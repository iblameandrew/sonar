from __future__ import annotations

from app.grid import is_walkable
from app.seed import (
    SPECIALISTS,
    create_colony_agents,
    create_project_canvas,
    create_specialist_agents,
    ought_for_prompt,
)


def test_minimum_colony_has_four_specialists() -> None:
    agents = create_colony_agents(4)
    assert len(agents) == 4
    roles = [a.role for a in agents]
    assert roles == [s["role"] for s in SPECIALISTS[:4]]
    assert all(a.id.startswith("agent-") for a in agents)


def test_default_colony_mixes_specialists_and_workers() -> None:
    agents = create_colony_agents(48)
    assert len(agents) == 48
    specialists = [a for a in agents if a.role != "worker"]
    workers = [a for a in agents if a.role == "worker"]
    assert len(specialists) == 6
    assert len(workers) == 42
    assert workers[0].id.startswith("drone-")
    assert workers[0].name.startswith("Drone-")


def test_agent_positions_are_unique_and_walkable() -> None:
    agents = create_colony_agents(32)
    coords = [(a.grid_x, a.grid_y) for a in agents]
    assert len(set(coords)) == len(coords)
    assert all(is_walkable(x, y) for x, y in coords)


def test_count_is_clamped() -> None:
    assert len(create_colony_agents(1)) == 4
    assert len(create_colony_agents(900)) == 512


def test_specialist_helpers() -> None:
    specs = create_specialist_agents()
    assert len(specs) == 6
    assert {a.role for a in specs} == {s["role"] for s in SPECIALISTS}


def test_default_canvas_has_linked_subtasks() -> None:
    canvas = create_project_canvas()
    assert "Qualitative Self-Attention" in canvas.goal
    assert len(canvas.subtasks) == 8
    titles = {t.title: t for t in canvas.subtasks}
    assert titles["Voxel Viz"].parent_id == titles["Architecture"].id
    assert titles["Architecture"].parent_id is None
    tree = canvas.task_tree()
    assert {row["title"] for row in tree} == set(titles)


def test_prompt_canvas_uses_goal_phases() -> None:
    canvas = create_project_canvas("Design a negotiation protocol")
    assert canvas.goal == "Design a negotiation protocol"
    titles = [t.title for t in canvas.subtasks]
    assert titles[0] == "Frame the problem"
    assert titles[1] == "Decompose"
    assert canvas.subtasks[1].parent_id == canvas.subtasks[0].id
    assert all(
        t.parent_id in (None, canvas.subtasks[0].id, canvas.subtasks[1].id)
        for t in canvas.subtasks
    )


def test_ought_tracks_prompt() -> None:
    default = ought_for_prompt(None)
    custom = ought_for_prompt("  ship the demo  ")
    assert "demo-ready" in default["desired_adjectives"]
    assert custom["description"].endswith("ship the demo")
    assert "goal-aligned" in custom["desired_adjectives"]
