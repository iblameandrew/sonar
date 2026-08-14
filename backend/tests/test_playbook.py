from __future__ import annotations

from app.models.agent import DependencyEntry, SocialPlaybook
from app.store.playbook import PlaybookStore


def _entry(
    frm: str,
    to: str,
    *,
    strength: str = "med",
    kind: str = "collaboration",
) -> DependencyEntry:
    return DependencyEntry(
        from_id=frm,
        to_id=to,
        kind=kind,  # type: ignore[arg-type]
        verb_basis="work",
        qualitative_distance="near",
        strength=strength,  # type: ignore[arg-type]
        rationale="test",
        tick=1,
    )


def test_social_playbook_queries() -> None:
    pb = SocialPlaybook()
    pb.add(_entry("a", "b", strength="high", kind="craft"))
    pb.add(_entry("c", "a", strength="low"))
    pb.add(_entry("b", "d", strength="med"))

    assert [e.from_id for e in pb.outgoing("a")] == ["a"]
    assert [e.from_id for e in pb.incoming("a")] == ["c"]
    assert {e.to_id for e in pb.for_agent("a")} == {"b", "a"}
    assert len(pb.by_kind("craft")) == 1
    strong = pb.strong_entries("a")
    assert len(strong) == 1
    assert strong[0].to_id == "b"
    summary = pb.to_matrix_summary()
    assert summary[0]["from"] == "a"
    assert summary[0]["kind"] == "craft"


def test_playbook_store_roundtrip(tmp_path) -> None:
    log = tmp_path / "playbook.jsonl"
    store = PlaybookStore(log_path=log)
    store.append(_entry("x", "y", strength="high"))
    store.append(_entry("y", "z", strength="low"))

    reloaded = PlaybookStore(log_path=log)
    reloaded.load_from_log()
    assert len(reloaded.playbook.entries) == 2
    assert reloaded.playbook.entries[0].from_id == "x"
    exported = reloaded.export_json()
    assert "x" in exported and "y" in exported
    snap = reloaded.snapshot()
    snap.add(_entry("z", "x"))
    assert len(reloaded.playbook.entries) == 2
