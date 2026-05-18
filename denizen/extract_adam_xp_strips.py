from pathlib import Path

from PIL import Image


def extract_strips():
  """
  Extract clean 16x32 directional strips from the padded RPG Maker XP Adam.png.

  Input:
    Modern_Interiors_RPG_Maker_Version/Modern_Interiors_RPG_Maker_Version/RPG_MAKER_XP/Characters/Adam.png

  Output (same folder):
    Adam_walk_down_16x32.png
    Adam_walk_left_16x32.png
    Adam_walk_right_16x32.png
    Adam_walk_up_16x32.png

  Assumptions (standard XP-style layout used by LimeZu):
    - Each animation frame is 48x32 pixels.
    - Frames are arranged 4 columns (frames) x 4 rows (directions).
    - Row 0 = down, 1 = left, 2 = right, 3 = up.
    - The actual character is a 16x32 sprite centered horizontally inside each 48x32 frame.
  """

  project_root = Path(__file__).resolve().parents[1]
  adam_path = project_root / "pixel game stuff" / "pixel game assets and stuff" / \
    "Modern_Interiors_RPG_Maker_Version" / "Modern_Interiors_RPG_Maker_Version" / \
    "RPG_MAKER_XP" / "Characters" / "Adam.png"

  if not adam_path.exists():
    raise FileNotFoundError(f"Could not find Adam.png at: {adam_path}")

  img = Image.open(adam_path).convert("RGBA")
  sheet_w, sheet_h = img.size

  # Try to detect the actual layout of Adam.png.
  # Some XP sheets are 4x4 of 48x32, others are 3x4 of 32x48 (classic 3‑frame walk).

  # Option A: 4x4 of 48x32 (what we first assumed)
  cols_48 = sheet_w // 48
  rows_32 = sheet_h // 32

  # Option B: 3x4 or 4x4 of 32x48 (classic XP single character variants)
  cols_32 = sheet_w // 32
  rows_48 = sheet_h // 48

  if cols_48 >= 4 and rows_32 >= 4:
    # 4x4 of 48x32
    frame_w = 48
    frame_h = 32
    cols = 4
    rows = 4
    frames_per_row = 4
    target_w = 16
    target_h = 32
    offset_x = (frame_w - target_w) // 2  # 16px padding each side
    offset_y = 0
  elif rows_48 == 4 and cols_32 in (3, 4):
    # 3x4 or 4x4 of 32x48 (3 or 4 walking frames per direction, four directions)
    # Here we will SCALE each 32x48 frame down to 16x32, instead of cropping,
    # so we preserve the full body proportions and avoid chopped arms/feet.
    frame_w = 32
    frame_h = 48
    cols = cols_32
    rows = 4
    frames_per_row = cols_32
    target_w = 16
    target_h = 32
    # No crop offsets needed for this layout; we resize whole frames.
    offset_x = 0
    offset_y = 0
  else:
    raise ValueError(
      f"Unexpected Adam.png layout. Got size {sheet_w}x{sheet_h}. "
      f"Computed (cols_48={cols_48}, rows_32={rows_32}) for 48x32 and "
      f"(cols_32={cols_32}, rows_48={rows_48}) for 32x48. "
      "Expected either 4x4 of 48x32 or 3x4 of 32x48."
    )

  # We only use the first 4 rows:
  # row 0 = down, 1 = left, 2 = right, 3 = up
  dir_map = {
    0: "down",
    1: "left",
    2: "right",
    3: "up",
  }

  out_dir = adam_path.parent

  for row_idx in range(4):
    direction = dir_map[row_idx]

    # Create a new strip image: frames_per_row frames horizontally, 16x32 each.
    strip = Image.new("RGBA", (target_w * frames_per_row, target_h))

    for col_idx in range(frames_per_row):
      src_x = col_idx * frame_w + offset_x
      src_y = row_idx * frame_h + offset_y
      box = (src_x, src_y, src_x + frame_w, src_y + frame_h)
      frame = img.crop(box)

      # If the source frame is larger than our target (e.g. 32x48),
      # scale it down to 16x32 so it matches the size of the side-view strips.
      if frame.size != (target_w, target_h):
        frame = frame.resize((target_w, target_h), Image.NEAREST)

      dst_x = col_idx * target_w
      dst_y = 0
      strip.paste(frame, (dst_x, dst_y))

    out_path = out_dir / f"Adam_walk_{direction}_16x32.png"
    strip.save(out_path)
    print(f"Saved {out_path}")


if __name__ == "__main__":
  extract_strips()

