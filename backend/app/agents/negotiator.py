from __future__ import annotations

import uuid

from app.models.agent import DependencyEntry, QualitativeAgent
from app.models.canvas import NegotiationRound, ProjectCanvas
from app.models.events import SimEvent


class Negotiator:
    """Structured negotiation rounds — proposals, bids, compromises."""

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
            task_a = next(
                (t for t in canvas.subtasks if t.id == a.current_task_id), None
            )
            topic = task_a.title if task_a else "VoxForge integration approach"
            proposal = (
                f"{a.name} proposes {a.verbs[0]}-first approach using {a.nouns[0]}"
            )
            counter = (
                f"{b.name} counters with {b.verbs[0]} emphasis on {b.nouns[0]}"
            )
            outcome = "compromise"
            rationale = (
                f"Compromise: blend {a.nouns[0]} with {b.nouns[0]} for {topic}"
            )

            neg_id = f"neg-{uuid.uuid4().hex[:8]}"
            rnd = NegotiationRound(
                id=neg_id,
                tick=tick,
                topic=topic,
                proposer_id=a.id,
                responder_id=b.id,
                proposal=proposal,
                counter_offer=counter,
                outcome=outcome,
                rationale=rationale,
            )
            canvas.negotiations.append(rnd)

            extra_entries.append(
                DependencyEntry(
                    from_id=a.id,
                    to_id=b.id,
                    kind="negotiation",
                    verb_basis=a.verbs[0] if a.verbs else "propose",
                    qualitative_distance="near",
                    strength="high",
                    rationale=rationale,
                    tick=tick,
                    negotiation_id=neg_id,
                )
            )

            events.append(
                SimEvent(
                    type="negotiation_round",
                    tick=tick,
                    payload=rnd.model_dump(),
                )
            )

        for entry in assignments:
            if entry.strength in ("med", "high"):
                events.append(
                    SimEvent(
                        type="collaboration_pod",
                        tick=tick,
                        payload={
                            "from_id": entry.from_id,
                            "to_id": entry.to_id,
                            "kind": entry.kind,
                            "strength": entry.strength,
                        },
                    )
                )

        return canvas, extra_entries, events