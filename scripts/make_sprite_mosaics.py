"""
make_sprite_mosaics.py
Creates contact-sheet mosaic images from Modern Office singles PNGs
so they can be visually analyzed and labeled.

Output: out/mosaics/mosaic_NNNN.png (one PNG per batch of COLS x ROWS sprites)
"""
import os
import sys
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ── Config ──────────────────────────────────────────────────────────────────
SINGLES_DIR = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\4_Modern_Office_singles")
OUT_DIR = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game\out\mosaics")

# Only label the 32x32 size — best balance of detail vs speed
SIZE_FOLDER = "32x32"

THUMB = 64          # display size per cell (square)
COLS  = 10          # sprites per row
LABEL_H = 14        # pixels for the filename label below each cell
BG    = (30, 30, 40)
BORDER= (60, 60, 80)
TEXT  = (220, 220, 220)
BATCH = COLS * 6    # 60 sprites per mosaic sheet

# ── Gather files ──────────────────────────────────────────────────────────
def gather(size_folder):
    folder = SINGLES_DIR / size_folder
    files = sorted(folder.glob("*.png"), key=lambda p: int(''.join(filter(str.isdigit, p.stem)) or '0'))
    return files

# ── Build a single mosaic ─────────────────────────────────────────────────
def make_mosaic(files, out_path, offset):
    rows = (len(files) + COLS - 1) // COLS
    cell_h = THUMB + LABEL_H
    cell_w = THUMB
    W = COLS * cell_w
    H = rows * cell_h

    img = Image.new("RGBA", (W, H), BG + (255,))
    draw = ImageDraw.Draw(img)

    for i, f in enumerate(files):
        col = i % COLS
        row = i // COLS
        x = col * cell_w
        y = row * cell_h

        # Draw sprite
        try:
            sp = Image.open(f).convert("RGBA")
            scale = min(THUMB / sp.width, THUMB / sp.height)
            nw = max(1, int(sp.width * scale))
            nh = max(1, int(sp.height * scale))
            sp = sp.resize((nw, nh), Image.NEAREST)
            px = x + (THUMB - nw) // 2
            py = y + (THUMB - nh) // 2
            img.paste(sp, (px, py), sp)
        except Exception as e:
            pass  # blank cell for broken files

        # Border
        draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], outline=BORDER)

        # Label: index number (for referencing in descriptions)
        label = str(offset + i + 1)  # global 1-indexed number
        draw.text((x + 2, y + THUMB + 1), label, fill=TEXT)

    img.save(out_path, "PNG")
    print(f"  Written: {out_path}  ({len(files)} sprites, starting at #{offset+1})")

# ── Index map: number → filename ──────────────────────────────────────────
def save_index(files, out_path):
    idx = {str(i + 1): f.name for i, f in enumerate(files)}
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(idx, fh, indent=2)
    print(f"  Index written: {out_path}")

# ── Main ─────────────────────────────────────────────────────────────────
def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    files = gather(SIZE_FOLDER)
    print(f"Found {len(files)} sprites in {SIZE_FOLDER}.")

    # Save full index
    save_index(files, OUT_DIR / "sprite_index.json")

    # Build mosaics in batches
    for batch_start in range(0, len(files), BATCH):
        batch = files[batch_start:batch_start + BATCH]
        batch_num = batch_start // BATCH
        out_path = OUT_DIR / f"mosaic_{batch_num:04d}.png"
        make_mosaic(batch, out_path, offset=batch_start)

    print(f"\nAll done! {((len(files) - 1) // BATCH) + 1} mosaic sheets created in {OUT_DIR}")

if __name__ == "__main__":
    main()
