from __future__ import annotations

from app.models.events import SimEvent

MICRO_SEASONS = ["harvest", "scarcity", "planting", "festival"]
MACRO_CYCLE = 8
MICRO_CYCLE = 4

KIND_WEIGHTS: dict[str, dict[str, float]] = {
    "harvest": {"sustenance": 1.0, "economic": 0.8, "kinship": 0.5},
    "scarcity": {"conflict": 1.0, "sustenance": 0.9, "prestige": 0.4},
    "planting": {"craft": 0.8, "kinship": 0.7, "sustenance": 0.6},
    "festival": {"ritual": 1.0, "prestige": 0.8, "kinship": 0.9},
}


class SeasonScheduler:
    def __init__(self) -> None:
        self.forced_macro: str | None = None
        self.forced_micro: str | None = None

    def force(self, macro: str | None = None, micro: str | None = None) -> None:
        self.forced_macro = macro
        self.forced_micro = micro

    def resolve(self, tick: int) -> tuple[str, str, str, str, float, SimEvent | None]:
        macro = self.forced_macro or ("sharp" if (tick // MACRO_CYCLE) % 2 == 0 else "diffuse")
        micro = self.forced_micro or MICRO_SEASONS[(tick // MICRO_CYCLE) % len(MICRO_SEASONS)]
        temperature = "sharp" if macro == "sharp" else "diffuse"
        weights = KIND_WEIGHTS.get(micro, {})
        dominant_kind = max(weights, key=weights.get) if weights else "economic"
        season_weight = 1.2 if macro == "sharp" else 0.8

        event = None
        if tick % MICRO_CYCLE == 0:
            event = SimEvent(
                type="season_change",
                tick=tick,
                payload={
                    "macro_season": macro,
                    "micro_season": micro,
                    "judgment_temperature": temperature,
                    "dominant_kind": dominant_kind,
                    "kind_weights": weights,
                },
            )

        return macro, micro, temperature, dominant_kind, season_weight, event