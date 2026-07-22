# -*- coding: utf-8 -*-
"""Render contact sheets of the LvBu static export for visual review."""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, 'assets/resources/spine-4.2/packs/lvbu/static')
OUT_DIR = os.path.join(ROOT, 'temp/contact-sheets')

CHECKER = (58, 58, 66), (74, 74, 84)
BG = (32, 32, 38)
LABEL = (235, 235, 235)
SUB = (150, 200, 255)


def font(size):
    for name in ('consola.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_MAIN = font(18)
F_SUB = font(15)


def checker(w, h, cell=16):
    img = Image.new('RGB', (w, h), CHECKER[0])
    d = ImageDraw.Draw(img)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=CHECKER[1])
    return img


def sheet(title, items, per_row, tile_w, tile_h, out_name):
    """items: list of (path, label)"""
    pad, label_h, title_h = 14, 44, 44
    rows = math.ceil(len(items) / per_row)
    W = pad + per_row * (tile_w + pad)
    H = title_h + pad + rows * (tile_h + label_h + pad)
    canvas = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(canvas)
    d.text((pad, 12), title, font=F_MAIN, fill=(255, 210, 120))
    for i, (p, label) in enumerate(items):
        r, c = divmod(i, per_row)
        x = pad + c * (tile_w + pad)
        y = title_h + pad + r * (tile_h + label_h + pad)
        tile = checker(tile_w, tile_h)
        img = Image.open(p).convert('RGBA')
        s = min(tile_w / img.width, tile_h / img.height, 1.0)
        img2 = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
        tile.paste(img2, ((tile_w - img2.width) // 2, (tile_h - img2.height) // 2), img2)
        canvas.paste(tile, (x, y))
        kb = os.path.getsize(p) / 1024
        d.text((x + 2, y + tile_h + 4), label, font=F_MAIN, fill=LABEL)
        d.text((x + 2, y + tile_h + 24), f'{img.width}x{img.height}  {kb:.0f}KB', font=F_SUB, fill=SUB)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, out_name)
    canvas.save(out)
    print(out)


def p(rel):
    return os.path.join(STATIC, rel)


manifest = json.load(open(p('manifest.json'), encoding='utf-8'))

# --- Sheet 1: 17 canonical symbols ---
sym_items = []
for s in manifest['symbols']:
    rel = s['output'].split('static/')[-1]
    sym_items.append((p(rel), f"{s['id']:02d} {s['name']}"))
sheet('LvBu canonical symbols (17) - tallest tier, 1 asset per logical symbol',
      sym_items, per_row=6, tile_w=170, tile_h=238, out_name='sheet-1-symbols.png')

# --- Sheet 2: bonus orientations ---
bonus = [(p('symbols/01-bonus.png'), 'icon_1_1 vertical (canonical)'),
         (p('symbols/01-bonus-horizontal.png'), 'icon_1 horizontal'),
         (p('symbols/01-bonus-horizontal-wide.png'), 'icon_1_2 horizontal wide')]
sheet('Bonus orientations - vertical cells vs wide / top-strip placement',
      bonus, per_row=3, tile_w=300, tile_h=240, out_name='sheet-2-bonus.png')

# --- Sheet 3: low-symbol composition parts (panel + letters) ---
comp = [(p('background/symbol-bg-9slice.png'), 'symbol-bg (shared panel)'),
        (p('frame/symbol-frame-9slice.png'), 'symbol-frame (effect)')]
for L in ('A', 'K', 'Q', 'J', '10', '9'):
    comp.append((p(f'letter/letter-{L}.png'), f'letter-{L}'))
sheet('Low-symbol composition: 1 shared panel + 6 letters (prefab panel+letter)',
      comp, per_row=4, tile_w=190, tile_h=250, out_name='sheet-3-composition.png')

# --- Sheet 4: dissolve masks ---
dis = [(p(f'dissolve/{n}.png'), n) for n in
       ('dissolve-cloud', 'dissolve-cells', 'dissolve-turbulence', 'dissolve-fire')]
sheet('Dissolve masks (shared Sprite dissolve shader) - cloud is the active one',
      dis, per_row=4, tile_w=210, tile_h=210, out_name='sheet-4-dissolve.png')
