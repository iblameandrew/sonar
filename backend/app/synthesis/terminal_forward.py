"""Terminal forward pass — one final PERFORM round per specialist, then synthesis."""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from app.models.agent import QualitativeAgent, format_system_prompt
from app.models.state import SimulationState
from app.roles import FEED_FORWARD_AGENT
from app.llm.qwen_factory import qwen_factory
from app.synthesis.limits import (
    answer_effort_targets,
    clamp_answer_max_tokens,
    estimate_output_tokens,
)

_SKIP_ROLES = frozenset({"worker", "generalist", "loss_agent", "attention_agent"})

_MAX_SYNTH_CONTINUATIONS = 2


def specialist_agents(agents: list[QualitativeAgent]) -> list[QualitativeAgent]:
    return [a for a in agents if a.role not in _SKIP_ROLES]

TERMINAL_PROPOSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Terminal forward pass. Answer the user's goal directly from your adapted persona. "
            "No simulation jargon. This is the final specialist contribution — be substantive.",
        ),
        (
            "human",
            "{system_prompt}\n\n"
            "Colony goal: {goal}\n"
            "Ticks completed: {ticks}\n"
            "Playbook edges: {edges}\n"
            "Collective regret: {regret:.2f}\n\n"
            "Output budget: up to {specialist_max_tokens} tokens "
            "(target at least {specialist_min_words} words).\n"
            "Cover your specialist angle in depth: concrete recommendations, trade-offs, "
            "implementation notes, risks, and examples where relevant. "
            "Do not stop after a short summary.\n\n"
            "Give your specialist's final answer to the goal.",
        ),
    ]
)

TERMINAL_SYNTH_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Synthesize the terminal forward-pass specialist answers into ONE coherent "
            "markdown response to the goal. Use the specialist outputs as source material "
            "and expand where needed.\n\n"
            "MANDATORY OUTPUT BUDGET:\n"
            "- Hard API cap: {max_tokens} output tokens.\n"
            "- Minimum effort: at least {min_output_tokens} tokens (~{min_words} words).\n"
            "- You MUST produce a long-form, thorough answer. Use headings, sections, lists, "
            "and detailed explanations until the minimum is clearly met.\n"
            "- Do NOT end with a brief summary. Do NOT stop early when the goal warrants depth.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Hard output cap: {max_tokens} tokens\n"
            "Required minimum: {min_output_tokens} tokens (~{min_words} words)\n\n"
            "Specialist terminal outputs:\n{outputs}\n\n"
            "Write the complete final answer now:",
        ),
    ]
)

TERMINAL_CONTINUE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Continue the terminal synthesis answer. Do not repeat prior content. "
            "Add new sections, detail, examples, or implementation depth.\n\n"
            "Remain within the overall budget of {max_tokens} tokens and keep going until "
            "at least {min_output_tokens} tokens (~{min_words} words) are covered in total.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Required minimum (total): {min_output_tokens} tokens (~{min_words} words)\n\n"
            "Answer so far:\n{partial}\n\n"
            "Continue the answer:",
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


def _specialist_min_words(specialist_max_tokens: int) -> int:
    return max(80, (specialist_max_tokens * 3) // 8)


def _collect_terminal_outputs(
    state: SimulationState,
    effort: AnswerEffort,
) -> list[tuple[str, str]]:
    canvas = state["canvas"]
    ought = state.get("ought_snapshot") or {}
    purpose = str(ought.get("description", canvas.goal)).strip()
    goal = canvas.goal
    edges = len(state["playbook"].entries)
    regret = float(state.get("regret", 0.0))
    ticks = state.get("tick", 0)
    specialist_min_words = _specialist_min_words(effort.specialist_max_tokens)
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
                    "specialist_max_tokens": effort.specialist_max_tokens,
                    "specialist_min_words": specialist_min_words,
                },
                max_tokens=effort.specialist_max_tokens,
            )
        if not content or _is_placeholder(content):
            content = _heuristic_terminal(agent, goal, purpose)
        outputs.append((agent.name, content.strip()))

    return outputs


def _feed_forward_effort_suffix(effort: AnswerEffort) -> str:
    return (
        "Terminal synthesis mode: override brevity defaults. "
        f"Produce a long-form answer using up to {effort.max_tokens} tokens "
        f"and at least {effort.min_output_tokens} tokens (~{effort.min_words} words)."
    )


def _synthesize_terminal_answer(goal: str, block: str, effort: AnswerEffort) -> str | None:
    if not qwen_factory.is_configured():
        return None

    suffix = _feed_forward_effort_suffix(effort)
    synth_vars = {
        "goal": goal,
        "outputs": block,
        "max_tokens": effort.max_tokens,
        "min_output_tokens": effort.min_output_tokens,
        "min_words": effort.min_words,
    }
    text = qwen_factory.invoke_text(
        FEED_FORWARD_AGENT,
        TERMINAL_SYNTH_PROMPT,
        synth_vars,
        max_tokens=effort.max_tokens,
        system_suffix=suffix,
    )
    if not text or not text.strip() or _is_placeholder(text):
        return None

    accumulated = text.strip()
    continuations = 0
    while (
        estimate_output_tokens(accumulated) < effort.min_output_tokens
        and continuations < _MAX_SYNTH_CONTINUATIONS
    ):
        remaining = max(512, effort.max_tokens - estimate_output_tokens(accumulated))
        more = qwen_factory.invoke_text(
            FEED_FORWARD_AGENT,
            TERMINAL_CONTINUE_PROMPT,
            {
                "goal": goal,
                "partial": accumulated,
                "max_tokens": effort.max_tokens,
                "min_output_tokens": effort.min_output_tokens,
                "min_words": effort.min_words,
            },
            max_tokens=remaining,
            system_suffix=suffix,
        )
        if not more or not more.strip() or _is_placeholder(more):
            break
        accumulated = f"{accumulated}\n\n{more.strip()}"
        continuations += 1

    return accumulated


def run_terminal_forward_pass(state: SimulationState) -> str:
    """Run terminal PERFORM (per-specialist) then synthesize — forward mechanisms only."""
    specialists = specialist_agents(state["agents"])
    answer_max_tokens = clamp_answer_max_tokens(state.get("answer_max_tokens"))
    effort = answer_effort_targets(answer_max_tokens, len(specialists))
    outputs = _collect_terminal_outputs(state, effort)
    goal = state["canvas"].goal
    block = "\n\n".join(f"### {name}\n{text}" for name, text in outputs)

    text = _synthesize_terminal_answer(goal, block, effort)
    if text:
        return text

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