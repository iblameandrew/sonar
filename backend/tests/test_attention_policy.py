from __future__ import annotations

from app.attention_policy import (
    DEFAULT_POLICY,
    FUNCTION_CATALOGUE,
    aggregate_function_weights,
    apply_policy_boost,
    catalogue_for_api,
    normalize_policy,
    pair_relevance,
    preview_entries,
)
from app.models.agent import DependencyEntry


def test_catalogue_covers_known_functions() -> None:
    cat = catalogue_for_api()
    ids = {item["id"] for item in cat}
    assert ids == set(FUNCTION_CATALOGUE)
    assert all(item["label"] and item["category"] for item in cat)


def test_normalize_empty_falls_back_to_default() -> None:
    assert normalize_policy(None) == DEFAULT_POLICY.model_dump()
    assert normalize_policy({}) == DEFAULT_POLICY.model_dump()
    assert normalize_policy({"heads": {}}) == DEFAULT_POLICY.model_dump()


def test_normalize_filters_unknown_and_renormalizes() -> None:
    raw = {
        "heads": {
            "h1": {
                "primary_focus": ["auditor", "not_a_function"],
                "secondary_focus": ["messenger"],
                "weight_distribution": {"auditor": 3, "ghost": 9, "messenger": 1},
                "description": "qc",
            }
        }
    }
    policy = normalize_policy(raw)
    weights = policy["heads"]["h1"]["weight_distribution"]
    assert set(weights) == {"auditor", "messenger"}
    assert abs(sum(weights.values()) - 1.0) < 1e-9
    assert "not_a_function" not in policy["heads"]["h1"]["primary_focus"]


def test_normalize_fills_missing_weights_from_focus() -> None:
    raw = {"heads": {"h1": {"primary_focus": ["negotiator"], "weight_distribution": {}}}}
    weights = normalize_policy(raw)["heads"]["h1"]["weight_distribution"]
    assert weights == {"negotiator": 1.0}


def test_aggregate_function_weights_sums_heads() -> None:
    weights = aggregate_function_weights(DEFAULT_POLICY.model_dump())
    assert abs(sum(weights.values()) - 1.0) < 1e-9
    assert weights["auditor"] > 0
    assert "seasonal_modulator" not in weights


def test_pair_relevance_prefers_matching_roles() -> None:
    weights = {"auditor": 1.0}
    role_hit = pair_relevance("loss_agent", "worker", "economic", weights)
    kind_hit = pair_relevance("worker", "worker", "prestige", weights)
    miss = pair_relevance("worker", "worker", "craft", weights)
    assert role_hit > kind_hit > miss
    assert miss == 0.0


def test_apply_policy_boost_raises_strength_and_weight() -> None:
    entry = DependencyEntry(
        from_id="a",
        to_id="b",
        kind="prestige",
        verb_basis="evaluate",
        qualitative_distance="near",
        strength="low",
        rationale="score",
        season_weight=1.0,
    )
    focused = {
        "heads": {
            "h1": {
                "primary_focus": ["auditor"],
                "weight_distribution": {"auditor": 1.0},
                "description": "audit first",
            }
        }
    }
    boosted = apply_policy_boost(entry, "loss_agent", "worker", focused)
    assert boosted.strength in ("med", "high")
    assert boosted.season_weight > 1.0
    assert "policy" in boosted.rationale


def test_preview_entries_are_sorted() -> None:
    preview = preview_entries(DEFAULT_POLICY.model_dump(), limit=3)
    assert len(preview) == 3
    weights = [p["weight"] for p in preview]
    assert weights == sorted(weights, reverse=True)
    assert all(p["function"] in FUNCTION_CATALOGUE for p in preview)
