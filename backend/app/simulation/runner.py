from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator

from app.attention_policy import normalize_policy, preview_entries
from app.baseline.single_agent import SingleAgentBaseline
from app.llm.qwen_factory import qwen_factory
from app.graph.simulation_graph import build_simulation_graph, engine
from app.models.agent import SocialPlaybook
from app.models.canvas import ProjectCanvas
from app.models.events import SimEvent
from app.models.metrics import ComparisonMetrics, RunMetrics
from app.models.state import SimulationState
from app.grid import WORLD_SIZE, sector_id, total_walkable_cells
from app.seed import create_colony_agents, create_project_canvas, ought_for_prompt
from app.synthesis.final_answer import build_final_answer


class SimulationRunner:
    def __init__(self) -> None:
        self.graph = build_simulation_graph()
        self.baseline = SingleAgentBaseline()
        self.event_queue: asyncio.Queue[SimEvent] = asyncio.Queue()
        self.state: SimulationState | None = None
        self.baseline_state: dict[str, Any] | None = None
        self._task: asyncio.Task | None = None
        self.thread_id = str(uuid.uuid4())
        self._lock = asyncio.Lock()
        self.execution_mode: str = "society"
        self.live_phase: str = "idle"
        self.live_attention: dict[str, int] = {"done": 0, "total": 0, "matched": 0}
        self.final_answer: str = ""

    def reset_live_progress(self) -> None:
        self.live_phase = "idle"
        self.live_attention = {"done": 0, "total": 0, "matched": 0}

    def record_live_phase(self, tick: int, phase: str, **attention: int) -> None:
        self.live_phase = phase
        if attention:
            self.live_attention.update(attention)

    def _initial_state(
        self,
        max_ticks: int = 100,
        speed: float = 1.0,
        mode: str = "society",
        agent_count: int = 48,
        user_prompt: str | None = None,
        attention_policy: dict[str, Any] | None = None,
    ) -> SimulationState:
        return SimulationState(
            tick=0,
            macro_season="sharp",
            micro_season="harvest",
            design_phase="concept",
            judgment_temperature="sharp",
            execution_mode=mode,
            agents=create_colony_agents(agent_count),
            playbook=SocialPlaybook(),
            canvas=create_project_canvas(user_prompt),
            regret=0.0,
            regret_narrative="",
            conflict_active=False,
            ought_snapshot=ought_for_prompt(user_prompt),
            events=[],
            institutions=[],
            raptor_nodes=[],
            quality_pool=[],
            metrics=ComparisonMetrics(),
            running=False,
            max_ticks=max_ticks,
            speed=speed,
            paused=False,
            inject_conflict=False,
            attention_policy=normalize_policy(attention_policy),
        )

    async def start(
        self,
        max_ticks: int = 100,
        speed: float = 1.0,
        mode: str = "society",
        agent_count: int = 48,
        user_prompt: str | None = None,
        attention_policy: dict[str, Any] | None = None,
    ) -> SimulationState:
        if self._task and not self._task.done():
            self._task.cancel()

        async with self._lock:
            engine.playbook_store.playbook = SocialPlaybook()
            engine.custodian.weights = {}
            self.reset_live_progress()
            self.final_answer = ""
            self.execution_mode = mode
            self.thread_id = str(uuid.uuid4())
            self.state = self._initial_state(
                max_ticks, speed, mode, agent_count, user_prompt, attention_policy,
            )
            self.state["running"] = True
            self.state["paused"] = False
            self._task = asyncio.create_task(self._run_loop())
            return self.state

    async def start_baseline(self, max_ticks: int = 50) -> dict[str, Any]:
        if self._task and not self._task.done():
            self._task.cancel()

        async with self._lock:
            self.execution_mode = "baseline"
            canvas = create_project_canvas()
            self.baseline_state = {
                "tick": 0,
                "canvas": canvas,
                "max_ticks": max_ticks,
                "running": True,
                "paused": False,
                "metrics": RunMetrics(mode="baseline"),
            }
            self._task = asyncio.create_task(self._run_baseline_loop())
            return {"status": "baseline_started", "mode": "baseline"}

    async def inject_conflict(self) -> dict[str, str]:
        if self.state:
            self.state["inject_conflict"] = True
            await self.event_queue.put(
                SimEvent(
                    type="conflict_injected",
                    tick=self.state["tick"],
                    payload={"message": "Artificial conflict injected for demo"},
                )
            )
            return {"status": "conflict_injected"}
        raise ValueError("No society simulation running")

    async def advance_phase(self) -> dict[str, str]:
        if self.state:
            phase = engine.seasons.advance_phase(self.state.get("design_phase", "concept"))
            engine.seasons.force(phase=phase)
            self.state["design_phase"] = phase
            await self.event_queue.put(
                SimEvent(
                    type="phase_change",
                    tick=self.state["tick"],
                    payload={"design_phase": phase, "manual": True},
                )
            )
            return {"design_phase": phase}
        raise ValueError("No simulation running")

    async def pause(self) -> SimulationState | None:
        if self.state:
            self.state["paused"] = not self.state.get("paused", False)
        if self.baseline_state:
            self.baseline_state["paused"] = not self.baseline_state.get("paused", False)
        return self.state

    async def step(self) -> SimulationState | None:
        if self.execution_mode == "baseline" and self.baseline_state:
            async with self._lock:
                await self._run_baseline_tick()
            return None
        if not self.state:
            return None
        async with self._lock:
            return await self._run_single_tick()

    async def _run_loop(self) -> None:
        while self.state and self.state["running"]:
            if self.state.get("paused"):
                await asyncio.sleep(0.2)
                continue
            if self.state["tick"] >= self.state["max_ticks"]:
                self.state["running"] = False
                self.final_answer = build_final_answer(self.state)
                await self.event_queue.put(
                    SimEvent(
                        type="sim_complete",
                        tick=self.state["tick"],
                        payload={
                            "mode": "society",
                            "final_answer": self.final_answer,
                            "goal": self.state["canvas"].goal,
                        },
                    )
                )
                break
            try:
                await self._run_single_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                tick = self.state["tick"] if self.state else 0
                await self.event_queue.put(
                    SimEvent(
                        type="sim_error",
                        tick=tick,
                        payload={"message": str(exc)},
                    )
                )
                if self.state:
                    self.state["running"] = False
                break
            delay = 1.0 / max(self.state.get("speed", 1.0), 0.1)
            await asyncio.sleep(delay)

    async def _run_baseline_loop(self) -> None:
        while self.baseline_state and self.baseline_state["running"]:
            if self.baseline_state.get("paused"):
                await asyncio.sleep(0.2)
                continue
            if self.baseline_state["tick"] >= self.baseline_state["max_ticks"]:
                self.baseline_state["running"] = False
                await self.event_queue.put(
                    SimEvent(type="sim_complete", tick=self.baseline_state["tick"], payload={"mode": "baseline"})
                )
                break
            async with self._lock:
                await self._run_baseline_tick()
            await asyncio.sleep(0.8)

    async def _run_baseline_tick(self) -> None:
        assert self.baseline_state is not None
        tick = self.baseline_state["tick"]
        canvas, events, metrics = self.baseline.run_tick(
            self.baseline_state["canvas"], tick
        )
        self.baseline_state["canvas"] = canvas
        self.baseline_state["metrics"] = metrics
        for event in events:
            await self.event_queue.put(event)
        if self.state:
            self.state["metrics"].baseline = metrics
            self.state["metrics"].compute_summary()
            await self.event_queue.put(
                SimEvent(
                    type="comparison_metrics",
                    tick=tick,
                    payload=self.state["metrics"].model_dump(),
                )
            )
        await self.event_queue.put(
            SimEvent(type="qwen_usage", tick=tick, payload=qwen_factory.get_status())
        )
        self.baseline_state["tick"] = tick + 1

    async def _run_single_tick(self) -> SimulationState:
        async with self._lock:
            if not self.state:
                raise RuntimeError("No simulation state")
            state = self.state
            thread_id = self.thread_id
            tick = state["tick"]

        self.record_live_phase(tick, "STARTING")
        await self.event_queue.put(
            SimEvent(
                type="tick_started",
                tick=tick,
                payload={
                    "max_ticks": state["max_ticks"],
                    "agent_count": len(state["agents"]),
                    "playbook_edges": len(state["playbook"].entries),
                },
            )
        )

        config = {"configurable": {"thread_id": thread_id}}
        result = dict(state)
        async for chunk in self.graph.astream(state, config, stream_mode="updates"):
            for _node, update in chunk.items():
                node_events = update.get("events") or []
                for event in node_events:
                    await self.event_queue.put(event)
                patch = {k: v for k, v in update.items() if k != "events"}
                if patch:
                    result.update(patch)  # type: ignore[typeddict-item]

        async with self._lock:
            if self.state is not state:
                return state  # type: ignore[return-value]
            self.state = result  # type: ignore[assignment]
            self.record_live_phase(result["tick"], "TICK_DONE")
            return self.state

    async def event_stream(self) -> AsyncGenerator[str, None]:
        """Yield JSON payloads only — EventSourceResponse adds the SSE data: framing."""
        while True:
            try:
                event = await asyncio.wait_for(self.event_queue.get(), timeout=10.0)
                yield json.dumps(event.to_sse())
            except asyncio.TimeoutError:
                tick = 0
                if self.state:
                    tick = self.state["tick"]
                elif self.baseline_state:
                    tick = self.baseline_state["tick"]
                yield json.dumps({"type": "heartbeat", "tick": tick})

    def get_state_snapshot(self) -> dict[str, Any] | None:
        if not self.state:
            return None
        s = self.state
        return {
            "tick": s["tick"],
            "macro_season": s["macro_season"],
            "micro_season": s["micro_season"],
            "design_phase": s.get("design_phase", "concept"),
            "judgment_temperature": s["judgment_temperature"],
            "execution_mode": s.get("execution_mode", "society"),
            "regret": s["regret"],
            "regret_narrative": s["regret_narrative"],
            "conflict_active": s.get("conflict_active", False),
            "running": s["running"],
            "paused": s.get("paused", False),
            "max_ticks": s["max_ticks"],
            "speed": s["speed"],
            "agents": [a.model_dump() for a in s["agents"]],
            "playbook": s["playbook"].to_matrix_summary(),
            "canvas": s["canvas"].model_dump(),
            "institutions": [i.model_dump() for i in s["institutions"]],
            "raptor_nodes": [n.model_dump() for n in s["raptor_nodes"]],
            "metrics": s["metrics"].model_dump(),
            "custodian": engine.custodian.to_dict(),
            "qwen": qwen_factory.get_status(),
            "colony": self._colony_stats(s["agents"]),
            "attention_policy": s.get("attention_policy"),
            "attention_policy_preview": preview_entries(s.get("attention_policy")),
            "live_phase": self.live_phase,
            "live_attention": dict(self.live_attention),
            "final_answer": self.final_answer or (
                build_final_answer(s) if not s["running"] else ""
            ),
        }

    def _colony_stats(self, agents: list) -> dict[str, Any]:
        sectors: dict[str, int] = {}
        for a in agents:
            sid = sector_id(a.grid_x, a.grid_y)
            sectors[sid] = sectors.get(sid, 0) + 1
        return {
            "world_size": WORLD_SIZE,
            "walkable_cells": total_walkable_cells(),
            "agent_count": len(agents),
            "sectors": sectors,
        }

    def get_metrics(self) -> dict[str, Any]:
        if not self.state:
            return {"comparison": ComparisonMetrics().model_dump()}
        m = self.state["metrics"]
        if self.baseline_state:
            m.baseline = self.baseline_state["metrics"]
        m.compute_summary()
        return {"comparison": m.model_dump(), "mode": self.execution_mode}


runner = SimulationRunner()