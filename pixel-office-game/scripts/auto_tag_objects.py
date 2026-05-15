import argparse
import json
from pathlib import Path


def tag_object(rect: dict, grid: dict) -> dict:
    # Heuristics: coarse but useful defaults. User can refine later.
    w = int(rect["w"])
    h = int(rect["h"])
    gw = int(grid["w"])
    gh = int(grid["h"])

    # Base type by aspect/size.
    if gh >= 4 and gw <= 2:
        base = "tall_storage"
    elif gw >= 4 and gh <= 2:
        base = "wall_wide"
    elif gw >= 3 and gh >= 3:
        base = "large_furniture"
    elif gw >= 2 and gh >= 2:
        base = "furniture"
    else:
        base = "prop"

    placement_layer = "floor"
    if base in ("wall_wide",) and h <= w:
        placement_layer = "wall"

    # Interaction hints (very conservative).
    action = None
    if base in ("furniture", "large_furniture") and (gw, gh) in ((1, 1), (2, 2), (2, 1)):
        # Many chairs are 1x1 or 2x2 depending on sheet.
        action = None

    return {
        "type": base,
        "style": "modern_office",
        "placement": {"layer": placement_layer},
        "action": action,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Add semantic tags to extracted sheet objects.")
    ap.add_argument("--in", dest="inp", required=True, help="Input objects.json from extract_sheet_objects.py")
    ap.add_argument("--sheetId", required=True, help="Logical sheet id")
    ap.add_argument("--out", required=True, help="Output catalog json")
    args = ap.parse_args()

    data = json.loads(Path(args.inp).read_text(encoding="utf-8"))
    out = {
        "info": {
            "source": data.get("file"),
            "sheetId": args.sheetId,
            "mode": data.get("mode"),
            "grid": data.get("grid"),
        },
        "objects": {},
    }

    for obj in data.get("objects", []):
        r = obj.get("rect")
        g = obj.get("grid")
        if not r or not g:
            continue
        oid = f"{args.sheetId}__g{g['x']}_{g['y']}__{g['w']}x{g['h']}"
        tags = tag_object(r, g)
        out["objects"][oid] = {
            "sheet": args.sheetId,
            "rect": r,
            "origin": "bottom",
            "depthHint": 1.5 if tags["placement"]["layer"] == "floor" else 2.2,
            **tags,
            "grid": g,
        }

    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {args.out} ({len(out['objects'])} objects)")


if __name__ == "__main__":
    main()

