/**
 * 从 PowerOfThor2Recovered.scene 抽出一帧 6×5 盘面，
 * 换算为 symbolEditor EditorDoc（power-of-thor2 符号 id）。
 *
 * 用法：node tools/extract-thor2-board-from-recovered.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCENE = path.join(
    ROOT,
    '..',
    'PowerOfThor2Recovered/assets/scene/powerofthor2_recovered.scene',
);
const SPRITES = path.join(
    ROOT,
    '..',
    'PowerOfThor2Recovered/assets/recovered/godeebxp/sprites',
);
const OUT_JSON = path.join(ROOT, 'assets/resources/configs/presentation/doc_thor2_recovered.json');

/** 静帧文件名 → 包内符号 id（与 import-power-of-thor2-pack.cjs 一致） */
const TEX_TO_PACK = {
    'base_symbolB1_Node.2870': 1,
    'base_symbolB2_Node.2906': 2,
    'base_symbolF1_Node.2838': 3,
    'base_symbolF2_Node.2938': 4,
    'base_symbolF3_Node.2922': 5,
    'base_symbolF4_Node.2822': 6,
    'base_symbolF5_Node.2830': 7,
    'base_symbolM1_Node.2866': 8,
    'base_symbolM2_Node.2846': 9,
    'base_symbolM3_Node.2874': 10,
    'base_symbolM4_Node.2854': 11,
    'base_symbolA_Node.2826': 12,
    'base_symbolK_Node.2902': 13,
    'base_symbolQ_Node.2850': 14,
    'base_symbolJ_Node.2834': 15,
    'base_symbolTE_Node.2918': 16,
};

const PACK_NAMES = {
    1: 'B1',
    2: 'B2',
    3: 'F1',
    4: 'F2',
    5: 'F3',
    6: 'F4',
    7: 'F5',
    8: 'M1',
    9: 'M2',
    10: 'M3',
    11: 'M4',
    12: 'A',
    13: 'K',
    14: 'Q',
    15: 'J',
    16: 'TE',
};

const COL_PITCH = 116;
const ROW_PITCH = 96;
const COLS = 6;
const ROWS = 5;

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

function findSpriteUuid(scene, node) {
    const visit = (n) => {
        for (const cRef of n._components || []) {
            const c = scene[cRef.__id__];
            if (c && c.__type__ === 'cc.Sprite' && c._spriteFrame) {
                return c._spriteFrame.__uuid__ || c._spriteFrame;
            }
        }
        for (const ch of n._children || []) {
            const hit = visit(scene[ch.__id__]);
            if (hit) return hit;
        }
        return null;
    };
    return visit(node);
}

function worldPos(scene, node) {
    let x = 0;
    let y = 0;
    let cur = node;
    while (cur) {
        x += cur._lpos?.x || 0;
        y += cur._lpos?.y || 0;
        cur = cur._parent ? scene[cur._parent.__id__] : null;
    }
    return { x, y };
}

function main() {
    const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
    const uuidMap = loadUuidMap();

    const candidates = [];
    for (let i = 0; i < scene.length; i++) {
        const o = scene[i];
        if (!o || o.__type__ !== 'cc.Node') continue;
        if (!/^symbol_\d+$/.test(o._name || '')) continue;
        const chain = parentChain(scene, o);
        // 只要盘面层：editable-dropper-layer 下；或带 reel_ 祖先
        const onBoard =
            chain.includes('editable-dropper-layer') ||
            chain.some((n) => /^reel_\d+$/.test(n));
        if (!onBoard) continue;

        const raw = stripUuid(findSpriteUuid(scene, o));
        const tex = raw ? uuidMap.get(raw) : null;
        const packId = tex ? TEX_TO_PACK[tex] ?? null : null;
        const gameId = Number(String(o._name).split('_')[1]);
        const { x, y } = worldPos(scene, o);
        candidates.push({
            name: o._name,
            gameId: Number.isFinite(gameId) ? gameId : null,
            chain: chain.join('/'),
            x,
            y,
            lx: o._lpos?.x || 0,
            ly: o._lpos?.y || 0,
            tex,
            packId,
            packName: packId != null ? PACK_NAMES[packId] : null,
        });
    }

    // 从有贴图的格子建立「游戏 symbol_N → 包 id」；无贴图时回退
    const gameToPack = new Map();
    for (const c of candidates) {
        if (c.gameId == null || c.packId == null) continue;
        const prev = gameToPack.get(c.gameId);
        if (prev != null && prev !== c.packId) {
            console.warn('[extract] gameId conflict', c.gameId, prev, c.packId, c.tex);
        } else {
            gameToPack.set(c.gameId, c.packId);
        }
    }
    console.log(
        '[extract] gameId→pack',
        [...gameToPack.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([g, p]) => `${g}:${PACK_NAMES[p]}`)
            .join(' '),
    );
    for (const c of candidates) {
        if (c.packId == null && c.gameId != null && gameToPack.has(c.gameId)) {
            c.packId = gameToPack.get(c.gameId);
            c.packName = PACK_NAMES[c.packId];
            c.tex = c.tex || `(via gameId ${c.gameId})`;
        }
    }

    console.log('[extract] board symbol nodes:', candidates.length);
    if (!candidates.length) {
        // dump nearby structure for debug
        const named = scene
            .map((o, i) => (o && o.__type__ === 'cc.Node' ? { i, name: o._name, kids: (o._children || []).length } : null))
            .filter((x) => x && /reel|symbol|dropper|layer/i.test(x.name));
        console.log('[extract] related nodes sample:', named.slice(0, 40));
        process.exit(1);
    }

    // 用本地 y 排序更稳：每列内 ly = 192,96,0,-96,-192
    // 先按列中心 x 聚类
    const xs = [...new Set(candidates.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    console.log('[extract] unique world X:', xs);

    // 若 world X 不干净，用父 reel 索引
    let grid = Array.from({ length: COLS }, () => Array(ROWS).fill(null));
    let usedWorld = false;

    if (xs.length === COLS) {
        usedWorld = true;
        const colIndex = new Map(xs.map((x, i) => [x, i]));
        // 每列按 y 降序（上→下）
        const byCol = Array.from({ length: COLS }, () => []);
        for (const c of candidates) {
            const ci = colIndex.get(Math.round(c.x));
            if (ci == null) continue;
            byCol[ci].push(c);
        }
        for (let c = 0; c < COLS; c++) {
            byCol[c].sort((a, b) => b.y - a.y);
            for (let r = 0; r < ROWS; r++) {
                const cell = byCol[c][r];
                grid[c][r] = cell?.packId ?? null;
                if (cell && cell.packId == null) {
                    console.warn('[extract] unmapped', cell.name, cell.tex, 'at', c, r);
                }
            }
        }
    } else {
        // fallback：从 chain 解析 reel_N，本地 y 映射行
        const rowYs = [192, 96, 0, -96, -192];
        for (const c of candidates) {
            const reel = c.chain.split('/').find((n) => /^reel_\d+$/.test(n));
            if (!reel) continue;
            const col = Number(reel.split('_')[1]);
            let row = rowYs.findIndex((yy) => Math.abs(c.ly - yy) < 2);
            if (row < 0) {
                // 最近行
                let best = 0;
                let bestD = Infinity;
                for (let i = 0; i < rowYs.length; i++) {
                    const d = Math.abs(c.ly - rowYs[i]);
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
                row = best;
            }
            if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
                grid[col][row] = c.packId;
                if (c.packId == null) console.warn('[extract] unmapped', c.name, c.tex, 'col', col, 'row', row);
            }
        }
    }

    // 打印盘面
    console.log('[extract] clustering:', usedWorld ? 'world-x' : 'reel-name');
    console.log('[extract] board (col→, row↓ top-first):');
    for (let r = 0; r < ROWS; r++) {
        const line = [];
        for (let c = 0; c < COLS; c++) {
            const id = grid[c][r];
            line.push(id == null ? ' .' : String(PACK_NAMES[id] || id).padStart(3));
        }
        console.log(' ', line.join(' '));
    }

    // 统计
    const counts = {};
    for (const col of grid) {
        for (const id of col) {
            if (id == null) continue;
            counts[PACK_NAMES[id]] = (counts[PACK_NAMES[id]] || 0) + 1;
        }
    }
    console.log('[extract] counts', counts);

    const cell = (symbolId) => ({ symbolId, entityRef: null });
    const makeGrid = () => grid.map((col) => col.map((id) => cell(id)));
    const zeros = () => Array(COLS).fill(0);
    const fives = () => Array(COLS).fill(ROWS);

    const state = {
        version: '0.2.0',
        sessionId: 'doc_thor2_recovered',
        board: {
            topology: {
                cols: COLS,
                visibleRows: fives(),
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
        id: 'doc_thor2_recovered',
        name: 'Thor2 还原盘面对照',
        states: [state],
        meta: {
            source: 'PowerOfThor2Recovered/powerofthor2_recovered.scene',
            note: '中心距 116×96 / gap 0；符号 id 为 pack power-of-thor2',
            colPitch: COL_PITCH,
            rowPitch: ROW_PITCH,
            extractedAt: new Date().toISOString(),
        },
    };

    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    console.log('[extract] wrote', path.relative(ROOT, OUT_JSON));
}

main();
