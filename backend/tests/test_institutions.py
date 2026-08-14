from __future__ import annotations

from app.institutions.condense import (
    ENTRY_THRESHOLD,
    InstitutionCondenser,
    vectorize_entry,
)
from app.models.agent import DependencyEntry, QualitativeAgent, SocialPlaybook
from app.models.institution import Institution


def _edge(i: int, kind: str = "collaboration") -> DependencyEntry:
    return DependencyEntry(
        from_id=f"a{i}",
        to_id=f"b{i % 3}",
        kind=kind,  # type: ignore[arg-type]
        verb_basis="work",
        qualitative_distance="near",
        strength="high",
        rationale=f"edge-{i}",
        season_weight=1.0,
        tick=i,
    )


def test_vectorize_entry_is_fixed_width() -> None:
    vec = vectorize_entry(_edge(0, "craft"))
    assert vec.shape == (12,)
    assert vec[5] == 1.0  # craft one-hot


def test_below_threshold_forms_nothing() -> None:
    playbook = SocialPlaybook(entries=[_edge(i) for i in range(ENTRY_THRESHOLD - 1)])
    insts, events = InstitutionCondenser().condense(playbook, [], "sharp", tick=1)
    assert insts == []
    assert events == []


def test_heuristic_naming_when_llm_absent() -> None:
    playbook = SocialPlaybook(entries=[_edge(i, "craft") for i in range(ENTRY_THRESHOLD)])
    insts, events = InstitutionCondenser().condense(playbook, [], "sharp", tick=4)
    assert events
    assert any(e.type == "institution_formed" for e in events)
    assert any("Craft" in i.name or i.name == "Council" for i in insts)


def test_diffuse_season_dissolves_weak_institution() -> None:
    existing = [
        Institution(id="inst-1", name="Fading Guild", member_ids=["ghost-a", "ghost-b"])
    ]
    playbook = SocialPlaybook(entries=[_edge(i) for i in range(3)])
    insts, events = InstitutionCondenser().condense(playbook, existing, "diffuse", tick=2)
    assert insts == []
    assert any(e.type == "institution_dissolved" for e in events)


def test_assign_members() -> None:
    agents = [
        QualitativeAgent(id="m1", name="A", role="worker"),
        QualitativeAgent(id="x", name="B", role="worker"),
    ]
    insts = [Institution(id="inst-9", name="Guild", member_ids=["m1"])]
    updated = InstitutionCondenser().assign_members(agents, insts)
    assert updated[0].institution_id == "inst-9"
    assert updated[1].institution_id is None
