"""Terminal forward pass — synthesize the user-facing answer from forward-half outputs only."""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from app.agents.messenger import ROLE_ARTIFACT_KIND
from app.models.agent import QualitativeAgent, format_system_prompt
from app.models.canvas import Artifact
from app.models.state import SimulationState
from app.roles import FEED_FORWARD_AGENT
from app.llm.qwen_factory import qwen_factory

FORWARD_ARTIFACT_KINDS = frozenset(ROLE_ARTIFACT_KIND.values()) | {"code"}

FINAL_SYNTH_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are the colony's terminal forward pass. Synthesize ONE clear markdown "
            "answer to the user's goal using only the specialist outputs below. "
            "Be concrete and actionable. No simulation meta-commentary.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Ticks completed: {ticks}\n\n"
            "Specialist system prompts (error-adapted):\n{prompts}\n\n"
            "Forward-pass artifacts (PERFORM / feed-forward only):\n{artifacts}\n\n"
            "Completed subtasks:\n{tasks}\n\n"
            "Write the final answer.",
        ),
    ]
)


def forward_artifacts(canvas) -> list[Artifact]:
    """Artifacts from PERFORM only — exclude conflict/negotiation noise."""
    return [
        a
        for a in canvas.artifacts
        if a.kind in FORWARD_ARTIFACT_KINDS
        and "conflict resolution" not in a.title.lower()
        and "conflict" not in a.title.lower()
    ]


def specialist_agents(agents: list[QualitativeAgent]) -> list[QualitativeAgent]:
    skip = {"worker", "generalist", "loss_agent", "attention_agent"}
    return [a for a in agents if a.role not in skip]


def run_final_forward_pass(state: SimulationState) -> str:
    canvas = state["canvas"]
    ought = state.get("ought_snapshot") or {}
    purpose = str(ought.get("description", canvas.goal)).strip()
    agents = specialist_agents(state["agents"])
    arts = forward_artifacts(canvas)
    done = [t for t in canvas.subtasks if t.status == "done"]

    prompts = "\n\n".join(
        f"### {a.name}\n{format_system_prompt(a, purpose)}"
        for a in agents[:12]
    )
    artifact_block = "\n\n".join(
        f"**{a.title}** ({a.kind})\n{a.content.strip()}"
        for a in arts[-16:]
    ) or "_No forward artifacts yet — specialists did not complete PERFORM outputs._"
    task_block = "\n".join(f"- {t.title}: {t.description}" for t in done[:12]) or "_None marked done._"

    if qwen_factory.is_configured():
        text = qwen_factory.invoke_text(
            FEED_FORWARD_AGENT,
            FINAL_SYNTH_PROMPT,
            {
                "goal": canvas.goal,
                "ticks": state.get("tick", 0),
                "prompts": prompts or "_No specialists._",
                "artifacts": artifact_block,
                "tasks": task_block,
            },
        )
        if text and text.strip():
            return text.strip()

    return _heuristic_synthesis(canvas.goal, agents, arts, done, state.get("tick", 0), purpose)


def _heuristic_synthesis(goal, agents, arts, done, tick, purpose) -> str:
    lines = [
        "## Synthesis",
        "",
        f"After **{tick}** ticks the colony adapted specialist personas toward: _{purpose[:120]}_",
        "",
    ]
    if done:
        lines.append("### Completed work")
        lines.append("")
        for t in done[:8]:
            lines.append(f"- **{t.title}** — {t.description}")
        lines.append("")
    if arts:
        lines.append("### Forward-pass outputs")
        lines.append("")
        for a in arts[-6:]:
            lines.append(f"#### {a.title}")
            lines.append("")
            lines.append(a.content.strip())
            lines.append("")
    if agents:
        lines.append("### Adapted specialists")
        lines.append("")
        for ag in agents[:6]:
            lines.append(f"- **{ag.name}**: {', '.join(ag.verbs)} · {', '.join(ag.nouns)} · *{', '.join(ag.adjectives)}*")
        lines.append("")
    lines.append(f"**Goal recap:** {goal}")
    return "\n".join(lines)