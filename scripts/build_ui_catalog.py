import os
import json
import re
from pathlib import Path

def main():
    root_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
    ui_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\modernuserinterface-win")
    assets_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff")
    
    out_file = root_dir / "data" / "modern_ui_catalog.json"
    
    ui_catalog = {
        "info": {
            "purpose": "Catalog mapping modern UI sheets, icons, and portrait generator pieces.",
            "usage": "Use full sheets as NineSlices or SpriteAtlases in Phaser, or load single icons."
        },
        "objects": {}
    }

    if not ui_dir.exists():
        print("UI directory not found:", ui_dir)
        return

    # Loop through the UI dir and collect all png/gif files
    for filepath in ui_dir.rglob("*"):
        if filepath.is_file() and filepath.suffix.lower() in [".png", ".gif"]:
            # Try to determine if it's 16x16 or 32x32
            resolution = "16x16"
            if "32x32" in str(filepath):
                resolution = "32x32"
                
            # Determine sub-category based on path
            category = "ui_sheet"
            if "Portrait_Generator" in str(filepath):
                category = "portrait_part"
            elif "Animated" in str(filepath):
                category = "animated_icon"
            elif "Icon" in str(filepath): # Just in case LimeZu adds loose icons
                category = "ui_icon"
                
            # Create a slug for the ID
            name_stem = filepath.stem
            slug = re.sub(r'[^a-zA-Z0-9]', '_', name_stem).lower()
            slug = re.sub(r'_+', '_', slug).strip('_')
            
            obj_id = f"ui_{resolution}_{category}_{slug}"
            
            # Reconstruct relative URL from the master assets dir
            try:
                rel_path = filepath.relative_to(assets_dir)
                url_path = f"assets/{rel_path}".replace("\\", "/")
            except ValueError:
                url_path = str(filepath).replace("\\", "/")
                
            ui_catalog["objects"][obj_id] = {
                "source_type": category,
                "url_path": url_path,
                "resolution": resolution,
                "base_name": name_stem
            }
            
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(ui_catalog, f, indent=2)
        
    print(f"Modern UI catalog built! Total objects: {len(ui_catalog['objects'])}")

if __name__ == "__main__":
    main()
