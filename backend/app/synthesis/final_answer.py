"""Compose the colony's final markdown answer from the terminal forward pass only."""

from __future__ import annotations

from app.models.state import SimulationState
from app.synthesis.final_forward import run_final_forward_pass


def build_final_answer(state: SimulationState, forward_synthesis: str | None = None) -> str:
    """Answer uses forward-pass synthesis only — no negotiation/raptor/regret dumps."""
    canvas = state["canvas"]
    synthesis = (forward_synthesis or run_final_forward_pass(state)).strip()
    done = sum(1 for t in canvas.subtasks if t.status == "done")
    total = max(len(canvas.subtasks), 1)

    lines = [
        "# Colony Answer",
        "",
        f"**Goal:** {canvas.goal}",
        "",
        synthesis,
        "",
        "---",
        "",
        f"*Terminal forward pass · {state.get('tick', 0)} ticks · "
        f"{done}/{total} subtasks complete · "
        f"quality {max(0.0, 1.0 - state.get('regret', 0.0)):.0%}*",
    ]
    return "\n".join(lines)