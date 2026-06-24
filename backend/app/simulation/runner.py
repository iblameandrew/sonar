from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator

from app.baseline.single_agent import SingleAgentBaseline
from app.graph.simulation_graph import build_simulation_graph, engine
from app.models.agent import SocialPlaybook
from app.models.canvas import ProjectCanvas
from app.models.events import SimEvent
from app.models.metrics import ComparisonMetrics, RunMetrics
from app.models.state import SimulationState
from app.seed import DEFAULT_OUGHT, create_project_canvas, create_specialist_agents


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

    def _initial_state(
        self,
        max_ticks: int = 100,
        speed: float = 1.0,
        mode: str = "society",
    ) -> SimulationState:
        return SimulationState(
            tick=0,
            macro_season="sharp",
            micro_season="harvest",
            design_phase="concept",
            judgment_temperature="sharp",
            execution_mode=mode,
            agents=create_specialist_agents(),
            playbook=SocialPlaybook(),
            canvas=create_project_canvas(),
            regret=0.0,
            regret_narrative="",
            conflict_active=False,
            ought_snapshot=DEFAULT_OUGHT,
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
        )

    async def start(
        self,
        max_ticks: int = 100,
        speed: float = 1.0,
        mode: str = "society",
    ) -> SimulationState:
        async with self._lock:
            if self._task and not self._task.done():
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass

            engine.playbook_store.playbook = SocialPlaybook()
            engine.custodian.weights = {}
            self.execution_mode = mode
            self.thread_id = str(uuid.uuid4())
            self.state = self._initial_state(max_ticks, speed, mode)
            self.state["running"] = True
            self.state["paused"] = False
            self._task = asyncio.create_task(self._run_loop())
            return self.state

    async def start_baseline(self, max_ticks: int = 50) -> dict[str, Any]:
        async with self._lock:
            if self._task and not self._task.done():
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass

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
                await self.event_queue.put(
                    SimEvent(type="sim_complete", tick=self.state["tick"], payload={"mode": "society"})
                )
                break
            async with self._lock:
                await self._run_single_tick()
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
        self.baseline_state["tick"] = tick + 1

    async def _run_single_tick(self) -> SimulationState:
        assert self.state is not None
        config = {"configurable": {"thread_id": self.thread_id}}
        result = await self.graph.ainvoke(self.state, config)
        events = result.get("events", [])
        for event in events:
            await self.event_queue.put(event)
        self.state = result  # type: ignore[assignment]
        return self.state

    async def event_stream(self) -> AsyncGenerator[str, None]:
        while True:
            try:
                event = await asyncio.wait_for(self.event_queue.get(), timeout=30.0)
                yield f"data: {json.dumps(event.to_sse())}\n\n"
            except asyncio.TimeoutError:
                tick = 0
                if self.state:
                    tick = self.state["tick"]
                elif self.baseline_state:
                    tick = self.baseline_state["tick"]
                yield f"data: {json.dumps({'type': 'heartbeat', 'tick': tick})}\n\n"

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