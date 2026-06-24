"""MLP-style terminal feedforward — convolve activations through drone cells."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from langchain_core.prompts import ChatPromptTemplate

from app.models.agent import DependencyEntry, QualitativeAgent, format_system_prompt
from app.models.state import SimulationState
from app.roles import FEED_FORWARD_AGENT
from app.llm.qwen_factory import qwen_factory
from app.synthesis.limits import AnswerEffort, estimate_output_tokens

WORKER_ROLES = frozenset({"worker", "generalist"})
_SKIP_ROLES = frozenset({"loss_agent", "attention_agent"})

_STRENGTH_W: dict[str, float] = {
    "none": 0.0,
    "low": 0.25,
    "med": 0.6,
    "high": 1.0,
}

MAX_HIDDEN_LAYERS = 4
MAX_CELLS_PER_LAYER = 16
_MAX_READOUT_CONTINUATIONS = 2

INPUT_PROJECT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Input projection layer. Emit a dense activation fragment only — no agent names, "
            "no simulation jargon, no meta-commentary about roles or ticks.",
        ),
        (
            "human",
            "{system_prompt}\n\n"
            "Goal: {goal}\n"
            "Channel role: {role}\n\n"
            "Project this goal into your specialist dimension as raw forward signal "
            "(facts, constraints, recommendations). Output ONLY the activation text.",
        ),
    ]
)

DRONE_FFN_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Feed-forward hidden unit in an MLP. Nonlinearly mix upstream activations. "
            "Never name agents, drones, or colony mechanics. Output ONLY transformed signal.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Cell traits: verbs={verbs}; nouns={nouns}; adjectives={adjectives}\n\n"
            "Weighted upstream activations:\n{incoming}\n\n"
            "Convolve toward the goal. Emit the outgoing activation:",
        ),
    ]
)

READOUT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Output readout head after MLP feedforward. The fragments are convolved terminal "
            "activations sampled from the swarm — NOT agent reports. Write ONE direct markdown "
            "answer to the goal. Do not list who said what. Do not describe the simulation.\n\n"
            "MANDATORY OUTPUT BUDGET:\n"
            "- Hard cap: {max_tokens} tokens\n"
            "- Minimum: {min_output_tokens} tokens (~{min_words} words)\n"
            "- Be thorough within the budget; no brief summary endings.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Terminal activations (sampled output layer):\n{activations}\n\n"
            "Final answer:",
        ),
    ]
)

READOUT_CONTINUE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Continue the readout answer. Add depth; do not repeat; no agent reports.",
        ),
        (
            "human",
            "Goal: {goal}\n"
            "Required minimum (total): {min_output_tokens} tokens\n\n"
            "Answer so far:\n{partial}\n\n"
            "Continue:",
        ),
    ]
)

PLACEHOLDER_MARKERS = ("proposes solution for", "[concept]", "[technical]")


@dataclass(frozen=True)
class ForwardGraph:
    specialists: list[str]
    layers: list[list[str]]
    depth: dict[str, int]
    incoming: dict[str, list[tuple[str, float]]]


def specialist_agents(agents: list[QualitativeAgent]) -> list[QualitativeAgent]:
    return [a for a in agents if a.role not in _SKIP_ROLES and a.role not in WORKER_ROLES]


def drone_agents(agents: list[QualitativeAgent]) -> list[QualitativeAgent]:
    return [a for a in agents if a.role in WORKER_ROLES]


def _is_placeholder(text: str) -> bool:
    lower = text.lower()
    return any(m in lower for m in PLACEHOLDER_MARKERS)


def _edge_weight(entry: DependencyEntry) -> float:
    return _STRENGTH_W.get(entry.strength, 0.0) * max(entry.season_weight, 0.1)


def build_forward_graph(state: SimulationState) -> ForwardGraph:
    """BFS layers from specialists through playbook edges (drone-heavy hidden layers)."""
    agents = {a.id: a for a in state["agents"]}
    specialists = [a.id for a in specialist_agents(state["agents"])]
    if not specialists:
        specialists = [a.id for a in state["agents"] if a.role not in _SKIP_ROLES][:6]

    incoming: dict[str, list[tuple[str, float]]] = defaultdict(list)
    outgoing: dict[str, list[str]] = defaultdict(list)
    for entry in state["playbook"].entries:
        w = _edge_weight(entry)
        if w <= 0 or entry.from_id not in agents or entry.to_id not in agents:
            continue
        incoming[entry.to_id].append((entry.from_id, w))
        outgoing[entry.from_id].append(entry.to_id)

    depth: dict[str, int] = {sid: 0 for sid in specialists}
    layers: list[list[str]] = []
    visited = set(specialists)
    frontier = list(specialists)

    for hop in range(1, MAX_HIDDEN_LAYERS + 1):
        next_ids: list[tuple[str, float]] = []
        for node in frontier:
            for nxt in outgoing.get(node, []):
                if nxt in visited:
                    continue
                agent = agents[nxt]
                if agent.role in _SKIP_ROLES:
                    continue
                score = sum(w for _, w in incoming[nxt])
                if agent.role in WORKER_ROLES:
                    score *= 1.35
                next_ids.append((nxt, score))

        if not next_ids:
            break

        next_ids.sort(key=lambda x: -x[1])
        layer: list[str] = []
        for nid, _ in next_ids:
            if nid in visited:
                continue
            if len(layer) >= MAX_CELLS_PER_LAYER:
                break
            visited.add(nid)
            depth[nid] = hop
            layer.append(nid)

        if not layer:
            break
        layers.append(layer)
        frontier = layer

    if not layers:
        drones = drone_agents(state["agents"])
        fallback = [d.id for d in drones[:MAX_CELLS_PER_LAYER]]
        if fallback:
            layers = [fallback]
            for did in fallback:
                depth[did] = 1
                for sid in specialists:
                    incoming[did].append((sid, 0.5))

    return ForwardGraph(specialists=specialists, layers=layers, depth=depth, incoming=dict(incoming))


def _blend_incoming(
    cell_id: str,
    graph: ForwardGraph,
    activations: dict[str, str],
) -> str:
    edges = graph.incoming.get(cell_id, [])
    if not edges:
        return ""
    parts: list[tuple[float, str]] = []
    for pred, w in edges:
        act = activations.get(pred, "").strip()
        if act:
            parts.append((w, act))
    if not parts:
        return ""
    parts.sort(key=lambda x: -x[0])
    total = sum(w for w, _ in parts) or 1.0
    lines = []
    for w, act in parts[:6]:
        share = w / total
        snippet = act if len(act) <= 900 else f"{act[:900]}…"
        lines.append(f"[{share:.0%}] {snippet}")
    return "\n---\n".join(lines)


def _heuristic_project(agent: QualitativeAgent, goal: str) -> str:
    verb = agent.verbs[0] if agent.verbs else "address"
    noun = agent.nouns[0] if agent.nouns else "requirement"
    return (
        f"«{goal}»: {verb} the {noun}; surface constraints, trade-offs, and concrete outputs."
    )


def _heuristic_drone(agent: QualitativeAgent, goal: str, incoming: str) -> str:
    verb = agent.verbs[0] if agent.verbs else "relay"
    noun = agent.nouns[0] if agent.nouns else "signal"
    raw = incoming.split("\n---\n")[0] if incoming else goal[:120]
    core = raw.split("] ", 1)[-1][:280] if raw else goal[:120]
    return f"{verb} {noun} — {core}"


def _heuristic_readout(goal: str, activation_lines: list[str]) -> str:
    parts: list[str] = []
    for line in activation_lines:
        text = line
        if text.startswith("[depth="):
            end = text.find("] ")
            if end >= 0:
                text = text[end + 2 :].strip()
        if text:
            parts.append(text)
    body = "\n\n".join(parts) if parts else f"No convolved signal reached the output layer for «{goal}»."
    return f"## Answer\n\n{body}"


def _project_input(
    agent: QualitativeAgent,
    goal: str,
    purpose: str,
    max_tokens: int,
) -> str:
    if qwen_factory.is_configured():
        text = qwen_factory.invoke_text(
            agent.role,
            INPUT_PROJECT_PROMPT,
            {
                "system_prompt": format_system_prompt(agent, purpose),
                "goal": goal,
                "role": agent.role,
            },
            max_tokens=max_tokens,
        )
        if text and text.strip() and not _is_placeholder(text):
            return text.strip()
    return _heuristic_project(agent, goal)


def _drone_ffn(
    agent: QualitativeAgent,
    goal: str,
    incoming: str,
    max_tokens: int,
) -> str:
    if not incoming.strip():
        return ""
    if qwen_factory.is_configured():
        text = qwen_factory.invoke_text(
            agent.role,
            DRONE_FFN_PROMPT,
            {
                "goal": goal,
                "verbs": ", ".join(agent.verbs) or "relay",
                "nouns": ", ".join(agent.nouns) or "signal",
                "adjectives": ", ".join(agent.adjectives) or "neutral",
                "incoming": incoming,
            },
            max_tokens=max_tokens,
        )
        if text and text.strip() and not _is_placeholder(text):
            return text.strip()
    return _heuristic_drone(agent, goal, incoming)


def _sample_output_nodes(
    graph: ForwardGraph,
    activations: dict[str, str],
) -> list[str]:
    if not activations:
        return []
    max_depth = max(graph.depth.get(nid, 0) for nid in activations)
    sinks = [nid for nid, act in activations.items() if act.strip() and graph.depth.get(nid, 0) == max_depth]
    if not sinks and graph.layers:
        sinks = [nid for nid in graph.layers[-1] if activations.get(nid, "").strip()]
    if not sinks:
        sinks = list(activations.keys())

    def _sink_score(nid: str) -> float:
        return sum(w for _, w in graph.incoming.get(nid, []))

    sinks.sort(key=_sink_score, reverse=True)
    return sinks[: min(8, len(sinks))]


def _readout_effort_suffix(effort: AnswerEffort) -> str:
    return (
        "MLP readout mode: convolved terminal activations only — never an agent roster."
    )


def _readout_answer(goal: str, activation_block: str, effort: AnswerEffort) -> str | None:
    if not qwen_factory.is_configured() or not activation_block.strip():
        return None

    suffix = _readout_effort_suffix(effort)
    text = qwen_factory.invoke_text(
        FEED_FORWARD_AGENT,
        READOUT_PROMPT,
        {
            "goal": goal,
            "activations": activation_block,
            "max_tokens": effort.max_tokens,
            "min_output_tokens": effort.min_output_tokens,
            "min_words": effort.min_words,
        },
        max_tokens=effort.max_tokens,
        system_suffix=suffix,
    )
    if not text or not text.strip() or _is_placeholder(text):
        return None

    accumulated = text.strip()
    continuations = 0
    while (
        estimate_output_tokens(accumulated) < effort.min_output_tokens
        and continuations < _MAX_READOUT_CONTINUATIONS
    ):
        remaining = max(512, effort.max_tokens - estimate_output_tokens(accumulated))
        more = qwen_factory.invoke_text(
            FEED_FORWARD_AGENT,
            READOUT_CONTINUE_PROMPT,
            {
                "goal": goal,
                "partial": accumulated,
                "min_output_tokens": effort.min_output_tokens,
            },
            max_tokens=remaining,
            system_suffix=suffix,
        )
        if not more or not more.strip():
            break
        accumulated = f"{accumulated}\n\n{more.strip()}"
        continuations += 1
    return accumulated


def run_mlp_forward_pass(state: SimulationState, effort: AnswerEffort) -> str:
    """Convolve goal signal through specialist input → drone hidden layers → readout."""
    agents = {a.id: a for a in state["agents"]}
    canvas = state["canvas"]
    ought = state.get("ought_snapshot") or {}
    purpose = str(ought.get("description", canvas.goal)).strip()
    goal = canvas.goal

    graph = build_forward_graph(state)
    hop_tokens = max(192, min(512, effort.specialist_max_tokens // 2))
    project_tokens = max(256, effort.specialist_max_tokens)

    activations: dict[str, str] = {}

    for sid in graph.specialists:
        agent = agents.get(sid)
        if not agent:
            continue
        activations[sid] = _project_input(agent, goal, purpose, project_tokens)

    for layer in graph.layers:
        next_activations: dict[str, str] = {}
        for cell_id in layer:
            agent = agents.get(cell_id)
            if not agent:
                continue
            incoming = _blend_incoming(cell_id, graph, activations)
            if not incoming:
                continue
            out = _drone_ffn(agent, goal, incoming, hop_tokens)
            if out:
                next_activations[cell_id] = out
        activations.update(next_activations)

    sinks = _sample_output_nodes(graph, activations)
    if not sinks:
        sinks = graph.specialists

    activation_lines = []
    for nid in sinks:
        act = activations.get(nid, "").strip()
        if act:
            depth = graph.depth.get(nid, 0)
            activation_lines.append(f"[depth={depth}] {act}")

    block = "\n\n".join(activation_lines)
    readout = _readout_answer(goal, block, effort)
    if readout:
        return readout

    if activation_lines:
        return _heuristic_readout(goal, activation_lines)

    return f"## Answer\n\nInsufficient forward signal for «{goal}»."