"""Draws the Lensy app icon (a soft pink/lilac iris) at every size the app needs.
Run: python tools/make-icons.py"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw(size):
    s = size * 4  # supersample, then shrink for smooth edges
    img = Image.new('RGB', (s, s))
    px = img.load()
    top, bottom = (252, 225, 236), (226, 214, 248)
    for y in range(s):
        c = lerp(top, bottom, y / s)
        for x in range(s):
            px[x, y] = c
    d = ImageDraw.Draw(img)
    cx = cy = s / 2
    r = s * 0.30
    # iris rings: dark rim -> rose -> lilac -> pupil
    for i in range(60, 0, -1):
        t = i / 60
        rr = r * t
        if t > 0.9:
            col = (150, 80, 110)
        elif t > 0.45:
            col = lerp((205, 160, 230), (232, 128, 160), (t - 0.45) / 0.45)
        else:
            col = (60, 38, 52)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)
    # radial fibres
    for k in range(36):
        a = k * math.pi * 2 / 36
        x1, y1 = cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.5
        x2, y2 = cx + math.cos(a) * r * 0.86, cy + math.sin(a) * r * 0.86
        d.line([x1, y1, x2, y2], fill=(250, 210, 225), width=max(1, s // 160))
    d.ellipse([cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42], fill=(55, 34, 48))
    hl = r * 0.16
    d.ellipse([cx - r * 0.42 - hl, cy - r * 0.5 - hl, cx - r * 0.42 + hl, cy - r * 0.5 + hl], fill=(255, 255, 255))
    d.ellipse([cx + r * 0.25, cy + r * 0.2, cx + r * 0.25 + hl * 0.8, cy + r * 0.2 + hl * 0.8], fill=(255, 240, 246))
    img = img.filter(ImageFilter.GaussianBlur(s / 900))
    return img.resize((size, size), Image.LANCZOS)


for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    draw(size).save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)
