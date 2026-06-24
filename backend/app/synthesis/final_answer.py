"""Compose the colony's final markdown answer from simulation state."""

from __future__ import annotations

from app.models.state import SimulationState


def build_final_answer(state: SimulationState) -> str:
    canvas = state["canvas"]
    lines: list[str] = [
        "# Colony Answer",
        "",
        f"**Goal:** {canvas.goal}",
        "",
    ]

    regret = state.get("regret", 0.0)
    narrative = (state.get("regret_narrative") or "").strip()
    if narrative:
        lines.extend(["## Collective assessment", "", narrative, ""])
    else:
        lines.extend([
            "## Collective assessment",
            "",
            f"The society closed with regret **{regret:.2f}** "
            f"and **{canvas.society_progress:.0%}** progress toward the goal.",
            "",
        ])

    done = [t for t in canvas.subtasks if t.status == "done"]
    pending = [t for t in canvas.subtasks if t.status != "done"]
    if done:
        lines.append("## Completed work")
        lines.append("")
        for task in done:
            lines.append(f"- **{task.title}** — {task.description}")
        lines.append("")

    if pending:
        lines.append("## Remaining work")
        lines.append("")
        for task in pending[:8]:
            lines.append(f"- {task.title} — {task.description}")
        if len(pending) > 8:
            lines.append(f"- *…and {len(pending) - 8} more*")
        lines.append("")

    if canvas.artifacts:
        lines.append("## Specialist outputs")
        lines.append("")
        for art in canvas.artifacts[-12:]:
            lines.append(f"### {art.title}")
            lines.append("")
            lines.append(art.content.strip())
            lines.append("")

    if canvas.negotiations:
        lines.append("## Key negotiations")
        lines.append("")
        for neg in canvas.negotiations[-5:]:
            lines.append(
                f"- **{neg.topic}** — *{neg.outcome}*: {neg.rationale.strip()}"
            )
        lines.append("")

    raptor = state.get("raptor_nodes") or []
    if raptor:
        lines.append("## Season memory")
        lines.append("")
        for node in raptor[-3:]:
            summary = getattr(node, "summary", "") or ""
            if summary:
                lines.append(f"- {summary}")
        lines.append("")

    metrics = state.get("metrics")
    society = getattr(metrics, "society", None) if metrics else None
    quality = society.quality_score if society else max(0.0, 1.0 - regret)
    lines.extend([
        "---",
        "",
        f"*Ticks: {state.get('tick', 0)} · quality {quality:.0%} · "
        f"{len(state['playbook'].entries)} playbook edges · "
        f"{len(canvas.artifacts)} artifacts*",
    ])
    return "\n".join(lines)