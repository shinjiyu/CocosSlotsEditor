/**
 * 按 PowerOfThor2Recovered 盘面 pitch 写回包布局：
 *   cell 116×96，col/row gap 0，格子 FX scale 0.75
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-3.8/packs/power-of-thor2');

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, v) {
    fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
}

const DESIGN_W = 116;
const DESIGN_H = 96;
const FX_SCALE = 0.75;

// --- symbol-library ---
{
    const file = path.join(PACK, 'symbol-library.prefab');
    const j = readJson(file);
    const lib = j.find((o) => o && typeof o.symbolWidth === 'number');
    if (!lib) throw new Error('SymbolLibrary not found in prefab');
    lib.symbolWidth = DESIGN_W;
    lib.symbolHeight = DESIGN_H;
    lib.boardColGap = 0;
    lib.boardRowGap = 0;
    lib.lockBoardColGap = true;
    lib.lockBoardRowGap = true;
    const win = j[lib.winCellFx.__id__];
    const vanish = j[lib.vanishCellFx.__id__];
    if (win) win.scale = FX_SCALE;
    if (vanish) vanish.scale = FX_SCALE;
    writeJson(file, j);
    console.log('[patch-thor2] symbol-library', {
        w: lib.symbolWidth,
        h: lib.symbolHeight,
        gaps: [lib.boardColGap, lib.boardRowGap],
        fx: FX_SCALE,
    });
}

// --- asset-library effectScale ---
{
    const file = path.join(PACK, 'asset-library.prefab');
    const j = readJson(file);
    let n = 0;
    for (const e of j) {
        if (e && e.__type__ === 'AssetEntry' && e.kind === 5 && /fx_thor2_symbol_(win|eliminate)/.test(e.id || '')) {
            e.effectScale = FX_SCALE;
            n++;
        }
    }
    writeJson(file, j);
    console.log(`[patch-thor2] asset-library effectScale×${n}`);
}

// --- manifest ---
{
    const file = path.join(PACK, 'manifest.json');
    const m = readJson(file);
    m.designW = DESIGN_W;
    m.designH = DESIGN_H;
    m.boardColGap = 0;
    m.boardRowGap = 0;
    m.cellFxScale = FX_SCALE;
    writeJson(file, m);
    console.log('[patch-thor2] manifest', m.designW, m.designH);
}

// --- README note ---
{
    const file = path.join(PACK, 'README.md');
    let md = fs.readFileSync(file, 'utf8');
    const note = `\n## 盘面布局（还原自 PowerOfThor2Recovered）\n\n| 项 | 值 |\n|----|----|\n| 设计格 | ${DESIGN_W}×${DESIGN_H}（reel 中心 pitch） |\n| 列距/行距 | 0 / 0 |\n| 盘面 | 6×5 |\n| 格子 FX scale | ${FX_SCALE}（高亮/消除贴合格） |\n\n**配置入口**：H5 SymbolEditor →「包布局」（\`SymbolSheetDoc.packLayout\`）。不要用 Creator Inspector 改 symbol-library。\n`;
    if (!md.includes('盘面布局（还原')) {
        md = md.replace(/\n## 符号 id/, `${note}\n## 符号 id`);
        fs.writeFileSync(file, md, 'utf8');
        console.log('[patch-thor2] README layout section');
    }
}

console.log('[patch-thor2] done');
