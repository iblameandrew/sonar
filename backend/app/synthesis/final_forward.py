"""Re-export terminal forward pass — the only path for final answers."""

from __future__ import annotations

from app.models.state import SimulationState
from app.synthesis.terminal_forward import run_terminal_forward_pass

__all__ = ["run_terminal_forward_pass"]


def run_final_forward_pass(state: SimulationState) -> str:
    return run_terminal_forward_pass(state)