from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.roles import LOSS_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import QualitativeAgent
from app.models.canvas import ProjectCanvas
from app.models.events import SimEvent
from app.seed import DEFAULT_OUGHT


class AuditResult(BaseModel):
    regret: float = Field(ge=0.0, le=1.0)
    narrative: str
    quality_score: float = Field(ge=0.0, le=1.0)
    conflict_detected: bool = False


AUDIT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "OUGHT: {ought}\nAgents: {agents}\n"
            "Tasks done: {tasks_done}/{tasks_total}\n"
            "Artifacts: {artifacts}\nNegotiations: {negotiations}\n"
            "Playbook size: {playbook_size}\n"
            "Score Colony engineering progress. Emit regret 0-1, quality_score 0-1, narrative.",
        ),
    ]
)


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
        done_tasks = sum(1 for t in canvas.subtasks if t.status == "done")
        total_tasks = max(len(canvas.subtasks), 1)

        result = qwen_factory.invoke_structured(
            LOSS_AGENT,
            AuditResult,
            AUDIT_PROMPT,
            {
                "ought": ought,
                "agents": [a.summary() for a in agents],
                "tasks_done": done_tasks,
                "tasks_total": total_tasks,
                "artifacts": len(canvas.artifacts),
                "negotiations": len(canvas.negotiations),
                "playbook_size": playbook_size,
            },
        )

        if result:
            regret, narrative = result.regret, result.narrative
            quality = result.quality_score
            conflict = result.conflict_detected
        else:
            regret, narrative, quality, conflict = self._heuristic(
                agents, canvas, ought, playbook_size, done_tasks, total_tasks
            )

        if inject_conflict:
            regret = max(regret, 0.75)
            conflict = True

        event = SimEvent(
            type="auditor_regret",
            tick=tick,
            payload={
                "regret": regret,
                "narrative": narrative,
                "quality_score": quality,
                "conflict_detected": conflict or regret >= 0.55,
                "llm": "qwen",
            },
        )
        return regret, narrative, event

    def _heuristic(
        self, agents, canvas, ought, playbook_size, done_tasks, total_tasks
    ) -> tuple[float, str, float, bool]:
        desired = set(ought.get("desired_adjectives", []))
        overlap = sum(
            len(desired & set(a.adjectives)) / max(len(desired), 1) for a in agents
        ) / max(len(agents), 1)
        task_score = done_tasks / total_tasks
        quality = overlap * 0.3 + task_score * 0.7
        regret = max(0.0, min(1.0, 1.0 - quality))
        narrative = (
            f"Colony audit (heuristic): quality={quality:.2f} "
            f"tasks {done_tasks}/{total_tasks} playbook={playbook_size}"
        )
        return regret, narrative, quality, regret >= 0.55