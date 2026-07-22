"""把 _lvbu_extract 里全部 eff_lvbu_* 贴图拼成对照表，便于肉眼找目标纹理。"""
import os
import re

from PIL import Image, ImageDraw

SRC = r'D:\workspace\symbolEditor\res\_lvbu_extract'
OUT = r'D:\workspace\symbolEditor\temp\fx-contact-sheet-{}.png'

entries = []
for d in os.listdir(SRC):
    pn = os.path.join(SRC, d, 'pathname')
    asset = os.path.join(SRC, d, 'asset')
    if not (os.path.exists(pn) and os.path.exists(asset)):
        continue
    path = open(pn, encoding='utf-8', errors='ignore').readline().strip()
    m = re.search(r'/(eff_lvbu_(?:mask|noise|glow|smoke|trail|ring|cloud)[^/]*)\.png$', path)
    if m:
        entries.append((m.group(1), asset))

entries.sort()
CELL = 160
COLS = 8
PER_SHEET = 48
for sheet_i in range(0, len(entries), PER_SHEET):
    chunk = entries[sheet_i:sheet_i + PER_SHEET]
    rows = (len(chunk) + COLS - 1) // COLS
    im = Image.new('RGB', (COLS * CELL, rows * (CELL + 18)), (30, 30, 40))
    draw = ImageDraw.Draw(im)
    for i, (name, asset) in enumerate(chunk):
        c, r = i % COLS, i // COLS
        try:
            tex = Image.open(asset).convert('RGBA')
            tex.thumbnail((CELL - 8, CELL - 8))
            # 铺白底看 alpha 形状
            bgim = Image.new('RGBA', tex.size, (0, 0, 0, 255))
            bgim.alpha_composite(tex)
            im.paste(bgim.convert('RGB'), (c * CELL + 4, r * (CELL + 18) + 4))
        except Exception as e:
            draw.text((c * CELL + 4, r * (CELL + 18) + 40), 'ERR', fill=(255, 80, 80))
        draw.text((c * CELL + 4, r * (CELL + 18) + CELL - 8), name[:26], fill=(200, 220, 200))
    out = OUT.format(sheet_i // PER_SHEET)
    im.save(out)
    print('wrote', out, len(chunk))
