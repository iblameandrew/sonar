from __future__ import annotations

import math

WORLD_SIZE = 96
TREE_MARGIN = 4
TREE_SPACING = 8
SECTOR_SIZE = 12
MAX_AGENTS = 2048

_GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5))


def is_tree_cell(x: int, y: int) -> bool:
    if x < TREE_MARGIN or y < TREE_MARGIN or x >= WORLD_SIZE - TREE_MARGIN or y >= WORLD_SIZE - TREE_MARGIN:
        return False
    lx = x - TREE_MARGIN
    ly = y - TREE_MARGIN
    return lx % TREE_SPACING == 0 and ly % TREE_SPACING == 0


def is_walkable(x: int, y: int, occupied: set[tuple[int, int]] | None = None) -> bool:
    if x < 0 or y < 0 or x >= WORLD_SIZE or y >= WORLD_SIZE:
        return False
    if is_tree_cell(x, y):
        return False
    if occupied and (x, y) in occupied:
        return False
    return True


def sector_id(x: int, y: int) -> str:
    sx = x // SECTOR_SIZE
    sy = y // SECTOR_SIZE
    return f"s{sx}-{sy}"


def _nearest_walkable(
    x: int,
    y: int,
    occupied: set[tuple[int, int]],
    max_radius: int = 24,
) -> tuple[int, int] | None:
    if is_walkable(x, y, occupied):
        return (x, y)
    for radius in range(1, max_radius + 1):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if max(abs(dx), abs(dy)) != radius:
                    continue
                nx, ny = x + dx, y + dy
                if is_walkable(nx, ny, occupied):
                    return (nx, ny)
    return None


def _spiral_fill(
    count: int,
    occupied: set[tuple[int, int]],
    cx: int,
    cy: int,
) -> list[tuple[int, int]]:
    positions: list[tuple[int, int]] = []
    for radius in range(WORLD_SIZE):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if max(abs(dx), abs(dy)) != radius:
                    continue
                x, y = cx + dx, cy + dy
                if is_walkable(x, y, occupied):
                    positions.append((x, y))
                    occupied.add((x, y))
                    if len(positions) >= count:
                        return positions
    return positions


def allocate_positions(count: int, occupied: set[tuple[int, int]] | None = None) -> list[tuple[int, int]]:
    """Sunflower disk packing from meadow center — even spread, tree-aware."""
    if count <= 0:
        return []

    occ = set(occupied or ())
    cx, cy = WORLD_SIZE // 2, WORLD_SIZE // 2
    max_radius = WORLD_SIZE // 2 - TREE_MARGIN - 2
    positions: list[tuple[int, int]] = []

    for i in range(count):
        if count == 1:
            radius = 0.0
            angle = 0.0
        else:
            t = i / (count - 1)
            radius = max_radius * math.sqrt(t)
            angle = i * _GOLDEN_ANGLE

        tx = int(round(cx + radius * math.cos(angle)))
        ty = int(round(cy + radius * math.sin(angle)))
        slot = _nearest_walkable(tx, ty, occ)
        if slot:
            positions.append(slot)
            occ.add(slot)

    if len(positions) < count:
        remaining = count - len(positions)
        positions.extend(_spiral_fill(remaining, occ, cx, cy))

    return positions[:count]


def total_walkable_cells() -> int:
    n = 0
    for y in range(WORLD_SIZE):
        for x in range(WORLD_SIZE):
            if is_walkable(x, y):
                n += 1
    return n