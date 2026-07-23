/**
 * 从 BountyHunterRecovered 静帧 + harExplore bounty-hunter spine 引导符号包。
 *
 * 阶段 A（本脚本）：拷贝原始资源到 packs/bounty-hunter
 * 阶段 B：Creator refresh 生成 .meta 后，再跑：
 *   node tools/build-bounty-hunter-libraries.cjs
 *
 * 用法：
 *   node tools/import-bounty-hunter-pack.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-3.8/packs/bounty-hunter');
const SPRITES = path.join(
    ROOT,
    '..',
    'BountyHunterRecovered/assets/recovered/bountyhunter/sprites',
);
const HAR = path.join(
    ROOT,
    '..',
    'harExplore/dist/texture-viewer/animations/bounty-hunter',
);

/**
 * 逻辑符号：pack id 对齐 recovered 盘面 gameId（3–6 / 9–12），
 * B1=1、WX=2 未出现在种子盘面。
 * AKQJ 共用 spine，靠 spineSkin 区分。
 */
const SYMBOLS = [
    {
        id: 1,
        name: 'B1',
        tex: 'base_symbolB1_Node.new.png',
        spine: 'symbolB1',
        winAnim: 'play',
        kind: 'normal',
    },
    {
        id: 2,
        name: 'WX',
        tex: 'base_symbolWX_Node.new.png',
        spine: 'symbolWX',
        winAnim: 'play_win',
        kind: 'normal',
    },
    {
        id: 3,
        name: 'M1',
        tex: 'base_symbolM1_Node.2382.png',
        spine: 'symbolM1',
        winAnim: 'play',
        kind: 'normal',
    },
    {
        id: 4,
        name: 'M2',
        tex: 'base_symbolM2_Node.2349.png',
        spine: 'symbolM2',
        winAnim: 'play',
        kind: 'normal',
    },
    {
        id: 5,
        name: 'M3',
        tex: 'base_symbolM3_Node.2364.png',
        spine: 'symbolM3',
        winAnim: 'play',
        kind: 'normal',
    },
    {
        id: 6,
        name: 'M4',
        tex: 'base_symbolM4_Node.2370.png',
        spine: 'symbolM4',
        winAnim: 'play',
        kind: 'normal',
    },
    {
        id: 9,
        name: 'A',
        tex: 'base_symbolA_Node.2328.png',
        spine: 'symbolAKQJ',
        winAnim: 'play',
        spineSkin: 'A',
        kind: 'normal',
    },
    {
        id: 10,
        name: 'K',
        tex: 'base_symbolK_Node.2355.png',
        spine: 'symbolAKQJ',
        winAnim: 'play',
        spineSkin: 'K',
        kind: 'normal',
    },
    {
        id: 11,
        name: 'Q',
        tex: 'base_symbolQ_Node.2379.png',
        spine: 'symbolAKQJ',
        winAnim: 'play',
        spineSkin: 'Q',
        kind: 'normal',
    },
    {
        id: 12,
        name: 'J',
        tex: 'base_symbolJ_Node.2373.png',
        spine: 'symbolAKQJ',
        winAnim: 'play',
        spineSkin: 'J',
        kind: 'normal',
    },
];

const SPINE_DIRS = [
    'symbolB1',
    'symbolWX',
    'symbolM1',
    'symbolM2',
    'symbolM3',
    'symbolM4',
    'symbolAKQJ',
];

const EFFECT_SPINES = [
    {
        dir: 'symbol_win',
        id: 'fx_bh_symbol_win',
        name: 'symbol_win',
        defaultAnim: 'play',
        front: false,
    },
    {
        dir: 'symbol_eliminate',
        id: 'fx_bh_symbol_eliminate',
        name: 'symbol_eliminate',
        defaultAnim: 'play',
        front: true,
    },
];

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** atlas 里顶层贴图页名（非缩进行且以图片扩展名结尾） */
function atlasPageNames(atlasText) {
    const pages = [];
    for (const line of atlasText.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || line.startsWith(' ') || line.startsWith('\t')) continue;
        if (/\.(png|jpg|jpeg)$/i.test(t)) pages.push(t);
    }
    return pages;
}

function rewriteAtlasFirstPage(atlasText, pageName) {
    const lines = atlasText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
            lines[i] = pageName;
            break;
        }
    }
    return lines.join('\n');
}

/** 拷贝 spine 目录：首页改名为 folder.ext，其余页原名保留 */
function copySpineBundle(srcDir, dstDir, fileStem) {
    ensureDir(dstDir);
    const atlasSrc = path.join(srcDir, 'skeleton.atlas');
    const jsonSrc = path.join(srcDir, 'skeleton.json');
    if (!fs.existsSync(atlasSrc) || !fs.existsSync(jsonSrc)) {
        throw new Error(`spine 不完整: ${srcDir}`);
    }
    const atlasText = fs.readFileSync(atlasSrc, 'utf8');
    const pages = atlasPageNames(atlasText);
    if (!pages.length) throw new Error(`atlas 无贴图页: ${atlasSrc}`);

    const first = pages[0];
    const ext = path.extname(first);
    const firstOut = `${fileStem}${ext}`;
    const firstSrc = path.join(srcDir, first);
    if (!fs.existsSync(firstSrc)) throw new Error(`缺贴图 ${firstSrc}`);
    copyFile(firstSrc, path.join(dstDir, firstOut));

    for (let i = 1; i < pages.length; i++) {
        const p = pages[i];
        const src = path.join(srcDir, p);
        if (!fs.existsSync(src)) throw new Error(`缺贴图页 ${src}`);
        copyFile(src, path.join(dstDir, p));
    }

    fs.writeFileSync(
        path.join(dstDir, `${fileStem}.atlas`),
        rewriteAtlasFirstPage(atlasText, firstOut),
        'utf8',
    );
    copyFile(jsonSrc, path.join(dstDir, `${fileStem}.json`));
}

function main() {
    if (!fs.existsSync(SPRITES)) throw new Error(`缺少静帧目录: ${SPRITES}`);
    if (!fs.existsSync(HAR)) throw new Error(`缺少 HAR spine 目录: ${HAR}`);

    ensureDir(path.join(PACK, 'symbols'));
    ensureDir(path.join(PACK, 'oriSymbols'));

    for (const s of SYMBOLS) {
        const src = path.join(SPRITES, s.tex);
        if (!fs.existsSync(src)) throw new Error(`缺静帧 ${src}`);
        const outName = `${String(s.id).padStart(2, '0')}-${s.name}.png`;
        copyFile(src, path.join(PACK, 'symbols', outName));
    }

    for (const dir of SPINE_DIRS) {
        copySpineBundle(path.join(HAR, dir), path.join(PACK, 'oriSymbols', dir), dir);
    }

    for (const fx of EFFECT_SPINES) {
        copySpineBundle(path.join(HAR, fx.dir), path.join(PACK, 'effects', fx.dir), fx.dir);
    }

    writeJson(path.join(PACK, 'manifest.json'), {
        id: 'bounty-hunter',
        name: 'Bounty Hunter',
        zone: 'spine-3.8',
        designW: 120,
        designH: 100,
        boardColGap: 0,
        boardRowGap: 20,
        cellFxScale: 0.85,
        columnVAlign: 'center',
        seedDocId: 'doc_bounty_hunter_recovered',
        seedDocPath: 'configs/presentation/doc_bounty_hunter_recovered',
        seedRev: 1,
        visibleRows: [3, 4, 5, 5, 4, 3],
        symbols: SYMBOLS.map((s) => ({
            id: s.id,
            name: s.name,
            textureFile: `symbols/${String(s.id).padStart(2, '0')}-${s.name}.png`,
            spineDir: `oriSymbols/${s.spine}`,
            spineId: `spine_bh_${s.spine}`,
            textureId: `tex_bh_${String(s.id).padStart(2, '0')}_${s.name}`,
            winAnim: s.winAnim,
            idleAnim: '',
            spineSkin: s.spineSkin || '',
            kind: s.kind || 'normal',
        })),
        spines: SPINE_DIRS.map((d) => ({
            id: `spine_bh_${d}`,
            dir: `oriSymbols/${d}`,
            file: `${d}.json`,
        })),
        effects: EFFECT_SPINES.map((fx) => ({
            id: fx.id,
            name: fx.name,
            dir: `effects/${fx.dir}`,
            file: `${fx.dir}.json`,
            defaultAnim: fx.defaultAnim,
            front: fx.front,
            role: fx.dir === 'symbol_eliminate' ? 'vanish' : 'win',
        })),
    });

    fs.writeFileSync(
        path.join(PACK, 'README.md'),
        `# bounty-hunter (spine-3.8)

赏金猎人符号包。静帧来自 \`BountyHunterRecovered\`，Spine 来自 harExplore \`bounty-hunter\`。

## 重建

\`\`\`bash
node tools/import-bounty-hunter-pack.cjs
# Creator refresh db://assets/resources/spine-3.8/packs/bounty-hunter
node tools/build-bounty-hunter-libraries.cjs
node tools/extract-bounty-hunter-board-from-recovered.cjs
\`\`\`

## 盘面布局（还原自 BountyHunterRecovered）

| 项 | 值 |
|----|----|
| 设计格 | 120×100 |
| 列距/行距 | 0 / 20（中心距 120×120） |
| 盘面 | ways 6 列，visibleRows [3,4,5,5,4,3] |
| 格子 FX scale | 0.85 |

**配置入口**：H5 SymbolEditor「包布局」；包↔种子盘面由 \`GamePack.seedDoc*\` 登记，可自由切换包。

## 符号 id

| id | name | spine | skin | winAnim |
|----|------|-------|------|---------|
${SYMBOLS.map(
    (s) =>
        `| ${s.id} | ${s.name} | ${s.spine} | ${s.spineSkin || ''} | ${s.winAnim} |`,
).join('\n')}
`,
        'utf8',
    );

    console.log(`[import-bounty-hunter] pack → ${path.relative(ROOT, PACK)}`);
    console.log(
        `[import-bounty-hunter] symbols=${SYMBOLS.length} spines=${SPINE_DIRS.length} effects=${EFFECT_SPINES.length}`,
    );
    console.log('下一步：Creator refresh 该目录，再跑 build-bounty-hunter-libraries.cjs');
}

main();
