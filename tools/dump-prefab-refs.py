"""列出 prefab 引用到的所有 guid 及其 pathname。用法: python dump-prefab-refs.py <prefab-guid>"""
import os
import re
import sys

SRC = r'D:\workspace\symbolEditor\res\_lvbu_extract'
guid = sys.argv[1] if len(sys.argv) > 1 else '1f342a1ca17d69c47ad923e35a6795a5'

text = open(os.path.join(SRC, guid, 'asset'), encoding='utf-8', errors='ignore').read()
refs = sorted(set(re.findall(r'guid: ([0-9a-f]{32})', text)))
for g in refs:
    pn = os.path.join(SRC, g, 'pathname')
    if os.path.exists(pn):
        path = open(pn, encoding='utf-8', errors='ignore').readline().strip()
        print(g, '->', path)
    else:
        print(g, '-> (not in package)')
