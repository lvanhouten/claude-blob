"""Turns the frames from capture.js into looping animated WebPs in docs/media.

WebP rather than GIF: the halftone shimmer defeats GIF compression, and WebP
keeps full color at about a third of the size.
"""
import sys
from pathlib import Path

from PIL import Image

FPS = 25
QUALITY = 80
ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / "frames"
MEDIA = ROOT / "docs" / "media"

if __name__ == "__main__":
    MEDIA.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for d in sorted(FRAMES.iterdir()):
        if not d.is_dir() or (only and d.name not in only):
            continue
        frames = [Image.open(p).convert("RGB") for p in sorted(d.glob("*.png"))]
        out = MEDIA / f"{d.name}.webp"
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=1000 // FPS,
                       loop=0, quality=QUALITY, method=6)
        print(f"{out.name}: {out.stat().st_size / 1024:.0f} KB")
