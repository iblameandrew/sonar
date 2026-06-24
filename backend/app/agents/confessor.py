from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.roles import RESIDUAL_FLOW_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import DependencyEntry, QualitativeAgent, SocialPlaybook
from app.models.events import SimEvent
from app.store.custodian import Custodian


class LessonLearned(BaseModel):
    lesson: str
    affected_agents: list[str]


CONFESS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "Backward flow entries this tick: {entries}\n"
            "Summarize one key lesson to propagate to causes.",
        ),
    ]
)


class Confessor:
    """Backward connection: consequences flow backward to their causes."""

    def confess(
        self,
        agents: list[QualitativeAgent],
        playbook: SocialPlaybook,
        custodian: Custodian,
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        agent_map = {a.id: a.model_copy(deep=True) for a in agents}
        tick_entries = [e for e in playbook.entries if e.tick == tick]

        if tick_entries:
            lesson_result = qwen_factory.invoke_structured(
                RESIDUAL_FLOW_AGENT,
                LessonLearned,
                CONFESS_PROMPT,
                {
                    "entries": [
                        f"{e.from_id}->{e.to_id} [{e.kind}/{e.strength}]: {e.rationale[:80]}"
                        for e in tick_entries[:10]
                    ],
                },
            )
            if lesson_result:
                events.append(
                    SimEvent(
                        type="confessor_lesson",
                        tick=tick,
                        payload={"lesson": lesson_result.lesson, "llm": "qwen"},
                    )
                )

        for entry in tick_entries:
            blended = custodian.update(entry.from_id, entry.to_id, entry.strength)
            events.append(
                SimEvent(
                    type="confessor_flow",
                    tick=tick,
                    payload={
                        "from_id": entry.from_id,
                        "to_id": entry.to_id,
                        "original_strength": entry.strength,
                        "blended_strength": blended,
                        "kind": entry.kind,
                        "llm": "qwen",
                    },
                )
            )

            cause = agent_map.get(entry.to_id)
            effect = agent_map.get(entry.from_id)
            if not cause or not effect:
                continue

            if entry.strength in ("med", "high") and entry.qualitative_distance == "near":
                for adj in cause.adjectives[:2]:
                    if adj not in effect.adjectives and adj in (
                        "trusted", "generous", "calm", "prestigious", "skilled", "aligned"
                    ):
                        effect.adjectives.append(adj)

        custodian.save()
        return list(agent_map.values()), events