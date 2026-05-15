import argparse
import hashlib
import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


def crop_alpha_signature(img: Image.Image, r: Rect) -> str:
    # Variant key: stable digest of alpha channel inside tight rect.
    crop = img.crop((r.x, r.y, r.x + r.w, r.y + r.h)).convert("RGBA")
    px = crop.load()
    w, h = crop.size
    alpha = bytearray()
    for y in range(h):
        for x in range(w):
            alpha.append(px[x, y][3])
    return hashlib.sha1(alpha).hexdigest()[:12]


def compute_collision_back_strip(r: Rect, ratio_h: float, ratio_w: float) -> Rect:
    # Collision strip at the back/bottom region so player can walk in front of furniture.
    ch = max(4, int(round(r.h * ratio_h)))
    cw = max(4, int(round(r.w * ratio_w)))
    cx = r.x + (r.w - cw) // 2
    cy = r.y + r.h - ch
    return Rect(cx, cy, cw, ch)


def near_bg(r: int, g: int, b: int, bg: tuple[int, int, int], tol: int) -> bool:
    br, bgc, bb = bg
    return abs(r - br) <= tol and abs(g - bgc) <= tol and abs(b - bb) <= tol


def load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def fg_mask(img: Image.Image, bg: tuple[int, int, int], bg_tol: int, min_alpha: int) -> list[list[bool]]:
    w, h = img.size
    px = img.load()
    mask = [[False] * w for _ in range(h)]
    for y in range(h):
        row = mask[y]
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= min_alpha:
                continue
            if near_bg(r, g, b, bg, bg_tol):
                continue
            row[x] = True
    return mask


def connected_components(mask: list[list[bool]], min_pixels: int) -> list[Rect]:
    h = len(mask)
    w = len(mask[0]) if h else 0
    seen = [[False] * w for _ in range(h)]
    rects: list[Rect] = []

    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0][x0] or seen[y0][x0]:
                continue
            q = deque([(x0, y0)])
            seen[y0][x0] = True
            minx = maxx = x0
            miny = maxy = y0
            count = 0

            while q:
                x, y = q.popleft()
                count += 1
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y

                # 4-neighborhood is safer for pixel art.
                if x > 0 and mask[y][x - 1] and not seen[y][x - 1]:
                    seen[y][x - 1] = True
                    q.append((x - 1, y))
                if x + 1 < w and mask[y][x + 1] and not seen[y][x + 1]:
                    seen[y][x + 1] = True
                    q.append((x + 1, y))
                if y > 0 and mask[y - 1][x] and not seen[y - 1][x]:
                    seen[y - 1][x] = True
                    q.append((x, y - 1))
                if y + 1 < h and mask[y + 1][x] and not seen[y + 1][x]:
                    seen[y + 1][x] = True
                    q.append((x, y + 1))

            if count < min_pixels:
                continue

            rects.append(Rect(minx, miny, (maxx - minx + 1), (maxy - miny + 1)))

    # Sort stable top-to-bottom, left-to-right
    rects.sort(key=lambda r: (r.y, r.x))
    return rects


def snap_rect_to_grid(r: Rect, grid: int, w: int, h: int, pad: int) -> Rect:
    # Expand slightly (pad) then snap to grid boundaries, clamped to sheet.
    x0 = max(0, r.x - pad)
    y0 = max(0, r.y - pad)
    x1 = min(w, r.x + r.w + pad)
    y1 = min(h, r.y + r.h + pad)

    gx0 = (x0 // grid) * grid
    gy0 = (y0 // grid) * grid
    gx1 = ((x1 + grid - 1) // grid) * grid
    gy1 = ((y1 + grid - 1) // grid) * grid

    gx1 = min(w, gx1)
    gy1 = min(h, gy1)
    return Rect(gx0, gy0, gx1 - gx0, gy1 - gy0)


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract full sprite objects from a LimeZu sheet via pixel connected-components.")
    ap.add_argument("sheet", help="Path to sheet PNG.")
    ap.add_argument("--grid", type=int, default=16, help="Grid size (16/32/48). Used for snapping and grid coords.")
    ap.add_argument("--bg", default="auto", help="Background: 'auto' or 'r,g,b' (default auto uses pixel(0,0)).")
    ap.add_argument("--bgTol", type=int, default=2, help="Background tolerance (default 2).")
    ap.add_argument("--minAlpha", type=int, default=0, help="Min alpha to count as foreground (default 0).")
    ap.add_argument("--minPixels", type=int, default=30, help="Minimum pixels for a component (default 30).")
    ap.add_argument("--pad", type=int, default=1, help="Padding in pixels before snapping to grid (default 1).")
    ap.add_argument("--snap", action="store_true", help="If set, exported primary rect is grid-snapped rect.")
    ap.add_argument("--collisionMode", default="back_strip", choices=["back_strip", "none"], help="Collision generation mode.")
    ap.add_argument("--collisionH", type=float, default=0.22, help="Collision strip height ratio of sprite rect (default 0.22).")
    ap.add_argument("--collisionW", type=float, default=0.70, help="Collision strip width ratio of sprite rect (default 0.70).")
    ap.add_argument("--out", required=True, help="Output JSON path.")
    args = ap.parse_args()

    sheet_path = Path(args.sheet)
    img = load_rgba(sheet_path)
    w, h = img.size

    if args.bg == "auto":
        bg = img.getpixel((0, 0))[:3]
    else:
        parts = [int(p.strip()) for p in str(args.bg).split(",")]
        if len(parts) != 3:
            raise SystemExit("--bg must be 'auto' or 'r,g,b'")
        bg = (parts[0], parts[1], parts[2])

    mask = fg_mask(img, bg=bg, bg_tol=int(args.bgTol), min_alpha=int(args.minAlpha))
    comps = connected_components(mask, min_pixels=int(args.minPixels))

    objects = []
    for i, r in enumerate(comps):
        snapped = snap_rect_to_grid(r, grid=int(args.grid), w=w, h=h, pad=int(args.pad))
        chosen = snapped if args.snap else r

        gx = snapped.x // int(args.grid)
        gy = snapped.y // int(args.grid)
        gw = max(1, snapped.w // int(args.grid))
        gh = max(1, snapped.h // int(args.grid))

        collision = None
        if args.collisionMode == "back_strip":
            collision = compute_collision_back_strip(
                chosen,
                ratio_h=float(args.collisionH),
                ratio_w=float(args.collisionW),
            )

        variant_key = f"{r.w}x{r.h}_{crop_alpha_signature(img, r)}"
        touches_sheet_edge = (
            r.x == 0
            or r.y == 0
            or (r.x + r.w) >= w
            or (r.y + r.h) >= h
        )

        objects.append(
            {
                "name": f"obj_{i}",
                "rect": {"x": chosen.x, "y": chosen.y, "w": chosen.w, "h": chosen.h},
                "rectTight": {"x": r.x, "y": r.y, "w": r.w, "h": r.h},
                "rectSnapped": {"x": snapped.x, "y": snapped.y, "w": snapped.w, "h": snapped.h},
                "grid": {"x": gx, "y": gy, "w": gw, "h": gh},
                "origin": "bottom",
                "pivot_y": chosen.y + chosen.h,
                "variantKey": variant_key,
                "collision": {
                    "mode": args.collisionMode,
                    "rect": (
                        None
                        if collision is None
                        else {"x": collision.x, "y": collision.y, "w": collision.w, "h": collision.h}
                    ),
                },
                "meta": {
                    "touchesSheetEdge": touches_sheet_edge,
                    "gridSize": int(args.grid),
                    "snapEnabled": bool(args.snap),
                    "bg": {"r": bg[0], "g": bg[1], "b": bg[2]},
                },
            }
        )

    out = {
        "file": str(sheet_path.resolve()),
        "width": w,
        "height": h,
        "grid": int(args.grid),
        "mode": "components",
        "exportRect": "snapped" if args.snap else "tight",
        "background": {"r": bg[0], "g": bg[1], "b": bg[2]},
        "backgroundTolerance": int(args.bgTol),
        "collision": {
            "mode": args.collisionMode,
            "heightRatio": float(args.collisionH),
            "widthRatio": float(args.collisionW),
        },
        "objects": objects,
    }
    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {args.out} ({len(objects)} objects)")


if __name__ == "__main__":
    main()

