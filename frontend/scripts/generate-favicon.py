"""Generate voxel pixel-art favicon PNGs for Sociomorphic Computing."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PUBLIC.mkdir(parents=True, exist_ok=True)

SIZE = 32
SKY = (135, 206, 235)
SKY_HI = (168, 222, 245)
GREEN_TOP = (127, 216, 127)
GREEN_LEFT = (93, 187, 99)
GREEN_RIGHT = (61, 139, 64)
BLUE_LEFT = (79, 195, 247)
BLUE_RIGHT = (2, 119, 189)
RED_LEFT = (239, 83, 80)
RED_RIGHT = (198, 40, 40)
MOSS = (102, 255, 170)
WHITE = (255, 252, 245)


def set_px(img: Image.Image, x: int, y: int, color: tuple[int, int, int]) -> None:
    if 0 <= x < SIZE and 0 <= y < SIZE:
        img.putpixel((x, y), (*color, 255))


def build_sky() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (*SKY, 255))
    for y in range(SIZE):
        for x in range(SIZE):
            if (x * 3 + y * 5) % 11 == 0:
                img.putpixel((x, y), (*SKY_HI, 255))
    return img


def draw_colony_voxel(img: Image.Image) -> None:
    cx, cy, w, h = 16, 9, 7, 5
    # Top face — green colony ground
    for row in range(w):
        for col in range(w):
            x = cx - row + col
            y = cy + row + col
            color = GREEN_TOP
            if row == 0 and col == w - 1:
                color = MOSS
            if row == 1 and col == 1:
                color = WHITE
            set_px(img, x, y, color)
    # Left face — blue compute zone
    for row in range(h):
        for col in range(w):
            x = cx - col
            y = cy + w + row + col
            shade = BLUE_LEFT if row < h // 2 else GREEN_LEFT
            if col == 0:
                shade = tuple(max(0, c - 20) for c in shade)
            set_px(img, x, y, shade)
    # Right face — red society zone
    for row in range(h):
        for col in range(w):
            x = cx + col
            y = cy + w + row + col
            shade = RED_RIGHT if row < h // 2 else GREEN_RIGHT
            if col == w - 1:
                shade = tuple(max(0, c - 24) for c in shade)
            set_px(img, x, y, shade)
    # Ground shadow
    for col in range(w + 2):
        set_px(img, cx - w + col, cy + w + h + col, (46, 125, 50))


def render_icon() -> Image.Image:
    img = build_sky()
    draw_colony_voxel(img)
    return img


def save_scaled(src: Image.Image, path: Path, size: int) -> None:
    src.resize((size, size), Image.Resampling.NEAREST).save(path, optimize=True)


def write_svg(path: Path) -> None:
    src = render_icon()
    rects = []
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = src.getpixel((x, y))
            if a < 128:
                continue
            rects.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
    path.write_text(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" "
        "shape-rendering=\"crispEdges\">\n"
        + "\n".join(rects)
        + "\n</svg>\n",
        encoding="utf-8",
    )


def main() -> None:
    icon = render_icon()
    save_scaled(icon, PUBLIC / "favicon-16x16.png", 16)
    save_scaled(icon, PUBLIC / "favicon-32x32.png", 32)
    save_scaled(icon, PUBLIC / "favicon.png", 32)
    save_scaled(icon, PUBLIC / "apple-touch-icon.png", 180)
    icon.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    write_svg(PUBLIC / "favicon.svg")
    print(f"Wrote favicons to {PUBLIC}")


if __name__ == "__main__":
    main()