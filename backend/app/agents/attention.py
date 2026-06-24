from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableSequence
from pydantic import BaseModel, Field

from app.agents.base import get_llm
from app.models.agent import DependencyEntry, QualitativeAgent

DIMENSIONS = ["sustenance", "prestige", "kinship", "conflict", "craft", "ritual"]

HEURISTIC_KIND_MAP = {
    "farm": "sustenance",
    "cook": "sustenance",
    "fish": "sustenance",
    "hunt": "sustenance",
    "trade": "economic",
    "build": "craft",
    "repair": "craft",
    "weave": "craft",
    "mine": "economic",
    "smelt": "craft",
    "sing": "ritual",
    "pray": "ritual",
    "mediate": "kinship",
    "teach": "kinship",
    "guard": "conflict",
    "steal": "conflict",
    "spy": "conflict",
    "heal": "sustenance",
    "judge": "prestige",
    "sail": "economic",
    "orchestrate": "collaboration",
    "render": "craft",
    "benchmark": "economic",
    "wire": "collaboration",
    "layout": "craft",
    "evaluate": "prestige",
    "mediate": "negotiation",
}


class AttentionJudgment(BaseModel):
    kind: str
    verb_basis: str
    qualitative_distance: str
    strength: str
    rationale: str


ATTENTION_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are THE ATTENTION AGENT — qualitative social physics. "
            "No numbers, no embeddings. Judge the qualitative distance between "
            "agent A's needs/skills and agent B's offerings/state along named "
            "dimensions: sustenance, prestige, kinship, conflict, craft, ritual. "
            "Temperature: {temperature}. "
            "Sharp = decisive, exclusive dependencies. "
            "Diffuse = loose, exploratory dependencies. "
            "Dominant kind this season: {dominant_kind}.",
        ),
        (
            "human",
            "Agent A: verbs={a_verbs}, nouns={a_nouns}, adjectives={a_adjectives}\n"
            "Agent B: verbs={b_verbs}, nouns={b_nouns}, adjectives={b_adjectives}\n"
            "Judge A's attention toward B. Return kind, verb_basis, "
            "qualitative_distance (near/mid/far), strength (none/low/med/high), rationale.",
        ),
    ]
)


def _heuristic_judge(
    agent_a: QualitativeAgent,
    agent_b: QualitativeAgent,
    tick: int,
    season_weight: float,
    temperature: str,
    dominant_kind: str,
) -> DependencyEntry | None:
    shared_nouns = set(agent_a.nouns) & set(agent_b.nouns)
    shared_verbs = set(agent_a.verbs) & set(agent_b.verbs)

    verb_basis = agent_a.verbs[0] if agent_a.verbs else "observe"
    kind = HEURISTIC_KIND_MAP.get(verb_basis, dominant_kind)

    if shared_nouns:
        distance, strength = "near", "high"
        rationale = f"A and B share resources {list(shared_nouns)} — strong {kind} bond."
    elif shared_verbs:
        distance, strength = "near", "med"
        rationale = f"A and B share skills {list(shared_verbs)} — moderate {kind} affinity."
    elif any(adj in agent_b.adjectives for adj in ("trusted", "generous", "prestigious")):
        distance, strength = "mid", "med"
        rationale = f"B appears {agent_b.adjectives[0]} — A attends with moderate interest."
    elif any(adj in agent_b.adjectives for adj in ("feared", "cunning", "hostile")):
        distance, strength = "mid", "low"
        rationale = f"B appears threatening — A maintains cautious distance."
        kind = "conflict"
    else:
        if temperature == "sharp":
            return None
        distance, strength = "far", "low"
        rationale = f"No obvious affinity between A and B along {kind}."

    if temperature == "sharp" and strength == "low":
        strength = "none"
        return None

    return DependencyEntry(
        from_id=agent_a.id,
        to_id=agent_b.id,
        kind=kind,  # type: ignore[arg-type]
        verb_basis=verb_basis,
        qualitative_distance=distance,  # type: ignore[arg-type]
        strength=strength,  # type: ignore[arg-type]
        rationale=rationale,
        season_weight=season_weight,
        tick=tick,
    )


class AttentionAgent:
    def __init__(self, max_concurrency: int = 10) -> None:
        self.llm = get_llm()
        self.max_concurrency = max_concurrency
        if self.llm:
            self.chain: RunnableSequence | None = self.llm.with_structured_output(
                AttentionJudgment
            )
        else:
            self.chain = None

    async def judge_pair(
        self,
        agent_a: QualitativeAgent,
        agent_b: QualitativeAgent,
        tick: int,
        season_weight: float,
        temperature: str,
        dominant_kind: str,
    ) -> DependencyEntry | None:
        if agent_a.id == agent_b.id:
            return None

        if self.chain and self.llm:
            try:
                prompt = ATTENTION_PROMPT.format_messages(
                    temperature=temperature,
                    dominant_kind=dominant_kind,
                    a_verbs=agent_a.verbs,
                    a_nouns=agent_a.nouns,
                    a_adjectives=agent_a.adjectives,
                    b_verbs=agent_b.verbs,
                    b_nouns=agent_b.nouns,
                    b_adjectives=agent_b.adjectives,
                )
                result: AttentionJudgment = await self.chain.ainvoke(prompt)
                if result.strength == "none":
                    return None
                return DependencyEntry(
                    from_id=agent_a.id,
                    to_id=agent_b.id,
                    kind=result.kind,  # type: ignore[arg-type]
                    verb_basis=result.verb_basis,
                    qualitative_distance=result.qualitative_distance,  # type: ignore[arg-type]
                    strength=result.strength,  # type: ignore[arg-type]
                    rationale=result.rationale,
                    season_weight=season_weight,
                    tick=tick,
                )
            except Exception:
                pass

        return _heuristic_judge(
            agent_a, agent_b, tick, season_weight, temperature, dominant_kind
        )

    async def judge_all_pairs(
        self,
        agents: list[QualitativeAgent],
        tick: int,
        season_weight: float,
        temperature: str,
        dominant_kind: str,
    ) -> list[DependencyEntry]:
        sem = asyncio.Semaphore(self.max_concurrency)
        pairs = [
            (a, b)
            for a in agents
            for b in agents
            if a.id != b.id
        ]

        async def _judge(a: QualitativeAgent, b: QualitativeAgent) -> DependencyEntry | None:
            async with sem:
                return await self.judge_pair(
                    a, b, tick, season_weight, temperature, dominant_kind
                )

        results = await asyncio.gather(*[_judge(a, b) for a, b in pairs])
        return [r for r in results if r is not None]