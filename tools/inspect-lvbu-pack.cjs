'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../assets/resources/spine-4.2/packs/lvbu/spines');
for (const dir of fs.readdirSync(root)) {
    const dirPath = path.join(root, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const j of fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'))) {
        const raw = fs.readFileSync(path.join(dirPath, j), 'utf8');
        const idx = raw.indexOf('"animations"');
        if (idx < 0) {
            console.log(dir, 'no animations');
            continue;
        }
        const slice = raw.slice(idx, idx + 4000);
        const keys = [...slice.matchAll(/\n    "([^"]+)"\s*:\s*\{/g)].map((x) => x[1]).slice(0, 20);
        console.log(dir, '->', keys.join(', '));
    }
}

const al = fs.readFileSync(
    path.join(__dirname, '../assets/resources/spine-4.2/packs/lvbu/asset-library.prefab'),
    'utf8',
);
const sl = fs.readFileSync(
    path.join(__dirname, '../assets/resources/spine-4.2/packs/lvbu/symbol-library.prefab'),
    'utf8',
);
console.log('asset-library has spine_bonus:', al.includes('spine_bonus'));
console.log('asset-library uuid refs:', (al.match(/__uuid__/g) || []).length);
console.log('symbol-library has spineAssetId:', sl.includes('spineAssetId'));
console.log('symbol-library sample:', sl.includes('spine_h1'), sl.includes('"id": 4') || sl.includes('"id":4'));
