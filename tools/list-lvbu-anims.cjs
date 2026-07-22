'use strict';
const fs = require('fs');
const path = require('path');

function animKeys(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/"animations"\s*:\s*\{/);
    if (!m) return [];
    let i = m.index + m[0].length;
    let depth = 1;
    let key = '';
    let inStr = false;
    let esc = false;
    const keys = [];
    let collectingKey = true;
    let buf = '';
    for (; i < raw.length && depth > 0; i++) {
        const c = raw[i];
        if (inStr) {
            if (esc) {
                buf += c;
                esc = false;
            } else if (c === '\\') esc = true;
            else if (c === '"') {
                inStr = false;
                if (collectingKey && depth === 1) {
                    key = buf;
                    keys.push(key);
                }
                buf = '';
            } else buf += c;
            continue;
        }
        if (c === '"') {
            inStr = true;
            buf = '';
            continue;
        }
        if (c === '{') {
            depth++;
            collectingKey = false;
        } else if (c === '}') {
            depth--;
            collectingKey = depth === 1;
        } else if (c === ',' && depth === 1) {
            collectingKey = true;
        } else if (c === ':' && depth === 1) {
            collectingKey = false;
        }
    }
    return keys;
}

const root = path.join(__dirname, '../assets/resources/spine-4.2/packs/lvbu/spines');
const pick = {};
for (const dir of fs.readdirSync(root)) {
    const dirPath = path.join(root, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const j of fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'))) {
        const keys = animKeys(path.join(dirPath, j));
        pick[dir] = keys;
        console.log(dir, keys.slice(0, 12).join(', '));
    }
}
fs.writeFileSync(path.join(__dirname, '../temp-lvbu-anims.json'), JSON.stringify(pick, null, 2));
