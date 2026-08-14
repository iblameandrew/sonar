from __future__ import annotations

from app.seasons.scheduler import DESIGN_PHASES, MICRO_SEASONS, SeasonScheduler


def test_default_tick_zero_is_sharp_harvest_concept() -> None:
    macro, micro, phase, temp, kind, weight, event = SeasonScheduler().resolve(0)
    assert macro == "sharp"
    assert micro == "harvest"
    assert phase == "concept"
    assert temp == "sharp"
    assert weight == 1.2
    assert event is not None
    assert event.type == "phase_change"


def test_macro_flips_after_cycle() -> None:
    macro, _, _, temp, _, weight, _ = SeasonScheduler().resolve(8)
    assert macro == "diffuse"
    assert temp == "diffuse"
    assert weight == 0.8


def test_micro_and_phase_cycle() -> None:
    _, micro, _, _, _, _, ev = SeasonScheduler().resolve(3)
    assert micro == MICRO_SEASONS[1]
    assert ev is not None
    assert ev.type == "season_change"

    _, _, phase, _, _, _, _ = SeasonScheduler().resolve(6)
    assert phase == DESIGN_PHASES[1]


def test_force_overrides_clock() -> None:
    sched = SeasonScheduler()
    sched.force(macro="diffuse", micro="festival", phase="polish")
    macro, micro, phase, temp, _, weight, _ = sched.resolve(0)
    assert (macro, micro, phase, temp, weight) == ("diffuse", "festival", "polish", "diffuse", 0.8)


def test_advance_phase_wraps() -> None:
    sched = SeasonScheduler()
    assert sched.advance_phase("concept") == "technical"
    assert sched.advance_phase("validation") == "concept"
    assert sched.advance_phase("unknown") == "concept"
