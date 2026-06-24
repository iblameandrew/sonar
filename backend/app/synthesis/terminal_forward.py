"""Terminal forward pass — one final PERFORM round per specialist, then synthesis."""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from app.models.agent import QualitativeAgent, format_system_prompt
from app.models.state import SimulationState
from app.roles import FEED_FORWARD_AGENT
from app.llm.qwen_factory import qwen_factory

_SKIP_ROLES = frozenset({"worker", "generalist", "loss_agent", "attention_agent"})


def specialist_agents(agents: list[QualitativeAgent]) -> list[QualitativeAgent]:
    return [a for a in agents if a.role not in _SKIP_ROLES]

TERMINAL_PROPOSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Terminal forward pass. Answer the user's goal directly from your adapted persona. "
            "No simulation jargon. 3–6 sentences.",
        ),
        (
            "human",
            "{system_prompt}\n\n"
            "Colony goal: {goal}\n"
            "Ticks completed: {ticks}\n"
            "Playbook edges: {edges}\n"
            "Collective regret: {regret:.2f}\n\n"
            "Give your specialist's final answer to the goal.",
        ),
    ]
)

TERMINAL_SYNTH_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Synthesize the terminal forward-pass specialist answers into ONE coherent "
            "markdown response to the goal. Use only the specialist outputs below.",
        ),
        (
            "human",
            "Goal: {goal}\n\nSpecialist terminal outputs:\n{outputs}\n\nFinal answer:",
        ),
    ]
)

PLACEHOLDER_MARKERS = ("proposes solution for", "[concept]", "[technical]")


def _is_placeholder(text: str) -> bool:
    lower = text.lower()
    return any(m in lower for m in PLACEHOLDER_MARKERS)


def _heuristic_terminal(agent: QualitativeAgent, goal: str, purpose: str) -> str:
    verb = agent.verbs[0] if agent.verbs else "consider"
    noun = agent.nouns[0] if agent.nouns else "the question"
    traits = ", ".join(agent.adjectives[:3]) or "thoughtful"
    return (
        f"**{agent.name}** ({agent.role}, {traits}): "
        f"Approaching «{goal}» through {verb} and {noun}, "
        f"I see meaning in purposeful {noun} — aligned with {purpose[:100]}."
    )


def _collect_terminal_outputs(state: SimulationState) -> list[tuple[str, str]]:
    canvas = state["canvas"]
    ought = state.get("ought_snapshot") or {}
    purpose = str(ought.get("description", canvas.goal)).strip()
    goal = canvas.goal
    edges = len(state["playbook"].entries)
    regret = float(state.get("regret", 0.0))
    ticks = state.get("tick", 0)
    outputs: list[tuple[str, str]] = []

    for agent in specialist_agents(state["agents"]):
        sys_prompt = format_system_prompt(agent, purpose)
        content: str | None = None
        if qwen_factory.is_configured():
            content = qwen_factory.invoke_text(
                agent.role,
                TERMINAL_PROPOSE_PROMPT,
                {
                    "system_prompt": sys_prompt,
                    "goal": goal,
                    "ticks": ticks,
                    "edges": edges,
                    "regret": regret,
                },
            )
        if not content or _is_placeholder(content):
            content = _heuristic_terminal(agent, goal, purpose)
        outputs.append((agent.name, content.strip()))

    return outputs


def run_terminal_forward_pass(state: SimulationState) -> str:
    """Run terminal PERFORM (per-specialist) then synthesize — forward mechanisms only."""
    outputs = _collect_terminal_outputs(state)
    goal = state["canvas"].goal
    block = "\n\n".join(f"### {name}\n{text}" for name, text in outputs)

    if qwen_factory.is_configured():
        text = qwen_factory.invoke_text(
            FEED_FORWARD_AGENT,
            TERMINAL_SYNTH_PROMPT,
            {"goal": goal, "outputs": block},
        )
        if text and text.strip() and not _is_placeholder(text):
            return text.strip()

    lines = [
        "## Answer",
        "",
        f"The colony completed **{state.get('tick', 0)}** ticks of attention, audit, "
        f"spanner-fit reform, and backward flow before this terminal forward pass.",
        "",
    ]
    for _name, text in outputs:
        lines.append(text)
        lines.append("")
    return "\n".join(lines).strip()