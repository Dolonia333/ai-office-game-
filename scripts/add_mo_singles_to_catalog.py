"""
add_mo_singles_to_catalog.py
Adds the Modern Office 32x32 singles to master_furniture_catalog.json
with ai_name labels produced by visual analysis.
"""
import json
from pathlib import Path

ROOT        = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
CATALOG     = ROOT / "data" / "master_furniture_catalog.json"
LABELS      = ROOT / "out" / "mosaics" / "sprite_labels.json"
INDEX       = ROOT / "out" / "mosaics" / "sprite_index.json"
SINGLES_DIR = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\4_Modern_Office_singles\32x32")

def slug(s: str) -> str:
    """Convert a string to a safe key slug."""
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")

def main():
    print("Loading catalog...")
    with open(CATALOG, 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    with open(LABELS, 'r', encoding='utf-8') as f:
        labels = json.load(f)   # {"1": "beige single-seat sofa", ...}

    with open(INDEX, 'r', encoding='utf-8') as f:
        index = json.load(f)    # {"1": "Modern_Office_Singles_32x32_1.png", ...}

    # Get actual PNG files on disk (sorted by number)
    files = sorted(SINGLES_DIR.glob("*.png"), key=lambda p: int(''.join(filter(str.isdigit, p.stem)) or '0'))

    added = 0
    for i, fpath in enumerate(files, start=1):
        num_str = str(i)
        filename = fpath.name
        ai_name  = labels.get(num_str, "")
        
        # Build catalog key
        base = filename.replace(".png", "").lower().replace(" ", "_")
        cat_key = f"single_32x32_modern_office_singles_{base}"

        if cat_key in catalog["objects"]:
            # Already exists — just patch in the label
            if ai_name and "ai_name" not in catalog["objects"][cat_key]:
                catalog["objects"][cat_key]["ai_name"] = ai_name
            continue

        # Build relative url_path (relative to pixel game stuff asset root)
        url_path = f"Modern_Office_Revamped_v1.2/4_Modern_Office_singles/32x32/{filename}"

        catalog["objects"][cat_key] = {
            "source_type": "single_file",
            "url_path": url_path,
            "w": 32,
            "h": 32,
            "origin": "bottom",
            "entity_type": "furniture",
            "type": "furniture",
            "pack": "modern_office",
            "size_variant": "32x32",
            "ai_name": ai_name
        }
        added += 1

    print(f"Added {added} new entries to the catalog.")

    with open(CATALOG, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2)
    print("Saved updated master_furniture_catalog.json.")

if __name__ == "__main__":
    main()
