"""Terminal forward pass — MLP feedforward through specialist input and drone hidden cells."""

from __future__ import annotations

from app.models.state import SimulationState
from app.synthesis.limits import answer_effort_targets, clamp_answer_max_tokens
from app.synthesis.mlp_forward import run_mlp_forward_pass, specialist_agents


def run_terminal_forward_pass(state: SimulationState) -> str:
    """Convolve N-token activations through drone layers; readout at sampled sinks."""
    answer_max_tokens = clamp_answer_max_tokens(state.get("answer_max_tokens"))
    specialists = specialist_agents(state["agents"])
    effort = answer_effort_targets(answer_max_tokens, max(1, len(specialists)))
    return run_mlp_forward_pass(state, effort)