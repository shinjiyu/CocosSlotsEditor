/**
 * Copy LvBu Unity Spine exports (json + atlas.txt + png) into SE pack.
 * Usage: node tools/import-lvbu-spines.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTRACT = path.join(ROOT, 'res/_lvbu_extract');
const DEST = path.join(ROOT, 'assets/resources/spine-4.2/packs/lvbu/spines');

const WANTED = [
    'eff_spine_lvbu_h1',
    'eff_spine_lvbu_h2',
    'eff_spine_lvbu_h3',
    'eff_spine_lvbu_h4',
    'eff_spine_lvbu_wild',
    'eff_spine_lvbu_scatter',
    'eff_spine_lvbu_superwild1',
    'eff_spine_lvbu_superwild2',
    'eff_spine_lvbu_baseflag',
];

function readPathname(dir) {
    const p = path.join(dir, 'pathname');
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8').trim().replace(/\\/g, '/');
}

function buildMap() {
    const map = new Map();
    for (const name of fs.readdirSync(EXTRACT)) {
        const dir = path.join(EXTRACT, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        const pn = readPathname(dir);
        if (pn) map.set(pn, dir);
    }
    return map;
}

function ensureDir(d) {
    fs.mkdirSync(d, { recursive: true });
}

function copyAsset(srcGuidDir, destFile) {
    const asset = path.join(srcGuidDir, 'asset');
    if (!fs.existsSync(asset)) return false;
    ensureDir(path.dirname(destFile));
    fs.copyFileSync(asset, destFile);
    return true;
}

function main() {
    if (!fs.existsSync(EXTRACT)) {
        console.error('missing extract:', EXTRACT);
        process.exit(1);
    }
    const map = buildMap();
    ensureDir(DEST);
    const report = [];

    for (const name of WANTED) {
        const outDir = path.join(DEST, name);
        ensureDir(outDir);
        // Prefer Assets/Resources/.../<name> folder entries
        const keys = [...map.keys()].filter(
            (k) =>
                k.endsWith('/' + name) ||
                k.includes('/' + name + '/') ||
                k.endsWith('/' + name + '.json') ||
                k.endsWith('/' + name + '.png') ||
                k.endsWith('/' + name + '.atlas.txt'),
        );
        if (keys.length === 0) {
            report.push({ name, ok: false, reason: 'no pathname match' });
            continue;
        }
        const files = [];
        for (const k of keys) {
            const leaf = path.posix.basename(k);
            const guidDir = map.get(k);
            if (leaf.endsWith('.json') || leaf.endsWith('.png')) {
                const dest = path.join(outDir, leaf);
                if (copyAsset(guidDir, dest)) files.push(leaf);
            } else if (leaf.endsWith('.atlas.txt')) {
                const atlasName = leaf.replace(/\.atlas\.txt$/, '.atlas');
                const dest = path.join(outDir, atlasName);
                if (copyAsset(guidDir, dest)) files.push(atlasName);
            }
        }
        report.push({ name, ok: files.length >= 2, files });
    }

    console.log(JSON.stringify(report, null, 2));
    const bad = report.filter((r) => !r.ok);
    if (bad.length) {
        console.error(`[import-lvbu-spines] ${bad.length} incomplete`);
        process.exit(1);
    }
    console.log('[import-lvbu-spines] ok →', DEST);
}

main();
