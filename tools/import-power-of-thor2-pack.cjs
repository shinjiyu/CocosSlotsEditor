/**
 * 从 PowerOfThor2Recovered 静帧 + harExplore spine 引导雷神2符号包。
 *
 * 阶段 A（本脚本）：拷贝原始资源到 packs/power-of-thor2
 * 阶段 B：Creator refresh 生成 .meta 后，再跑：
 *   node tools/build-power-of-thor2-libraries.cjs
 *
 * 用法：
 *   node tools/import-power-of-thor2-pack.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-3.8/packs/power-of-thor2');
const SPRITES = path.join(
    ROOT,
    '..',
    'PowerOfThor2Recovered/assets/recovered/godeebxp/sprites',
);
const HAR = path.join(
    ROOT,
    '..',
    'harExplore-portable-win-x64/harExplore-portable-win-x64/app/dist/texture-viewer/animations/power-of-thor2',
);

/** 逻辑符号表：id / 名 / 静帧源 / spine 目录 / 动画名 / 可选静帧旋转(度) */
const SYMBOLS = [
    // Recovered 静帧里 B1/M4 倒了 180°（Unity/WebGL 导出朝向），导入时转正
    { id: 1, name: 'B1', tex: 'base_symbolB1_Node.2870.png', spine: 'symbolB1', winAnim: 'play', rotateDeg: 180 },
    { id: 2, name: 'B2', tex: 'base_symbolB2_Node.2906.png', spine: 'symbolB2', winAnim: 'play' },
    { id: 3, name: 'F1', tex: 'base_symbolF1_Node.2838.png', spine: 'symbolF12345', winAnim: 'play' },
    { id: 4, name: 'F2', tex: 'base_symbolF2_Node.2938.png', spine: 'symbolF12345', winAnim: 'play' },
    { id: 5, name: 'F3', tex: 'base_symbolF3_Node.2922.png', spine: 'symbolF12345', winAnim: 'play' },
    { id: 6, name: 'F4', tex: 'base_symbolF4_Node.2822.png', spine: 'symbolF12345', winAnim: 'play' },
    { id: 7, name: 'F5', tex: 'base_symbolF5_Node.2830.png', spine: 'symbolF12345', winAnim: 'play' },
    { id: 8, name: 'M1', tex: 'base_symbolM1_Node.2866.png', spine: 'symbolM1', winAnim: 'play' },
    { id: 9, name: 'M2', tex: 'base_symbolM2_Node.2846.png', spine: 'symbolM2', winAnim: 'play' },
    { id: 10, name: 'M3', tex: 'base_symbolM3_Node.2874.png', spine: 'symbolM3', winAnim: 'play' },
    { id: 11, name: 'M4', tex: 'base_symbolM4_Node.2854.png', spine: 'symbolM4', winAnim: 'play', rotateDeg: 180 },
    { id: 12, name: 'A', tex: 'base_symbolA_Node.2826.png', spine: 'symbolAKQJTE', winAnim: 'play_A' },
    { id: 13, name: 'K', tex: 'base_symbolK_Node.2902.png', spine: 'symbolAKQJTE', winAnim: 'play_K' },
    { id: 14, name: 'Q', tex: 'base_symbolQ_Node.2850.png', spine: 'symbolAKQJTE', winAnim: 'play_Q' },
    { id: 15, name: 'J', tex: 'base_symbolJ_Node.2834.png', spine: 'symbolAKQJTE', winAnim: 'play_J' },
    { id: 16, name: 'TE', tex: 'base_symbolTE_Node.2918.png', spine: 'symbolAKQJTE', winAnim: 'play_TE' },
];

const SPINE_DIRS = ['symbolB1', 'symbolB2', 'symbolF12345', 'symbolM1', 'symbolM2', 'symbolM3', 'symbolM4', 'symbolAKQJTE'];

/** 格子特效：高亮 / 消除（harExplore 独立 skeleton，动画名均为 play） */
const EFFECT_SPINES = [
    { dir: 'symbol_win', id: 'fx_thor2_symbol_win', name: 'symbol_win', defaultAnim: 'play', front: false },
    { dir: 'symbol_eliminate', id: 'fx_thor2_symbol_eliminate', name: 'symbol_eliminate', defaultAnim: 'play', front: true },
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

/** 只改 atlas 第一页文件名，保留后续页（如 symbol.jpg） */
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

function main() {
    if (!fs.existsSync(SPRITES)) throw new Error(`缺少静帧目录: ${SPRITES}`);
    if (!fs.existsSync(HAR)) throw new Error(`缺少 HAR spine 目录: ${HAR}`);

    ensureDir(path.join(PACK, 'symbols'));
    ensureDir(path.join(PACK, 'oriSymbols'));

    // 静帧（部分 recovered 朝向倒了，按 rotateDeg 转正）
    const { execFileSync } = require('child_process');
    for (const s of SYMBOLS) {
        const src = path.join(SPRITES, s.tex);
        if (!fs.existsSync(src)) throw new Error(`缺静帧 ${src}`);
        const outName = `${String(s.id).padStart(2, '0')}-${s.name}.png`;
        const dst = path.join(PACK, 'symbols', outName);
        copyFile(src, dst);
        if (s.rotateDeg) {
            execFileSync(
                'python',
                [
                    '-c',
                    `from PIL import Image; p=r'''${dst}'''; Image.open(p).convert('RGBA').rotate(${s.rotateDeg}, expand=False).save(p)`,
                ],
                { stdio: 'inherit' },
            );
        }
    }

    // Spine：每目录一份，统一改名为 folder 名
    for (const dir of SPINE_DIRS) {
        const srcDir = path.join(HAR, dir);
        const dstDir = path.join(PACK, 'oriSymbols', dir);
        ensureDir(dstDir);
        const pngSrc = path.join(srcDir, 'symbol.png');
        const jpgSrc = path.join(srcDir, 'symbol.jpg');
        const atlasSrc = path.join(srcDir, 'skeleton.atlas');
        const jsonSrc = path.join(srcDir, 'skeleton.json');
        if (!fs.existsSync(pngSrc) || !fs.existsSync(atlasSrc) || !fs.existsSync(jsonSrc)) {
            throw new Error(`spine 不完整: ${srcDir}`);
        }
        const pngName = `${dir}.png`;
        copyFile(pngSrc, path.join(dstDir, pngName));
        // 第二页贴图仍叫 symbol.jpg（atlas 内第二页名），原样拷贝
        if (fs.existsSync(jpgSrc)) {
            copyFile(jpgSrc, path.join(dstDir, 'symbol.jpg'));
        }
        // 只改第一页名；保留后续 page（如 symbol.jpg）
        const atlas = rewriteAtlasFirstPage(fs.readFileSync(atlasSrc, 'utf8'), pngName);
        fs.writeFileSync(path.join(dstDir, `${dir}.atlas`), atlas, 'utf8');
        copyFile(jsonSrc, path.join(dstDir, `${dir}.json`));
    }

    // 高亮 / 消除特效（atlas 页为 light.jpg）
    for (const fx of EFFECT_SPINES) {
        const srcDir = path.join(HAR, fx.dir);
        const dstDir = path.join(PACK, 'effects', fx.dir);
        ensureDir(dstDir);
        const jpgSrc = path.join(srcDir, 'light.jpg');
        const atlasSrc = path.join(srcDir, 'skeleton.atlas');
        const jsonSrc = path.join(srcDir, 'skeleton.json');
        if (!fs.existsSync(jpgSrc) || !fs.existsSync(atlasSrc) || !fs.existsSync(jsonSrc)) {
            throw new Error(`effect spine 不完整: ${srcDir}`);
        }
        const pageName = `${fx.dir}.jpg`;
        copyFile(jpgSrc, path.join(dstDir, pageName));
        const atlas = rewriteAtlasFirstPage(fs.readFileSync(atlasSrc, 'utf8'), pageName);
        fs.writeFileSync(path.join(dstDir, `${fx.dir}.atlas`), atlas, 'utf8');
        copyFile(jsonSrc, path.join(dstDir, `${fx.dir}.json`));
    }

    // 清单：给 build 脚本用
    writeJson(path.join(PACK, 'manifest.json'), {
        id: 'power-of-thor2',
        name: 'Power of Thor 2',
        zone: 'spine-3.8',
        designW: 116,
        designH: 96,
        boardColGap: 0,
        boardRowGap: 0,
        cellFxScale: 0.75,
        symbols: SYMBOLS.map((s) => ({
            id: s.id,
            name: s.name,
            textureFile: `symbols/${String(s.id).padStart(2, '0')}-${s.name}.png`,
            spineDir: `oriSymbols/${s.spine}`,
            spineId: `spine_thor2_${s.spine}`,
            textureId: `tex_thor2_${String(s.id).padStart(2, '0')}_${s.name}`,
            winAnim: s.winAnim,
            idleAnim: '',
        })),
        spines: SPINE_DIRS.map((d) => ({
            id: `spine_thor2_${d}`,
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
        `# power-of-thor2 (spine-3.8)

雷神2 符号包。静帧来自 \`PowerOfThor2Recovered\`，Spine 来自 harExplore \`power-of-thor2\`。

## 重建

\`\`\`bash
node tools/import-power-of-thor2-pack.cjs
# Creator refresh db://assets/resources/spine-3.8/packs/power-of-thor2
node tools/build-power-of-thor2-libraries.cjs
# 再 refresh asset-library / symbol-library
\`\`\`

## 符号 id

| id | name | spine | winAnim |
|----|------|-------|---------|
${SYMBOLS.map((s) => `| ${s.id} | ${s.name} | ${s.spine} | ${s.winAnim} |`).join('\n')}
`,
        'utf8',
    );

    console.log(`[import-power-of-thor2] pack → ${path.relative(ROOT, PACK)}`);
    console.log(
        `[import-power-of-thor2] symbols=${SYMBOLS.length} spines=${SPINE_DIRS.length} effects=${EFFECT_SPINES.length}`,
    );
    console.log('下一步：Creator refresh 该目录，再跑 build-power-of-thor2-libraries.cjs');
}

main();
