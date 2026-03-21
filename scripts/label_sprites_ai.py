import os
import sys
import json
import time
from pathlib import Path
from tempfile import NamedTemporaryFile

try:
    import google.generativeai as genai
    from PIL import Image
except ImportError:
    print("Error: Missing packages. Please run 'pip install google-generativeai pillow'")
    sys.exit(1)

SHEET_PATHS = {
    "modern_office_black_shadow_grid32": "Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_32x32.png",
    "modern_office_black_shadow_grid48": "Modern_Office_Revamped_v1.2/2_Modern_Office_Black_Shadow/Modern_Office_Black_Shadow_48x48.png",
    "modern_office_16": "Modern_Office_Revamped_v1.2/Modern_Office_16x16.png",
}

def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("\n" + "="*60)
        print("ERROR: Missing GEMINI_API_KEY environment variable.")
        print("To run this AI script, you must provide your Google Gemini API Key.")
        print("In powershell, run:")
        print("  $env:GEMINI_API_KEY=\"your_api_key_here\"")
        print("Then run this script again.")
        print("="*60 + "\n")
        sys.exit(1)

    genai.configure(api_key=api_key)
    # Using gemini-2.5-flash-8b as it is extremely fast and cheap for batch image processing
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    root_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
    catalog_path = root_dir / "data" / "master_furniture_catalog.json"
    
    if not catalog_path.exists():
        print(f"Error: Catalog not found at {catalog_path}")
        sys.exit(1)
        
    with open(catalog_path, 'r', encoding='utf-8') as f:
        catalog = json.load(f)
        
    print("Loaded Master Catalog.")
    
    # We will process BOTH single files and sheet slices from Modern_Office
    assets_dir = root_dir.parent / "pixel game stuff" / "pixel game assets and stuff"
    
    count = 0
    updated = False
    
    sheet_cache = {}
    
    limit = 5 # default dry run limit
    if "--all" in sys.argv:
        limit = 999999
    else:
        print("\n*** DRY RUN MODE (Processing 5 sprites) ***")
        print("To run on all 1,000+ images, pass the --all flag.\n")
    
    for key, data in catalog["objects"].items():
        if "modern_office" in key:
            if "ai_name" in data:
                continue # Already labeled
                
            img = None
            filename = ""
            
            source_type = data.get("source_type", "")
            if source_type == "single_file":
                url_path = data.get("url_path", "")
                if not url_path: continue
                filename = Path(url_path).name
                found_png = list((assets_dir / "Modern_Office_Revamped_v1.2" / "4_Modern_Office_singles").rglob(filename))
                if not found_png: continue
                img_path = found_png[0]
                try:
                    img = Image.open(img_path).convert('RGBA')
                except Exception as e:
                    print(f"Error loading {img_path}: {e}")
                    continue
                    
            elif source_type == "sheet_slice":
                sheet_id = data.get("sheet", "")
                if sheet_id not in SHEET_PATHS:
                    continue
                filename = f"{sheet_id}_{key}.png"
                sheet_rel_path = SHEET_PATHS[sheet_id]
                sheet_full_path = assets_dir / sheet_rel_path
                
                if sheet_full_path not in sheet_cache:
                    if not sheet_full_path.exists():
                        print(f"Warning: Sheet not found {sheet_full_path}")
                        continue
                    sheet_cache[sheet_full_path] = Image.open(sheet_full_path).convert('RGBA')
                    
                full_sheet_img = sheet_cache[sheet_full_path]
                r = data.get("rect", {})
                if not r: continue
                
                # Crop the rect
                crop_box = (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
                img = full_sheet_img.crop(crop_box)
            else:
                continue
                
            if not img:
                continue

            # **CRITICAL CHANGE**: The AI sees a 16x16 image as a blurry mess. 
            # We must explicitly upscale it using Nearest Neighbor so it sees chunky pixels.
            new_w, new_h = img.width * 10, img.height * 10
            img = img.resize((new_w, new_h), Image.Resampling.NEAREST)
            
            max_retries = 5
            retry_delay = 60 # wait a minute
            
            for attempt in range(max_retries):
                try:
                    # Ask Gemini
                    prompt = "Describe this pixel art object from a Modern Office asset pack in 2 to 4 words. For example: 'blue office chair', 'leather sofa', 'desktop PC monitor', 'water cooler', 'potted plant'. Return ONLY the descriptive name, no punctuation, all lowercase."
                    response = model.generate_content([img, prompt])
                    ai_desc = response.text.strip().lower().replace(".", "").replace("\n", "")
                    print(f"Labeled {key} -> '{ai_desc}'")
                    data["ai_name"] = ai_desc
                    updated = True
                    count += 1
                    
                    # Save every 50 to avoid data loss on huge runs
                    if count % 50 == 0:
                        with open(catalog_path, 'w', encoding='utf-8') as f:
                            json.dump(catalog, f, indent=2)
                        print(f"Checkpoint saved ({count} processed).")
                    
                    # wait base delay
                    time.sleep(5)
                    break # success, exit retry loop
                except Exception as e:
                    err_str = str(e)
                    if "429" in err_str or "quota" in err_str.lower():
                        if attempt < max_retries - 1:
                            print(f"Rate limited. Waiting {retry_delay}s before retry {attempt+1}/{max_retries}...")
                            time.sleep(retry_delay)
                            retry_delay *= 2 # exponential backoff
                        else:
                            print(f"Error processing {key}: Rate limit exceeded after {max_retries} retries.")
                            break
                    else:
                        print(f"Error processing {key}: {e}")
                        break
                
            if count >= limit:
                if limit == 5:
                    print("\nReached dry-run limit of 5. Run with --all to process the rest.")
                break

    if updated:
         with open(catalog_path, 'w', encoding='utf-8') as f:
            json.dump(catalog, f, indent=2)
         print(f"\nFinished. Successfully auto-labeled {count} sprites.")
    else:
         print("\nFinished. No un-labeled Modern Office sprites were found.")

if __name__ == "__main__":
    main()
