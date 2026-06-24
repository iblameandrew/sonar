from __future__ import annotations

from pydantic import BaseModel, Field


class RaptorNode(BaseModel):
    id: str
    title: str
    summary: str
    child_ids: list[str] = Field(default_factory=list)
    season_range: tuple[int, int] = (0, 0)
    tick_range: tuple[int, int] = (0, 0)
    level: int = 0