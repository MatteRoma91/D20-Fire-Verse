#!/usr/bin/env python3
"""Render the Fire TV launcher art from the game's own artwork: banner, app icons and splash mark.

Needs Pillow and fontTools (to read the Cinzel web font the TV already ships):
    pip install pillow fonttools
Run from the repository root:
    python3 firetv/scripts/make-launcher-art.py
"""

import math
import os
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "firetv" / "app" / "src" / "main" / "res"
ART = ROOT / "tv" / "public" / "art" / "home.png"
FONT_WOFF = ROOT / "node_modules" / "@fontsource" / "cinzel" / "files" / "cinzel-latin-700-normal.woff"
FONT_TTF = ROOT / "firetv" / "app" / "src" / "main" / "assets" / "fonts" / "Cinzel-Bold.ttf"

GOLD = (241, 196, 107)
GOLD_DEEP = (176, 118, 44)
EMBER = (196, 98, 45)
NIGHT = (12, 9, 6)
INK = (246, 234, 214)


def cinzel(size: int) -> ImageFont.FreeTypeFont:
    if not FONT_TTF.exists():
        font = TTFont(str(FONT_WOFF))
        font.flavor = None
        FONT_TTF.parent.mkdir(parents=True, exist_ok=True)
        font.save(str(FONT_TTF))
    return ImageFont.truetype(str(FONT_TTF), size)


def d20(size: int, *, background: bool) -> Image.Image:
    """A gold icosahedron seen face-on, with a 20 on its front face."""
    s = size * 4
    img = Image.new("RGBA", (s, s), NIGHT + (255,) if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = s / 2, s / 2
    if background:
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([s * 0.12, s * 0.12, s * 0.88, s * 0.88], fill=EMBER + (150,))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(s * 0.12)))
    r = s * (0.36 if background else 0.46)
    hexagon = [(cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a))) for a in range(0, 360, 60)]
    inner_r = r * 0.56
    tri = [(cx + inner_r * math.sin(math.radians(a)), cy - inner_r * math.cos(math.radians(a)) + r * 0.06) for a in (0, 120, 240)]
    draw.polygon(hexagon, fill=(38, 26, 14, 255))
    shades = [(96, 64, 30), (70, 46, 22), (122, 82, 38), (58, 38, 18), (104, 70, 32), (84, 56, 26)]
    for i in range(6):
        a, b = hexagon[i], hexagon[(i + 1) % 6]
        t = tri[((i + 1) // 2) % 3]
        draw.polygon([a, b, t], fill=shades[i] + (255,))
    for i in range(3):
        a, b = tri[i], tri[(i + 1) % 3]
        v = hexagon[(2 * i + 1) % 6]
        draw.polygon([a, b, v], fill=(140, 94, 42, 255))
    draw.polygon(tri, fill=GOLD + (255,))
    line = max(2, int(s * 0.012))
    for i in range(6):
        draw.line([hexagon[i], hexagon[(i + 1) % 6]], fill=GOLD + (255,), width=line * 2)
        draw.line([hexagon[i], tri[(i // 2 + (i % 2)) % 3]], fill=GOLD + (230,), width=line)
    for i in range(3):
        draw.line([tri[i], tri[(i + 1) % 3]], fill=GOLD_DEEP + (255,), width=line)
    font = cinzel(int(inner_r * 0.62))
    box = draw.textbbox((0, 0), "20", font=font)
    tx = cx - (box[2] - box[0]) / 2 - box[0]
    ty = cy + r * 0.06 - (box[3] - box[1]) / 2 - box[1] + inner_r * 0.1
    draw.text((tx, ty), "20", font=font, fill=NIGHT + (255,))
    return img.resize((size, size), Image.LANCZOS)


def banner(width: int, height: int) -> Image.Image:
    art = Image.open(ART).convert("RGB")
    scale = max(width / art.width, height / art.height)
    art = art.resize((math.ceil(art.width * scale), math.ceil(art.height * scale)), Image.LANCZOS)
    left = (art.width - width) // 2
    top = (art.height - height) // 2
    img = art.crop((left, top, left + width, top + height)).convert("RGBA")
    shade = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(height):
        k = y / height
        sd.line([(0, y), (width, y)], fill=NIGHT + (int(90 + 150 * k * k),))
    img.alpha_composite(shade)
    mark_size = int(height * 0.4)
    mark = d20(mark_size, background=False)
    margin = int(width * 0.05)
    img.alpha_composite(mark, (margin, height - mark_size - int(height * 0.08)))
    draw = ImageDraw.Draw(img)
    x = margin + mark_size + int(width * 0.03)
    room = width - x - margin
    size = int(height * 0.2)
    while size > 8 and draw.textlength("D20 FireVerse", font=cinzel(size)) > room:
        size -= 1
    title = cinzel(size)
    small = cinzel(max(8, int(size * 0.42)))
    base = height - int(height * 0.08) - int(mark_size * 0.5)
    draw.text((x + 2, base - size + 2), "D20 FireVerse", font=title, fill=(0, 0, 0, 200))
    draw.text((x, base - size), "D20 FireVerse", font=title, fill=INK)
    draw.text((x + 1, base + int(size * 0.3)), "LUPPOLANDIA", font=small, fill=GOLD)
    return img.convert("RGB")


def main() -> None:
    (RES / "drawable-xhdpi").mkdir(parents=True, exist_ok=True)
    banner(320, 180).save(RES / "drawable-xhdpi" / "banner.png", optimize=True)
    for density, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        d20(px, background=True).save(folder / "ic_launcher.png", optimize=True)
    foreground = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    foreground.alpha_composite(d20(260, background=False), (86, 86))
    (RES / "drawable-nodpi").mkdir(parents=True, exist_ok=True)
    foreground.save(RES / "drawable-nodpi" / "ic_launcher_foreground.png", optimize=True)
    d20(440, background=False).save(RES / "drawable-nodpi" / "splash_mark.png", optimize=True)
    store = ROOT / "firetv" / "store"
    store.mkdir(exist_ok=True)
    banner(1280, 720).save(store / "banner-1280x720.png", optimize=True)
    d20(512, background=True).save(store / "icon-512.png", optimize=True)
    print("Launcher art written to", os.path.relpath(RES, ROOT))


if __name__ == "__main__":
    main()
