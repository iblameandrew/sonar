from __future__ import annotations

import uuid

from app.models.agent import QualitativeAgent, SpecialistRole
from app.models.canvas import ProjectCanvas, Subtask
from app.models.events import SimEvent

ROLE_TASK_MAP: dict[SpecialistRole, list[str]] = {
    "voxel_architect": ["Voxel Viz"],
    "orchestrator": ["LangGraph Core", "SSE Pipeline"],
    "optimizer": ["Benchmark Harness", "Metrics Dashboard"],
    "integrator": ["Integration", "SSE Pipeline"],
    "ux_weaver": ["Negotiation UI", "Voxel Viz"],
    "critic_evaluator": ["Metrics Dashboard", "Benchmark Harness"],
}


class Decomposer:
    """Attention-driven task decomposition and role assignment."""

    def decompose(
        self,
        canvas: ProjectCanvas,
        agents: list[QualitativeAgent],
        tick: int,
        phase: str,
    ) -> tuple[ProjectCanvas, list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        canvas = canvas.model_copy(deep=True)
        agents = [a.model_copy(deep=True) for a in agents]

        pending = [t for t in canvas.subtasks if t.status == "pending"]
        for task in pending[:2]:
            best = self._match_agent(task, agents)
            if best:
                task.status = "assigned"
                task.assigned_to = best.id
                best.current_task_id = task.id
                best.adjectives = list(dict.fromkeys(best.adjectives + ["focused"]))
                events.append(
                    SimEvent(
                        type="task_decomposed",
                        tick=tick,
                        payload={
                            "task_id": task.id,
                            "title": task.title,
                            "assigned_to": best.id,
                            "agent_name": best.name,
                            "role": best.role,
                            "phase": phase,
                        },
                    )
                )

        if not canvas.subtasks and phase == "concept":
            for title, desc, parent in [
                ("Phase Deliverable", f"Produce {phase} artifact for VoxForge", None)
            ]:
                tid = f"task-{uuid.uuid4().hex[:6]}"
                canvas.subtasks.append(
                    Subtask(id=tid, title=title, description=desc, status="pending")
                )

        return canvas, agents, events

    def _match_agent(
        self, task: Subtask, agents: list[QualitativeAgent]
    ) -> QualitativeAgent | None:
        for agent in agents:
            titles = ROLE_TASK_MAP.get(agent.role, [])
            if task.title in titles and not agent.current_task_id:
                return agent
        for agent in agents:
            if not agent.current_task_id:
                return agent
        return None