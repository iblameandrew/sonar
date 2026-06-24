from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.graph.simulation_graph import engine
from app.llm.qwen_factory import qwen_factory
from app.grid import WORLD_SIZE, total_walkable_cells
from app.seed import create_colony_agents, create_project_canvas
from app.simulation.runner import runner

router = APIRouter(prefix="/api")


class StartRequest(BaseModel):
    max_ticks: int = Field(default=80, ge=1, le=500)
    speed: float = Field(default=1.0, ge=0.1, le=10.0)
    agent_count: int = Field(default=48, ge=6, le=512)
    prompt: str = Field(default="", max_length=4000)


class SeasonForceRequest(BaseModel):
    macro_season: str | None = None
    micro_season: str | None = None
    design_phase: str | None = None


class SpeedRequest(BaseModel):
    speed: float = Field(ge=0.1, le=10.0)


class QwenConfigRequest(BaseModel):
    role: str
    model: str
    temperature: float | None = None


class QwenApiKeyRequest(BaseModel):
    api_key: str = Field(min_length=8)


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "system": "Colony", "project": "Colony", "llm": "Qwen Cloud"}


@router.get("/qwen/status")
async def qwen_status() -> dict[str, Any]:
    return qwen_factory.get_status()


@router.get("/qwen/usage")
async def qwen_usage() -> dict[str, Any]:
    return qwen_factory.get_usage_summary()


@router.post("/qwen/api-key")
async def qwen_set_api_key(req: QwenApiKeyRequest) -> dict[str, Any]:
    qwen_factory.set_api_key(req.api_key)
    return qwen_factory.get_status()


@router.post("/qwen/configure")
async def qwen_configure(req: QwenConfigRequest) -> dict[str, Any]:
    kwargs = {}
    if req.temperature is not None:
        kwargs["temperature"] = req.temperature
    qwen_factory.set_role_model(req.role, req.model, **kwargs)
    from dataclasses import asdict
    return {"role": req.role, "model": req.model, "config": asdict(qwen_factory.get_config(req.role))}


@router.get("/state")
async def get_state() -> dict[str, Any]:
    snapshot = runner.get_state_snapshot()
    if not snapshot:
        return {
            "tick": 0,
            "design_phase": "concept",
            "execution_mode": "idle",
            "agents": [a.model_dump() for a in create_colony_agents(48)],
            "colony": {
                "world_size": WORLD_SIZE,
                "walkable_cells": total_walkable_cells(),
                "agent_count": 48,
            },
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
    prompt = req.prompt.strip() or None
    canvas = create_project_canvas(prompt)

    async def _launch() -> None:
        await runner.start(
            req.max_ticks,
            req.speed,
            mode="society",
            agent_count=req.agent_count,
            user_prompt=prompt,
        )

    asyncio.create_task(_launch())
    return {
        "status": "society_started",
        "tick": 0,
        "agents": req.agent_count,
        "subtasks": len(canvas.subtasks),
        "agent_count": req.agent_count,
        "goal": canvas.goal,
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