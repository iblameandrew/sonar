from __future__ import annotations

import uuid

from app.models.agent import QualitativeAgent, SpecialistRole
from app.models.canvas import ProjectCanvas, Subtask

VOXFORGE_REQUIREMENTS = [
    "Interactive voxel-art 3D visualization of agent societies",
    "LangGraph orchestration with live SSE updates",
    "Task decomposition UI and negotiation panel",
    "Conflict resolution tools and live metrics dashboard",
    "FastAPI backend + Three.js frontend integration",
    "Automatic benchmarking against single-agent baseline",
]

SPECIALISTS: list[dict] = [
    {
        "name": "Voxel Architect",
        "role": "voxel_architect",
        "verbs": ["render", "animate", "instanciate"],
        "nouns": ["voxels", "meshes", "shaders"],
        "adjectives": ["visual", "precise"],
        "grid": (4, 8),
    },
    {
        "name": "Orchestrator",
        "role": "orchestrator",
        "verbs": ["orchestrate", "stream", "checkpoint"],
        "nouns": ["langgraph", "sse", "state"],
        "adjectives": ["coordinated", "reliable"],
        "grid": (12, 8),
    },
    {
        "name": "Optimizer",
        "role": "optimizer",
        "verbs": ["benchmark", "profile", "tune"],
        "nouns": ["metrics", "latency", "throughput"],
        "adjectives": ["efficient", "analytical"],
        "grid": (20, 8),
    },
    {
        "name": "Integrator",
        "role": "integrator",
        "verbs": ["wire", "deploy", "proxy"],
        "nouns": ["fastapi", "vite", "cors"],
        "adjectives": ["connected", "robust"],
        "grid": (8, 16),
    },
    {
        "name": "UX Weaver",
        "role": "ux_weaver",
        "verbs": ["layout", "toggle", "dashboard"],
        "nouns": ["panels", "controls", "overlays"],
        "adjectives": ["judge-friendly", "clear"],
        "grid": (16, 16),
    },
    {
        "name": "Critic",
        "role": "critic_evaluator",
        "verbs": ["evaluate", "compare", "score"],
        "nouns": ["baseline", "rubric", "evidence"],
        "adjectives": ["rigorous", "skeptical"],
        "grid": (24, 16),
    },
]

INITIAL_SUBTASKS = [
    ("Architecture", "Define VoxForge system architecture and module boundaries", None),
    ("Voxel Viz", "Implement Conway-style pixel-art society visualization", "Architecture"),
    ("LangGraph Core", "Build PERFORM→ATTEND→AUDIT→REFORM→CONFESS graph", "Architecture"),
    ("SSE Pipeline", "Wire live SSE event stream to frontend", "LangGraph Core"),
    ("Negotiation UI", "Build negotiation panel and task tree UI", "Architecture"),
    ("Metrics Dashboard", "Implement society vs baseline comparison", "Architecture"),
    ("Integration", "FastAPI + Three.js production integration", "Architecture"),
    ("Benchmark Harness", "Single-agent baseline runner", "Metrics Dashboard"),
]


def create_specialist_agents() -> list[QualitativeAgent]:
    agents: list[QualitativeAgent] = []
    for spec in SPECIALISTS:
        agents.append(
            QualitativeAgent(
                id=f"agent-{uuid.uuid4().hex[:8]}",
                name=spec["name"],
                role=spec["role"],  # type: ignore[arg-type]
                verbs=list(spec["verbs"]),
                nouns=list(spec["nouns"]),
                adjectives=list(spec["adjectives"]),
                grid_x=spec["grid"][0],
                grid_y=spec["grid"][1],
            )
        )
    return agents


def create_project_canvas() -> ProjectCanvas:
    subtasks: list[Subtask] = []
    id_map: dict[str, str] = {}
    for title, desc, parent_title in INITIAL_SUBTASKS:
        tid = f"task-{uuid.uuid4().hex[:6]}"
        id_map[title] = tid
        subtasks.append(
            Subtask(
                id=tid,
                title=title,
                description=desc,
                parent_id=id_map.get(parent_title) if parent_title else None,
            )
        )
    return ProjectCanvas(
        goal="Design and build VoxForge collaborative engineering workspace",
        requirements=VOXFORGE_REQUIREMENTS,
        subtasks=subtasks,
    )


DEFAULT_OUGHT: dict = {
    "description": "VoxForge must be demo-ready with society outperforming single-agent baseline",
    "desired_adjectives": ["collaborative", "transparent", "efficient", "demo-ready"],
    "desired_balance": {
        "quality": "high",
        "transparency": "high",
        "conflict_resolution": "active",
        "feature_completeness": "high",
    },
    "voxforge_modules": [
        "voxel_visualization",
        "langgraph_orchestration",
        "sse_streaming",
        "negotiation_panel",
        "metrics_dashboard",
        "baseline_comparison",
    ],
}


VOXFORGE_VOXEL_BLUEPRINT = [
    {"x": 30, "y": 4, "z": 0, "color": "#4060a0", "label": "backend_tower"},
    {"x": 31, "y": 4, "z": 0, "color": "#4060a0", "label": "backend_tower"},
    {"x": 32, "y": 4, "z": 0, "color": "#60c080", "label": "sse_pipe"},
    {"x": 33, "y": 4, "z": 0, "color": "#f0c040", "label": "ui_panel"},
    {"x": 34, "y": 4, "z": 0, "color": "#f0c040", "label": "ui_panel"},
    {"x": 35, "y": 5, "z": 0, "color": "#c080f0", "label": "metrics_crystal"},
    {"x": 36, "y": 4, "z": 0, "color": "#40c070", "label": "viz_guild"},
    {"x": 37, "y": 4, "z": 0, "color": "#40c070", "label": "viz_guild"},
]


def create_seed_agents(count: int | None = None) -> list[QualitativeAgent]:
    return create_specialist_agents()