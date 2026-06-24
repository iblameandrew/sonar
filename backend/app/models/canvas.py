from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SubtaskStatus = Literal["pending", "assigned", "in_progress", "done", "blocked"]
ArtifactKind = Literal["architecture", "code", "tradeoff", "integration", "ui", "benchmark"]


class Subtask(BaseModel):
    id: str
    title: str
    description: str
    assigned_to: str | None = None
    status: SubtaskStatus = "pending"
    parent_id: str | None = None
    priority: int = 1
    bids: list[dict] = Field(default_factory=list)


class Artifact(BaseModel):
    id: str
    kind: ArtifactKind
    title: str
    content: str
    author_id: str
    tick: int = 0
    voxel_key: str | None = None


class NegotiationRound(BaseModel):
    id: str
    tick: int
    topic: str
    proposer_id: str
    responder_id: str
    proposal: str
    counter_offer: str | None = None
    outcome: Literal["accepted", "compromise", "rejected", "voting"] = "accepted"
    rationale: str = ""


class ProjectCanvas(BaseModel):
    goal: str = "Build VoxForge collaborative engineering workspace"
    requirements: list[str] = Field(default_factory=list)
    subtasks: list[Subtask] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    negotiations: list[NegotiationRound] = Field(default_factory=list)
    voxforge_progress: float = 0.0
    voxforge_voxels: list[dict] = Field(default_factory=list)

    def add_artifact(self, artifact: Artifact) -> None:
        self.artifacts.append(artifact)

    def task_tree(self) -> list[dict]:
        return [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "assigned_to": t.assigned_to,
                "parent_id": t.parent_id,
            }
            for t in self.subtasks
        ]