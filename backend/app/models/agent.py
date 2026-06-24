from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DependencyKind = Literal[
    "economic",
    "kinship",
    "prestige",
    "conflict",
    "sustenance",
    "craft",
    "ritual",
    "collaboration",
    "negotiation",
]
QualitativeDistance = Literal["near", "mid", "far"]
DependencyStrength = Literal["none", "low", "med", "high"]
SpecialistRole = Literal[
    "voxel_architect",
    "orchestrator",
    "optimizer",
    "integrator",
    "ux_weaver",
    "critic_evaluator",
    "worker",
    "auditor",
    "attention",
    "generalist",
]


class QualitativeAgent(BaseModel):
    id: str
    name: str = ""
    role: SpecialistRole = "generalist"
    verbs: list[str] = Field(default_factory=list)
    nouns: list[str] = Field(default_factory=list)
    adjectives: list[str] = Field(default_factory=list)
    parent_ids: list[str] = Field(default_factory=list)
    institution_id: str | None = None
    grid_x: int = 0
    grid_y: int = 0
    current_task_id: str | None = None

    @property
    def position(self) -> tuple[float, float, float]:
        return (float(self.grid_x), 0.0, float(self.grid_y))

    def summary(self) -> str:
        return (
            f"[{self.id}|{self.role}] verbs={self.verbs} nouns={self.nouns} "
            f"adjectives={self.adjectives} task={self.current_task_id}"
        )


class DependencyEntry(BaseModel):
    from_id: str
    to_id: str
    kind: DependencyKind
    verb_basis: str
    qualitative_distance: QualitativeDistance
    strength: DependencyStrength
    rationale: str
    season_weight: float = 1.0
    tick: int = 0
    negotiation_id: str | None = None

    def key(self) -> tuple[str, str]:
        return (self.from_id, self.to_id)


class SocialPlaybook(BaseModel):
    entries: list[DependencyEntry] = Field(default_factory=list)

    def add(self, entry: DependencyEntry) -> None:
        self.entries.append(entry)

    def incoming(self, agent_id: str) -> list[DependencyEntry]:
        return [e for e in self.entries if e.to_id == agent_id]

    def outgoing(self, agent_id: str) -> list[DependencyEntry]:
        return [e for e in self.entries if e.from_id == agent_id]

    def for_agent(self, agent_id: str) -> list[DependencyEntry]:
        return [e for e in self.entries if e.from_id == agent_id or e.to_id == agent_id]

    def by_kind(self, kind: DependencyKind) -> list[DependencyEntry]:
        return [e for e in self.entries if e.kind == kind]

    def strong_entries(self, agent_id: str) -> list[DependencyEntry]:
        return [
            e
            for e in self.for_agent(agent_id)
            if e.strength in ("med", "high")
        ]

    def to_matrix_summary(self) -> list[dict]:
        return [
            {
                "from": e.from_id,
                "to": e.to_id,
                "kind": e.kind,
                "strength": e.strength,
                "distance": e.qualitative_distance,
                "rationale": e.rationale,
                "negotiation_id": e.negotiation_id,
            }
            for e in self.entries
        ]