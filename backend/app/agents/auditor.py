from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.agents.base import get_llm
from app.models.agent import QualitativeAgent
from app.models.events import SimEvent


class AuditResult(BaseModel):
    regret: float = Field(ge=0.0, le=1.0)
    narrative: str


AUDIT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are THE AUDITOR — the cost function of this society. "
            "Measure the gap between what the society IS and what it OUGHT to be. "
            "Emit regret as a float 0.0-1.0 and a brief narrative.",
        ),
        (
            "human",
            "OUGHT: {ought}\n"
            "IS (agents): {agents}\n"
            "Current playbook size: {playbook_size}",
        ),
    ]
)


class Auditor:
    def audit(
        self,
        agents: list[QualitativeAgent],
        ought: dict,
        playbook_size: int,
        tick: int,
    ) -> tuple[float, str, SimEvent]:
        llm = get_llm()
        if llm:
            try:
                chain = llm.with_structured_output(AuditResult)
                result: AuditResult = chain.invoke(
                    AUDIT_PROMPT.format_messages(
                        ought=ought,
                        agents=[a.summary() for a in agents],
                        playbook_size=playbook_size,
                    )
                )
                regret, narrative = result.regret, result.narrative
            except Exception:
                regret, narrative = self._heuristic(agents, ought)
        else:
            regret, narrative = self._heuristic(agents, ought)

        event = SimEvent(
            type="auditor_regret",
            tick=tick,
            payload={"regret": regret, "narrative": narrative},
        )
        return regret, narrative, event

    def _heuristic(self, agents: list[QualitativeAgent], ought: dict) -> tuple[float, str]:
        desired = set(ought.get("desired_adjectives", []))
        if not agents:
            return 1.0, "No agents remain — total societal failure."

        scores: list[float] = []
        for agent in agents:
            present = set(agent.adjectives)
            overlap = len(desired & present) / max(len(desired), 1)
            penalty = 0.0
            if "hungry" in present:
                penalty += 0.2
            if "feared" in present and "trusted" not in present:
                penalty += 0.15
            if "lonely" in present:
                penalty += 0.1
            scores.append(max(0.0, 1.0 - overlap - penalty))

        regret = sum(scores) / len(scores)
        narrative = (
            f"Society regret {regret:.2f}: gap between desired {list(desired)} "
            f"and actual conditions across {len(agents)} agents."
        )
        return regret, narrative