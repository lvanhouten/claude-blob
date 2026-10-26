"""Draws the app icon from the frame icon.js renders, into assets/.

The icon is a flat version of the blob, so it stays readable at tray size: his
silhouette with a dark outline, the cream/orange split traced from the
render's lighting, and eyes drawn larger than his real ones.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FRAME = ROOT / "docs" / "frames" / "icon.png"
ASSETS = ROOT / "assets"
N = 1024  # drawing size; every output is scaled down from it
CREAM = (255, 220, 156, 255)
ORANGE = (255, 134, 66, 255)
OUTLINE = (74, 40, 22, 255)
EYE = (13, 7, 5, 255)
# Green separates the two tones: about 210 lit, 139 in shade.
SHADE_BELOW = 175
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def binary(im, cut=128):
    return im.point(lambda v: 255 if v > cut else 0)


def main():
    src = Image.open(FRAME).convert("RGBA")
    # Filter sizes below are tuned for a 1200px-wide frame.
    src = src.resize((src.width * 2, src.height * 2), Image.LANCZOS)
    body = src.getchannel("A").point(lambda v: 255 if v > 200 else 0)  # without the contact shadow
    x0, y0, x1, y1 = body.getbbox()

    # Eye centers: the darkest opaque pixels on each side of his middle.
    rgba = np.asarray(src)
    dark = (rgba[..., 3] > 250) & (rgba[..., :3].astype(int).sum(-1) < 90)
    ys, xs = np.nonzero(dark)
    mid = (x0 + x1) / 2
    eyes = [(xs[m].mean(), ys[m].mean()) for m in (xs < mid, xs >= mid)]

    # Shade side: split on green, with the halftone dots filtered out and the
    # blur weighted by alpha so the transparent surround doesn't darken the edges.
    green = src.getchannel("G").filter(ImageFilter.MedianFilter(9))
    weight = np.asarray(body, dtype=np.float32) / 255
    blur = lambda a: np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(10)), dtype=np.float32)
    level = blur((np.asarray(green) * weight).astype(np.uint8)) / np.maximum(blur((weight * 255).astype(np.uint8)), 1) * 255
    shade = Image.fromarray(np.where(level < SHADE_BELOW, 255, 0).astype(np.uint8))

    # Square crop with some margin, scaled to the drawing size.
    side = max(x1 - x0, y1 - y0)
    h = side / 2 + side * 0.1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (int(cx - h), int(cy - h), int(cx + h), int(cy + h))
    k = N / (box[2] - box[0])
    fit = lambda m, r: binary(m.crop(box).resize((N, N), Image.LANCZOS).filter(ImageFilter.GaussianBlur(r)))
    mask = fit(body, 6)
    shade = fit(shade, 14)
    eyes = [((ex - box[0]) * k, (ey - box[1]) * k) for ex, ey in eyes]

    # Lit side: the main cream region only. Opening drops the render's thin
    # edge light, the flood fill drops gloss specks, and growing it back over
    # the raw lit area restores the arm tip and foot edges the opening trimmed.
    raw = ImageChops.multiply(mask, ImageChops.invert(shade))
    lit = ImageChops.multiply(raw.filter(ImageFilter.MinFilter(41)).filter(ImageFilter.MaxFilter(41)), mask)
    ImageDraw.floodfill(lit, (int(eyes[0][0] - N * 0.12), int(eyes[0][1])), 128)
    lit = lit.point(lambda v: 255 if v == 128 else 0)
    lit = ImageChops.multiply(lit.filter(ImageFilter.MaxFilter(45)), raw)

    icon = Image.new("RGBA", (N, N))
    icon.paste(OUTLINE, (0, 0), mask.filter(ImageFilter.MaxFilter(45)))
    icon.paste(ORANGE, (0, 0), mask)
    icon.paste(CREAM, (0, 0), lit)
    draw = ImageDraw.Draw(icon)
    rx, ry = N * 0.06, N * 0.095
    for ex, ey in eyes:
        draw.ellipse((ex - rx, ey - ry, ex + rx, ey + ry), fill=EYE)
        sx, sy, sr = ex - rx * 0.55, ey - ry * 0.7, rx * 0.7
        draw.ellipse((sx, sy, sx + sr, sy + sr), fill=(255, 255, 255, 255))

    ASSETS.mkdir(exist_ok=True)
    scaled = {s: icon.resize((s, s), Image.LANCZOS) for s in ICO_SIZES}
    scaled[256].save(ASSETS / "icon.ico", sizes=[(s, s) for s in ICO_SIZES],
                     append_images=[scaled[s] for s in ICO_SIZES[:-1]])
    # Electron picks tray@2x.png on high-DPI screens.
    scaled[16].save(ASSETS / "tray.png")
    scaled[32].save(ASSETS / "tray@2x.png")
    print(f"wrote {', '.join(p.name for p in sorted(ASSETS.iterdir()))}")


if __name__ == "__main__":
    main()
