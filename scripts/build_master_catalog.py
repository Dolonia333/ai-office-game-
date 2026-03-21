import os
import json
import re
from pathlib import Path

def extract_semantics(name_str, path_str, w, h):
    # Replace underscores with spaces so \b regex boundaries work correctly
    name = name_str.lower().replace('_', ' ')
    full_path = path_str.lower().replace('\\', ' ').replace('/', ' ').replace('_', ' ')
    
    semantics = {
        "direction": None,
        "variant": None,
        "anim_state": None,
        "entity_type": None,
        "type": "decor" # default fallback
    }
    
    # Directions
    for d in ["up", "down", "left", "right", "front", "back", "side", "forward", "backward"]:
        if re.search(rf'\b{d}\b', name):
            semantics["direction"] = d
            break
            
    # Variants (colors or materials)
    variants = ["leather", "wood", "wooden", "metal", "glass", "plastic", "red", "blue", "green", "yellow", "black", "white", "gray", "grey", "brown", "pink", "purple", "orange"]
    for v in variants:
        if re.search(rf'\b{v}\b', name):
            semantics["variant"] = v
            break
            
    # Animation states
    states = ["walk", "idle", "sit", "read", "run", "swim", "sleep", "eat", "attack", "die", "jump", "work", "type"]
    for s in states:
        if re.search(rf'\b{s}\b', name):
            semantics["anim_state"] = s
            break
            
    # Identify characters/animals
    animals = ["duck", "dog", "cat", "bird", "fish", "horse", "cow", "pig", "chicken", "sheep", "animal", "pet"]
    people = ["char", "character", "person", "npc", "hero", "man", "woman", "boy", "girl", "kid", "adult", "boss", "student", "teacher", "doctor", "nurse", "police", "thief", "adam", "alex", "amelia", "ashley", "bob", "bruce", "chef", "clown", "cyborg", "dana", "danny"]
    
    is_animal = any(re.search(rf'\b{a}\b', name) for a in animals) or any(re.search(rf'\b{a}\b', full_path) for a in animals)
    is_person = any(re.search(rf'\b{p}\b', name) for p in people) or any(re.search(rf'\b{p}\b', full_path) for p in people) or "character" in full_path
    
    if is_animal:
        semantics["entity_type"] = "animal"
        semantics["type"] = "animal"
    elif is_person:
        semantics["entity_type"] = "person"
        semantics["type"] = "character"
        
    # Other specific types
    surfaces = ["desk", "table", "counter", "shelf", "cabinet"]
    seats = ["chair", "sofa", "couch", "stool", "bench", "seat"]
    terrain = ["floor", "wall", "grass", "dirt", "path", "road", "tile"]
    water = ["water", "pool", "river", "lake", "ocean", "sea", "pond"]
    large_furniture = ["bed", "wardrobe", "bookshelf", "fridge", "oven", "stove", "sink", "tub", "shower", "vending", "machine", "printer", "cooler", "plant", "tree"]
    
    if semantics["type"] == "decor":
        if any(re.search(rf'\b{s}\b', name) for s in seats):
            semantics["type"] = "seating"
            semantics["entity_type"] = "furniture"
        elif any(re.search(rf'\b{s}\b', name) for s in surfaces):
            semantics["type"] = "surface"
            semantics["entity_type"] = "furniture"
        elif any(re.search(rf'\b{f}\b', name) for f in large_furniture):
            semantics["type"] = "furniture"
            semantics["entity_type"] = "furniture"
        elif any(re.search(rf'\b{t}\b', name) for t in terrain):
            semantics["type"] = "terrain"
            semantics["entity_type"] = "terrain"
        elif any(re.search(rf'\b{w}\b', name) for w in water):
            semantics["type"] = "water"
            semantics["entity_type"] = "water"
        else:
            if w >= 32 or h >= 32:
                semantics["type"] = "furniture"
                semantics["entity_type"] = "furniture"
            else:
                semantics["entity_type"] = "decor"
                
    # clean up None
    return {k: v for k, v in semantics.items() if v is not None}

def main():
    root_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
    assets_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff")
    
    out_file = root_dir / "data" / "master_furniture_catalog.json"
    
    master_catalog = {
        "info": {
            "purpose": "Master auto-generated catalog mapping every sprite slice and single file.",
            "origin": "bottom"
        },
        "objects": {}
    }
    
    # 1. Ingest existing grid/scan json files from scripts folder
    scripts_dir = root_dir / "scripts"
    for f in scripts_dir.glob("*.grid*.json"):
        try:
            with open(f, 'r', encoding='utf-8') as file:
                data = json.load(file)
            sheet_name = f.stem.replace('.grid', '_grid').replace('.scan', '_scan')
            grid_size = data.get("grid", 32)
            for obj in data.get("objects", []):
                r = obj.get("rect")
                g = obj.get("grid")
                if not r: continue
                
                if g:
                    obj_id = f"sheet_{grid_size}x{grid_size}_{sheet_name}_g_{g['x']}_{g['y']}_{g['w']}x{g['h']}"
                else:
                    obj_id = f"sheet_{grid_size}x{grid_size}_{sheet_name}_rect_{r['x']}_{r['y']}_{r['w']}x{r['h']}"
                
                sheet_sem = extract_semantics(sheet_name, "unknown", r["w"], r["h"])
                master_catalog["objects"][obj_id] = {
                    "source_type": "sheet_slice",
                    "sheet": sheet_name,
                    "rect": r,
                    "w": r["w"],
                    "h": r["h"],
                    "origin": "bottom",
                    **sheet_sem
                }
        except Exception as e:
            print(f"Error parsing {f}: {e}")
            
    # 2. Ingest the singles directory recursively across all asset packs
    # LimeZu consistently places individual props in folders with 'single' in the name
    
    for singles_dir in assets_dir.rglob("*"):
        dir_name = singles_dir.name.lower()
        if singles_dir.is_dir() and ("single" in dir_name or "animated" in dir_name or "room_builder" in dir_name):
            for png_file in singles_dir.glob("*.png"):
                # Preserve the descriptive name (e.g. Modern_Office_Singles_computer -> modern_office_singles_computer)
                name_stem = png_file.stem
                idx = re.sub(r'[^a-zA-Z0-9]', '_', name_stem).lower()
                # Remove redundant underscores
                idx = re.sub(r'_+', '_', idx).strip('_')
                
                # Try to guess size from path
                size_str = "16x16"
                if "32x32" in str(png_file): size_str = "32x32"
                elif "48x48" in str(png_file): size_str = "48x48"
                
                try:
                    w, h = int(size_str.split('x')[0]), int(size_str.split('x')[1])
                except:
                    w, h = 16, 16 

                # Reconstruct relative URL from the assets dir
                try:
                    rel_path = png_file.relative_to(assets_dir)
                    url_path = f"assets/{rel_path}"
                except ValueError:
                    url_path = str(png_file)

                # Find the actual pack name by looking up from the assets_dir
                try:
                    rel_parts = png_file.relative_to(assets_dir).parts
                    pack_name = re.sub(r'[^a-zA-Z0-9]', '_', rel_parts[0]).lower() if len(rel_parts) > 0 else "unknown"
                except ValueError:
                    pack_name = "unknown"
                obj_id = f"single_{size_str}_{pack_name}_{idx}"
                # extract_semantics using the full relative path
                rel_path_str = str(png_file.relative_to(assets_dir)) if assets_dir in png_file.parents else str(png_file)
                single_sem = extract_semantics(idx, rel_path_str, w, h)
                master_catalog["objects"][obj_id] = {
                    "source_type": "single_file",
                    "url_path": url_path.replace("\\", "/"),
                    "w": w,
                    "h": h,
                    "origin": "bottom",
                    **single_sem
                }
                
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(master_catalog, f, indent=2)
        
    print(f"Master catalog built! Total objects: {len(master_catalog['objects'])}")

if __name__ == "__main__":
    main()
