from __future__ import annotations

import uuid

from app.models.agent import QualitativeAgent, SocialPlaybook
from app.models.events import SimEvent

OVERLOAD_THRESHOLD = 20
BIRTH_INCOMING_HIGH = 4
SURVIVE_MIN_STRONG = 1
GRACE_TICKS = 20


class LifecycleRules:
    def apply(
        self,
        agents: list[QualitativeAgent],
        playbook: SocialPlaybook,
        quality_pool: list[str],
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[str], list[SimEvent]]:
        events: list[SimEvent] = []
        surviving: list[QualitativeAgent] = []
        pool = list(quality_pool)

        for agent in agents:
            strong = playbook.strong_entries(agent.id)
            incoming_high = [
                e for e in playbook.incoming(agent.id) if e.strength == "high"
            ]

            if tick < GRACE_TICKS:
                surviving.append(agent)
                continue

            if len(strong) < SURVIVE_MIN_STRONG:
                pool.extend(agent.nouns)
                pool.extend(agent.adjectives)
                events.append(
                    SimEvent(
                        type="agent_death",
                        tick=tick,
                        payload={
                            "agent_id": agent.id,
                            "reason": "isolation",
                            "strong_deps": len(strong),
                        },
                    )
                )
                continue

            if len(strong) > OVERLOAD_THRESHOLD:
                pool.extend(agent.nouns)
                pool.extend(agent.adjectives)
                events.append(
                    SimEvent(
                        type="agent_death",
                        tick=tick,
                        payload={
                            "agent_id": agent.id,
                            "reason": "overload",
                            "strong_deps": len(strong),
                        },
                    )
                )
                continue

            surviving.append(agent)

            if len(incoming_high) >= BIRTH_INCOMING_HIGH:
                child = self._spawn_child(agent, incoming_high, pool, tick)
                surviving.append(child)
                events.append(
                    SimEvent(
                        type="agent_birth",
                        tick=tick,
                        payload={
                            "child_id": child.id,
                            "parent_id": agent.id,
                            "verbs": child.verbs,
                            "nouns": child.nouns,
                            "adjectives": child.adjectives,
                            "grid_x": child.grid_x,
                        "grid_y": child.grid_y,
                        },
                    )
                )

        if pool != quality_pool:
            events.append(
                SimEvent(
                    type="quality_pool_update",
                    tick=tick,
                    payload={"pool_size": len(pool), "sample": pool[:10]},
                )
            )

        return surviving, pool, events

    def _spawn_child(
        self,
        parent: QualitativeAgent,
        incoming: list,
        pool: list[str],
        tick: int,
    ) -> QualitativeAgent:
        donors = [parent]
        verbs: list[str] = []
        nouns: list[str] = []
        adjectives: list[str] = []

        for d in donors:
            verbs.extend(d.verbs[:1])
            nouns.extend(d.nouns[:1])
            adjectives.extend(d.adjectives[:1])

        if pool:
            adjectives.append(pool[tick % len(pool)])

        verbs = list(dict.fromkeys(verbs))[:3]
        nouns = list(dict.fromkeys(nouns))[:3]
        adjectives = list(dict.fromkeys(adjectives))[:4]

        return QualitativeAgent(
            id=f"agent-{uuid.uuid4().hex[:8]}",
            name=f"Offspring of {parent.name}",
            role=parent.role,
            verbs=verbs or ["observe"],
            nouns=nouns or ["spark"],
            adjectives=adjectives or ["curious"],
            parent_ids=[parent.id],
            grid_x=parent.grid_x + 1,
            grid_y=parent.grid_y + 1,
        )