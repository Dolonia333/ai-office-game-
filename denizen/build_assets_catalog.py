import json
import os
import re
from collections import defaultdict


# Absolute path to your asset root
ASSET_ROOT = r"C:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff"

# Where to write the generated catalog (relative to this script)
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "assets-catalog.scanned.json")


def slugify(name: str) -> str:
  """Turn a folder name into a safe pack id."""
  name = name.strip().lower()
  name = re.sub(r"[^a-z0-9]+", "_", name)
  name = re.sub(r"_+", "_", name).strip("_")
  return name or "pack"


def main() -> None:
  if not os.path.isdir(ASSET_ROOT):
    raise SystemExit(f"ASSET_ROOT does not exist: {ASSET_ROOT}")

  packs = {}
  assets_by_pack = defaultdict(list)

  exts = {".png", ".webp"}

  for root, _dirs, files in os.walk(ASSET_ROOT):
    for fn in files:
      ext = os.path.splitext(fn)[1].lower()
      if ext not in exts:
        continue

      full_path = os.path.join(root, fn)
      rel_path = os.path.relpath(full_path, ASSET_ROOT).replace("\\", "/")

      # Top-level folder under ASSET_ROOT becomes a pack
      top = rel_path.split("/", 1)[0]
      pack_id = slugify(top)

      if pack_id not in packs:
        packs[pack_id] = {
          "id": pack_id,
          "name": top,
          "kind": "unknown",  # can be refined by hand later
          "basePath": top,
          "license": {
            "author": "Unknown",
            "url": "",
            "redistributionAllowed": False
          },
          "assets": []
        }

      asset_id_base = os.path.splitext(fn)[0]
      asset_id = slugify(asset_id_base)
      # Make asset id unique within pack if needed
      existing_ids = {a["id"] for a in assets_by_pack[pack_id]}
      candidate = asset_id
      i = 2
      while candidate in existing_ids:
        candidate = f"{asset_id}_{i}"
        i += 1
      asset_id = candidate

      asset_record = {
        "id": asset_id,
        "file": rel_path,
        "category": "unknown",
        "tags": []
      }
      assets_by_pack[pack_id].append(asset_record)

  # Attach assets to packs
  catalog_packs = []
  for pack_id, pack in packs.items():
    pack["assets"] = assets_by_pack[pack_id]
    catalog_packs.append(pack)

  catalog = {
    "root": ASSET_ROOT.replace("\\", "/"),
    "packs": catalog_packs
  }

  os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
  with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)

  print(f"Wrote catalog with {len(catalog_packs)} packs to {OUTPUT_PATH}")


if __name__ == "__main__":
  main()

