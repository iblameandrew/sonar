from __future__ import annotations

from typing import Literal

NegotiationOutcome = Literal["accepted", "compromise", "rejected", "voting"]

_VALID: tuple[NegotiationOutcome, ...] = ("accepted", "compromise", "rejected", "voting")


def normalize_negotiation_outcome(
    raw: str,
    rationale: str = "",
) -> tuple[NegotiationOutcome, str]:
    """Map free-text LLM outcome labels to NegotiationRound literals."""
    text = (raw or "").strip()
    lower = text.lower()
    rationale = (rationale or "").strip()

    for key in _VALID:
        if lower == key or lower.startswith(f"{key} ") or lower.startswith(f"{key}:"):
            return key, rationale

    if any(w in lower for w in ("reject", "denied", "blocked", "refused")):
        merged = _merge_rationale(rationale, text)
        return "rejected", merged

    if any(w in lower for w in ("vote", "voting", "poll", "ballot")):
        merged = _merge_rationale(rationale, text)
        return "voting", merged

    if any(
        w in lower
        for w in ("compromise", "hybrid", "blend", "merge", "middle ground", "partial")
    ):
        merged = _merge_rationale(rationale, text)
        return "compromise", merged

    if any(w in lower for w in ("accept", "accepted", "approved", "agreed")):
        merged = _merge_rationale(rationale, text)
        return "accepted", merged

    if text:
        return "compromise", _merge_rationale(rationale, text)
    return "compromise", rationale or "Negotiation settled by compromise."


def _merge_rationale(rationale: str, extra: str) -> str:
    extra = extra.strip()
    if not extra:
        return rationale
    if not rationale:
        return extra
    if extra.lower() in rationale.lower():
        return rationale
    return f"{rationale} | {extra}"