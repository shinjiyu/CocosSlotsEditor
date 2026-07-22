"""找出引用指定贴图的所有材质，以及引用这些材质的 prefab。"""
import os
import re
import sys

SRC = r'D:\workspace\symbolEditor\res\_lvbu_extract'

# 先建 guid -> pathname 索引
paths = {}
for d in os.listdir(SRC):
    pn = os.path.join(SRC, d, 'pathname')
    if os.path.exists(pn):
        paths[d] = open(pn, encoding='utf-8', errors='ignore').readline().strip()

# 目标贴图 guid
targets = {g: p for g, p in paths.items() if re.search(r'(noise_xm_10|noise_xm_11|noise_xm_12|zi_0\d)\.png$', p)}
print('target textures:')
for g, p in targets.items():
    print(' ', g, p.split('/')[-1])

# 扫描 .mat
mat_users = {}
for d, p in paths.items():
    if not p.endswith('.mat'):
        continue
    t = open(os.path.join(SRC, d, 'asset'), encoding='utf-8', errors='ignore').read()
    for g in targets:
        if g in t:
            mat_users.setdefault(g, []).append((d, p.split('/')[-1]))

print('\nmaterials using them:')
for g, mats in mat_users.items():
    print(' ', targets[g].split('/')[-1], '<-', [m[1] for m in mats])

# 扫描 prefab 引用这些材质
allmats = {m[0] for mats in mat_users.values() for m in mats}
print('\nprefabs using those materials:')
for d, p in paths.items():
    if not p.endswith('.prefab'):
        continue
    t = open(os.path.join(SRC, d, 'asset'), encoding='utf-8', errors='ignore').read()
    hit = [paths[m].split('/')[-1] for m in allmats if m in t]
    if hit:
        print(' ', p.split('/')[-1], '<-', hit)
