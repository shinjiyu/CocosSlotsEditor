/**
 * 从 bountyhunter_recovered.scene 抽出 ways 盘面一帧，
 * 换算为 symbolEditor EditorDoc（bounty-hunter 符号 id）。
 *
 * 用法：node tools/extract-bounty-hunter-board-from-recovered.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCENE = path.join(
    ROOT,
    '..',
    'BountyHunterRecovered/assets/scene/bountyhunter_recovered.scene',
);
const SPRITES = path.join(
    ROOT,
    '..',
    'BountyHunterRecovered/assets/recovered/bountyhunter/sprites',
);
const OUT_JSON = path.join(
    ROOT,
    'assets/resources/configs/presentation/doc_bounty_hunter_recovered.json',
);

/** img_symbol 静帧 → pack id（与 import-bounty-hunter-pack.cjs 一致） */
const TEX_TO_PACK = {
    'base_symbolB1_Node.new': 1,
    'base_symbolWX_Node.new': 2,
    'base_symbolM1_Node.2382': 3,
    'base_symbolM2_Node.2349': 4,
    'base_symbolM3_Node.2364': 5,
    'base_symbolM4_Node.2370': 6,
    'base_symbolA_Node.2328': 9,
    'base_symbolK_Node.2355': 10,
    'base_symbolQ_Node.2379': 11,
    'base_symbolJ_Node.2373': 12,
};

const PACK_NAMES = {
    1: 'B1',
    2: 'WX',
    3: 'M1',
    4: 'M2',
    5: 'M3',
    6: 'M4',
    9: 'A',
    10: 'K',
    11: 'Q',
    12: 'J',
};

const COLS = 6;
const VISIBLE_ROWS = [3, 4, 5, 5, 4, 3];
const COL_PITCH = 120;
const ROW_PITCH = 120;

function loadUuidMap() {
    const map = new Map();
    for (const f of fs.readdirSync(SPRITES)) {
        if (!f.endsWith('.png.meta')) continue;
        const meta = JSON.parse(fs.readFileSync(path.join(SPRITES, f), 'utf8'));
        const base = f.replace(/\.png\.meta$/, '');
        if (meta.uuid) map.set(meta.uuid, base);
        if (meta.subMetas) {
            for (const v of Object.values(meta.subMetas)) {
                if (v && v.uuid) map.set(v.uuid, base);
            }
        }
    }
    return map;
}

function stripUuid(u) {
    if (!u || typeof u !== 'string') return null;
    return u.split('@')[0];
}

function parentChain(scene, node) {
    const names = [];
    let cur = node;
    while (cur) {
        names.unshift(cur._name || '?');
        cur = cur._parent ? scene[cur._parent.__id__] : null;
    }
    return names;
}

function findImgSymbolTex(scene, node, uuidMap) {
    for (const ch of node._children || []) {
        const child = scene[ch.__id__];
        if (!child || child._name !== 'img_symbol') continue;
        for (const cRef of child._components || []) {
            const c = scene[cRef.__id__];
            if (c && c.__type__ === 'cc.Sprite' && c._spriteFrame) {
                const raw = stripUuid(c._spriteFrame.__uuid__ || c._spriteFrame);
                return raw ? uuidMap.get(raw) : null;
            }
        }
    }
    return null;
}

function main() {
    const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
    const uuidMap = loadUuidMap();

    const byReel = Array.from({ length: COLS }, () => []);
    for (const o of scene) {
        if (!o || o.__type__ !== 'cc.Node') continue;
        if (!/^symbol_\d+$/.test(o._name || '')) continue;
        const chain = parentChain(scene, o);
        if (!chain.includes('classic-symbol-layout')) continue;
        const reelName = chain.find((n) => /^reel_\d+$/.test(n));
        if (!reelName) continue;
        const col = Number(reelName.split('_')[1]);
        if (col < 0 || col >= COLS) continue;
        const tex = findImgSymbolTex(scene, o, uuidMap);
        const packId = tex ? TEX_TO_PACK[tex] ?? null : null;
        const gameId = Number(String(o._name).split('_')[1]);
        byReel[col].push({
            name: o._name,
            gameId,
            ly: o._lpos?.y || 0,
            tex,
            packId,
            packName: packId != null ? PACK_NAMES[packId] : null,
        });
    }

    const grid = Array.from({ length: COLS }, () => []);
    for (let c = 0; c < COLS; c++) {
        const cells = byReel[c].slice().sort((a, b) => b.ly - a.ly);
        const expect = VISIBLE_ROWS[c];
        if (cells.length !== expect) {
            console.warn(
                `[extract] reel_${c} got ${cells.length} cells, expect ${expect}`,
                cells.map((x) => x.name),
            );
        }
        for (let r = 0; r < expect; r++) {
            const cell = cells[r];
            let id = cell?.packId ?? null;
            // 无贴图时用 gameId（与 pack id 对齐）
            if (id == null && cell?.gameId != null && PACK_NAMES[cell.gameId]) {
                id = cell.gameId;
            }
            grid[c].push(id);
            if (id == null) {
                console.warn('[extract] unmapped', cell?.name, cell?.tex, 'col', c, 'row', r);
            }
        }
    }

    console.log('[extract] board (col→, row↓ top-first):');
    const maxR = Math.max(...VISIBLE_ROWS);
    for (let r = 0; r < maxR; r++) {
        const line = [];
        for (let c = 0; c < COLS; c++) {
            if (r >= grid[c].length) {
                line.push('   ');
                continue;
            }
            const id = grid[c][r];
            line.push(id == null ? ' .' : String(PACK_NAMES[id] || id).padStart(3));
        }
        console.log(' ', line.join(' '));
    }

    const cell = (symbolId) => ({ symbolId, entityRef: null });
    const makeGrid = () => grid.map((col) => col.map((id) => cell(id)));
    const zeros = () => Array(COLS).fill(0);

    const state = {
        version: '0.2.0',
        sessionId: 'doc_bounty_hunter_recovered',
        board: {
            topology: {
                cols: COLS,
                visibleRows: VISIBLE_ROWS.slice(),
                extraTop: zeros(),
                extraBottom: zeros(),
            },
            display: makeGrid(),
            resolved: makeGrid(),
            entities: {},
            anchors: { locks: { $set: [] }, sticks: { $set: [] } },
            overlays: [],
            wins: [],
        },
        phase: 'idle',
        sessionContext: { mode: 'ng' },
        totalWinDisplay: 0,
        extensions: {
            frame: {
                cascadeIndex: 0,
                frameIndex: 0,
                frameKind: 'enter-table',
            },
        },
    };

    const doc = {
        docVersion: 1,
        id: 'doc_bounty_hunter_recovered',
        name: 'Bounty Hunter 还原盘面对照',
        states: [state],
        meta: {
            source: 'BountyHunterRecovered/bountyhunter_recovered.scene',
            note: 'ways [3,4,5,5,4,3]；中心距 120×120 / design 120×100 gap 0/20；符号 id=pack bounty-hunter',
            colPitch: COL_PITCH,
            rowPitch: ROW_PITCH,
            extractedAt: new Date().toISOString(),
        },
    };

    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log('[extract] wrote', path.relative(ROOT, OUT_JSON));
}

main();
