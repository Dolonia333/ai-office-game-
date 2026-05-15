import argparse
import json
from pathlib import Path


def rect_iou(a, b):
  ax0, ay0, aw, ah = a["x"], a["y"], a["w"], a["h"]
  bx0, by0, bw, bh = b["x"], b["y"], b["w"], b["h"]
  ax1, ay1 = ax0 + aw, ay0 + ah
  bx1, by1 = bx0 + bw, by0 + bh
  inter_x0 = max(ax0, bx0)
  inter_y0 = max(ay0, by0)
  inter_x1 = min(ax1, bx1)
  inter_y1 = min(ay1, by1)
  if inter_x1 <= inter_x0 or inter_y1 <= inter_y0:
    return 0.0
  inter_area = (inter_x1 - inter_x0) * (inter_y1 - inter_y0)
  a_area = aw * ah
  b_area = bw * bh
  return inter_area / float(a_area + b_area - inter_area)


def main():
  ap = argparse.ArgumentParser(description="Map screenshot match rects to nearest full objects from a catalog.")
  ap.add_argument("--matches", required=True, help="matches.json from reference_match.py")
  ap.add_argument("--catalog", required=True, help="catalog_modern_office_*.auto.json")
  ap.add_argument("--out", required=True, help="Output JSON with assigned object ids")
  args = ap.parse_args()

  matches = json.loads(Path(args.matches).read_text(encoding="utf-8"))
  cat = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
  objects = cat.get("objects", {})

  # Pre-build list of rects per sheet; here catalog already scoped to one sheet.
  obj_list = []
  for oid, od in objects.items():
    r = od.get("rect")
    if not r:
      continue
    obj_list.append((oid, r))

  mapped = []
  for m in matches:
    best_oid = None
    best_iou = 0.0
    mrect = m["best"]
    # Build rect in pixel coords for the matched region.
    tile = int(m["tileSize"])
    rect = {
      "x": mrect["tx"] * tile,
      "y": mrect["ty"] * tile,
      "w": mrect.get("wTiles", 1) * tile,
      "h": mrect.get("hTiles", 1) * tile,
    }
    for oid, orect in obj_list:
      iou = rect_iou(rect, orect)
      if iou > best_iou:
        best_iou = iou
        best_oid = oid
    mapped.append(
      {
        "name": m["name"],
        "sheetId": m["sheetId"],
        "matchRect": rect,
        "bestObjectId": best_oid,
        "bestIoU": best_iou,
      }
    )

  Path(args.out).write_text(json.dumps(mapped, indent=2), encoding="utf-8")
  print(f"Wrote {args.out} ({len(mapped)} entries)")


if __name__ == "__main__":
  main()

