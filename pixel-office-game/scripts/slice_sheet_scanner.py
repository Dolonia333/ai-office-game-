#!/usr/bin/env python3
"""
Auto-slice a sprite sheet by detecting non-transparent clusters on a 16px grid.
Outputs suggested compound objects (e.g. punching bag = 16x48) instead of separate tiles.

Usage:
  python slice_sheet_scanner.py <path_to.png> [--grid 16] [--min-alpha 10]
  python slice_sheet_scanner.py "path/to/8_Gym.png"

Output: JSON or text listing objects with (x, y, w, h) in 16px base tiles.
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

GRID = 16
MIN_ALPHA = 10  # pixel alpha above this counts as opaque


def is_cell_occupied(im: Image.Image, cx: int, cy: int, grid: int, min_alpha: int) -> bool:
    """True if this grid cell has any pixel with alpha > min_alpha."""
    x0, y0 = cx * grid, cy * grid
    if x0 + grid > im.width or y0 + grid > im.height:
        return False
    for dy in range(grid):
        for dx in range(grid):
            px = x0 + dx
            py = y0 + dy
            if px < im.width and py < im.height:
                p = im.getpixel((px, py))
                a = p[3] if len(p) >= 4 else 255
                if a > min_alpha:
                    return True
    return False


def collect_occupied_cells(im: Image.Image, grid: int, min_alpha: int) -> set[tuple[int, int]]:
    out = set()
    for cy in range((im.height + grid - 1) // grid):
        for cx in range((im.width + grid - 1) // grid):
            if is_cell_occupied(im, cx, cy, grid, min_alpha):
                out.add((cx, cy))
    return out


def merge_adjacent(cells: set[tuple[int, int]]) -> list[tuple[int, int, int, int]]:
    """Merge adjacent cells into bounding boxes (x, y, w, h) in grid units."""
    if not cells:
        return []
    # Simple approach: for each cell, try to grow a rectangle (greedy merge along rows/cols).
    remaining = set(cells)
    regions = []
    while remaining:
        start = remaining.pop()
        stack = [start]
        seen = {start}
        while stack:
            cx, cy = stack.pop()
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                n = (cx + dx, cy + dy)
                if n in remaining and n not in seen:
                    remaining.discard(n)
                    seen.add(n)
                    stack.append(n)
        xs = [p[0] for p in seen]
        ys = [p[1] for p in seen]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        regions.append((x0, y0, x1 - x0 + 1, y1 - y0 + 1))
    return regions


def main():
    ap = argparse.ArgumentParser(description="Scan sprite sheet for non-transparent compound objects.")
    ap.add_argument("image", type=Path, help="Path to PNG (e.g. 8_Gym.png, 2_LivingRoom.png)")
    ap.add_argument("--grid", type=int, default=GRID, help="Base grid size in pixels (default 16)")
    ap.add_argument("--min-alpha", type=int, default=MIN_ALPHA, help="Min alpha to count as opaque")
    ap.add_argument("--json", action="store_true", help="Output JSON")
    args = ap.parse_args()

    path = args.image
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)

    im = Image.open(path).convert("RGBA")
    cells = collect_occupied_cells(im, args.grid, args.min_alpha)
    regions = merge_adjacent(cells)

    # Sort by (y, x) for stable output
    regions.sort(key=lambda r: (r[1], r[0]))

    out = []
    for i, (x, y, w, h) in enumerate(regions):
        obj = {
            "index": i,
            "x_grid": x,
            "y_grid": y,
            "w_grid": w,
            "h_grid": h,
            "x_px": x * args.grid,
            "y_px": y * args.grid,
            "width_px": w * args.grid,
            "height_px": h * args.grid,
        }
        out.append(obj)

    if args.json:
        print(json.dumps({"grid": args.grid, "image": str(path), "objects": out}, indent=2))
    else:
        print(f"# Sheet: {path} (grid={args.grid}px)")
        for o in out:
            print(f"  {o['w_grid']}x{o['h_grid']} tiles  at ({o['x_grid']},{o['y_grid']})  -> {o['width_px']}x{o['height_px']} px  pivot: bottom")


if __name__ == "__main__":
    main()
