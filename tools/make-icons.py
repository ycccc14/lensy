"""Draws the Lensy app icon: a cute contact-lens case (pink L cap, lilac R cap) with sparkles.
Run: python tools/make-icons.py   (writes icons/*.png)"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)
FONT = next((f for f in ['C:/Windows/Fonts/seguisb.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/SFNSRounded.ttf'] if os.path.exists(f)), None)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(s, c1, c2):
    img = Image.new('RGB', (s, s))
    px = img.load()
    for y in range(s):
        for x in range(s):
            px[x, y] = lerp(c1, c2, (x + y) / (2 * s))
    return img


def sparkle(d, cx, cy, r, col):
    pts = []
    for k in range(8):
        a = k * math.pi / 4 - math.pi / 2
        rr = r if k % 2 == 0 else r * 0.28
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=col)


def cap(img, cx, cy, r, base, letter):
    d = ImageDraw.Draw(img)
    # grip ridges around the edge
    ridge = lerp(base, (0, 0, 0), 0.12)
    for k in range(28):
        a = k * 2 * math.pi / 28
        x, y = cx + math.cos(a) * r * 0.98, cy + math.sin(a) * r * 0.98
        w = r * 0.07
        d.ellipse([x - w, y - w, x + w, y + w], fill=ridge)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=lerp(base, (0, 0, 0), 0.08))
    d.ellipse([cx - r * 0.9, cy - r * 0.9, cx + r * 0.9, cy + r * 0.9], fill=base)
    # soft top highlight
    hl = Image.new('L', img.size, 0)
    hd = ImageDraw.Draw(hl)
    hd.ellipse([cx - r * 0.62, cy - r * 0.8, cx + r * 0.2, cy - r * 0.25], fill=120)
    hl = hl.filter(ImageFilter.GaussianBlur(r * 0.12))
    img.paste((255, 255, 255), (0, 0), hl)
    if FONT:
        f = ImageFont.truetype(FONT, int(r * 1.05))
        d.text((cx, cy + r * 0.04), letter, font=f, fill=(255, 255, 255), anchor='mm')


def draw(size, pad=0.0):
    s = size * 4  # supersample for smooth edges
    img = gradient(s, (253, 232, 241), (229, 220, 251))
    k = 1 - pad * 2  # shrink content for maskable safe zone
    c = s / 2
    def P(v):
        return c + (v - 0.5) * s * k
    # shadow
    sh = Image.new('L', (s, s), 0)
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([P(0.14), P(0.40), P(0.86), P(0.72)], radius=s * k * 0.16, fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(s * 0.03))
    img.paste((190, 140, 175), (0, int(s * 0.02)), sh)
    d = ImageDraw.Draw(img)
    # case body (white stadium)
    d.rounded_rectangle([P(0.13), P(0.37), P(0.87), P(0.69)], radius=s * k * 0.16, fill=(255, 255, 255))
    d.rounded_rectangle([P(0.13), P(0.37), P(0.87), P(0.69)], radius=s * k * 0.16, outline=(240, 222, 234), width=int(s * 0.006))
    r = s * k * 0.155
    cap(img, P(0.315), P(0.515), r, (241, 140, 176), 'L')
    cap(img, P(0.685), P(0.515), r, (170, 145, 226), 'R')
    d = ImageDraw.Draw(img)
    sparkle(d, P(0.78), P(0.2), s * k * 0.075, (255, 255, 255))
    sparkle(d, P(0.66), P(0.13), s * k * 0.035, (255, 255, 255))
    sparkle(d, P(0.2), P(0.82), s * k * 0.045, (255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


for name, size, pad in [('icon-192.png', 192, 0), ('icon-512.png', 512, 0), ('apple-touch-icon.png', 180, 0), ('maskable-512.png', 512, 0.08)]:
    draw(size, pad).save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)
