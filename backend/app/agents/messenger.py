from __future__ import annotations

import random

from app.models.agent import QualitativeAgent
from app.models.events import SimEvent
from app.models.institution import Institution


class Messenger:
    """Feed-forward: carries activation to neighbors via verb-driven state change."""

    VERB_EFFECTS: dict[str, dict[str, list[str]]] = {
        "farm": {"nouns_add": ["grain"], "adjectives_add": ["fed"]},
        "trade": {"nouns_add": ["coin"], "adjectives_add": ["prosperous"]},
        "build": {"nouns_add": ["shelter"], "adjectives_add": ["secure"]},
        "hunt": {"nouns_add": ["meat"], "adjectives_add": ["strong"]},
        "heal": {"adjectives_add": ["healthy"], "adjectives_remove": ["weary", "tired"]},
        "cook": {"adjectives_add": ["satisfied"], "adjectives_remove": ["hungry"]},
        "mediate": {"adjectives_add": ["trusted", "calm"]},
        "steal": {"adjectives_add": ["feared"], "adjectives_remove": ["trusted"]},
        "pray": {"adjectives_add": ["devout", "calm"]},
        "sing": {"adjectives_add": ["joyful"]},
    }

    def perform(
        self,
        agents: list[QualitativeAgent],
        institutions: list[Institution],
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        inst_by_id = {i.id: i for i in institutions}

        updated: list[QualitativeAgent] = []
        for agent in agents:
            agent = agent.model_copy(deep=True)
            for verb in agent.verbs:
                effects = self.VERB_EFFECTS.get(verb, {})
                for noun in effects.get("nouns_add", []):
                    if noun not in agent.nouns:
                        agent.nouns.append(noun)
                for adj in effects.get("adjectives_add", []):
                    if adj not in agent.adjectives:
                        agent.adjectives.append(adj)
                for adj in effects.get("adjectives_remove", []):
                    if adj in agent.adjectives:
                        agent.adjectives.remove(adj)

            if agent.institution_id and agent.institution_id in inst_by_id:
                inst = inst_by_id[agent.institution_id]
                for adj, bias in inst.policy.items():
                    if bias == "promote" and adj not in agent.adjectives:
                        agent.adjectives.append(adj)
                    elif bias == "suppress" and adj in agent.adjectives:
                        agent.adjectives.remove(adj)

            if random.random() < 0.1:
                hunger_words = {"hungry", "weary", "tired", "lonely"}
                agent.adjectives = [
                    a for a in agent.adjectives if a not in hunger_words
                ] + [random.choice(["hungry", "weary", "restless"])]

            updated.append(agent)
            events.append(
                SimEvent(
                    type="messenger_perform",
                    tick=tick,
                    payload={
                        "agent_id": agent.id,
                        "verbs": agent.verbs,
                        "nouns": agent.nouns,
                        "adjectives": agent.adjectives,
                    },
                )
            )

        return updated, events