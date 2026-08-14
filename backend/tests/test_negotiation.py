from __future__ import annotations

from app.llm.negotiation_outcome import normalize_negotiation_outcome


def test_exact_and_prefixed_labels() -> None:
    assert normalize_negotiation_outcome("accepted")[0] == "accepted"
    assert normalize_negotiation_outcome("rejected: no")[0] == "rejected"
    assert normalize_negotiation_outcome("voting now")[0] == "voting"
    assert normalize_negotiation_outcome("compromise")[0] == "compromise"


def test_fuzzy_mapping() -> None:
    assert normalize_negotiation_outcome("the bid was refused")[0] == "rejected"
    assert normalize_negotiation_outcome("put it to a ballot")[0] == "voting"
    assert normalize_negotiation_outcome("middle ground on scope")[0] == "compromise"
    assert normalize_negotiation_outcome("we agreed on the plan")[0] == "accepted"


def test_unknown_text_becomes_compromise() -> None:
    outcome, rationale = normalize_negotiation_outcome("let's sleep on it", "prior")
    assert outcome == "compromise"
    assert "sleep" in rationale
    assert "prior" in rationale


def test_empty_defaults() -> None:
    outcome, rationale = normalize_negotiation_outcome("", "")
    assert outcome == "compromise"
    assert rationale
