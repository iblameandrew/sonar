from __future__ import annotations

from app.models.agent import DependencyEntry, QualitativeAgent, SocialPlaybook
from app.models.events import SimEvent
from app.store.custodian import Custodian


class Confessor:
    """Backward connection: consequences flow backward to their causes."""

    def confess(
        self,
        agents: list[QualitativeAgent],
        playbook: SocialPlaybook,
        custodian: Custodian,
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        agent_map = {a.id: a.model_copy(deep=True) for a in agents}

        tick_entries = [e for e in playbook.entries if e.tick == tick]

        for entry in tick_entries:
            blended = custodian.update(entry.from_id, entry.to_id, entry.strength)
            events.append(
                SimEvent(
                    type="confessor_flow",
                    tick=tick,
                    payload={
                        "from_id": entry.from_id,
                        "to_id": entry.to_id,
                        "original_strength": entry.strength,
                        "blended_strength": blended,
                        "kind": entry.kind,
                    },
                )
            )

            cause = agent_map.get(entry.to_id)
            effect = agent_map.get(entry.from_id)
            if not cause or not effect:
                continue

            if entry.strength in ("med", "high") and entry.qualitative_distance == "near":
                for adj in cause.adjectives[:2]:
                    if adj not in effect.adjectives and adj in (
                        "trusted", "generous", "calm", "prestigious", "skilled"
                    ):
                        effect.adjectives.append(adj)

            if entry.kind == "conflict" and entry.strength in ("med", "high"):
                if "feared" not in effect.adjectives:
                    effect.adjectives.append("feared")

        custodian.save()
        return list(agent_map.values()), events