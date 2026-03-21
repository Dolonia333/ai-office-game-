import os
import json
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow is not installed. Please run 'pip install pillow'")
    exit(1)

def main():
    root_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel-office-game")
    assets_dir = Path(r"c:\Users\zionv\OneDrive\Desktop\multbot\pixel game stuff\pixel game assets and stuff\Modern_Office_Revamped_v1.2\4_Modern_Office_singles")
    out_file = root_dir / "data" / "bad_crops_report.html"
    
    if not assets_dir.exists():
        print(f"Error: Directory not found - {assets_dir}")
        return

    # Look for both singles and main sheets
    png_files = list(assets_dir.rglob("*.png"))
    
    flagged_sprites = []
    
    print(f"Scanning {len(png_files)} Modern Office PNG files for bad crops...")
    
    for filepath in png_files:
        try:
            with Image.open(filepath) as img:
                # We only care about images with an alpha channel
                if img.mode not in ('RGBA', 'LA') and 'transparency' not in img.info:
                    img = img.convert('RGBA')
                    
                # getbbox() returns the bounding box of non-zero alpha in (left, upper, right, lower)
                # If the image is entirely transparent, it returns None
                bbox = img.getbbox()
                
                width, height = img.size
                
                # Exclude huge tilesheets as they naturally touch the edges
                if width > 64 or height > 64:
                    continue
                    
                if bbox is None:
                    # 100% transparent image anomaly
                    flagged_sprites.append({
                        "file": filepath.name,
                        "path": str(filepath.relative_to(assets_dir.parent)),
                        "reason": "100% Transparent (Empty Image)",
                        "size": f"{width}x{height}"
                    })
                    continue
                
                left, upper, right, lower = bbox
                
                # Check if the non-transparent pixels touch the absolute borders
                touches_left = (left == 0)
                touches_top = (upper == 0)
                touches_right = (right == width)
                touches_bottom = (lower == height)
                
                edges_touched = []
                if touches_left: edges_touched.append("Left")
                if touches_top: edges_touched.append("Top")
                if touches_right: edges_touched.append("Right")
                if touches_bottom: edges_touched.append("Bottom")
                
                if edges_touched:
                    # Single items shouldn't usually touch top/left/right. Bottom is okay for shadows planting on floor.
                    if len(edges_touched) > 1 or (len(edges_touched) == 1 and "Bottom" not in edges_touched):
                        # Since the HTTP server is running in "multbot", the path from the HTTP server root needs to be "/pixel game stuff/..."
                        rel_path = filepath.relative_to(assets_dir.parent.parent)
                        flagged_sprites.append({
                            "file": filepath.name,
                            "path": f"/pixel game stuff/pixel game assets and stuff/{str(rel_path)}".replace("\\", "/"),
                            "reason": f"Cut Off Warning! Touches edges: {', '.join(edges_touched)}",
                            "size": f"{width}x{height}"
                        })

        except Exception as e:
            print(f"Error analyzing {filepath.name}: {e}")

    # Generate HTML report
    html_content = [
        "<html>",
        "<head>",
        "<style>",
        "body { font-family: sans-serif; background: #1e1e1e; color: #fff; padding: 20px; }",
        "h1 { color: #ff5555; }",
        ".grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; }",
        ".card { background: #2d2d2d; padding: 10px; border-radius: 8px; text-align: center; }",
        ".card img { max-width: 64px; max-height: 64px; image-rendering: pixelated; background: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAAXNSR0IArs4c6QAAACVJREFUKFNjZCASMDKhuwoKCv7//08WJjEah8NgOAwmk5mwsBwA0gMf6o/m8M4AAAAASUVORK5CYII='); }",
        ".reason { color: #ffaa00; font-size: 12px; margin-top: 10px; }",
        ".name { font-size: 10px; word-break: break-all; margin-top: 5px; color: #aaa; }",
        "</style>",
        "</head>",
        "<body>",
        f"<h1>Anomaly Report: Bad Crops in Modern Office ({len(flagged_sprites)} found)</h1>",
        "<p>This script scans for individual single sprites where the colored pixels touch the absolute file borders, indicating the artist may have sliced the image too tightly and 'cut off' part of the drawing.</p>",
        "<div class='grid'>"
    ]
    
    for sprite in flagged_sprites:
        # Resolve path so HTML can display it relative to pixel-office-game directory where it will be hosted
        html_content.append(f"<div class='card'>")
        html_content.append(f"<img src='{sprite['path']}' alt='{sprite['file']}'>")
        html_content.append(f"<div class='reason'>{sprite['reason']}</div>")
        html_content.append(f"<div class='name'>{sprite['file']} ({sprite['size']})</div>")
        html_content.append(f"</div>")
        
    html_content.append("</div>")
    html_content.append("</body></html>")
    
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write("\n".join(html_content))
        
    print(f"\nAnalysis complete! Found {len(flagged_sprites)} potential anomalies.")
    print(f"Report saved to: {out_file}")

if __name__ == "__main__":
    main()
