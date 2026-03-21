"""
add_all_mo_sizes_to_catalog.py
Adds 16x16 and 48x48 Modern Office singles to master_furniture_catalog.json
reusing the same sprite_labels.json produced from 32x32 visual analysis.
(All three size variants contain the same furniture objects.)
"""
import json
from pathlib import Path

ROOT        = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
CATALOG     = ROOT / "data" / "master_furniture_catalog.json"
LABELS      = ROOT / "out" / "mosaics" / "sprite_labels.json"
SINGLES_BASE = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\4_Modern_Office_singles")

SIZES = {
    "16x16": (16, 16),
    "48x48": (48, 48),
}

def numeric_sort_key(p: Path) -> int:
    digits = ''.join(filter(str.isdigit, p.stem))
    return int(digits) if digits else 0

def main():
    print("Loading catalog...")
    with open(CATALOG, 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    with open(LABELS, 'r', encoding='utf-8') as f:
        labels = json.load(f)   # {"1": "beige single-seat sofa", ...}

    total_added = 0

    for size_folder, (w, h) in SIZES.items():
        folder = SINGLES_BASE / size_folder
        files = sorted(folder.glob("*.png"), key=numeric_sort_key)
        print(f"\nProcessing {size_folder}: {len(files)} sprites...")

        for i, fpath in enumerate(files, start=1):
            filename = fpath.name
            ai_name  = labels.get(str(i), "")

            # Build catalog key
            base = filename.replace(".png", "").lower().replace(" ", "_")
            cat_key = f"single_{size_folder.replace('x', 'x')}_modern_office_singles_{base}"

            if cat_key in catalog["objects"]:
                # Already exists — just patch in the label if missing
                if ai_name and "ai_name" not in catalog["objects"][cat_key]:
                    catalog["objects"][cat_key]["ai_name"] = ai_name
                continue

            url_path = f"Modern_Office_Revamped_v1.2/4_Modern_Office_singles/{size_folder}/{filename}"

            catalog["objects"][cat_key] = {
                "source_type": "single_file",
                "url_path": url_path,
                "w": w,
                "h": h,
                "origin": "bottom",
                "entity_type": "furniture",
                "type": "furniture",
                "pack": "modern_office",
                "size_variant": size_folder,
                "ai_name": ai_name
            }
            total_added += 1

        print(f"  Done with {size_folder}.")

    print(f"\nTotal new entries added: {total_added}")
    with open(CATALOG, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2)
    print("Saved updated master_furniture_catalog.json.")

if __name__ == "__main__":
    main()
