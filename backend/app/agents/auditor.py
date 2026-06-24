from __future__ import annotations

from app.models.agent import QualitativeAgent
from app.models.canvas import ProjectCanvas
from app.models.events import SimEvent
from app.seed import DEFAULT_OUGHT


class Auditor:
    def audit(
        self,
        agents: list[QualitativeAgent],
        canvas: ProjectCanvas,
        ought: dict,
        playbook_size: int,
        tick: int,
        inject_conflict: bool = False,
    ) -> tuple[float, str, SimEvent]:
        desired = set(ought.get("desired_adjectives", []))
        modules = ought.get("voxforge_modules", [])
        done_tasks = sum(1 for t in canvas.subtasks if t.status == "done")
        total_tasks = max(len(canvas.subtasks), 1)
        artifact_kinds = {a.kind for a in canvas.artifacts}

        overlap = 0.0
        for agent in agents:
            present = set(agent.adjectives)
            overlap += len(desired & present) / max(len(desired), 1)
        overlap /= max(len(agents), 1)

        task_score = done_tasks / total_tasks
        module_score = len(artifact_kinds) / max(len(modules), 1)
        quality = (overlap * 0.3 + task_score * 0.4 + module_score * 0.3)

        regret = max(0.0, min(1.0, 1.0 - quality))
        if inject_conflict:
            regret = max(regret, 0.75)

        disagreements = sum(
            1 for n in canvas.negotiations if n.outcome in ("rejected", "voting")
        )
        if disagreements:
            regret = min(1.0, regret + 0.1)

        narrative = (
            f"VoxForge audit: quality={quality:.2f} regret={regret:.2f} "
            f"tasks {done_tasks}/{total_tasks} artifacts={len(canvas.artifacts)} "
            f"negotiations={len(canvas.negotiations)} playbook={playbook_size}"
        )

        event = SimEvent(
            type="auditor_regret",
            tick=tick,
            payload={
                "regret": regret,
                "narrative": narrative,
                "quality_score": quality,
                "conflict_detected": regret >= 0.55,
            },
        )
        return regret, narrative, event