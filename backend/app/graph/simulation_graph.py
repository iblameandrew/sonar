from __future__ import annotations

from typing import Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.agents.attention import AttentionAgent
from app.agents.auditor import Auditor
from app.agents.confessor import Confessor
from app.agents.messenger import Messenger
from app.agents.reformer import Reformer
from app.institutions.condense import InstitutionCondenser
from app.lifecycle.rules import LifecycleRules
from app.models.agent import SocialPlaybook
from app.models.events import SimEvent
from app.models.state import SimulationState
from app.seasons.raptor import RaptorMemory
from app.seasons.scheduler import SeasonScheduler
from app.store.custodian import Custodian
from app.store.playbook import PlaybookStore


class SimulationEngine:
    def __init__(self) -> None:
        self.messenger = Messenger()
        self.attention = AttentionAgent()
        self.auditor = Auditor()
        self.reformer = Reformer()
        self.confessor = Confessor()
        self.lifecycle = LifecycleRules()
        self.institutions = InstitutionCondenser()
        self.seasons = SeasonScheduler()
        self.raptor = RaptorMemory()
        self.custodian = Custodian()
        self.playbook_store = PlaybookStore()


engine = SimulationEngine()


async def perform_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    agents, events = engine.messenger.perform(
        state["agents"], state["institutions"], tick
    )
    return {"agents": agents, "events": events}


async def attend_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    macro, micro, temperature, dominant_kind, season_weight, season_event = (
        engine.seasons.resolve(tick)
    )

    entries = await engine.attention.judge_all_pairs(
        state["agents"],
        tick,
        season_weight,
        temperature,
        dominant_kind,
    )

    playbook = state["playbook"]
    events: list[SimEvent] = []
    if season_event:
        events.append(season_event)

    for entry in entries:
        playbook.add(entry)
        engine.playbook_store.append(entry)
        events.append(
            SimEvent(
                type="attention_judgment",
                tick=tick,
                payload=entry.model_dump(),
            )
        )

    return {
        "playbook": playbook,
        "macro_season": macro,
        "micro_season": micro,
        "judgment_temperature": temperature,
        "events": events,
    }


async def audit_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    regret, narrative, event = engine.auditor.audit(
        state["agents"],
        state["ought_snapshot"],
        len(state["playbook"].entries),
        tick,
    )
    return {
        "regret": regret,
        "regret_narrative": narrative,
        "events": [event],
    }


async def reform_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    agents, events = engine.reformer.reform(
        state["agents"],
        state["regret"],
        state["regret_narrative"],
        state["ought_snapshot"],
        tick,
    )
    return {"agents": agents, "events": events}


async def confess_node(state: SimulationState) -> dict[str, Any]:
    tick = state["tick"]
    agents, events = engine.confessor.confess(
        state["agents"],
        state["playbook"],
        engine.custodian,
        tick,
    )

    institutions, inst_events = engine.institutions.condense(
        state["playbook"],
        state["institutions"],
        state["macro_season"],
        tick,
    )
    agents = engine.institutions.assign_members(agents, institutions)

    agents, pool, life_events = engine.lifecycle.apply(
        agents, state["playbook"], state["quality_pool"], tick
    )

    raptor_nodes, raptor_events = engine.raptor.maybe_summarize(
        state["raptor_nodes"],
        state["playbook"],
        state["macro_season"],
        state["micro_season"],
        tick,
    )

    all_events = events + inst_events + life_events + raptor_events
    return {
        "agents": agents,
        "institutions": institutions,
        "quality_pool": pool,
        "raptor_nodes": raptor_nodes,
        "events": all_events,
    }


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
    graph.add_node("attend", attend_node)
    graph.add_node("audit", audit_node)
    graph.add_node("reform", reform_node)
    graph.add_node("confess", confess_node)
    graph.add_node("increment", increment_tick)

    graph.set_entry_point("perform")
    graph.add_edge("perform", "attend")
    graph.add_edge("attend", "audit")
    graph.add_edge("audit", "reform")
    graph.add_edge("reform", "confess")
    graph.add_edge("confess", "increment")
    graph.add_conditional_edges(
        "increment",
        should_continue,
        {"continue": "perform", "end": END},
    )

    return graph.compile(checkpointer=MemorySaver())