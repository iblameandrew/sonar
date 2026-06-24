from __future__ import annotations

from pydantic import BaseModel, Field


class Institution(BaseModel):
    id: str
    name: str
    member_ids: list[str] = Field(default_factory=list)
    policy: dict[str, str] = Field(default_factory=dict)
    birthing_entry_ids: list[str] = Field(default_factory=list)
    cluster_centroid: list[float] = Field(default_factory=list)
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)

    def as_pseudo_agent_summary(self) -> str:
        return f"Institution '{self.name}' members={self.member_ids} policy={self.policy}"