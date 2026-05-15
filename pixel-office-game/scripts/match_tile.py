import json
import sys
from dataclasses import dataclass

from PIL import Image


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int


def crop(img: Image.Image, r: Rect) -> Image.Image:
    return img.crop((r.x, r.y, r.x + r.w, r.y + r.h))


def resize_nearest(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.resize((w, h), resample=Image.NEAREST)


def score_tile(tile, templ, bg_rgb, bg_tol: int) -> float:
    # tile & templ are RGBA images (tileSize x tileSize)
    tile_px = tile.load()
    templ_px = templ.load()
    w, h = tile.size
    bg_r, bg_g, bg_b = bg_rgb
    total = 0
    count = 0
    for y in range(h):
        for x in range(w):
            tr, tg, tb, ta = tile_px[x, y]
            if ta == 0:
                continue
            if abs(tr - bg_r) <= bg_tol and abs(tg - bg_g) <= bg_tol and abs(tb - bg_b) <= bg_tol:
                continue
            rr, rg, rb, ra = templ_px[x, y]
            if ra == 0:
                continue
            total += abs(tr - rr) + abs(tg - rg) + abs(tb - rb)
            count += 1
    if count == 0:
        return float("inf")
    return total / count


def main():
    if len(sys.argv) < 8:
        print(
            "Usage: python match_tile.py <sheet.png> <shot.png> <cropX> <cropY> <cropW> <cropH> <tileSize=32>",
            file=sys.stderr,
        )
        sys.exit(2)

    sheet_path = sys.argv[1]
    shot_path = sys.argv[2]
    cx, cy, cw, ch = map(int, sys.argv[3:7])
    tile_size = int(sys.argv[7]) if len(sys.argv) >= 8 else 32

    sheet = Image.open(sheet_path).convert("RGBA")
    shot = Image.open(shot_path).convert("RGBA")

    bg = sheet.getpixel((0, 0))[:3]

    templ = resize_nearest(crop(shot, Rect(cx, cy, cw, ch)), tile_size, tile_size)

    tiles_x = sheet.width // tile_size
    tiles_y = sheet.height // tile_size

    best = None
    for ty in range(tiles_y):
        for tx in range(tiles_x):
            tile = crop(sheet, Rect(tx * tile_size, ty * tile_size, tile_size, tile_size))
            s = score_tile(tile, templ, bg, bg_tol=2)
            if best is None or s < best["score"]:
                best = {"tx": tx, "ty": ty, "score": s}

    print(
        json.dumps(
            {
                "best": best,
                "crop": {"x": cx, "y": cy, "w": cw, "h": ch},
                "tileSize": tile_size,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

