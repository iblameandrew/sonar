from __future__ import annotations

import uuid

from app.models.agent import QualitativeAgent
from app.models.canvas import Artifact, NegotiationRound, ProjectCanvas
from app.models.events import SimEvent


class ConflictResolver:
    """Mediated negotiation, compromise, or voting when Auditor regret is high."""

    def resolve(
        self,
        canvas: ProjectCanvas,
        agents: list[QualitativeAgent],
        regret: float,
        narrative: str,
        tick: int,
        forced: bool = False,
    ) -> tuple[ProjectCanvas, list[QualitativeAgent], list[SimEvent], bool]:
        events: list[SimEvent] = []
        canvas = canvas.model_copy(deep=True)
        agents = [a.model_copy(deep=True) for a in agents]

        if regret < 0.55 and not forced:
            return canvas, agents, events, False

        disputants = agents[:2] if len(agents) >= 2 else agents
        if not disputants:
            return canvas, agents, events, False

        a, b = disputants[0], disputants[1] if len(disputants) > 1 else disputants[0]
        topic = "Architecture disagreement: monolith vs modular VoxForge"
        votes = {a.id: "modular", b.id: "modular"}
        outcome = "voting"

        rnd = NegotiationRound(
            id=f"conflict-{uuid.uuid4().hex[:8]}",
            tick=tick,
            topic=topic,
            proposer_id=a.id,
            responder_id=b.id,
            proposal=f"{a.name}: modular LangGraph nodes",
            counter_offer=f"{b.name}: shared canvas state",
            outcome=outcome,
            rationale=f"Mediated vote resolved conflict (regret={regret:.2f}): adopt modular graph + shared canvas",
        )
        canvas.negotiations.append(rnd)
        canvas.decisions.append(rnd.rationale)

        artifact = Artifact(
            id=f"art-{uuid.uuid4().hex[:8]}",
            kind="architecture",
            title="Conflict Resolution: Modular VoxForge",
            content=rnd.rationale,
            author_id=a.id,
            tick=tick,
        )
        canvas.add_artifact(artifact)

        for agent in agents:
            if "hostile" in agent.adjectives:
                agent.adjectives.remove("hostile")
            if "aligned" not in agent.adjectives:
                agent.adjectives.append("aligned")

        events.append(
            SimEvent(
                type="conflict_resolved",
                tick=tick,
                payload={
                    "regret": regret,
                    "narrative": narrative,
                    "negotiation": rnd.model_dump(),
                    "votes": votes,
                    "artifact_id": artifact.id,
                },
            )
        )

        return canvas, agents, events, True