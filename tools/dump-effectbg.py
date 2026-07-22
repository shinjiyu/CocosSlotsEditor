import re

p = r'D:\workspace\symbolEditor\res\_lvbu_extract\1f342a1ca17d69c47ad923e35a6795a5\asset'
text = open(p, encoding='utf-8', errors='ignore').read()

docs = re.split(r'--- !u!(\d+) &(-?\d+)', text)
objs = {}
for i in range(1, len(docs) - 2, 3):
    objs[docs[i + 2]] = (docs[i + 1], docs[i + 2 + 1] if False else docs[i + 2])
# rebuild correctly: groups are (classId, fileId, body)
objs = {}
for i in range(1, len(docs) - 2, 3):
    cid, fid, body = docs[i], docs[i + 1], docs[i + 2]
    objs[fid] = (cid, body)

names = {}
for fid, (cid, body) in objs.items():
    if cid == '1':
        m = re.search(r'm_Name: (.+)', body)
        names[fid] = m.group(1).strip() if m else '?'

print('all GameObjects:', sorted(set(names.values())))

for fid, (cid, body) in objs.items():
    if cid != '1' or names[fid] != 'eff_bg_glow':
        continue
    comps = re.findall(r'component: \{fileID: (-?\d+)\}', body)
    print(f'=== eff_bg_glow comps={comps}')
    for c in comps:
        if c not in objs:
            print(f'  comp {c}: MISSING')
            continue
        ccid, cbody = objs[c]
        print(f'  --- comp classId={ccid} ---')
        for pat, label in [
            (r'm_Sprite: \{fileID: \d+, guid: ([0-9a-f]+)', 'sprite'),
            (r'm_Material: \{fileID: \d+, guid: ([0-9a-f]+)', 'material'),
            (r'm_Color: \{(.+?)\}', 'color'),
            (r'm_SizeDelta: \{(.+?)\}', 'sizeDelta'),
            (r'm_LocalScale: \{(.+?)\}', 'scale'),
            (r'm_Script: \{fileID: -?\d+, guid: ([0-9a-f]+)', 'script'),
        ]:
            m = re.search(pat, cbody)
            if m:
                print(f'    {label}: {m.group(1)}')
