"""Makes a fake 小红书 note screenshot (iPhone size) around a photo, for the auto-crop tests.
   python test/make-shot.py <photo> <out.jpg> [dark]
Prints the photo's box in the screenshot as x0 y0 x1 y1 (pixels).
(Same file in Lensy/test and Zhongcao/test.)"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1170, 2532


def font(size, bold=False):
    for name in (('msyhbd.ttc' if bold else 'msyh.ttc'), 'simhei.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main(src, out, dark=False):
    bg = (18, 18, 18) if dark else (255, 255, 255)
    ink = (235, 235, 235) if dark else (34, 34, 34)
    grey = (140, 140, 140)
    im = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(im)
    # status bar + note header (back arrow, avatar, name, red follow button, share)
    d.text((90, 40), '9:41', fill=ink, font=font(44, True))
    d.rounded_rectangle([1010, 52, 1100, 92], 10, outline=ink, width=4)
    d.text((40, 190), '‹', fill=ink, font=font(80))
    d.ellipse([110, 180, 200, 270], fill=(214, 160, 140))
    d.text((225, 200), '美瞳日记本', fill=ink, font=font(42))
    d.rounded_rectangle([830, 192, 990, 258], 33, fill=(255, 36, 66))
    d.text((870, 200), '关注', fill=(255, 255, 255), font=font(40))
    d.text((1040, 196), '⤴', fill=ink, font=font(52))
    # the photo, full width, 3:4
    top = 300
    ph = Image.open(src).convert('RGB')
    pw, phh = W, round(W * 4 / 3)
    k = max(pw / ph.width, phh / ph.height)
    ph = ph.resize((round(ph.width * k), round(ph.height * k)), Image.LANCZOS)
    ph = ph.crop(((ph.width - pw) // 2, (ph.height - phh) // 2, (ph.width - pw) // 2 + pw, (ph.height - phh) // 2 + phh))
    im.paste(ph, (0, top))
    d.rounded_rectangle([W - 140, top + 30, W - 40, top + 80], 25, fill=(0, 0, 0))
    d.text((W - 118, top + 32), '1/3', fill=(255, 255, 255), font=font(34))
    bottom = top + phh
    # carousel dots, title, text, tags, date, comment bar
    for i in range(3):
        d.ellipse([545 + i * 30, bottom + 28, 559 + i * 30, bottom + 42], fill=(255, 36, 66) if i == 0 else (210, 210, 210))
    y = bottom + 80
    d.text((40, y), '秋冬混血感美瞳分享｜自然又显大 🤎', fill=ink, font=font(52, True))
    y += 100
    for line in ('姐妹们这款真的绝了！直径14.2，上眼自然不夸张', '日常通勤也可以戴，棕色系很温柔，显眼睛有神', '戴了一整天也不干，敏感眼也可以试试～',
                 '#美瞳推荐 #混血感美瞳 #日抛美瞳 #秋冬美瞳'):
        d.text((40, y), line, fill=ink if not line.startswith('#') else (55, 90, 160), font=font(44))
        y += 76
    d.text((40, y + 10), '11-20 吉隆坡', fill=grey, font=font(36))
    d.line([(40, y + 90), (W - 40, y + 90)], fill=(60, 60, 60) if dark else (238, 238, 238), width=2)
    d.text((40, y + 120), '共 128 条评论', fill=grey, font=font(38))
    d.rounded_rectangle([40, H - 160, 620, H - 80], 40, fill=(40, 40, 40) if dark else (243, 243, 243))
    d.text((80, H - 145), '说点什么...', fill=grey, font=font(40))
    for i, t in enumerate(('♡ 2.1万', '☆ 8964', '💬 128')):
        d.text((660 + i * 170, H - 145), t, fill=ink, font=font(38))
    im.save(out, quality=90)
    print(0, top, W, bottom)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], len(sys.argv) > 3 and sys.argv[3] == 'dark')
