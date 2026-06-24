from __future__ import annotations

import uuid
from collections import Counter

import numpy as np
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from sklearn.cluster import KMeans

from app.agents.base import get_llm
from app.models.agent import DependencyEntry, SocialPlaybook
from app.models.events import SimEvent
from app.models.institution import Institution

KINDS = [
    "economic", "kinship", "prestige", "conflict", "sustenance",
    "craft", "ritual", "collaboration", "negotiation",
]
DISTANCES = {"near": 0.0, "mid": 0.5, "far": 1.0}
STRENGTHS = {"none": 0.0, "low": 0.25, "med": 0.55, "high": 0.85}

ENTRY_THRESHOLD = 15
MIN_CLUSTER_ENTRIES = 3


class InstitutionProposal(BaseModel):
    name: str
    policy: dict[str, str] = Field(default_factory=dict)


INST_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You name and policy-compress a cluster of social dependencies into an "
            "institutional agent. No inner psychology — only policies that bias member qualities.",
        ),
        (
            "human",
            "Dominant kind: {kind}\n"
            "Member agents: {members}\n"
            "Sample rationales: {rationales}\n"
            "Return institution name and policy (adjective -> promote/suppress).",
        ),
    ]
)


def vectorize_entry(entry: DependencyEntry) -> np.ndarray:
    kind_vec = [1.0 if entry.kind == k else 0.0 for k in KINDS]
    dist = DISTANCES.get(entry.qualitative_distance, 0.5)
    strength = STRENGTHS.get(entry.strength, 0.0)
    return np.array(kind_vec + [dist, strength, entry.season_weight], dtype=float)


class InstitutionCondenser:
    def condense(
        self,
        playbook: SocialPlaybook,
        existing: list[Institution],
        macro_season: str,
        tick: int,
    ) -> tuple[list[Institution], list[SimEvent]]:
        events: list[SimEvent] = []
        institutions = list(existing)

        strong_entries = [e for e in playbook.entries if e.strength in ("med", "high")]
        if len(strong_entries) < ENTRY_THRESHOLD:
            if macro_season == "diffuse":
                dissolved = self._maybe_dissolve(institutions, playbook, tick)
                events.extend(dissolved)
            return institutions, events

        vectors = np.stack([vectorize_entry(e) for e in strong_entries])
        k = max(2, min(5, len(strong_entries) // 10))
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(vectors)

        clusters: dict[int, list[DependencyEntry]] = {}
        for entry, label in zip(strong_entries, labels):
            clusters.setdefault(int(label), []).append(entry)

        existing_member_sets = {frozenset(i.member_ids) for i in institutions}

        for cluster_entries in clusters.values():
            if len(cluster_entries) < MIN_CLUSTER_ENTRIES:
                continue

            kinds = Counter(e.kind for e in cluster_entries)
            dominant_kind = kinds.most_common(1)[0][0]
            member_ids = list(
                dict.fromkeys(
                    [e.from_id for e in cluster_entries] + [e.to_id for e in cluster_entries]
                )
            )
            if frozenset(member_ids) in existing_member_sets:
                continue

            centroid = np.mean(
                [vectorize_entry(e) for e in cluster_entries], axis=0
            ).tolist()
            name, policy = self._name_institution(
                dominant_kind, member_ids, cluster_entries
            )

            cx = sum(i % 3 for i in range(len(member_ids))) / max(len(member_ids), 1)
            cz = sum((i * 2) % 5 for i in range(len(member_ids))) / max(len(member_ids), 1)

            inst = Institution(
                id=f"inst-{uuid.uuid4().hex[:8]}",
                name=name,
                member_ids=member_ids,
                policy=policy,
                birthing_entry_ids=[
                    f"{e.from_id}->{e.to_id}@{e.tick}" for e in cluster_entries
                ],
                cluster_centroid=centroid,
                position=(cx * 4, 0, cz * 4),
            )
            institutions.append(inst)
            events.append(
                SimEvent(
                    type="institution_formed",
                    tick=tick,
                    payload={
                        "institution_id": inst.id,
                        "name": inst.name,
                        "member_ids": inst.member_ids,
                        "policy": inst.policy,
                        "dominant_kind": dominant_kind,
                        "position": inst.position,
                        "birthing_entry_ids": inst.birthing_entry_ids,
                    },
                )
            )

        if macro_season == "diffuse":
            events.extend(self._maybe_dissolve(institutions, playbook, tick))

        return institutions, events

    def _name_institution(
        self,
        kind: str,
        members: list[str],
        entries: list[DependencyEntry],
    ) -> tuple[str, dict[str, str]]:
        llm = get_llm()
        rationales = [e.rationale for e in entries[:5]]
        if llm:
            try:
                chain = llm.with_structured_output(InstitutionProposal)
                result: InstitutionProposal = chain.invoke(
                    INST_PROMPT.format_messages(
                        kind=kind,
                        members=members,
                        rationales=rationales,
                    )
                )
                return result.name, result.policy
            except Exception:
                pass

        templates = {
            "economic": ("Trade Guild", {"prosperous": "promote", "hungry": "suppress"}),
            "kinship": ("Kin Circle", {"trusted": "promote", "lonely": "suppress"}),
            "prestige": ("Honor Court", {"prestigious": "promote", "feared": "suppress"}),
            "conflict": ("War Band", {"feared": "promote", "calm": "suppress"}),
            "sustenance": ("Harvest Collective", {"fed": "promote", "hungry": "suppress"}),
            "craft": ("Craftsmen Hall", {"skilled": "promote", "tired": "suppress"}),
            "ritual": ("Temple Order", {"devout": "promote", "restless": "suppress"}),
            "collaboration": ("Visualization Guild", {"collaborative": "promote", "aligned": "promote"}),
            "negotiation": ("Orchestration Council", {"focused": "promote", "productive": "promote"}),
        }
        return templates.get(kind, ("Council", {"cooperative": "promote"}))

    def _maybe_dissolve(
        self,
        institutions: list[Institution],
        playbook: SocialPlaybook,
        tick: int,
    ) -> list[SimEvent]:
        events: list[SimEvent] = []
        remaining: list[Institution] = []
        for inst in institutions:
            active = sum(
                1
                for e in playbook.entries
                if e.strength in ("med", "high")
                and (e.from_id in inst.member_ids or e.to_id in inst.member_ids)
            )
            if active < MIN_CLUSTER_ENTRIES:
                events.append(
                    SimEvent(
                        type="institution_dissolved",
                        tick=tick,
                        payload={
                            "institution_id": inst.id,
                            "name": inst.name,
                            "reason": "diffuse_season_erosion",
                        },
                    )
                )
            else:
                remaining.append(inst)
        institutions[:] = remaining
        return events

    def assign_members(
        self, agents: list, institutions: list[Institution]
    ) -> list:
        inst_members = {i.id: set(i.member_ids) for i in institutions}
        updated = []
        for agent in agents:
            agent = agent.model_copy(deep=True)
            for inst_id, members in inst_members.items():
                if agent.id in members:
                    agent.institution_id = inst_id
                    break
            updated.append(agent)
        return updated