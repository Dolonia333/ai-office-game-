import json
import os
from collections import Counter, defaultdict

CATALOG_PATH = os.path.join(os.path.dirname(__file__), "assets-catalog.scanned.json")


def main() -> None:
  if not os.path.exists(CATALOG_PATH):
    raise SystemExit(f"Catalog not found: {CATALOG_PATH}")

  with open(CATALOG_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

  packs = data.get("packs", [])
  print(f"Root: {data.get('root')}")
  print(f"Total packs: {len(packs)}")
  print()

  for pack in packs:
    pack_id = pack.get("id")
    name = pack.get("name")
    base = pack.get("basePath")
    assets = pack.get("assets", [])
    print(f"Pack: {pack_id}")
    print(f"  Name     : {name}")
    print(f"  BasePath : {base}")
    print(f"  Assets   : {len(assets)}")

    # Show a few example files in this pack (up to 5)
    for a in assets[:5]:
      print(f"    - {a.get('file')}")
    print()


if __name__ == "__main__":
  main()

