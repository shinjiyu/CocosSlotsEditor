#!/usr/bin/env node
'use strict';

/**
 * 从 LvBu Unity extract 的 item_*.prefab 抽取 Spine 用法：
 *   which skeleton + startingAnimation 出现在哪些节点上
 * 用来判断每个 spine 动画是否被业务引用。
 */

const fs = require('fs');
const path = require('path');

const EXTRACT = path.resolve(__dirname, '../res/_lvbu_extract');
const SPINES_DIR = path.resolve(__dirname, '../assets/resources/spine-4.2/packs/lvbu/spines');

function buildPathMap() {
    const map = {};
    for (const d of fs.readdirSync(EXTRACT)) {
        const dir = path.join(EXTRACT, d);
        if (!fs.statSync(dir).isDirectory()) continue;
        const pn = path.join(dir, 'pathname');
        if (!fs.existsSync(pn)) continue;
        map[fs.readFileSync(pn, 'utf8').trim()] = dir;
    }
    return map;
}

function guidOfMeta(metaPath) {
    const m = fs.readFileSync(metaPath, 'utf8').match(/guid:\s*([0-9a-f]{32})/i);
    return m ? m[1] : null;
}

function buildGuidToPath(pathMap) {
    const out = {};
    for (const [p, dir] of Object.entries(pathMap)) {
        const meta = path.join(dir, 'asset.meta');
        if (!fs.existsSync(meta)) continue;
        const g = guidOfMeta(meta);
        if (g) out[g] = p;
    }
    return out;
}

function animKeysFromJson(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const idx = raw.indexOf('"animations"');
    if (idx < 0) return [];
    let i = raw.indexOf('{', idx);
    if (i < 0) return [];
    let depth = 0;
    const keys = [];
    const start = i;
    for (; i < raw.length; i++) {
        const c = raw[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                const block = raw.slice(start, i + 1);
                for (const m of block.matchAll(/^\s{2}"([^"]+)":\s*\{/gm)) keys.push(m[1]);
                break;
            }
        }
    }
    return keys;
}

function parseItemPrefab(text) {
    // Split roughly by GameObject blocks via m_Name + following SkeletonAnimation fields
    const nodes = [];
    const re = /m_Name:\s*([^\r\n]*)[\s\S]*?(?=m_Name:|$)/g;
    // Better: find skeletonDataAsset + startingAnimation pairs with preceding m_Name
    const parts = text.split(/(?=^\s*m_Name:)/m);
    for (const part of parts) {
        const nameM = part.match(/^\s*m_Name:\s*(.*)$/m);
        const skelM = part.match(/skeletonDataAsset:\s*\{[^}]*guid:\s*([0-9a-f]{32})/i);
        const animM = part.match(/startingAnimation:\s*(.*)$/m);
        if (!skelM) continue;
        nodes.push({
            node: (nameM ? nameM[1] : '').trim(),
            skeletonGuid: skelM[1],
            startingAnimation: animM ? animM[1].trim() : '',
        });
    }
    return nodes;
}

const pathMap = buildPathMap();
const guidMap = buildGuidToPath(pathMap);

// local spine anim inventory
const spineAnims = {};
for (const d of fs.readdirSync(SPINES_DIR)) {
    const dir = path.join(SPINES_DIR, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    const json = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (!json) continue;
    spineAnims[d] = animKeysFromJson(path.join(dir, json));
}

// Collect item prefab usage
const usage = {}; // skelPath -> { anim -> [prefab paths] }
const itemPaths = Object.keys(pathMap)
    .filter((p) => /Resources\/lvbu\/effect\/item_\d/.test(p))
    .sort();

for (const p of itemPaths) {
    const asset = path.join(pathMap[p], 'asset');
    if (!fs.existsSync(asset)) continue;
    const text = fs.readFileSync(asset, 'utf8');
    if (text.includes('\u0000')) continue;
    for (const n of parseItemPrefab(text)) {
        const skelPath = guidMap[n.skeletonGuid] || n.skeletonGuid;
        const short = skelPath.replace(/^.*\//, '').replace(/\.json$/, '').replace(/\.asset$/, '');
        if (!usage[short]) usage[short] = { path: skelPath, nodes: {}, anims: {} };
        const anim = n.startingAnimation || '(empty)';
        if (!usage[short].anims[anim]) usage[short].anims[anim] = [];
        usage[short].anims[anim].push(`${path.basename(p)}#${n.node || '?'}`);
    }
}

console.log('=== Spine inventory vs prefab startingAnimation refs ===\n');
for (const [spine, anims] of Object.entries(spineAnims).sort()) {
    // find matching usage key
    const key =
        Object.keys(usage).find((k) => spine.includes(k) || k.includes(spine.replace(/^eff_/, ''))) ||
        Object.keys(usage).find((k) => k.includes(spine.split('_').slice(-1)[0]));
    // fuzzy: by suffix
    let u = usage[spine] || usage[spine.replace(/^eff_spine_/, 'eff_')] || null;
    if (!u) {
        for (const [k, v] of Object.entries(usage)) {
            if (spine.includes(k) || k.includes(spine) || spine.endsWith(k) || k.endsWith(spine)) {
                u = v;
                break;
            }
        }
    }
    console.log(`## ${spine}`);
    console.log(`  all anims (${anims.length}): ${anims.join(', ')}`);
    if (!u) {
        console.log('  prefab refs: (none found in item_*.prefab startingAnimation)');
        console.log('');
        continue;
    }
    const used = Object.keys(u.anims).filter((a) => a !== '(empty)');
    const unused = anims.filter((a) => !used.includes(a));
    console.log(`  used as startingAnimation: ${used.join(', ') || '(none)'}`);
    for (const [a, refs] of Object.entries(u.anims)) {
        const sample = refs.slice(0, 6).join(', ');
        console.log(`    - ${a}: ${refs.length} refs e.g. ${sample}`);
    }
    console.log(`  NOT referenced as startingAnimation: ${unused.join(', ') || '(none)'}`);
    console.log('');
}

console.log('=== raw usage keys ===');
console.log(Object.keys(usage).sort().join('\n'));
