"""Turns the frames from capture.js into looping animated WebPs in docs/media.

WebP rather than GIF: the halftone shimmer defeats GIF compression, and WebP
keeps full color and alpha at about a third of the size. Each clip is encoded
in its own process, since the encoder is slow and runs on one core.
"""
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

FPS = 25
QUALITY = 80
# 6 squeezes out ~10% more but takes minutes per clip instead of seconds.
METHOD = 4
ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / "frames"
MEDIA = ROOT / "docs" / "media"


def encode(d: Path) -> str:
    frames = [Image.open(p).convert("RGBA") for p in sorted(d.glob("*.png"))]
    out = MEDIA / f"{d.name}.webp"
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=1000 // FPS,
                   loop=0, quality=QUALITY, method=METHOD)
    return f"{out.name}: {out.stat().st_size / 1024:.0f} KB"


if __name__ == "__main__":
    MEDIA.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    dirs = [d for d in sorted(FRAMES.iterdir()) if d.is_dir() and (not only or d.name in only)]
    with ProcessPoolExecutor() as pool:
        for line in pool.map(encode, dirs):
            print(line)
