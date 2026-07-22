"""列出 item prefab 每个节点用的 sprite / material / mesh。"""
import os
import re
import sys

SRC = r'D:\workspace\symbolEditor\res\_lvbu_extract'
guid = sys.argv[1] if len(sys.argv) > 1 else '1f342a1ca17d69c47ad923e35a6795a5'
text = open(os.path.join(SRC, guid, 'asset'), encoding='utf-8', errors='ignore').read()

docs = re.split(r'--- !u!(\d+) &(-?\d+)', text)
objs = {}
for i in range(1, len(docs) - 2, 3):
    objs[docs[i + 1]] = (docs[i], docs[i + 2])

def pathname(g):
    pn = os.path.join(SRC, g, 'pathname')
    if os.path.exists(pn):
        return open(pn, encoding='utf-8', errors='ignore').readline().strip().split('/')[-1]
    return '(missing)'

names = {}
for fid, (cid, body) in objs.items():
    if cid == '1':
        m = re.search(r'm_Name: (.+)', body)
        names[fid] = m.group(1).strip() if m else '?'

for fid, (cid, body) in objs.items():
    if cid != '1':
        continue
    comps = re.findall(r'component: \{fileID: (-?\d+)\}', body)
    lines = []
    for c in comps:
        if c not in objs:
            continue
        ccid, cbody = objs[c]
        sprite = re.search(r'm_Sprite: \{fileID: (-?\d+), guid: ([0-9a-f]+)', cbody)
        mats = re.findall(r'- \{fileID: \d+, guid: ([0-9a-f]+)', cbody[:cbody.find('m_Materials') + 400] if 'm_Materials' in cbody else '')
        mat = re.search(r'm_Material: \{fileID: \d+, guid: ([0-9a-f]+)', cbody)
        mesh = re.search(r'm_Mesh: \{fileID: \d+, guid: ([0-9a-f]+)', cbody)
        info = []
        if sprite:
            info.append(f'sprite={pathname(sprite.group(2))}#{sprite.group(1)}')
        if mat:
            info.append(f'mat={pathname(mat.group(1))}')
        for mg in mats:
            info.append(f'psMat={pathname(mg)}')
        if mesh:
            info.append(f'mesh={pathname(mesh.group(1))}')
        if info:
            lines.append(f'    [{ccid}] ' + ' '.join(info))
    if lines:
        print(f'{names[fid]}:')
        print('\n'.join(lines))
