from __future__ import annotations

import json
from pathlib import Path

from app.models.agent import DependencyStrength

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

STRENGTH_ORDINAL: dict[DependencyStrength, float] = {
    "none": 0.0,
    "low": 0.25,
    "med": 0.55,
    "high": 0.85,
}

ORDINAL_STRENGTH: list[DependencyStrength] = ["none", "low", "med", "high"]


def ordinal_to_strength(value: float) -> DependencyStrength:
    if value < 0.15:
        return "none"
    if value < 0.4:
        return "low"
    if value < 0.7:
        return "med"
    return "high"


class Custodian:
    """Holds persistent dependency strength — slow-changing social memory."""

    def __init__(self, path: Path | None = None, ema_alpha: float = 0.3) -> None:
        self.path = path or DATA_DIR / "custodian.json"
        self.ema_alpha = ema_alpha
        self.weights: dict[str, float] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.load()

    def _key(self, from_id: str, to_id: str) -> str:
        return f"{from_id}->{to_id}"

    def get_strength(self, from_id: str, to_id: str) -> DependencyStrength:
        val = self.weights.get(self._key(from_id, to_id), 0.0)
        return ordinal_to_strength(val)

    def update(self, from_id: str, to_id: str, new_strength: DependencyStrength) -> DependencyStrength:
        key = self._key(from_id, to_id)
        prior = self.weights.get(key, 0.0)
        target = STRENGTH_ORDINAL[new_strength]
        blended = prior * (1 - self.ema_alpha) + target * self.ema_alpha
        self.weights[key] = blended
        return ordinal_to_strength(blended)

    def load(self) -> None:
        if not self.path.exists():
            return
        with self.path.open(encoding="utf-8") as f:
            self.weights = json.load(f)

    def save(self) -> None:
        with self.path.open("w", encoding="utf-8") as f:
            json.dump(self.weights, f, indent=2)

    def to_dict(self) -> dict[str, str]:
        return {k: ordinal_to_strength(v) for k, v in self.weights.items()}