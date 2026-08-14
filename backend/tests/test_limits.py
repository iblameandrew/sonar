from __future__ import annotations

from app.synthesis.limits import (
    DEFAULT_ANSWER_MAX_TOKENS,
    MAX_ANSWER_MAX_TOKENS,
    MIN_ANSWER_MAX_TOKENS,
    answer_effort_targets,
    clamp_answer_max_tokens,
    estimate_output_tokens,
)


def test_clamp_answer_max_tokens() -> None:
    assert clamp_answer_max_tokens(None) == DEFAULT_ANSWER_MAX_TOKENS
    assert clamp_answer_max_tokens("nope") == DEFAULT_ANSWER_MAX_TOKENS  # type: ignore[arg-type]
    assert clamp_answer_max_tokens(1) == MIN_ANSWER_MAX_TOKENS
    assert clamp_answer_max_tokens(999999) == MAX_ANSWER_MAX_TOKENS
    assert clamp_answer_max_tokens(2048) == 2048


def test_estimate_output_tokens() -> None:
    assert estimate_output_tokens("") == 0
    assert estimate_output_tokens("abcd") == 1
    assert estimate_output_tokens("a" * 40) == 10


def test_effort_targets_scale_with_budget() -> None:
    small = answer_effort_targets(256, 4)
    assert small.max_tokens == MIN_ANSWER_MAX_TOKENS
    assert small.min_output_tokens <= small.max_tokens
    assert small.min_words >= 120
    assert small.specialist_max_tokens >= 512

    large = answer_effort_targets(8192, 6)
    assert large.min_output_tokens >= 3000
    assert large.specialist_max_tokens <= 4096
    assert large.min_output_tokens > small.min_output_tokens
