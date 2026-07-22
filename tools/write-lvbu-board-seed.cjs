/**
 * Write configs/presentation/doc_lvbu_ways67.json (ways-6x7 empty board).
 * Run: node tools/write-lvbu-board-seed.cjs
 */
const fs = require('fs');
const path = require('path');

const COLS = 6;
const ROWS = 7;
const visibleRows = Array.from({ length: COLS }, () => ROWS);
const extra = Array.from({ length: COLS }, () => 0);

function makeGrid() {
    return Array.from({ length: COLS }, () =>
        Array.from({ length: ROWS }, () => ({ symbolId: null, entityRef: null })),
    );
}

const state = {
    version: '0.2.0',
    sessionId: 'doc_lvbu_ways67',
    board: {
        topology: {
            cols: COLS,
            visibleRows,
            extraTop: extra.slice(),
            extraBottom: extra.slice(),
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
        frame: { cascadeIndex: 0, frameIndex: 0, frameKind: 'enter-table' },
    },
};

const doc = {
    docVersion: 1,
    id: 'doc_lvbu_ways67',
    name: '吕布 ways-6x7',
    states: [state],
};

const out = path.join(__dirname, '../assets/resources/configs/presentation/doc_lvbu_ways67.json');
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote', out);
