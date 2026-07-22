#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../assets/resources/spine-4.2/packs/lvbu/spines');

function animNames(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const idx = raw.indexOf('"animations"');
    if (idx < 0) return [];
    // take until next top-level key after animations object — heuristic: lines "  \"name\": {"
    const slice = raw.slice(idx, idx + 200000);
    const names = [];
    for (const m of slice.matchAll(/\n  "([^"]+)"\s*:\s*\{/g)) {
        const n = m[1];
        if (['bones', 'slots', 'ik', 'transform', 'path', 'physics', 'attachments', 'events', 'drawOrder', 'audio', 'skeleton'].includes(n)) continue;
        // stop if we left animations (hit skins etc at depth)
        if (n === 'skins' || n === 'events') break;
        names.push(n);
    }
    // Better approach: find animations block braces
    let i = raw.indexOf('{', idx);
    let depth = 0;
    let start = -1;
    const keys = [];
    for (; i < raw.length; i++) {
        const c = raw[i];
        if (c === '{') {
            depth++;
            if (depth === 1) start = i;
        } else if (c === '}') {
            depth--;
            if (depth === 0) break;
        } else if (depth === 1 && c === '"') {
            let j = i + 1;
            while (j < raw.length && raw[j] !== '"') j++;
            const key = raw.slice(i + 1, j);
            // look ahead for :
            let k = j + 1;
            while (k < raw.length && /\s/.test(raw[k])) k++;
            if (raw[k] === ':') keys.push(key);
            i = j;
        }
    }
    return keys;
}

for (const d of fs.readdirSync(root).sort()) {
    const dir = path.join(root, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    const json = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (!json) continue;
    const keys = animNames(path.join(dir, json));
    console.log(d);
    console.log(' ', keys.length, keys.join(', '));
}
