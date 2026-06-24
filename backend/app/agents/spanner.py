"""Spanner — torque agent personas toward goal purpose proportional to audit error."""

from __future__ import annotations

from app.models.agent import QualitativeAgent, format_system_prompt
from app.models.events import SimEvent

ROLE_GOAL_TOKENS: dict[str, tuple[list[str], list[str]]] = {
    "voxel_architect": (["render", "visualize"], ["voxels", "scene"]),
    "orchestrator": (["orchestrate", "stream"], ["langgraph", "events"]),
    "optimizer": (["benchmark", "measure"], ["metrics", "latency"]),
    "integrator": (["wire", "deploy"], ["fastapi", "api"]),
    "ux_weaver": (["layout", "compose"], ["dashboard", "panels"]),
    "critic_evaluator": (["evaluate", "compare"], ["baseline", "quality"]),
}

MISFIT_ADJECTIVES = ("hostile", "restless", "lonely", "feared", "hungry")


class Spanner:
    """Adapt verbs/nouns/adjectives toward the ought purpose; torque scales with regret."""

    def fit(
        self,
        agents: list[QualitativeAgent],
        ought: dict,
        regret: float,
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[SimEvent]]:
        error = max(0.0, min(1.0, regret))
        purpose = str(ought.get("description", "")).strip()
        desired = list(ought.get("desired_adjectives", []))
        events: list[SimEvent] = []
        updated: list[QualitativeAgent] = []

        for agent in agents:
            a = agent.model_copy(deep=True)
            if error >= 0.08:
                self._apply_torque(a, desired, purpose, error)

            events.append(
                SimEvent(
                    type="spanner_fit",
                    tick=tick,
                    payload={
                        "agent_id": a.id,
                        "agent_name": a.name,
                        "regret": regret,
                        "torque": error,
                        "system_prompt": format_system_prompt(a, purpose),
                    },
                )
            )
            updated.append(a)

        return updated, events

    def _apply_torque(
        self,
        agent: QualitativeAgent,
        desired_adjectives: list[str],
        purpose: str,
        error: float,
    ) -> None:
        slots = max(1, int(error * 3))
        for adj in desired_adjectives[:slots]:
            if adj not in agent.adjectives:
                agent.adjectives.append(adj)

        goal_verbs, goal_nouns = ROLE_GOAL_TOKENS.get(agent.role, ([], []))
        if purpose:
            tokens = [t.strip().lower() for t in purpose.replace(",", " ").split() if len(t) > 3]
            if tokens and not goal_nouns:
                goal_nouns = tokens[:2]
        for verb in goal_verbs[: max(1, slots // 2)]:
            if verb not in agent.verbs:
                agent.verbs.append(verb)
        for noun in goal_nouns[: max(1, slots // 2)]:
            if noun not in agent.nouns:
                agent.nouns.append(noun)

        if error >= 0.45:
            agent.adjectives = [adj for adj in agent.adjectives if adj not in MISFIT_ADJECTIVES]

        agent.verbs = list(dict.fromkeys(agent.verbs))[:8]
        agent.nouns = list(dict.fromkeys(agent.nouns))[:8]
        agent.adjectives = list(dict.fromkeys(agent.adjectives))[:10]