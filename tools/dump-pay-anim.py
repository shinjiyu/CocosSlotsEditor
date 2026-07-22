import re

p = r'D:\workspace\symbolEditor\res\_lvbu_extract\8ff0c3415858a314fb4fae0d542371c7\asset'
text = open(p, encoding='utf-8', errors='ignore').read()

# 逐条 FloatCurve：以 "- serializedVersion: 2\n    curve:" 开头
entries = re.split(r'\n  - serializedVersion: 2\n    curve:', text)
rows = []
for b in entries[1:]:
    attr = re.search(r'attribute: (\S+)', b)
    path = re.search(r'path: (\S*)', b)
    keys = re.findall(r'time: ([\-\d.e+]+)\n\s+value: ([\-\d.e+]+)', b)
    if not attr:
        continue
    rows.append((path.group(1) if path else '?', attr.group(1), keys))

# 按节点分组打印
from collections import defaultdict
byPath = defaultdict(list)
for pt, a, keys in rows:
    byPath[pt].append((a, keys))

for pt in sorted(byPath):
    print('=====', pt)
    for a, keys in byPath[pt]:
        kv = ' '.join(f'{float(t):.2f}={float(v):.3g}' for t, v in keys[:10])
        print(f'  {a:28s} {kv}')
