import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


def crop(img: Image.Image, r: Rect) -> Image.Image:
    return img.crop((r.x, r.y, r.x + r.w, r.y + r.h))


def resize_nearest(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.resize((w, h), resample=Image.NEAREST)


def score_tile(tile: Image.Image, templ: Image.Image, bg_rgb, bg_tol: int) -> float:
    tile_px = tile.load()
    templ_px = templ.load()
    w, h = tile.size
    bg_r, bg_g, bg_b = bg_rgb
    total = 0
    count = 0
    for yy in range(h):
        for xx in range(w):
            tr, tg, tb, ta = tile_px[xx, yy]
            if ta == 0:
                continue
            if abs(tr - bg_r) <= bg_tol and abs(tg - bg_g) <= bg_tol and abs(tb - bg_b) <= bg_tol:
                continue
            rr, rg, rb, ra = templ_px[xx, yy]
            if ra == 0:
                continue
            total += abs(tr - rr) + abs(tg - rg) + abs(tb - rb)
            count += 1
    if count == 0:
        return float("inf")
    return total / count


def score_image(img: Image.Image, templ: Image.Image, bg_rgb, bg_tol: int) -> float:
    # Same scoring as score_tile but for arbitrary-sized regions.
    img_px = img.load()
    templ_px = templ.load()
    w, h = img.size
    bg_r, bg_g, bg_b = bg_rgb
    total = 0
    count = 0
    for yy in range(h):
        for xx in range(w):
            tr, tg, tb, ta = img_px[xx, yy]
            if ta == 0:
                continue
            if abs(tr - bg_r) <= bg_tol and abs(tg - bg_g) <= bg_tol and abs(tb - bg_b) <= bg_tol:
                continue
            rr, rg, rb, ra = templ_px[xx, yy]
            if ra == 0:
                continue
            # Ignore template "background-like" pixels by encoding them as fully transparent (ra==0).
            total += abs(tr - rr) + abs(tg - rg) + abs(tb - rb)
            count += 1
    if count == 0:
        return float("inf")
    return total / count


def dominant_rgb(img: Image.Image) -> tuple[int, int, int]:
    # Finds most common RGB among non-transparent pixels.
    px = img.load()
    w, h = img.size
    counts = {}
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a == 0:
                continue
            key = (r, g, b)
            counts[key] = counts.get(key, 0) + 1
    if not counts:
        return (0, 0, 0)
    return max(counts.items(), key=lambda kv: kv[1])[0]


def apply_template_bg_mask(templ: Image.Image, bg_rgb: tuple[int, int, int], tol: int) -> Image.Image:
    # Converts bg-like pixels to transparent so scoring focuses on the object.
    out = templ.copy()
    px = out.load()
    w, h = out.size
    br, bg, bb = bg_rgb
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a == 0:
                continue
            if abs(r - br) <= tol and abs(g - bg) <= tol and abs(b - bb) <= tol:
                px[xx, yy] = (r, g, b, 0)
    return out


def bbox_nontransparent(img: Image.Image) -> tuple[int, int, int, int] | None:
    px = img.load()
    w, h = img.size
    minx, miny = w, h
    maxx, maxy = -1, -1
    for yy in range(h):
        for xx in range(w):
            _, _, _, a = px[xx, yy]
            if a == 0:
                continue
            if xx < minx:
                minx = xx
            if yy < miny:
                miny = yy
            if xx > maxx:
                maxx = xx
            if yy > maxy:
                maxy = yy
    if maxx < minx or maxy < miny:
        return None
    # Pillow crop is right/bottom exclusive.
    return (minx, miny, maxx + 1, maxy + 1)


def touches_border(b: tuple[int, int, int, int], w: int, h: int) -> bool:
    l, t, r, btm = b
    return l <= 0 or t <= 0 or r >= w or btm >= h


def match_on_sheet(sheet: Image.Image, templ: Image.Image, tile_size: int, w_tiles: int, h_tiles: int, bg_tol: int) -> dict:
    bg = sheet.getpixel((0, 0))[:3]
    tiles_x = sheet.width // tile_size
    tiles_y = sheet.height // tile_size
    best = None
    max_tx = tiles_x - w_tiles
    max_ty = tiles_y - h_tiles
    for ty in range(max_ty + 1):
        for tx in range(max_tx + 1):
            region = sheet.crop(
                (
                    tx * tile_size,
                    ty * tile_size,
                    (tx + w_tiles) * tile_size,
                    (ty + h_tiles) * tile_size,
                )
            )
            s = score_image(region, templ, bg, bg_tol=bg_tol)
            if best is None or s < best["score"]:
                best = {"tx": tx, "ty": ty, "wTiles": w_tiles, "hTiles": h_tiles, "score": float(s)}
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description="Match crops from a reference screenshot against LimeZu sheets.")
    ap.add_argument("--ref", required=True, help="Reference screenshot (png).")
    ap.add_argument("--crops", required=True, help="JSON file of crops: [{name,x,y,w,h,tileSize?}].")
    ap.add_argument("--sheets", required=True, help="JSON file of sheets: [{id,file,tileSizes:[32,48],bgTol?}].")
    ap.add_argument("--out", required=True, help="Output folder.")
    ap.add_argument("--bgTol", type=int, default=2, help="Background tolerance (default 2).")
    ap.add_argument(
        "--templBgTol",
        type=int,
        default=6,
        help="Tolerance used to mask dominant background inside reference crops (default 6).",
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    ref_img = Image.open(args.ref).convert("RGBA")
    crops = json.loads(Path(args.crops).read_text(encoding="utf-8"))
    sheets_cfg = json.loads(Path(args.sheets).read_text(encoding="utf-8"))

    # Preload sheets (RGBA)
    sheets = []
    for s in sheets_cfg:
        p = Path(s["file"])
        if not p.exists():
            continue
        sheets.append(
            {
                "id": s.get("id") or p.stem,
                "file": str(p),
                "img": Image.open(p).convert("RGBA"),
                "tileSizes": s.get("tileSizes") or [32],
                "bgTol": int(s.get("bgTol") or args.bgTol),
            }
        )

    results = []
    for c in crops:
        if not isinstance(c, dict) or "name" not in c:
            continue
        name = c["name"]
        rect = Rect(int(c["x"]), int(c["y"]), int(c["w"]), int(c["h"]))
        templ0 = crop(ref_img, rect)
        # For matching, we always resize crop to each sheet tileSize.
        best_overall = None
        best_sheet = None
        best_tile_size = None
        best_w_tiles = None
        best_h_tiles = None
        for s in sheets:
            for tile_size in s["tileSizes"]:
                # Optionally allow crop JSON to force multi-tile search sizes.
                w_tiles = int(c.get("wTiles") or max(1, (rect.w + tile_size - 1) // tile_size))
                h_tiles = int(c.get("hTiles") or max(1, (rect.h + tile_size - 1) // tile_size))

                # Resize crop to the candidate multi-tile size.
                templ = resize_nearest(templ0, w_tiles * tile_size, h_tiles * tile_size)

                # Mask out the dominant background color in the reference crop (usually floor/wall),
                # then tighten to the object bbox so we don't match "pieces".
                tbg = dominant_rgb(templ)
                masked = apply_template_bg_mask(templ, tbg, tol=int(args.templBgTol))
                bb = bbox_nontransparent(masked)
                clipped = False
                if bb is not None:
                    clipped = touches_border(bb, masked.size[0], masked.size[1])
                    masked = masked.crop(bb)
                    # Keep search size tied to the tightened template.
                    w_tiles = max(1, (masked.size[0] + tile_size - 1) // tile_size)
                    h_tiles = max(1, (masked.size[1] + tile_size - 1) // tile_size)
                    masked = resize_nearest(masked, w_tiles * tile_size, h_tiles * tile_size)
                templ = masked
                best = match_on_sheet(
                    s["img"],
                    templ,
                    tile_size=tile_size,
                    w_tiles=w_tiles,
                    h_tiles=h_tiles,
                    bg_tol=s["bgTol"],
                )
                candidate = {
                    "name": name,
                    "refRect": {"x": rect.x, "y": rect.y, "w": rect.w, "h": rect.h},
                    "sheetId": s["id"],
                    "sheetFile": s["file"],
                    "tileSize": tile_size,
                    "best": best,
                    "cropClipped": clipped,
                }
                if best_overall is None or best["score"] < best_overall["best"]["score"]:
                    best_overall = candidate
                    best_sheet = s
                    best_tile_size = tile_size
                    best_w_tiles = w_tiles
                    best_h_tiles = h_tiles

        if (
            best_overall is None
            or best_sheet is None
            or best_tile_size is None
            or best_w_tiles is None
            or best_h_tiles is None
        ):
            continue

        # Write verification images:
        # - reference crop
        ref_out = out_dir / f"{name}.ref.png"
        templ0.save(ref_out)
        # - matched tile crop from sheet
        tx = int(best_overall["best"]["tx"])
        ty = int(best_overall["best"]["ty"])
        sheet_crop = best_sheet["img"].crop(
            (
                tx * best_tile_size,
                ty * best_tile_size,
                (tx + best_w_tiles) * best_tile_size,
                (ty + best_h_tiles) * best_tile_size,
            )
        )
        sheet_out = out_dir / f"{name}.match.{best_overall['sheetId']}.{best_tile_size}.{tx}_{ty}.png"
        sheet_crop.save(sheet_out)

        best_overall["verification"] = {
            "refCrop": str(ref_out),
            "sheetCrop": str(sheet_out),
        }
        results.append(best_overall)

    (out_dir / "matches.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote {out_dir / 'matches.json'} with {len(results)} matches")


if __name__ == "__main__":
    main()

