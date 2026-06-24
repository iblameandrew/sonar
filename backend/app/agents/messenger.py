from __future__ import annotations

import uuid

from app.models.agent import QualitativeAgent
from app.models.canvas import Artifact, ProjectCanvas
from app.models.events import SimEvent
from app.models.institution import Institution
from app.seed import VOXFORGE_VOXEL_BLUEPRINT

ROLE_ARTIFACTS: dict[str, tuple[str, str, str]] = {
    "voxel_architect": ("ui", "Voxel Renderer", "InstancedMesh pixel-grid with Conway Life aesthetic"),
    "orchestrator": ("architecture", "LangGraph Orchestrator", "StateGraph with SSE event bus per tick"),
    "optimizer": ("benchmark", "Benchmark Harness", "Society vs baseline metrics collector"),
    "integrator": ("integration", "FastAPI+Three.js Glue", "Vite proxy, static mount, CORS"),
    "ux_weaver": ("ui", "Dashboard Panels", "Negotiation, metrics, task tree, toggleable layers"),
    "critic_evaluator": ("tradeoff", "Trade-off Analysis", "Society wins on transparency and conflict resolution"),
}


class Messenger:
    """Feed-forward: agents propose solutions and code artifacts."""

    def perform(
        self,
        agents: list[QualitativeAgent],
        institutions: list[Institution],
        canvas: ProjectCanvas,
        tick: int,
        phase: str,
    ) -> tuple[list[QualitativeAgent], ProjectCanvas, list[SimEvent]]:
        events: list[SimEvent] = []
        inst_by_id = {i.id: i for i in institutions}
        canvas = canvas.model_copy(deep=True)
        updated: list[QualitativeAgent] = []

        for agent in agents:
            agent = agent.model_copy(deep=True)
            if agent.current_task_id:
                task = next(
                    (t for t in canvas.subtasks if t.id == agent.current_task_id), None
                )
                if task and task.status == "assigned":
                    task.status = "in_progress"
                    kind, title, content = ROLE_ARTIFACTS.get(
                        agent.role,
                        ("code", f"{agent.name} output", f"Proposal for {task.title}"),
                    )
                    content = f"[{phase}] {content} — task: {task.description}"
                    art = Artifact(
                        id=f"art-{uuid.uuid4().hex[:8]}",
                        kind=kind,  # type: ignore[arg-type]
                        title=title,
                        content=content,
                        author_id=agent.id,
                        tick=tick,
                    )
                    canvas.add_artifact(art)
                    if tick % 3 == 0:
                        task.status = "done"
                        agent.adjectives = list(
                            dict.fromkeys(agent.adjectives + ["productive"])
                        )
                    events.append(
                        SimEvent(
                            type="messenger_propose",
                            tick=tick,
                            payload={
                                "agent_id": agent.id,
                                "agent_name": agent.name,
                                "role": agent.role,
                                "task_id": task.id,
                                "artifact": art.model_dump(),
                                "grid_x": agent.grid_x,
                                "grid_y": agent.grid_y,
                            },
                        )
                    )

            if agent.institution_id and agent.institution_id in inst_by_id:
                inst = inst_by_id[agent.institution_id]
                for adj, bias in inst.policy.items():
                    if bias == "promote" and adj not in agent.adjectives:
                        agent.adjectives.append(adj)

            updated.append(agent)

        done = sum(1 for t in canvas.subtasks if t.status == "done")
        total = max(len(canvas.subtasks), 1)
        progress = done / total
        voxels_to_place = int(progress * len(VOXFORGE_VOXEL_BLUEPRINT))
        canvas.voxforge_voxels = VOXFORGE_VOXEL_BLUEPRINT[:voxels_to_place]
        canvas.voxforge_progress = progress

        for voxel in canvas.voxforge_voxels[-2:]:
            events.append(
                SimEvent(
                    type="voxforge_voxel",
                    tick=tick,
                    payload=voxel,
                )
            )

        return updated, canvas, events