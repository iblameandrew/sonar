from __future__ import annotations

import asyncio
from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.agents.attention import AttentionAgent
from app.agents.auditor import Auditor
from app.agents.confessor import Confessor
from app.agents.conflict_resolver import ConflictResolver
from app.agents.decomposer import Decomposer
from app.agents.messenger import Messenger
from app.agents.negotiator import Negotiator
from app.agents.reformer import Reformer
from app.agents.spanner import Spanner
from app.baseline.single_agent import SingleAgentBaseline
from app.institutions.condense import InstitutionCondenser
from app.lifecycle.rules import LifecycleRules
from app.models.events import SimEvent
from app.models.metrics import RunMetrics
from app.models.state import SimulationState
from app.seasons.raptor import RaptorMemory
from app.seasons.scheduler import SeasonScheduler
from app.llm.qwen_factory import qwen_factory
from app.store.custodian import Custodian
from app.store.playbook import PlaybookStore


class SimulationEngine:
    def __init__(self) -> None:
        self.messenger = Messenger()
        self.decomposer = Decomposer()
        self.attention = AttentionAgent()
        self.negotiator = Negotiator()
        self.auditor = Auditor()
        self.conflict = ConflictResolver()
        self.reformer = Reformer()
        self.spanner = Spanner()
        self.confessor = Confessor()
        self.lifecycle = LifecycleRules()
        self.institutions = InstitutionCondenser()
        self.seasons = SeasonScheduler()
        self.raptor = RaptorMemory()
        self.custodian = Custodian()
        self.playbook_store = PlaybookStore()
        self.baseline = SingleAgentBaseline()


engine = SimulationEngine()


async def _emit_phase(tick: int, phase: str) -> None:
    from app.simulation.runner import runner

    runner.record_live_phase(tick, phase)
    await runner.event_queue.put(
        SimEvent(type="tick_phase", tick=tick, payload={"phase": phase})
    )


async def perform_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "PERFORM")
    phase = state.get("design_phase", "concept")
    agents, canvas, events = await asyncio.to_thread(
        engine.messenger.perform,
        state["agents"], state["institutions"], state["canvas"], tick, phase,
    )
    return {"agents": agents, "canvas": canvas, "events": events}


async def decompose_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "DECOMPOSE")
    phase = state.get("design_phase", "concept")
    canvas, agents, events = await asyncio.to_thread(
        engine.decomposer.decompose,
        state["canvas"], state["agents"], tick, phase,
    )
    return {"canvas": canvas, "agents": agents, "events": events}


async def attend_node(state: SimulationState) -> dict[str, Any]:
    from app.simulation.runner import runner

    tick = state["tick"]
    await _emit_phase(tick, "ATTEND")
    macro, micro, phase, temperature, dominant_kind, season_weight, season_event = (
        engine.seasons.resolve(tick)
    )

    async def on_attention_progress(done: int, total: int, matched: int) -> None:
        runner.record_live_phase(tick, "ATTEND", done=done, total=total, matched=matched)
        await runner.event_queue.put(
            SimEvent(
                type="attention_progress",
                tick=tick,
                payload={"done": done, "total": total, "matched": matched},
            )
        )

    entries = await engine.attention.judge_all_pairs(
        state["agents"],
        tick,
        season_weight,
        temperature,
        dominant_kind,
        state.get("attention_policy"),
        on_progress=on_attention_progress,
    )

    playbook = state["playbook"]
    events: list[SimEvent] = []
    if season_event:
        events.append(season_event)

    for entry in entries:
        playbook.add(entry)
        engine.playbook_store.append(entry)
        events.append(
            SimEvent(type="attention_judgment", tick=tick, payload=entry.model_dump())
        )

    canvas, extra, neg_events = engine.negotiator.negotiate(
        state["canvas"], state["agents"], entries, tick
    )
    for entry in extra:
        playbook.add(entry)
        engine.playbook_store.append(entry)
        events.append(
            SimEvent(type="attention_judgment", tick=tick, payload=entry.model_dump())
        )
    events.extend(neg_events)

    return {
        "playbook": playbook,
        "canvas": canvas,
        "macro_season": macro,
        "micro_season": micro,
        "design_phase": phase,
        "judgment_temperature": temperature,
        "events": events,
    }


async def negotiate_node(state: SimulationState) -> dict[str, Any]:
    return {"events": []}


async def audit_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "AUDIT")
    regret, narrative, event = await asyncio.to_thread(
        engine.auditor.audit,
        state["agents"],
        state["canvas"],
        state["ought_snapshot"],
        len(state["playbook"].entries),
        tick,
        inject_conflict=state.get("inject_conflict", False),
    )
    metrics = state["metrics"]
    if state.get("execution_mode") == "society":
        m = metrics.society
        m.iterations = tick + 1
        m.quality_score = 1.0 - regret
        m.negotiations = len(state["canvas"].negotiations)
        m.subtasks_completed = sum(
            1 for t in state["canvas"].subtasks if t.status == "done"
        )
        m.features_complete = state["canvas"].society_progress
        m.transparency_events += 1
        if event.payload.get("conflict_detected"):
            m.conflicts_detected += 1
        m.tokens_estimate = 1200 + tick * 250 * len(state["agents"])

    return {
        "regret": regret,
        "regret_narrative": narrative,
        "inject_conflict": False,
        "metrics": metrics,
        "events": [event],
    }


async def conflict_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "CONFLICT")
    canvas, agents, events, resolved = await asyncio.to_thread(
        engine.conflict.resolve,
        state["canvas"],
        state["agents"],
        state["regret"],
        state["regret_narrative"],
        tick,
        forced=state.get("inject_conflict", False),
    )
    metrics = state["metrics"]
    if resolved and state.get("execution_mode") == "society":
        metrics.society.conflicts_resolved += 1

    return {
        "canvas": canvas,
        "agents": agents,
        "conflict_active": resolved,
        "metrics": metrics,
        "events": events,
    }


async def reform_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "REFORM")
    agents, spanner_events = await asyncio.to_thread(
        engine.spanner.fit,
        state["agents"],
        state["ought_snapshot"],
        state["regret"],
        tick,
    )
    agents, reform_events = await asyncio.to_thread(
        engine.reformer.reform,
        agents,
        state["regret"],
        state["regret_narrative"],
        state["ought_snapshot"],
        tick,
    )
    return {"agents": agents, "events": spanner_events + reform_events}


def _confess_sync(state: SimulationState, tick: int) -> dict[str, Any]:
    agents, events = engine.confessor.confess(
        state["agents"], state["playbook"], engine.custodian, tick,
    )
    institutions, inst_events = engine.institutions.condense(
        state["playbook"], state["institutions"], state["macro_season"], tick,
    )
    agents = engine.institutions.assign_members(agents, institutions)
    agents, pool, life_events = engine.lifecycle.apply(
        agents, state["playbook"], state["quality_pool"], tick,
    )
    raptor_nodes, raptor_events = engine.raptor.maybe_summarize(
        state["raptor_nodes"],
        state["playbook"],
        state["macro_season"],
        state["micro_season"],
        tick,
    )
    return {
        "agents": agents,
        "institutions": institutions,
        "quality_pool": pool,
        "raptor_nodes": raptor_nodes,
        "events": events,
        "inst_events": inst_events,
        "life_events": life_events,
        "raptor_events": raptor_events,
    }


async def confess_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    await _emit_phase(tick, "CONFESS")
    bundle = await asyncio.to_thread(_confess_sync, state, tick)
    agents = bundle["agents"]
    events = bundle["events"]
    inst_events = bundle["inst_events"]
    life_events = bundle["life_events"]
    raptor_events = bundle["raptor_events"]
    institutions = bundle["institutions"]
    pool = bundle["quality_pool"]
    raptor_nodes = bundle["raptor_nodes"]

    metrics = state["metrics"]
    metrics.compute_summary()
    usage = qwen_factory.get_usage_summary()
    metrics.society.tokens_estimate = usage.get("total_tokens", metrics.society.tokens_estimate)

    metrics_event = SimEvent(type="society_metrics", tick=tick, payload=metrics.model_dump())
    qwen_event = SimEvent(type="qwen_usage", tick=tick, payload={**qwen_factory.get_status(), "tick": tick})

    all_events = events + inst_events + life_events + raptor_events + [metrics_event, qwen_event]
    return {
        "agents": agents,
        "institutions": institutions,
        "quality_pool": pool,
        "raptor_nodes": raptor_nodes,
        "metrics": metrics,
        "events": all_events,
    }


def route_after_audit(state: SimulationState) -> str:
    if state["regret"] >= 0.55 or state.get("inject_conflict"):
        return "conflict"
    return "reform"


def should_continue(state: SimulationState) -> str:
    if state.get("paused"):
        return "end"
    if state["tick"] >= state["max_ticks"]:
        return "end"
    return "continue"


async def increment_tick(state: SimulationState) -> dict[str, Any]:
    return {"tick": state["tick"] + 1, "events": []}


def build_simulation_graph():
    graph = StateGraph(SimulationState)

    graph.add_node("perform", perform_node)
    graph.add_node("decompose", decompose_node)
    graph.add_node("attend", attend_node)
    graph.add_node("negotiate", negotiate_node)
    graph.add_node("audit", audit_node)
    graph.add_node("conflict", conflict_node)
    graph.add_node("reform", reform_node)
    graph.add_node("confess", confess_node)
    graph.add_node("increment", increment_tick)

    graph.set_entry_point("perform")
    graph.add_edge("perform", "decompose")
    graph.add_edge("decompose", "attend")
    graph.add_edge("attend", "negotiate")
    graph.add_edge("negotiate", "audit")
    graph.add_conditional_edges(
        "audit",
        route_after_audit,
        {"conflict": "conflict", "reform": "reform"},
    )
    graph.add_edge("conflict", "reform")
    graph.add_edge("reform", "confess")
    graph.add_edge("confess", "increment")
    graph.add_conditional_edges(
        "increment",
        should_continue,
        {"continue": "perform", "end": END},
    )

    return graph.compile(checkpointer=MemorySaver())