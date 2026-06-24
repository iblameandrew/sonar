from __future__ import annotations

WORLD_SIZE = 96
TREE_MARGIN = 4
TREE_SPACING = 8
SECTOR_SIZE = 12
MAX_AGENTS = 2048


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


def allocate_positions(count: int, occupied: set[tuple[int, int]] | None = None) -> list[tuple[int, int]]:
    """Spiral outward from meadow center — scales to thousands on the patch."""
    occ = occupied or set()
    cx, cy = WORLD_SIZE // 2, WORLD_SIZE // 2
    positions: list[tuple[int, int]] = []
    if is_walkable(cx, cy, occ):
        positions.append((cx, cy))
        occ.add((cx, cy))

    for radius in range(1, WORLD_SIZE):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if max(abs(dx), abs(dy)) != radius:
                    continue
                x, y = cx + dx, cy + dy
                if is_walkable(x, y, occ):
                    positions.append((x, y))
                    occ.add((x, y))
                    if len(positions) >= count:
                        return positions
    return positions


def total_walkable_cells() -> int:
    n = 0
    for y in range(WORLD_SIZE):
        for x in range(WORLD_SIZE):
            if is_walkable(x, y):
                n += 1
    return n