from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.graph.simulation_graph import engine
from app.simulation.runner import runner

router = APIRouter(prefix="/api")


class StartRequest(BaseModel):
    agent_count: int = Field(default=10, ge=3, le=50)
    max_ticks: int = Field(default=100, ge=1, le=1000)
    speed: float = Field(default=1.0, ge=0.1, le=10.0)


class SeasonForceRequest(BaseModel):
    macro_season: str | None = None
    micro_season: str | None = None


class SpeedRequest(BaseModel):
    speed: float = Field(ge=0.1, le=10.0)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "system": "THE ATTENTION AGENT"}


@router.get("/state")
async def get_state() -> dict[str, Any]:
    snapshot = runner.get_state_snapshot()
    if not snapshot:
        from app.seed import create_seed_agents

        return {
            "tick": 0,
            "agents": [a.model_dump() for a in create_seed_agents(10)],
            "playbook": [],
            "institutions": [],
            "raptor_nodes": [],
            "running": False,
        }
    return snapshot


@router.get("/stream")
async def stream_events() -> EventSourceResponse:
    return EventSourceResponse(runner.event_stream())


@router.post("/sim/start")
async def start_sim(req: StartRequest) -> dict[str, Any]:
    state = await runner.start(req.agent_count, req.max_ticks, req.speed)
    return {"status": "started", "tick": state["tick"], "agents": len(state["agents"])}


@router.post("/sim/pause")
async def pause_sim() -> dict[str, Any]:
    state = await runner.pause()
    if not state:
        raise HTTPException(400, "No simulation running")
    return {"status": "paused" if state.get("paused") else "resumed", "tick": state["tick"]}


@router.post("/sim/step")
async def step_sim() -> dict[str, Any]:
    state = await runner.step()
    if not state:
        raise HTTPException(400, "No simulation — call /sim/start first")
    return runner.get_state_snapshot() or {}


@router.post("/sim/speed")
async def set_speed(req: SpeedRequest) -> dict[str, float]:
    if runner.state:
        runner.state["speed"] = req.speed
    return {"speed": req.speed}


@router.post("/season/force")
async def force_season(req: SeasonForceRequest) -> dict[str, str | None]:
    engine.seasons.force(req.macro_season, req.micro_season)
    return {"macro_season": req.macro_season, "micro_season": req.micro_season}


@router.get("/playbook")
async def get_playbook() -> dict[str, Any]:
    if runner.state:
        return {
            "entries": runner.state["playbook"].to_matrix_summary(),
            "count": len(runner.state["playbook"].entries),
        }
    return {"entries": [], "count": 0}


@router.get("/raptor")
async def get_raptor() -> dict[str, Any]:
    if runner.state:
        return {"nodes": [n.model_dump() for n in runner.state["raptor_nodes"]]}
    return {"nodes": []}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str) -> dict[str, Any]:
    if not runner.state:
        raise HTTPException(404, "No simulation")
    agent = next((a for a in runner.state["agents"] if a.id == agent_id), None)
    if not agent:
        raise HTTPException(404, f"Agent {agent_id} not found")
    pb = runner.state["playbook"]
    return {
        "agent": agent.model_dump(),
        "incoming": [e.model_dump() for e in pb.incoming(agent_id)],
        "outgoing": [e.model_dump() for e in pb.outgoing(agent_id)],
    }