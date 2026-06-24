from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator

from app.graph.simulation_graph import build_simulation_graph, engine
from app.models.agent import SocialPlaybook
from app.models.events import SimEvent
from app.models.state import SimulationState
from app.seed import DEFAULT_OUGHT, create_seed_agents


class SimulationRunner:
    def __init__(self) -> None:
        self.graph = build_simulation_graph()
        self.event_queue: asyncio.Queue[SimEvent] = asyncio.Queue()
        self.state: SimulationState | None = None
        self._task: asyncio.Task | None = None
        self.thread_id = str(uuid.uuid4())
        self._lock = asyncio.Lock()

    def _initial_state(
        self,
        agent_count: int = 10,
        max_ticks: int = 100,
        speed: float = 1.0,
    ) -> SimulationState:
        return SimulationState(
            tick=0,
            macro_season="sharp",
            micro_season="harvest",
            judgment_temperature="sharp",
            agents=create_seed_agents(agent_count),
            playbook=SocialPlaybook(),
            regret=0.0,
            regret_narrative="",
            ought_snapshot=DEFAULT_OUGHT,
            events=[],
            institutions=[],
            raptor_nodes=[],
            quality_pool=[],
            running=False,
            max_ticks=max_ticks,
            speed=speed,
            paused=False,
        )

    async def start(
        self,
        agent_count: int = 10,
        max_ticks: int = 100,
        speed: float = 1.0,
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
            self.state = self._initial_state(agent_count, max_ticks, speed)
            self.state["running"] = True
            self.state["paused"] = False
            self._task = asyncio.create_task(self._run_loop())
            return self.state

    async def pause(self) -> SimulationState | None:
        if self.state:
            self.state["paused"] = not self.state.get("paused", False)
        return self.state

    async def step(self) -> SimulationState | None:
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
                    SimEvent(type="sim_complete", tick=self.state["tick"], payload={})
                )
                break
            async with self._lock:
                await self._run_single_tick()
            delay = 1.0 / max(self.state.get("speed", 1.0), 0.1)
            await asyncio.sleep(delay)

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
                yield f"data: {json.dumps({'type': 'heartbeat', 'tick': self.state['tick'] if self.state else 0})}\n\n"

    def get_state_snapshot(self) -> dict[str, Any] | None:
        if not self.state:
            return None
        s = self.state
        return {
            "tick": s["tick"],
            "macro_season": s["macro_season"],
            "micro_season": s["micro_season"],
            "judgment_temperature": s["judgment_temperature"],
            "regret": s["regret"],
            "regret_narrative": s["regret_narrative"],
            "running": s["running"],
            "paused": s.get("paused", False),
            "max_ticks": s["max_ticks"],
            "speed": s["speed"],
            "agents": [a.model_dump() for a in s["agents"]],
            "playbook": s["playbook"].to_matrix_summary(),
            "institutions": [i.model_dump() for i in s["institutions"]],
            "raptor_nodes": [n.model_dump() for n in s["raptor_nodes"]],
            "custodian": engine.custodian.to_dict(),
            "quality_pool_size": len(s["quality_pool"]),
        }


runner = SimulationRunner()