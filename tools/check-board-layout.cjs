/**
 * board-layout 自检（纯 Node，不依赖 Cocos）。
 * 用法: node tools/check-board-layout.cjs
 */

'use strict';

// 内联与 TS 一致的最小规则，避免编 TS
const BONUS = 1;
const WILD = 2;
const ROWS = 7;
const mapToMain = [
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 3, row: 0 },
    { col: 4, row: 0 },
];

function leftmostBonusStreak(top) {
    const indices = [];
    for (let i = 0; i < top.length; i++) {
        if (top[i] === BONUS) indices.push(i);
        else if (indices.length) break;
    }
    return indices.length >= 2 ? indices : [];
}

function resolve(top, prevFirst) {
    const first = top.findIndex((s) => s === BONUS);
    const bonusCount = top.filter((s) => s === BONUS).length;
    if (bonusCount <= 1) return { triggered: false, wildCols: [] };
    if (prevFirst !== undefined && first === prevFirst) return { triggered: false, wildCols: [] };
    const streak = leftmostBonusStreak(top);
    if (streak.length < 2) return { triggered: false, wildCols: [] };
    const wildCols = [...new Set(streak.map((i) => mapToMain[i].col))];
    return { triggered: true, wildCols, streak };
}

function encode(baseId, height, typeCount = 18) {
    return baseId + (height - 1) * typeCount;
}
function decode(runtimeId, typeCount = 18) {
    if (runtimeId <= 0) return { baseId: 0, height: 1 };
    return {
        height: Math.floor((runtimeId - 1) / typeCount) + 1,
        baseId: ((runtimeId - 1) % typeCount) + 1,
    };
}

const cases = [
    { top: [0, 0, 0, 0], expect: false },
    { top: [BONUS, 0, 0, 0], expect: false },
    { top: [BONUS, BONUS, 0, 0], expect: true, cols: [1, 2] },
    { top: [0, BONUS, BONUS, BONUS], expect: true, cols: [2, 3, 4] },
    { top: [BONUS, BONUS, 0, 0], prev: 0, expect: false },
    { top: [BONUS, BONUS, 0, 0], prev: 1, expect: true, cols: [1, 2] },
];

let failed = 0;
for (const c of cases) {
    const r = resolve(c.top, c.prev);
    const ok = r.triggered === c.expect && (!c.expect || JSON.stringify(r.wildCols) === JSON.stringify(c.cols));
    if (!ok) {
        console.error('FAIL', c, '→', r);
        failed++;
    }
}

const enc = encode(5, 3);
const dec = decode(enc);
if (enc !== 41 || dec.baseId !== 5 || dec.height !== 3) {
    console.error('FAIL encode', enc, dec);
    failed++;
}

const flatTop = [7, 14, 21, 28];
if (flatTop.some((i, n) => i !== mapToMain[n].col * ROWS + mapToMain[n].row)) {
    console.error('FAIL flat indices');
    failed++;
}

if (failed) {
    console.error(`[check-board-layout] ${failed} failed`);
    process.exit(1);
}
console.log('[check-board-layout] ok — ways-6x7-top-mid4 wild + encode');
