from __future__ import annotations

from app.models.events import SimEvent

MICRO_SEASONS = ["harvest", "scarcity", "planting", "festival"]
DESIGN_PHASES = ["concept", "technical", "polish", "validation"]
MACRO_CYCLE = 8
PHASE_CYCLE = 6

KIND_WEIGHTS: dict[str, dict[str, float]] = {
    "concept": {"collaboration": 1.0, "negotiation": 0.9, "craft": 0.5},
    "technical": {"craft": 1.0, "economic": 0.8, "collaboration": 0.7},
    "polish": {"prestige": 0.9, "ritual": 0.8, "craft": 0.6},
    "validation": {"conflict": 0.6, "prestige": 1.0, "economic": 0.7},
    "harvest": {"sustenance": 1.0, "economic": 0.8},
    "scarcity": {"conflict": 1.0, "sustenance": 0.9},
}


class SeasonScheduler:
    def __init__(self) -> None:
        self.forced_macro: str | None = None
        self.forced_micro: str | None = None
        self.forced_phase: str | None = None

    def force(
        self,
        macro: str | None = None,
        micro: str | None = None,
        phase: str | None = None,
    ) -> None:
        self.forced_macro = macro
        self.forced_micro = micro
        self.forced_phase = phase

    def advance_phase(self, current: str) -> str:
        if current in DESIGN_PHASES:
            idx = DESIGN_PHASES.index(current)
            return DESIGN_PHASES[(idx + 1) % len(DESIGN_PHASES)]
        return "concept"

    def resolve(self, tick: int) -> tuple[str, str, str, str, str, float, SimEvent | None]:
        macro = self.forced_macro or ("sharp" if (tick // MACRO_CYCLE) % 2 == 0 else "diffuse")
        micro = self.forced_micro or MICRO_SEASONS[(tick // 3) % len(MICRO_SEASONS)]
        phase = self.forced_phase or DESIGN_PHASES[(tick // PHASE_CYCLE) % len(DESIGN_PHASES)]
        temperature = "sharp" if macro == "sharp" else "diffuse"
        weights = KIND_WEIGHTS.get(phase, KIND_WEIGHTS.get(micro, {}))
        dominant_kind = max(weights, key=weights.get) if weights else "collaboration"
        season_weight = 1.2 if macro == "sharp" else 0.8

        event = None
        if tick % PHASE_CYCLE == 0:
            event = SimEvent(
                type="phase_change",
                tick=tick,
                payload={
                    "macro_season": macro,
                    "micro_season": micro,
                    "design_phase": phase,
                    "judgment_temperature": temperature,
                    "dominant_kind": dominant_kind,
                },
            )
        elif tick % 3 == 0:
            event = SimEvent(
                type="season_change",
                tick=tick,
                payload={
                    "macro_season": macro,
                    "micro_season": micro,
                    "design_phase": phase,
                    "dominant_kind": dominant_kind,
                },
            )

        return macro, micro, phase, temperature, dominant_kind, season_weight, event