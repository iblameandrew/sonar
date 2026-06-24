from __future__ import annotations

import uuid

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.llm.qwen_factory import qwen_factory
from app.models.events import SimEvent
from app.models.raptor import RaptorNode
from app.models.agent import SocialPlaybook

META_EVERY = 4


class SeasonSummary(BaseModel):
    title: str
    summary: str


RAPTOR_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Summarize a season's social playbook into a concise memory node "
            "for long-term societal structure (RAPTOR-style tree).",
        ),
        (
            "human",
            "Micro season: {micro_season}\nMacro season: {macro_season}\n"
            "Tick range: {tick_start}-{tick_end}\n"
            "Playbook entries: {entries}",
        ),
    ]
)


class RaptorMemory:
    def maybe_summarize(
        self,
        nodes: list[RaptorNode],
        playbook: SocialPlaybook,
        macro_season: str,
        micro_season: str,
        tick: int,
        micro_cycle: int = 4,
    ) -> tuple[list[RaptorNode], list[SimEvent]]:
        events: list[SimEvent] = []
        if tick == 0 or tick % micro_cycle != 0:
            return nodes, events

        tick_start = max(0, tick - micro_cycle)
        season_entries = [
            e for e in playbook.entries if tick_start <= e.tick < tick
        ]
        if not season_entries:
            return nodes, events

        title, summary = self._summarize(
            macro_season, micro_season, tick_start, tick, season_entries
        )
        leaf = RaptorNode(
            id=f"raptor-{uuid.uuid4().hex[:8]}",
            title=title,
            summary=summary,
            season_range=(tick_start, tick),
            tick_range=(tick_start, tick),
            level=0,
        )
        nodes = list(nodes)
        nodes.append(leaf)
        events.append(
            SimEvent(
                type="raptor_node_created",
                tick=tick,
                payload=leaf.model_dump(),
            )
        )

        leaf_count = sum(1 for n in nodes if n.level == 0)
        if leaf_count % META_EVERY == 0:
            recent_leaves = [n for n in nodes if n.level == 0][-META_EVERY:]
            meta = RaptorNode(
                id=f"raptor-{uuid.uuid4().hex[:8]}",
                title=f"Era of {recent_leaves[0].title}",
                summary=" | ".join(n.summary[:80] for n in recent_leaves),
                child_ids=[n.id for n in recent_leaves],
                season_range=(
                    recent_leaves[0].season_range[0],
                    recent_leaves[-1].season_range[1],
                ),
                tick_range=(
                    recent_leaves[0].tick_range[0],
                    recent_leaves[-1].tick_range[1],
                ),
                level=1,
            )
            nodes.append(meta)
            events.append(
                SimEvent(
                    type="raptor_node_created",
                    tick=tick,
                    payload=meta.model_dump(),
                )
            )

        return nodes, events

    def _summarize(
        self,
        macro: str,
        micro: str,
        tick_start: int,
        tick_end: int,
        entries: list,
    ) -> tuple[str, str]:
        summaries = [
            f"{e.from_id}->{e.to_id} [{e.kind}/{e.strength}]: {e.rationale[:60]}"
            for e in entries[:20]
        ]
        result = qwen_factory.invoke_structured(
            "raptor",
            SeasonSummary,
            RAPTOR_PROMPT,
            {
                "micro_season": micro, "macro_season": macro,
                "tick_start": tick_start, "tick_end": tick_end,
                "entries": summaries,
            },
        )
        if result:
            return result.title, result.summary

        kinds = [e.kind for e in entries]
        dominant = max(set(kinds), key=kinds.count) if kinds else "unknown"
        title = f"{micro.title()} ({macro}) — {dominant}"
        summary = (
            f"During ticks {tick_start}-{tick_end}, {len(entries)} dependencies "
            f"formed, dominated by {dominant} bonds in a {macro} macro-season."
        )
        return title, summary