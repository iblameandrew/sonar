from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SimEvent(BaseModel):
    type: str
    tick: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> dict[str, Any]:
        return {"type": self.type, "tick": self.tick, "payload": self.payload}