from __future__ import annotations

from app.lifecycle.rules import (
    BIRTH_INCOMING_HIGH,
    GRACE_TICKS,
    OVERLOAD_THRESHOLD,
    LifecycleRules,
)
from app.models.agent import DependencyEntry, QualitativeAgent, SocialPlaybook


def _agent(aid: str, x: int = 10, y: int = 10) -> QualitativeAgent:
    return QualitativeAgent(
        id=aid,
        name=aid,
        role="worker",
        verbs=["forage"],
        nouns=["grain"],
        adjectives=["alert"],
        grid_x=x,
        grid_y=y,
    )


def _edge(frm: str, to: str, strength: str = "high") -> DependencyEntry:
    return DependencyEntry(
        from_id=frm,
        to_id=to,
        kind="kinship",
        verb_basis="bond",
        qualitative_distance="near",
        strength=strength,  # type: ignore[arg-type]
        rationale="bond",
    )


def test_grace_period_prevents_death() -> None:
    agents = [_agent("lonely")]
    playbook = SocialPlaybook()
    survivors, pool, events = LifecycleRules().apply(agents, playbook, [], tick=0)
    assert [a.id for a in survivors] == ["lonely"]
    assert events == []
    assert pool == []


def test_isolation_death_after_grace() -> None:
    agents = [_agent("lonely")]
    playbook = SocialPlaybook()
    survivors, pool, events = LifecycleRules().apply(
        agents, playbook, [], tick=GRACE_TICKS
    )
    assert survivors == []
    assert "grain" in pool and "alert" in pool
    assert any(e.type == "agent_death" and e.payload["reason"] == "isolation" for e in events)
    assert any(e.type == "quality_pool_update" for e in events)


def test_overload_death() -> None:
    agents = [_agent("busy")]
    playbook = SocialPlaybook(
        entries=[_edge("busy", f"n{i}", "high") for i in range(OVERLOAD_THRESHOLD + 1)]
    )
    survivors, _, events = LifecycleRules().apply(agents, playbook, [], tick=GRACE_TICKS)
    assert survivors == []
    assert any(e.payload.get("reason") == "overload" for e in events)


def test_birth_when_incoming_high() -> None:
    agents = [_agent("parent", x=20, y=20)]
    playbook = SocialPlaybook(
        entries=[
            _edge(f"peer{i}", "parent", "high")
            for i in range(BIRTH_INCOMING_HIGH)
        ]
        + [_edge("parent", "peer0", "med")]
    )
    survivors, _, events = LifecycleRules().apply(agents, playbook, ["curious"], tick=GRACE_TICKS)
    ids = [a.id for a in survivors]
    assert "parent" in ids
    assert any(e.type == "agent_birth" for e in events)
    child = next(a for a in survivors if a.id != "parent")
    assert child.parent_ids == ["parent"]
    assert (child.grid_x, child.grid_y) != (20, 20)
