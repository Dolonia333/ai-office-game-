from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class TileEntry:
  id: str
  sheetId: str
  sheetPath: str
  tileIndex: int
  x: int
  y: int
  tileWidth: int
  tileHeight: int
  category: str
  tags: List[str]


def load_tilesheets_config(config_path: Path) -> List[Dict[str, Any]]:
  with config_path.open("r", encoding="utf-8") as f:
    data = json.load(f)
  return data.get("tilesheets", [])


def build_tiles_catalog(project_root: Path) -> List[TileEntry]:
  """
  Build a tile-level catalog from tilesheets-config.json.

  This does NOT cut images; it just describes each tile's position and metadata
  so the game (and OpenClaw) can refer to tiles by index and category.
  """
  config_path = project_root / "pixel-office-game" / "tilesheets-config.json"
  tilesheets = load_tilesheets_config(config_path)

  entries: List[TileEntry] = []

  for sheet_cfg in tilesheets:
    sheet_id = sheet_cfg["id"]
    rel_path = sheet_cfg["path"]
    tile_w = sheet_cfg["tileWidth"]
    tile_h = sheet_cfg["tileHeight"]
    tiles_per_row = sheet_cfg["tilesPerRow"]
    categories = sheet_cfg.get("categories", [])

    # Each category covers a range of tile indices on this sheet.
    for cat in categories:
      cat_name = cat["name"]
      start = cat["fromIndex"]
      end = cat["toIndex"]
      tags = cat.get("tags", [])

      for idx in range(start, end + 1):
        x = idx % tiles_per_row
        y = idx // tiles_per_row
        tile_id = f"{sheet_id}:{cat_name}:{idx}"

        entries.append(
          TileEntry(
            id=tile_id,
            sheetId=sheet_id,
            sheetPath=rel_path,
            tileIndex=idx,
            x=x,
            y=y,
            tileWidth=tile_w,
            tileHeight=tile_h,
            category=cat_name,
            tags=tags,
          )
        )

  return entries


def main() -> None:
  project_root = Path(__file__).resolve().parents[1]
  entries = build_tiles_catalog(project_root)

  out_path = project_root / "pixel-office-game" / "tiles-catalog.json"
  payload = {
    "info": {
      "generatedFrom": "tilesheets-config.json",
      "totalTiles": len(entries),
    },
    "tiles": [asdict(e) for e in entries],
  }

  out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
  print(f"Wrote {len(entries)} tile entries to {out_path}")


if __name__ == "__main__":
  main()

