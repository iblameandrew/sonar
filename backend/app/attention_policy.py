"""Pre-launch attention head → societal function mapping."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

STRENGTH_ORDER = {"none": 0, "low": 1, "med": 2, "high": 3}

FUNCTION_CATALOGUE: dict[str, dict[str, Any]] = {
    "auditor": {
        "label": "Auditor",
        "category": "Governance & Evaluation",
        "roles": ["loss_agent", "critic_evaluator"],
        "kinds": ["prestige"],
    },
    "conflict_resolver": {
        "label": "Conflict Resolver",
        "category": "Governance & Evaluation",
        "roles": ["intervention_agent"],
        "kinds": ["conflict"],
    },
    "baseline": {
        "label": "Baseline",
        "category": "Governance & Evaluation",
        "roles": ["baseline_agent"],
        "kinds": ["economic"],
    },
    "reformer": {
        "label": "Reformer",
        "category": "Transformation & Memory",
        "roles": ["gradient_descent_agent"],
        "kinds": ["craft"],
    },
    "confessor": {
        "label": "Confessor",
        "category": "Transformation & Memory",
        "roles": ["residual_flow_agent"],
        "kinds": ["kinship"],
    },
    "custodian": {
        "label": "Custodian",
        "category": "Transformation & Memory",
        "roles": ["weight_agent"],
        "kinds": ["collaboration"],
    },
    "messenger": {
        "label": "Messenger",
        "category": "Communication & Coordination",
        "roles": ["feed_forward_agent"],
        "kinds": ["collaboration"],
    },
    "decomposer": {
        "label": "Decomposer",
        "category": "Communication & Coordination",
        "roles": ["input_projection_agent"],
        "kinds": ["craft"],
    },
    "negotiator": {
        "label": "Negotiator",
        "category": "Communication & Coordination",
        "roles": ["multi_head_agent"],
        "kinds": ["negotiation"],
    },
    "voxel_architect": {
        "label": "Voxel Architect",
        "category": "Specialized Domain",
        "roles": ["voxel_architect"],
        "kinds": ["craft"],
    },
    "orchestrator": {
        "label": "Orchestrator",
        "category": "Specialized Domain",
        "roles": ["orchestrator"],
        "kinds": ["collaboration"],
    },
    "attention": {
        "label": "Attention (meta)",
        "category": "Specialized Domain",
        "roles": ["attention_agent"],
        "kinds": ["kinship", "collaboration"],
    },
    "institution_builder": {
        "label": "Institution Builder",
        "category": "Emergent / Higher-Order",
        "roles": ["low_rank_agent"],
        "kinds": ["prestige"],
    },
    "seasonal_modulator": {
        "label": "Seasonal Modulator",
        "category": "Emergent / Higher-Order",
        "roles": [],
        "kinds": ["ritual", "economic"],
    },
}

ROLE_TO_FUNCTIONS: dict[str, list[str]] = {}
for fn, meta in FUNCTION_CATALOGUE.items():
    for role in meta["roles"]:
        ROLE_TO_FUNCTIONS.setdefault(role, []).append(fn)


class AttentionHeadConfig(BaseModel):
    primary_focus: list[str] = Field(default_factory=list)
    secondary_focus: list[str] = Field(default_factory=list)
    weight_distribution: dict[str, float] = Field(default_factory=dict)
    description: str = ""


class AttentionPolicy(BaseModel):
    heads: dict[str, AttentionHeadConfig] = Field(default_factory=dict)


DEFAULT_POLICY = AttentionPolicy(
    heads={
        "attention_head_1": AttentionHeadConfig(
            primary_focus=["auditor", "conflict_resolver"],
            secondary_focus=["reformer"],
            weight_distribution={"auditor": 0.6, "conflict_resolver": 0.3, "reformer": 0.1},
            description="Quality control and conflict mediation with light optimization",
        ),
        "attention_head_2": AttentionHeadConfig(
            primary_focus=["voxel_architect", "orchestrator"],
            secondary_focus=["decomposer"],
            weight_distribution={"voxel_architect": 0.5, "orchestrator": 0.4, "decomposer": 0.1},
            description="Visualization and orchestration with task decomposition",
        ),
        "attention_head_3": AttentionHeadConfig(
            primary_focus=["negotiator", "messenger", "confessor"],
            weight_distribution={"negotiator": 0.4, "messenger": 0.35, "confessor": 0.25},
            description="Communication, negotiation, and reflective memory",
        ),
    }
)


def catalogue_for_api() -> list[dict[str, Any]]:
    return [
        {
            "id": fn,
            "label": meta["label"],
            "category": meta["category"],
            "roles": meta["roles"],
            "kinds": meta["kinds"],
        }
        for fn, meta in FUNCTION_CATALOGUE.items()
    ]


def normalize_policy(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return DEFAULT_POLICY.model_dump()

    heads_in: dict[str, Any] = raw.get("heads", raw)
    normalized: dict[str, AttentionHeadConfig] = {}

    for head_id, cfg in heads_in.items():
        if not isinstance(cfg, dict):
            continue
        weights = {
            k: float(v)
            for k, v in (cfg.get("weight_distribution") or {}).items()
            if k in FUNCTION_CATALOGUE and float(v) > 0
        }
        primary = [f for f in cfg.get("primary_focus", []) if f in FUNCTION_CATALOGUE]
        secondary = [f for f in cfg.get("secondary_focus", []) if f in FUNCTION_CATALOGUE]
        for fn in primary + secondary:
            if fn not in weights:
                weights[fn] = 0.15
        if weights:
            total = sum(weights.values())
            weights = {k: v / total for k, v in weights.items()}
        normalized[head_id] = AttentionHeadConfig(
            primary_focus=primary,
            secondary_focus=secondary,
            weight_distribution=weights,
            description=str(cfg.get("description", "")),
        )

    if not normalized:
        return DEFAULT_POLICY.model_dump()
    return AttentionPolicy(heads=normalized).model_dump()


def aggregate_function_weights(policy: dict[str, Any] | None) -> dict[str, float]:
    data = normalize_policy(policy)
    merged: dict[str, float] = {}
    for head in data.get("heads", {}).values():
        for fn, w in head.get("weight_distribution", {}).items():
            merged[fn] = merged.get(fn, 0.0) + float(w)
    if not merged:
        return {fn: 1.0 / len(FUNCTION_CATALOGUE) for fn in FUNCTION_CATALOGUE}
    total = sum(merged.values())
    return {k: v / total for k, v in merged.items()}


def pair_relevance(
    agent_a_role: str,
    agent_b_role: str,
    kind: str,
    weights: dict[str, float],
) -> float:
    score = 0.0
    for fn, w in weights.items():
        meta = FUNCTION_CATALOGUE.get(fn, {})
        roles = set(meta.get("roles", []))
        kinds = set(meta.get("kinds", []))
        if agent_a_role in roles or agent_b_role in roles:
            score += w * 1.0
        elif kind in kinds:
            score += w * 0.55
    return score


def apply_policy_boost(
    entry: Any,
    agent_a_role: str,
    agent_b_role: str,
    policy: dict[str, Any] | None,
) -> Any:
    weights = aggregate_function_weights(policy)
    rel = pair_relevance(agent_a_role, agent_b_role, entry.kind, weights)
    if rel <= 0:
        return entry
    entry.season_weight = min(2.5, entry.season_weight * (1.0 + rel * 0.85))
    cur = STRENGTH_ORDER.get(entry.strength, 1)
    if rel >= 0.35 and cur < 3:
        order = list(STRENGTH_ORDER.keys())
        entry.strength = order[min(3, cur + 1)]  # type: ignore[assignment]
    head_notes = [
        f"{hid}: {h.get('description', '')}"
        for hid, h in normalize_policy(policy).get("heads", {}).items()
        if h.get("description")
    ]
    if head_notes and rel >= 0.25:
        entry.rationale = f"{entry.rationale} [policy×{rel:.2f}: {head_notes[0][:80]}]"
    return entry


def preview_entries(policy: dict[str, Any] | None, limit: int = 5) -> list[dict[str, Any]]:
    weights = aggregate_function_weights(policy)
    top = sorted(weights.items(), key=lambda x: -x[1])[:limit]
    previews = []
    for fn, w in top:
        meta = FUNCTION_CATALOGUE[fn]
        previews.append({
            "function": fn,
            "label": meta["label"],
            "weight": round(w, 3),
            "bias": f"Prioritizes {meta['label']} agents and {', '.join(meta['kinds'])} dependencies",
        })
    return previews