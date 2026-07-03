from __future__ import annotations

import uuid

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.llm.negotiation_outcome import normalize_negotiation_outcome
from app.roles import MULTI_HEAD_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import DependencyEntry, QualitativeAgent
from app.models.canvas import NegotiationRound, ProjectCanvas
from app.models.events import SimEvent


class NegotiationResult(BaseModel):
    topic: str
    proposal: str
    counter_offer: str
    outcome: str = Field(
        description="Exactly one of: accepted, compromise, rejected, voting. Not a sentence."
    )
    rationale: str = Field(
        description="Full explanation of the agreement or dispute resolution."
    )


NEGOTIATE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "Agent A ({a_name}): verbs={a_verbs}, nouns={a_nouns}\n"
            "Agent B ({b_name}): verbs={b_verbs}, nouns={b_nouns}\n"
            "Task context: {topic}\n"
            "Run one negotiation round. Return JSON with proposal, counter_offer, "
            "outcome (ONLY: accepted|compromise|rejected|voting), and rationale "
            "(put the human-readable agreement text here, not in outcome).",
        ),
    ]
)


class Negotiator:
    def negotiate(
        self,
        canvas: ProjectCanvas,
        agents: list[QualitativeAgent],
        assignments: list[DependencyEntry],
        tick: int,
    ) -> tuple[ProjectCanvas, list[DependencyEntry], list[SimEvent]]:
        events: list[SimEvent] = []
        canvas = canvas.model_copy(deep=True)
        extra_entries: list[DependencyEntry] = []

        active = [a for a in agents if a.current_task_id]
        if len(active) >= 2:
            a, b = active[0], active[1]
            task_a = next((t for t in canvas.subtasks if t.id == a.current_task_id), None)
            topic = task_a.title if task_a else "Society integration approach"

            result = qwen_factory.invoke_structured(
                MULTI_HEAD_AGENT,
                NegotiationResult,
                NEGOTIATE_PROMPT,
                {
                    "a_name": a.name, "a_verbs": a.verbs, "a_nouns": a.nouns,
                    "b_name": b.name, "b_verbs": b.verbs, "b_nouns": b.nouns,
                    "topic": topic,
                },
            )

            if result:
                proposal, counter = result.proposal, result.counter_offer
                outcome, rationale = normalize_negotiation_outcome(
                    result.outcome, result.rationale
                )
            else:
                proposal = f"{a.name} proposes {a.verbs[0]}-first using {a.nouns[0]}"
                counter = f"{b.name} counters with {b.verbs[0]} on {b.nouns[0]}"
                outcome, rationale = "compromise", f"Blend {a.nouns[0]} with {b.nouns[0]}"

            neg_id = f"neg-{uuid.uuid4().hex[:8]}"
            rnd = NegotiationRound(
                id=neg_id, tick=tick, topic=topic,
                proposer_id=a.id, responder_id=b.id,
                proposal=proposal, counter_offer=counter,
                outcome=outcome,
                rationale=rationale,
            )
            canvas.negotiations.append(rnd)
            extra_entries.append(
                DependencyEntry(
                    from_id=a.id, to_id=b.id, kind="negotiation",
                    verb_basis=a.verbs[0] if a.verbs else "propose",
                    qualitative_distance="near", strength="high",
                    rationale=rationale, tick=tick, negotiation_id=neg_id,
                )
            )
            events.append(
                SimEvent(type="negotiation_round", tick=tick, payload={**rnd.model_dump(), "llm": "qwen"})
            )

        for entry in assignments:
            if entry.strength in ("med", "high"):
                events.append(
                    SimEvent(
                        type="collaboration_pod", tick=tick,
                        payload={"from_id": entry.from_id, "to_id": entry.to_id,
                                 "kind": entry.kind, "strength": entry.strength},
                    )
                )

        return canvas, extra_entries, events