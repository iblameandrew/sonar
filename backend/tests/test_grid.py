from __future__ import annotations

from app.grid import (
    SECTOR_SIZE,
    TREE_MARGIN,
    TREE_SPACING,
    WORLD_SIZE,
    allocate_positions,
    is_tree_cell,
    is_walkable,
    sector_id,
    total_walkable_cells,
)


def test_world_size_matches_colony_constants() -> None:
    assert WORLD_SIZE == 96
    assert TREE_SPACING == 8
    assert TREE_MARGIN == 4
    assert SECTOR_SIZE == 12


def test_tree_lattice_inside_margin() -> None:
    assert is_tree_cell(4, 4)
    assert is_tree_cell(12, 20)
    assert not is_tree_cell(0, 0)
    assert not is_tree_cell(5, 4)
    assert not is_tree_cell(95, 95)


def test_walkability_rejects_trees_bounds_and_occupied() -> None:
    assert is_walkable(5, 5)
    assert not is_walkable(-1, 10)
    assert not is_walkable(WORLD_SIZE, 10)
    assert not is_walkable(4, 4)
    assert not is_walkable(5, 5, occupied={(5, 5)})


def test_sector_id_tiles_the_map() -> None:
    assert sector_id(0, 0) == "s0-0"
    assert sector_id(12, 24) == "s1-2"
    assert sector_id(95, 95) == "s7-7"


def test_allocate_positions_unique_and_walkable() -> None:
    positions = allocate_positions(48)
    assert len(positions) == 48
    assert len(set(positions)) == 48
    for x, y in positions:
        assert is_walkable(x, y)


def test_allocate_positions_respects_occupied() -> None:
    reserved = {(48, 48), (47, 47)}
    positions = allocate_positions(8, occupied=reserved)
    assert reserved.isdisjoint(positions)
    assert len(positions) == 8


def test_allocate_zero_or_one() -> None:
    assert allocate_positions(0) == []
    one = allocate_positions(1)
    assert len(one) == 1
    assert is_walkable(*one[0])


def test_walkable_cell_count_is_stable() -> None:
    n = total_walkable_cells()
    trees = sum(
        1
        for y in range(WORLD_SIZE)
        for x in range(WORLD_SIZE)
        if is_tree_cell(x, y)
    )
    assert n + trees == WORLD_SIZE * WORLD_SIZE
    assert n > 8000
