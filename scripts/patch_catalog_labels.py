"""
patch_catalog_labels.py
Reads sprite_labels.json (produced by vision analysis) and
injects ai_name entries into master_furniture_catalog.json.
"""
import json
from pathlib import Path

ROOT = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
CATALOG_PATH = ROOT / "data" / "master_furniture_catalog.json"
LABELS_PATH  = ROOT / "out" / "mosaics" / "sprite_labels.json"
INDEX_PATH   = ROOT / "out" / "mosaics" / "sprite_index.json"

def main():
    print("Loading files...")
    with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
        catalog = json.load(f)
    with open(LABELS_PATH, 'r', encoding='utf-8') as f:
        labels = json.load(f)  # {str(num): "descriptive name"}
    with open(INDEX_PATH, 'r', encoding='utf-8') as f:
        index = json.load(f)  # {str(num): "Modern_Office_Singles_32x32_N.png"}

    # Build filename → label lookup
    filename_to_label = {}
    for num_str, filename in index.items():
        if num_str in labels:
            filename_to_label[filename] = labels[num_str]

    print(f"Loaded {len(filename_to_label)} labels.")

    # Patch catalog
    updated = 0
    for key, obj in catalog.get("objects", {}).items():
        url = obj.get("url_path", "")
        if not url:
            continue
        filename = Path(url).name
        if filename in filename_to_label:
            obj["ai_name"] = filename_to_label[filename]
            updated += 1

    print(f"Patched {updated} catalog entries with ai_name labels.")

    with open(CATALOG_PATH, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2)
    print("Saved updated catalog.")

if __name__ == "__main__":
    main()
