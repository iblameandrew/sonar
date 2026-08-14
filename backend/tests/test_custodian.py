from __future__ import annotations

from app.store.custodian import Custodian, ordinal_to_strength


def test_ordinal_thresholds() -> None:
    assert ordinal_to_strength(0.0) == "none"
    assert ordinal_to_strength(0.14) == "none"
    assert ordinal_to_strength(0.2) == "low"
    assert ordinal_to_strength(0.55) == "med"
    assert ordinal_to_strength(0.85) == "high"


def test_ema_blend_moves_toward_target(tmp_path) -> None:
    path = tmp_path / "custodian.json"
    c = Custodian(path=path, ema_alpha=0.3)
    first = c.update("a", "b", "high")
    assert first in ("low", "med")
    for _ in range(12):
        c.update("a", "b", "high")
    assert c.get_strength("a", "b") == "high"
    assert c._key("a", "b") in c.to_dict()


def test_missing_edge_is_none(tmp_path) -> None:
    c = Custodian(path=tmp_path / "c.json")
    assert c.get_strength("missing", "edge") == "none"


def test_save_and_load(tmp_path) -> None:
    path = tmp_path / "custodian.json"
    c = Custodian(path=path, ema_alpha=1.0)
    c.update("from", "to", "med")
    c.save()
    loaded = Custodian(path=path)
    assert loaded.get_strength("from", "to") == "med"
