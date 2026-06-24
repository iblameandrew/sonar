from __future__ import annotations

import math
import uuid

from app.models.agent import QualitativeAgent


def _position(index: int, total: int) -> tuple[float, float, float]:
    angle = (2 * math.pi * index) / max(total, 1)
    radius = 8 + (index % 3) * 2
    return (math.cos(angle) * radius, 0.0, math.sin(angle) * radius)


SEED_AGENTS: list[dict] = [
    {
        "verbs": ["farm", "trade"],
        "nouns": ["grain", "tools"],
        "adjectives": ["hungry", "diligent"],
    },
    {
        "verbs": ["build", "repair"],
        "nouns": ["lumber", "stone"],
        "adjectives": ["skilled", "tired"],
    },
    {
        "verbs": ["hunt", "guard"],
        "nouns": ["meat", "spear"],
        "adjectives": ["alert", "lonely"],
    },
    {
        "verbs": ["weave", "teach"],
        "nouns": ["cloth", "kin"],
        "adjectives": ["trusted", "patient"],
    },
    {
        "verbs": ["cook", "heal"],
        "nouns": ["herbs", "fire"],
        "adjectives": ["generous", "weary"],
    },
    {
        "verbs": ["sing", "mediate"],
        "nouns": ["song", "feast"],
        "adjectives": ["prestigious", "calm"],
    },
    {
        "verbs": ["mine", "smelt"],
        "nouns": ["ore", "furnace"],
        "adjectives": ["stubborn", "rich"],
    },
    {
        "verbs": ["sail", "fish"],
        "nouns": ["boat", "net"],
        "adjectives": ["restless", "brave"],
    },
    {
        "verbs": ["pray", "judge"],
        "nouns": ["temple", "law"],
        "adjectives": ["austere", "wise"],
    },
    {
        "verbs": ["steal", "spy"],
        "nouns": ["secrets", "dagger"],
        "adjectives": ["feared", "cunning"],
    },
]


def create_seed_agents(count: int | None = None) -> list[QualitativeAgent]:
    specs = SEED_AGENTS[: count or len(SEED_AGENTS)]
    agents: list[QualitativeAgent] = []
    for i, spec in enumerate(specs):
        agents.append(
            QualitativeAgent(
                id=f"agent-{uuid.uuid4().hex[:8]}",
                verbs=list(spec["verbs"]),
                nouns=list(spec["nouns"]),
                adjectives=list(spec["adjectives"]),
                position=_position(i, len(specs)),
            )
        )
    return agents


DEFAULT_OUGHT: dict = {
    "description": "A society where all members are fed, trusted, and purposeful",
    "desired_adjectives": ["fed", "trusted", "purposeful", "cooperative"],
    "desired_balance": {
        "sustenance": "high",
        "kinship": "high",
        "prestige": "moderate",
        "conflict": "low",
    },
}