from __future__ import annotations

import asyncio
import random

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.roles import ATTENTION_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import DependencyEntry, QualitativeAgent

DIMENSIONS = ["sustenance", "prestige", "kinship", "conflict", "craft", "ritual"]

HEURISTIC_KIND_MAP = {
    "farm": "sustenance", "cook": "sustenance", "fish": "sustenance", "hunt": "sustenance",
    "trade": "economic", "build": "craft", "repair": "craft", "weave": "craft",
    "mine": "economic", "smelt": "craft", "sing": "ritual", "pray": "ritual",
    "mediate": "kinship", "teach": "kinship", "guard": "conflict", "steal": "conflict",
    "spy": "conflict", "heal": "sustenance", "judge": "prestige", "sail": "economic",
    "orchestrate": "collaboration", "render": "craft", "benchmark": "economic",
    "wire": "collaboration", "layout": "craft", "evaluate": "prestige",
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
            "human",
            "Agent A: verbs={a_verbs}, nouns={a_nouns}, adjectives={a_adjectives}\n"
            "Agent B: verbs={b_verbs}, nouns={b_nouns}, adjectives={b_adjectives}\n"
            "Temperature: {temperature}. Dominant kind: {dominant_kind}.\n"
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
    else:
        if temperature == "sharp":
            return None
        distance, strength = "far", "low"
        rationale = f"No obvious affinity between A and B along {kind}."

    if temperature == "sharp" and strength == "low":
        return None

    return DependencyEntry(
        from_id=agent_a.id, to_id=agent_b.id,
        kind=kind,  # type: ignore[arg-type]
        verb_basis=verb_basis,
        qualitative_distance=distance,  # type: ignore[arg-type]
        strength=strength,  # type: ignore[arg-type]
        rationale=rationale, season_weight=season_weight, tick=tick,
    )


WORKER_ROLES = frozenset({"worker", "generalist"})

MAX_ATTENTION_PAIRS = 96


class AttentionAgent:
    def __init__(self, max_concurrency: int = 8) -> None:
        self.max_concurrency = max_concurrency

    def _select_pairs(self, agents: list[QualitativeAgent]) -> list[tuple[QualitativeAgent, QualitativeAgent]]:
        specialists = [a for a in agents if a.role not in WORKER_ROLES]
        pairs: list[tuple[QualitativeAgent, QualitativeAgent]] = []
        seen: set[tuple[str, str]] = set()

        def add_pair(a: QualitativeAgent, b: QualitativeAgent) -> None:
            if a.id == b.id:
                return
            key = (a.id, b.id)
            if key in seen:
                return
            seen.add(key)
            pairs.append((a, b))

        for a in specialists:
            for b in agents:
                add_pair(a, b)

        workers = [a for a in agents if a.role in WORKER_ROLES]
        worker_pairs = [(a, b) for a in workers for b in workers if a.id != b.id]
        random.shuffle(worker_pairs)
        for a, b in worker_pairs[:32]:
            add_pair(a, b)

        if len(pairs) > MAX_ATTENTION_PAIRS:
            random.shuffle(pairs)
            pairs = pairs[:MAX_ATTENTION_PAIRS]
        return pairs

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

        if (
            agent_a.role in WORKER_ROLES
            and agent_b.role in WORKER_ROLES
        ) or not qwen_factory.is_configured():
            return _heuristic_judge(
                agent_a, agent_b, tick, season_weight, temperature, dominant_kind
            )

        result = await qwen_factory.ainvoke_structured(
            ATTENTION_AGENT,
            AttentionJudgment,
            ATTENTION_PROMPT,
            {
                "temperature": temperature,
                "dominant_kind": dominant_kind,
                "a_verbs": agent_a.verbs, "a_nouns": agent_a.nouns, "a_adjectives": agent_a.adjectives,
                "b_verbs": agent_b.verbs, "b_nouns": agent_b.nouns, "b_adjectives": agent_b.adjectives,
            },
        )
        if result and result.strength != "none":
            return DependencyEntry(
                from_id=agent_a.id, to_id=agent_b.id,
                kind=result.kind,  # type: ignore[arg-type]
                verb_basis=result.verb_basis,
                qualitative_distance=result.qualitative_distance,  # type: ignore[arg-type]
                strength=result.strength,  # type: ignore[arg-type]
                rationale=result.rationale,
                season_weight=season_weight, tick=tick,
            )

        return _heuristic_judge(agent_a, agent_b, tick, season_weight, temperature, dominant_kind)

    async def judge_all_pairs(
        self, agents: list[QualitativeAgent], tick: int,
        season_weight: float, temperature: str, dominant_kind: str,
    ) -> list[DependencyEntry]:
        sem = asyncio.Semaphore(self.max_concurrency)
        pairs = self._select_pairs(agents)

        async def _judge(a: QualitativeAgent, b: QualitativeAgent) -> DependencyEntry | None:
            async with sem:
                return await self.judge_pair(a, b, tick, season_weight, temperature, dominant_kind)

        results = await asyncio.gather(*[_judge(a, b) for a, b in pairs])
        return [r for r in results if r is not None]