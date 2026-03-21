import json
from pathlib import Path

catalog_path = Path("c:/Users/zionv/OneDrive/Desktop/multbot/pixel-office-game/data/master_furniture_catalog.json")
with open(catalog_path, "r", encoding="utf-8") as f:
    catalog = json.load(f)

count = 0
for key, data in catalog.get("objects", {}).items():
    if "modern_office" in key and "ai_name" in data:
        del data["ai_name"]
        count += 1

if count > 0:
    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"Removed {count} bad AI generated names from Modern Office sprites.")
else:
    print("No bad names found to clean up.")
