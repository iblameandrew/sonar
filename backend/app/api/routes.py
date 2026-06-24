from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.graph.simulation_graph import engine
from app.seed import create_project_canvas, create_specialist_agents
from app.simulation.runner import runner

router = APIRouter(prefix="/api")


class StartRequest(BaseModel):
    max_ticks: int = Field(default=80, ge=1, le=500)
    speed: float = Field(default=1.0, ge=0.1, le=10.0)


class SeasonForceRequest(BaseModel):
    macro_season: str | None = None
    micro_season: str | None = None
    design_phase: str | None = None


class SpeedRequest(BaseModel):
    speed: float = Field(ge=0.1, le=10.0)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "system": "THE ATTENTION AGENT SOCIETY", "project": "VoxForge"}


@router.get("/state")
async def get_state() -> dict[str, Any]:
    snapshot = runner.get_state_snapshot()
    if not snapshot:
        return {
            "tick": 0,
            "design_phase": "concept",
            "execution_mode": "idle",
            "agents": [a.model_dump() for a in create_specialist_agents()],
            "canvas": create_project_canvas().model_dump(),
            "playbook": [],
            "institutions": [],
            "metrics": {},
            "running": False,
        }
    return snapshot


@router.get("/stream")
async def stream_events() -> EventSourceResponse:
    return EventSourceResponse(runner.event_stream())


@router.post("/sim/society")
async def run_society(req: StartRequest) -> dict[str, Any]:
    state = await runner.start(req.max_ticks, req.speed, mode="society")
    return {
        "status": "society_started",
        "tick": state["tick"],
        "agents": len(state["agents"]),
        "subtasks": len(state["canvas"].subtasks),
    }


@router.post("/sim/baseline")
async def run_baseline(req: StartRequest) -> dict[str, Any]:
    result = await runner.start_baseline(req.max_ticks)
    return result


@router.post("/sim/start")
async def start_sim(req: StartRequest) -> dict[str, Any]:
    return await run_society(req)


@router.post("/sim/pause")
async def pause_sim() -> dict[str, Any]:
    state = await runner.pause()
    return {"status": "toggled", "tick": state["tick"] if state else runner.baseline_state}


@router.post("/sim/step")
async def step_sim() -> dict[str, Any]:
    await runner.step()
    snap = runner.get_state_snapshot()
    return snap or {"baseline_tick": runner.baseline_state}


@router.post("/sim/speed")
async def set_speed(req: SpeedRequest) -> dict[str, float]:
    if runner.state:
        runner.state["speed"] = req.speed
    return {"speed": req.speed}


@router.post("/sim/inject-conflict")
async def inject_conflict() -> dict[str, str]:
    try:
        return await runner.inject_conflict()
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/sim/advance-phase")
async def advance_phase() -> dict[str, str]:
    try:
        return await runner.advance_phase()
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/metrics")
async def get_metrics() -> dict[str, Any]:
    return runner.get_metrics()


@router.post("/season/force")
async def force_season(req: SeasonForceRequest) -> dict[str, str | None]:
    engine.seasons.force(req.macro_season, req.micro_season, req.design_phase)
    return {
        "macro_season": req.macro_season,
        "micro_season": req.micro_season,
        "design_phase": req.design_phase,
    }


@router.get("/playbook")
async def get_playbook() -> dict[str, Any]:
    if runner.state:
        return {
            "entries": runner.state["playbook"].to_matrix_summary(),
            "negotiations": [n.model_dump() for n in runner.state["canvas"].negotiations],
            "count": len(runner.state["playbook"].entries),
        }
    return {"entries": [], "negotiations": [], "count": 0}


@router.get("/canvas")
async def get_canvas() -> dict[str, Any]:
    if runner.state:
        return runner.state["canvas"].model_dump()
    return create_project_canvas().model_dump()


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