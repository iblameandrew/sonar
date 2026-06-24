from __future__ import annotations

import random
import uuid

from app.grid import allocate_positions
from app.models.agent import QualitativeAgent, SpecialistRole

SOCIETY_REQUIREMENTS = [
    "Interactive voxel-art 3D visualization of agent societies",
    "LangGraph orchestration with live SSE updates",
    "Task decomposition UI and negotiation panel",
    "Conflict resolution tools and live metrics dashboard",
    "FastAPI backend + Three.js frontend integration",
    "Automatic benchmarking against single-agent baseline",
]

SPECIALISTS: list[dict] = [
    {"name": "Voxel Architect", "role": "voxel_architect", "verbs": ["render", "animate"], "nouns": ["voxels"], "adjectives": ["visual"]},
    {"name": "Orchestrator", "role": "orchestrator", "verbs": ["orchestrate", "stream"], "nouns": ["langgraph"], "adjectives": ["coordinated"]},
    {"name": "Optimizer", "role": "optimizer", "verbs": ["benchmark", "tune"], "nouns": ["metrics"], "adjectives": ["efficient"]},
    {"name": "Integrator", "role": "integrator", "verbs": ["wire", "deploy"], "nouns": ["fastapi"], "adjectives": ["connected"]},
    {"name": "UX Weaver", "role": "ux_weaver", "verbs": ["layout", "dashboard"], "nouns": ["panels"], "adjectives": ["clear"]},
    {"name": "Critic", "role": "critic_evaluator", "verbs": ["evaluate", "score"], "nouns": ["baseline"], "adjectives": ["rigorous"]},
]

WORKER_VERBS = ["forage", "carry", "signal", "patrol", "gather", "relay"]
WORKER_NOUNS = ["grain", "spark", "trail", "node", "pulse", "mark"]
WORKER_ADJ = ["alert", "busy", "calm", "eager", "restless"]

INITIAL_SUBTASKS = [
    ("Architecture", "Define Sociomorphic Computing system architecture and module boundaries", None),
    ("Voxel Viz", "Implement Conway colony visualization", "Architecture"),
    ("LangGraph Core", "Build PERFORM→ATTEND→AUDIT→REFORM→CONFESS graph", "Architecture"),
    ("SSE Pipeline", "Wire live SSE event stream to frontend", "LangGraph Core"),
    ("Negotiation UI", "Build negotiation panel and task tree UI", "Architecture"),
    ("Metrics Dashboard", "Implement society vs baseline comparison", "Architecture"),
    ("Integration", "FastAPI + Three.js production integration", "Architecture"),
    ("Benchmark Harness", "Single-agent baseline runner", "Metrics Dashboard"),
]


def create_colony_agents(count: int = 48) -> list[QualitativeAgent]:
    count = max(6, min(count, 512))
    positions = allocate_positions(count)
    agents: list[QualitativeAgent] = []

    for i, spec in enumerate(SPECIALISTS):
        if i >= len(positions):
            break
        x, y = positions[i]
        agents.append(
            QualitativeAgent(
                id=f"agent-{uuid.uuid4().hex[:8]}",
                name=spec["name"],
                role=spec["role"],  # type: ignore[arg-type]
                verbs=list(spec["verbs"]),
                nouns=list(spec["nouns"]),
                adjectives=list(spec["adjectives"]),
                grid_x=x,
                grid_y=y,
            )
        )

    for j in range(len(agents), count):
        x, y = positions[j]
        agents.append(
            QualitativeAgent(
                id=f"drone-{uuid.uuid4().hex[:8]}",
                name=f"Drone-{j - len(SPECIALISTS) + 1:03d}",
                role="worker",  # type: ignore[arg-type]
                verbs=[random.choice(WORKER_VERBS)],
                nouns=[random.choice(WORKER_NOUNS)],
                adjectives=[random.choice(WORKER_ADJ)],
                grid_x=x,
                grid_y=y,
            )
        )
    return agents


def create_specialist_agents() -> list[QualitativeAgent]:
    return create_colony_agents(6)


def create_project_canvas() -> ProjectCanvas:
    from app.models.canvas import ProjectCanvas, Subtask
    subtasks: list[Subtask] = []
    id_map: dict[str, str] = {}
    for title, desc, parent_title in INITIAL_SUBTASKS:
        tid = f"task-{uuid.uuid4().hex[:6]}"
        id_map[title] = tid
        subtasks.append(Subtask(id=tid, title=title, description=desc, parent_id=id_map.get(parent_title) if parent_title else None))
    return ProjectCanvas(
        goal="Build Sociomorphic Computing — qualitative social physics as software",
        requirements=SOCIETY_REQUIREMENTS,
        subtasks=subtasks,
    )


DEFAULT_OUGHT: dict = {
    "description": "Sociomorphic Computing must be demo-ready with society outperforming single-agent baseline",
    "desired_adjectives": ["collaborative", "transparent", "efficient", "demo-ready"],
    "society_modules": [
        "voxel_visualization",
        "langgraph_orchestration",
        "sse_streaming",
        "negotiation_panel",
        "metrics_dashboard",
        "baseline_comparison",
    ],
}

COLONY_VOXEL_BLUEPRINT = [
    {"x": 45, "y": 45, "z": 0, "color": "#4060a0", "label": "backend_tower"},
    {"x": 46, "y": 45, "z": 0, "color": "#60c080", "label": "sse_pipe"},
    {"x": 47, "y": 45, "z": 0, "color": "#f0c040", "label": "ui_panel"},
    {"x": 48, "y": 46, "z": 0, "color": "#c080f0", "label": "metrics_crystal"},
]


def create_seed_agents(count: int | None = None) -> list[QualitativeAgent]:
    return create_colony_agents(count or 48)