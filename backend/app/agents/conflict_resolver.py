from __future__ import annotations

import uuid

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.llm.negotiation_outcome import normalize_negotiation_outcome
from app.roles import INTERVENTION_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import QualitativeAgent
from app.models.canvas import Artifact, NegotiationRound, ProjectCanvas
from app.models.events import SimEvent


class ConflictResolution(BaseModel):
    topic: str
    proposal: str
    counter_offer: str
    outcome: str = Field(
        description="Exactly one of: accepted, compromise, rejected, voting. Not a sentence."
    )
    rationale: str = Field(description="Why this outcome was chosen.")
    decision: str = Field(description="Final resolved plan as one or two sentences.")


CONFLICT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "human",
            "Regret: {regret}\nNarrative: {narrative}\n"
            "Disputants: {agents}\nRecent negotiations: {negotiations}\n"
            "Mediate conflict for society architecture. Return JSON with proposal, "
            "counter_offer, outcome (ONLY: accepted|compromise|rejected|voting), "
            "rationale, and decision (the resolved plan text — do not put the plan in outcome).",
        ),
    ]
)


class ConflictResolver:
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
        if regret < 0.55 and not forced:
            return canvas, agents, events, False

        canvas = canvas.model_copy(deep=True)
        agents = [a.model_copy(deep=True) for a in agents]
        disputants = agents[:2] if len(agents) >= 2 else agents
        if not disputants:
            return canvas, agents, events, False

        a = disputants[0]
        b = disputants[1] if len(disputants) > 1 else disputants[0]

        result = qwen_factory.invoke_structured(
            INTERVENTION_AGENT,
            ConflictResolution,
            CONFLICT_PROMPT,
            {
                "regret": regret,
                "narrative": narrative,
                "agents": [ag.summary() for ag in disputants],
                "negotiations": [n.rationale for n in canvas.negotiations[-3:]],
            },
        )

        if result:
            topic = result.topic
            proposal, counter = result.proposal, result.counter_offer
            decision = result.decision or result.rationale
            outcome, rationale = normalize_negotiation_outcome(
                result.outcome,
                _merge_decision_rationale(result.rationale, decision),
            )
        else:
            topic = "Architecture disagreement"
            proposal = f"{a.name}: modular LangGraph"
            counter = f"{b.name}: shared canvas"
            outcome, rationale = "voting", "Adopt modular graph + shared canvas"
            decision = rationale

        rnd = NegotiationRound(
            id=f"conflict-{uuid.uuid4().hex[:8]}",
            tick=tick, topic=topic,
            proposer_id=a.id, responder_id=b.id,
            proposal=proposal, counter_offer=counter,
            outcome=outcome,
            rationale=rationale,
        )
        canvas.negotiations.append(rnd)
        canvas.decisions.append(decision)
        canvas.add_artifact(Artifact(
            id=f"art-{uuid.uuid4().hex[:8]}",
            kind="architecture", title="Conflict Resolution",
            content=decision, author_id=a.id, tick=tick,
        ))

        for agent in agents:
            if "hostile" in agent.adjectives:
                agent.adjectives.remove("hostile")
            if "aligned" not in agent.adjectives:
                agent.adjectives.append("aligned")

        events.append(
            SimEvent(
                type="conflict_resolved", tick=tick,
                payload={"regret": regret, "negotiation": rnd.model_dump(), "llm": "qwen"},
            )
        )
        return canvas, agents, events, True


def _merge_decision_rationale(rationale: str, decision: str) -> str:
    rationale = (rationale or "").strip()
    decision = (decision or "").strip()
    if not decision:
        return rationale
    if not rationale:
        return decision
    if decision.lower() in rationale.lower():
        return rationale
    return f"{rationale} | {decision}"