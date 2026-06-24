from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.roles import GRADIENT_DESCENT_AGENT
from app.llm.qwen_factory import qwen_factory
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
        batch = qwen_factory.invoke_structured(
            GRADIENT_DESCENT_AGENT,
            ReformerBatch,
            REFORM_PROMPT,
            {
                "regret": regret,
                "narrative": narrative,
                "ought": ought,
                "agents": [a.summary() for a in agents],
            },
        )
        updates = batch.updates if batch else self._heuristic(agents, regret, ought)

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
                        "llm": "qwen",
                    },
                )
            )

        return list(agent_map.values()), events

    def _heuristic(self, agents, regret, ought) -> list[ReformerUpdate]:
        desired = ought.get("desired_adjectives", ["collaborative", "transparent"])
        updates: list[ReformerUpdate] = []
        for agent in agents:
            add, remove = [], []
            if regret > 0.5:
                for d in desired:
                    if d not in agent.adjectives:
                        add.append(d)
                        break
            if add:
                updates.append(ReformerUpdate(
                    agent_id=agent.id, add_adjectives=add, remove_adjectives=remove,
                    rationale=f"Reform toward OUGHT (regret={regret:.2f})",
                ))
        return updates