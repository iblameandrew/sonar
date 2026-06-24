from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.attention_policy import aggregate_function_weights, apply_policy_boost, pair_relevance
from app.roles import ATTENTION_AGENT
from app.llm.qwen_factory import qwen_factory
from app.models.agent import DependencyEntry, DependencyKind, QualitativeAgent

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


VALID_KINDS = {
    "economic", "kinship", "prestige", "conflict", "sustenance",
    "craft", "ritual", "collaboration", "negotiation",
}
VALID_DISTANCES = {"near", "mid", "far"}
VALID_STRENGTHS = {"none", "low", "med", "high"}


def _coerce_kind(raw: str, fallback: str) -> DependencyKind:
    key = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if key in VALID_KINDS:
        return key  # type: ignore[return-value]
    for token in VALID_KINDS:
        if token in key:
            return token  # type: ignore[return-value]
    fb = fallback if fallback in VALID_KINDS else "collaboration"
    return fb  # type: ignore[return-value]


def _coerce_text(raw: str | list[str] | None, fallback: str = "") -> str:
    if isinstance(raw, list):
        return str(raw[0]) if raw else fallback
    return str(raw or fallback)


def _entry_from_judgment(
    result: AttentionJudgment,
    agent_a: QualitativeAgent,
    agent_b: QualitativeAgent,
    tick: int,
    season_weight: float,
    dominant_kind: str,
) -> DependencyEntry | None:
    strength = (result.strength or "").strip().lower()
    if strength not in VALID_STRENGTHS or strength == "none":
        return None
    distance = (result.qualitative_distance or "mid").strip().lower()
    if distance not in VALID_DISTANCES:
        distance = "mid"
    return DependencyEntry(
        from_id=agent_a.id,
        to_id=agent_b.id,
        kind=_coerce_kind(result.kind, dominant_kind),
        verb_basis=_coerce_text(result.verb_basis, agent_a.verbs[0] if agent_a.verbs else "observe"),
        qualitative_distance=distance,  # type: ignore[arg-type]
        strength=strength,  # type: ignore[arg-type]
        rationale=result.rationale or "LLM attention judgment",
        season_weight=season_weight,
        tick=tick,
    )


class AttentionAgent:
    def __init__(self, max_concurrency: int = 8) -> None:
        self.max_concurrency = max_concurrency

    def _select_pairs(
        self,
        agents: list[QualitativeAgent],
        attention_policy: dict | None = None,
    ) -> list[tuple[QualitativeAgent, QualitativeAgent]]:
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

        weights = aggregate_function_weights(attention_policy)
        pairs.sort(
            key=lambda ab: pair_relevance(ab[0].role, ab[1].role, "collaboration", weights),
            reverse=True,
        )
        if len(pairs) > MAX_ATTENTION_PAIRS:
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
        attention_policy: dict | None = None,
    ) -> DependencyEntry | None:
        if agent_a.id == agent_b.id:
            return None

        if (
            agent_a.role in WORKER_ROLES
            and agent_b.role in WORKER_ROLES
        ) or not qwen_factory.is_configured():
            entry = _heuristic_judge(
                agent_a, agent_b, tick, season_weight, temperature, dominant_kind
            )
            return apply_policy_boost(entry, agent_a.role, agent_b.role, attention_policy) if entry else None

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
        if result:
            entry = _entry_from_judgment(
                result, agent_a, agent_b, tick, season_weight, dominant_kind,
            )
            if entry:
                return apply_policy_boost(entry, agent_a.role, agent_b.role, attention_policy)

        entry = _heuristic_judge(agent_a, agent_b, tick, season_weight, temperature, dominant_kind)
        return apply_policy_boost(entry, agent_a.role, agent_b.role, attention_policy) if entry else None

    async def judge_all_pairs(
        self,
        agents: list[QualitativeAgent],
        tick: int,
        season_weight: float,
        temperature: str,
        dominant_kind: str,
        attention_policy: dict | None = None,
        on_progress: Callable[[int, int, int], Awaitable[None]] | None = None,
    ) -> list[DependencyEntry]:
        sem = asyncio.Semaphore(self.max_concurrency)
        pairs = self._select_pairs(agents, attention_policy)
        total = len(pairs)
        done = 0
        entries: list[DependencyEntry] = []

        async def _judge(a: QualitativeAgent, b: QualitativeAgent) -> DependencyEntry | None:
            async with sem:
                return await self.judge_pair(
                    a, b, tick, season_weight, temperature, dominant_kind, attention_policy,
                )

        tasks = [asyncio.create_task(_judge(a, b)) for a, b in pairs]
        for finished in asyncio.as_completed(tasks):
            result = await finished
            done += 1
            if result is not None:
                entries.append(result)
            if on_progress and (done % 4 == 0 or done == total):
                await on_progress(done, total, len(entries))

        return entries