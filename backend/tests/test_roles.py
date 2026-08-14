from __future__ import annotations

from app.llm.qwen_factory import _safe_text, _sanitize_api_key
from app.models.agent import QualitativeAgent
from app.models.events import SimEvent
from app.roles import DASHBOARD_ROLES, ROLE_LABELS


def test_role_labels_cover_dashboard() -> None:
    for role in DASHBOARD_ROLES:
        assert role in ROLE_LABELS
        assert ROLE_LABELS[role]


def test_agent_summary_and_prompt() -> None:
    agent = QualitativeAgent(
        id="agent-1",
        name="Voxel Architect Agent",
        role="voxel_architect",
        verbs=["render"],
        nouns=["voxels"],
        adjectives=["visual"],
        current_task_id="task-1",
        grid_x=4,
        grid_y=6,
    )
    assert agent.position == (4.0, 0.0, 6.0)
    summary = agent.summary()
    assert "voxel_architect" in summary
    prompt = agent.system_prompt("paint the grid")
    assert "Purpose: paint the grid" in prompt
    assert "task-1" in prompt


def test_sim_event_sse() -> None:
    ev = SimEvent(type="tick", tick=3, payload={"ok": True})
    assert ev.to_sse() == {"type": "tick", "tick": 3, "payload": {"ok": True}}


def test_safe_text_and_key_sanitize() -> None:
    assert _safe_text(None) == "Unknown error"
    assert "..." in _safe_text("x" * 600)
    assert _safe_text("café") == "caf?"
    assert _sanitize_api_key("  sk-abc\ufeff  ") == "sk-abc"
    assert "\n" not in _sanitize_api_key("sk-ab\nc")
