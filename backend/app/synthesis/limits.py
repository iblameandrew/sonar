"""Token limits for terminal forward-pass synthesis."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_ANSWER_MAX_TOKENS = 8192
MIN_ANSWER_MAX_TOKENS = 256
MAX_ANSWER_MAX_TOKENS = 65536


def clamp_answer_max_tokens(value: int | None) -> int:
    if value is None:
        return DEFAULT_ANSWER_MAX_TOKENS
    try:
        raw = int(value)
    except (TypeError, ValueError):
        return DEFAULT_ANSWER_MAX_TOKENS
    return max(MIN_ANSWER_MAX_TOKENS, min(MAX_ANSWER_MAX_TOKENS, raw))


def estimate_output_tokens(text: str) -> int:
    """Rough token estimate used to enforce minimum effort."""
    return max(len(text) // 4, 0)


@dataclass(frozen=True)
class AnswerEffort:
    max_tokens: int
    min_output_tokens: int
    min_words: int
    specialist_max_tokens: int


def answer_effort_targets(max_tokens: int, specialist_count: int) -> AnswerEffort:
    """Derive hard effort targets from the configured answer token budget."""
    capped = clamp_answer_max_tokens(max_tokens)
    count = max(1, specialist_count)

    specialist_share = 0.4 if capped >= 8192 else 0.3
    specialist_pool = int(capped * specialist_share)
    specialist_max = max(512, min(4096, specialist_pool // count))

    if capped >= 8192:
        ratio = 0.45
        floor = 3000
    elif capped >= 4096:
        ratio = 0.5
        floor = 1500
    elif capped >= 1024:
        ratio = 0.55
        floor = 512
    else:
        ratio = 0.65
        floor = 256

    min_output = max(floor, int(capped * ratio))
    min_output = min(min_output, capped)
    min_words = max(120, (min_output * 3) // 4)

    return AnswerEffort(
        max_tokens=capped,
        min_output_tokens=min_output,
        min_words=min_words,
        specialist_max_tokens=specialist_max,
    )