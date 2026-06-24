from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.agents.base import get_llm
from app.models.agent import QualitativeAgent
from app.models.events import SimEvent


class ReformerUpdate(BaseModel):
    agent_id: str
    add_adjectives: list[str] = Field(default_factory=list)
    remove_adjectives: list[str] = Field(default_factory=list)
    add_verbs: list[str] = Field(default_factory=list)
    rationale: str


class ReformerBatch(BaseModel):
    updates: list[ReformerUpdate]


REFORM_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are THE REFORMER — gradient descent as social change. "
            "Push each agent to change in the direction that reduces the Auditor's regret. "
            "Propose small qualitative shifts (add/remove adjectives or verbs).",
        ),
        (
            "human",
            "Regret: {regret}\nNarrative: {narrative}\n"
            "OUGHT: {ought}\nAgents: {agents}\n"
            "Propose updates for agents that most need reform.",
        ),
    ]
)


class Reformer:
    def reform(
        self,
        agents: list[QualitativeAgent],
        regret: float,
        narrative: str,
        ought: dict,
        tick: int,
    ) -> tuple[list[QualitativeAgent], list[SimEvent]]:
        events: list[SimEvent] = []
        llm = get_llm()
        updates: list[ReformerUpdate] = []

        if llm:
            try:
                chain = llm.with_structured_output(ReformerBatch)
                batch: ReformerBatch = chain.invoke(
                    REFORM_PROMPT.format_messages(
                        regret=regret,
                        narrative=narrative,
                        ought=ought,
                        agents=[a.summary() for a in agents],
                    )
                )
                updates = batch.updates
            except Exception:
                updates = self._heuristic(agents, regret, ought)
        else:
            updates = self._heuristic(agents, regret, ought)

        agent_map = {a.id: a.model_copy(deep=True) for a in agents}
        for upd in updates:
            if upd.agent_id not in agent_map:
                continue
            agent = agent_map[upd.agent_id]
            for adj in upd.add_adjectives:
                if adj not in agent.adjectives:
                    agent.adjectives.append(adj)
            for adj in upd.remove_adjectives:
                if adj in agent.adjectives:
                    agent.adjectives.remove(adj)
            for verb in upd.add_verbs:
                if verb not in agent.verbs:
                    agent.verbs.append(verb)
            events.append(
                SimEvent(
                    type="reformer_update",
                    tick=tick,
                    payload={
                        "agent_id": upd.agent_id,
                        "add_adjectives": upd.add_adjectives,
                        "remove_adjectives": upd.remove_adjectives,
                        "add_verbs": upd.add_verbs,
                        "rationale": upd.rationale,
                    },
                )
            )

        return list(agent_map.values()), events

    def _heuristic(
        self, agents: list[QualitativeAgent], regret: float, ought: dict
    ) -> list[ReformerUpdate]:
        desired = ought.get("desired_adjectives", ["fed", "trusted", "purposeful"])
        updates: list[ReformerUpdate] = []
        for agent in agents:
            add, remove = [], []
            if "hungry" in agent.adjectives and "fed" in desired:
                remove.append("hungry")
                add.append("fed")
            if "lonely" in agent.adjectives and "cooperative" in desired:
                remove.append("lonely")
                add.append("cooperative")
            if regret > 0.5 and "purposeful" in desired and "purposeful" not in agent.adjectives:
                add.append("purposeful")
            if add or remove:
                updates.append(
                    ReformerUpdate(
                        agent_id=agent.id,
                        add_adjectives=add,
                        remove_adjectives=remove,
                        rationale=f"Reform toward OUGHT (regret={regret:.2f})",
                    )
                )
        return updates