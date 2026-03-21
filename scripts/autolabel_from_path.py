"""
autolabel_from_path.py
Generates descriptive ai_name labels for all unlabeled single_file catalog entries
by parsing their folder structure and filename into a human-readable description.

Strategy:
- Strip pack root folders (assets/moderninteriors-win, etc.)
- Clean up trailing folder tokens (Room_Builder_subfiles, etc.)
- Use theme folder names (Kitchen, Bedroom, Office, etc.) as primary noun
- Add size variant (16x16, 32x32, 48x48) as context
- Convert snake case / CamelCase to lowercase words, strip numbers

This handles 48k+ sprites without needing vision analysis.
"""
import json
import re
from pathlib import Path

ROOT    = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
CATALOG = ROOT / "data" / "master_furniture_catalog.json"

# Prefixes/segments to strip from paths before making a label
STRIP_PREFIXES = [
    "assets/moderninteriors-win/1_Interiors/",
    "assets/moderninteriors-win/",
    "assets/modernexteriors-win/Modern_Exteriors_",
    "assets/modernexteriors-win/",
    "assets/Modern_Interiors_RPG_Maker_Version/",
    "assets/Modern_Office_Revamped_v1.2/",
    "assets/",
]

SIZE_TOKENS = {"16x16", "32x32", "48x48"}

# Tokens that are purely structural noise (no semantic value)
NOISE_TOKENS = {
    "room", "builder", "subfiles", "theme", "sorter", "singles",
    "single", "shadow", "black", "v1", "v1.2", "1.2", "interiors",
    "modern", "win", "rpg", "maker", "version", "me", "mo", "1",
    "2", "3", "4", "5", "6", "7", "8", "9", "0",
    "revamped", "pack", "assets", "png", "the",
}

def split_tokens(s: str) -> list:
    """Split a path segment into words, handling CamelCase and snake_case."""
    # Insert space before uppercase letters preceded by lowercase
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    # Split on _, -, spaces, digits used as separators
    tokens = re.split(r'[_\-\s]+', s)
    result = []
    for t in tokens:
        # Further split on digit-letter transitions for things like "16x16"
        sub = re.sub(r'(\d+)', r' \1 ', t).split()
        result.extend(sub)
    return [t.lower().strip() for t in result if t.strip()]

def path_to_label(url_path: str) -> str:
    """Convert a url_path to a human-readable descriptive label."""
    # Normalize slashes
    p = url_path.replace("\\", "/")

    # Strip known prefixes
    for prefix in STRIP_PREFIXES:
        if p.startswith(prefix):
            p = p[len(prefix):]
            break

    # Remove file extension
    p = re.sub(r'\.png$', '', p, flags=re.IGNORECASE)

    # Split into path segments
    parts = p.replace("\\", "/").split("/")

    # Gather all tokens from all parts
    all_tokens = []
    size_token = None
    for part in parts:
        tokens = split_tokens(part)
        for t in tokens:
            if t in SIZE_TOKENS:
                size_token = t
            elif t not in NOISE_TOKENS and not t.isdigit():
                all_tokens.append(t)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for t in all_tokens:
        if t not in seen:
            seen.add(t)
            unique.append(t)

    label_parts = unique[:5]  # Max 5 words
    if size_token:
        label_parts.append(size_token)

    label = " ".join(label_parts).strip()
    return label if label else "office item"

def main():
    print("Loading catalog...")
    with open(CATALOG, 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    updated = 0
    skipped = 0
    for key, obj in catalog["objects"].items():
        if obj.get("source_type") != "single_file":
            continue
        if obj.get("ai_name"):
            skipped += 1
            continue
        url = obj.get("url_path", "")
        if not url:
            continue
        label = path_to_label(url)
        obj["ai_name"] = label
        updated += 1

    print(f"Updated: {updated:,} entries")
    print(f"Skipped (already labeled): {skipped:,}")
    print("Saving catalog...")
    with open(CATALOG, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, indent=2)
    print("Done.")

if __name__ == "__main__":
    main()
