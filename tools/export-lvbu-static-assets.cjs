/**
 * Export the LvBu Unity package into a Cocos-friendly canonical asset set.
 *
 * The Unity client contains six precomposed size tiers per symbol. They are
 * visual variants of one logical id, not six logical symbols. Export canonical
 * sources plus tier assets so SymbolEditor can edit/preview the variant set.
 *
 * Usage:
 *   node tools/export-lvbu-static-assets.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTRACT = path.join(ROOT, 'res/_lvbu_extract');
const DEST = path.join(ROOT, 'assets/resources/spine-4.2/packs/lvbu/static');
const UNITY_SPRITES = 'Assets/Game_Resource/lvbu/lvbu_sprite/lvbu_sprite_ui';
const UNITY_ATLAS_TEXTURES = 'Assets/Resources/lvbu/atlas/texture';
const UNITY_SOUNDS = 'Assets/Resources/lvbu/sounds';
const TIER_HEIGHTS = [112, 130, 156, 196, 262, 392];
const TIER_COLUMN_COUNTS = [7, 6, 5, 4, 3, 2];

const SYMBOLS = [
    // Bonus has orientation variants: vertical icon_1_1 + horizontal icon_1 / icon_1_2.
    { id: 1, name: 'bonus', source: `${UNITY_SPRITES}/icon_1_1.png` },
    { id: 2, name: 'wild', source: `${UNITY_SPRITES}/icon_2_6.png` },
    { id: 3, name: 'scatter', source: `${UNITY_SPRITES}/icon_3_6.png` },
    { id: 4, name: 'h1', source: `${UNITY_SPRITES}/icon_4_6.png` },
    { id: 5, name: 'h2', source: `${UNITY_SPRITES}/icon_5_6.png` },
    { id: 6, name: 'h3', source: `${UNITY_SPRITES}/icon_6_6.png` },
    { id: 7, name: 'h4', source: `${UNITY_SPRITES}/icon_7_6.png` },
    // Low symbols are icon_8..13 (border baked in). A_/K_/… are separate borderless letter layers.
    { id: 8, name: 'A', source: `${UNITY_SPRITES}/icon_8_6.png` },
    { id: 9, name: 'K', source: `${UNITY_SPRITES}/icon_9_6.png` },
    { id: 10, name: 'Q', source: `${UNITY_SPRITES}/icon_10_6.png` },
    { id: 11, name: 'J', source: `${UNITY_SPRITES}/icon_11_6.png` },
    { id: 12, name: '10', source: `${UNITY_SPRITES}/icon_12_6.png` },
    { id: 13, name: '9', source: `${UNITY_SPRITES}/icon_13_6.png` },
    { id: 14, name: 'scatter14', source: `${UNITY_SPRITES}/icon_14_6.png` },
    { id: 15, name: 'scatter15', source: `${UNITY_SPRITES}/icon_15_6.png` },
    { id: 16, name: 'scatter16', source: `${UNITY_SPRITES}/icon_16_6.png` },
    { id: 17, name: 'scatter17', source: `${UNITY_SPRITES}/icon_17_6.png` },
];

const BONUS_ORIENTATIONS = [
    {
        kind: 'bonus-orientation',
        name: '01-bonus-horizontal.png',
        source: `${UNITY_SPRITES}/icon_1.png`,
        note: '590x206 horizontal Fangtian Ji',
    },
    {
        kind: 'bonus-orientation',
        name: '01-bonus-horizontal-wide.png',
        source: `${UNITY_SPRITES}/icon_1_2.png`,
        note: '615x206 wider horizontal Fangtian Ji',
    },
];

const SHARED = [
    {
        kind: 'frame',
        name: 'symbol-frame-9slice.png',
        source: `${UNITY_ATLAS_TEXTURES}/eff_lvbu_kuang_xm_01_5.png`,
        note: '280x392 tallest frame source; render with sliced mode instead of six frame assets',
    },
    {
        kind: 'background',
        name: 'symbol-bg-9slice.png',
        source: `${UNITY_SPRITES}/icon_bg_1.png`,
        note: '280x392 tallest empty panel frame',
    },
    {
        kind: 'letter',
        name: 'letter-A.png',
        source: `${UNITY_SPRITES}/A_1.png`,
        note: 'borderless letter layer for dissolve/glow overlays',
    },
    {
        kind: 'letter',
        name: 'letter-K.png',
        source: `${UNITY_SPRITES}/K_1.png`,
        note: 'borderless letter layer',
    },
    {
        kind: 'letter',
        name: 'letter-Q.png',
        source: `${UNITY_SPRITES}/Q_1.png`,
        note: 'borderless letter layer',
    },
    {
        kind: 'letter',
        name: 'letter-J.png',
        source: `${UNITY_SPRITES}/J_1.png`,
        note: 'borderless letter layer',
    },
    {
        kind: 'letter',
        name: 'letter-10.png',
        source: `${UNITY_SPRITES}/10_1.png`,
        note: 'borderless letter layer',
    },
    {
        kind: 'letter',
        name: 'letter-9.png',
        source: `${UNITY_SPRITES}/9_1.png`,
        note: 'borderless letter layer',
    },
    {
        kind: 'dissolve',
        name: 'dissolve-cloud.png',
        source: `${UNITY_ATLAS_TEXTURES}/eff_lvbu_noise_xm_01.png`,
        note: 'primary grayscale dissolve mask',
    },
    {
        kind: 'dissolve',
        name: 'dissolve-cells.png',
        source: `${UNITY_ATLAS_TEXTURES}/eff_lvbu_noise_xm_02.png`,
        note: 'cellular edge texture used by the original materials',
    },
    {
        kind: 'dissolve',
        name: 'dissolve-turbulence.png',
        source: `${UNITY_ATLAS_TEXTURES}/eff_lvbu_noise_xm_08.png`,
        note: 'turbulence texture used by the original break materials',
    },
    {
        kind: 'dissolve',
        name: 'dissolve-fire.png',
        source: `${UNITY_ATLAS_TEXTURES}/eff_lvbu_noise_xm_10.png`,
        note: 'orange fire texture used by the original break materials',
    },
    {
        kind: 'audio',
        name: 'lvbu-clear.mp3',
        source: `${UNITY_SOUNDS}/sounds@lvbu_clear.mp3`,
        note: 'shared clear sound',
    },

    // 注：普通符号高亮 / 通用消除的 Unity 特效贴图曾导出到 fx/highlight、fx/clear，
    // 但逐像素还原（多层发光 + 湍流 shader + ParticleSystem）无法用静态贴图复现，
    // 已放弃并从产物中 purge。运行时演出改用 assets/scripts/editor-app/PlaceholderFx.ts
    // 的零贴图占位（缩放/颜色脉冲 + 淡出）。真美术就绪后在此重新登记并替换占位模块。
];

function buildPathMap() {
    if (!fs.existsSync(EXTRACT)) throw new Error(`Missing Unity extract: ${EXTRACT}`);
    const map = new Map();
    for (const hash of fs.readdirSync(EXTRACT)) {
        const dir = path.join(EXTRACT, hash);
        const pathnameFile = path.join(dir, 'pathname');
        const assetFile = path.join(dir, 'asset');
        if (!fs.existsSync(pathnameFile) || !fs.existsSync(assetFile)) continue;
        const pathname = fs.readFileSync(pathnameFile, 'utf8').trim().replace(/\\/g, '/');
        map.set(pathname, { hash, assetFile });
    }
    return map;
}

function copyMapped(map, source, outFile) {
    const found = map.get(source);
    if (!found) throw new Error(`Unity asset not found: ${source}`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.copyFileSync(found.assetFile, outFile);
    return {
        source,
        extractHash: found.hash,
        output: path.relative(ROOT, outFile).replace(/\\/g, '/'),
        bytes: fs.statSync(outFile).size,
    };
}

function sizeTierReferences(symbol) {
    if (symbol.id === 1) {
        return [
            `${UNITY_SPRITES}/icon_1.png`,
            `${UNITY_SPRITES}/icon_1_1.png`,
            `${UNITY_SPRITES}/icon_1_2.png`,
        ];
    }
    return Array.from({ length: 6 }, (_, i) => `${UNITY_SPRITES}/icon_${symbol.id}_${i + 1}.png`);
}

function main() {
    const map = buildPathMap();
    fs.mkdirSync(DEST, { recursive: true });
    fs.rmSync(path.join(DEST, 'tiers'), { recursive: true, force: true });

    const manifest = {
        version: 1,
        packId: 'lvbu',
        policy: {
            logicalSymbolCount: 17,
            canonicalAssetPerSymbol: true,
            // Keep tier PNGs available as SpriteFrame variants, not SymbolEntry variants.
            runtimeTierAssets: true,
            cropOwner: 'board renderer',
            originalTierRule:
                'Unity tiers are independent precomposed PNGs (112/130/156/196/262/392), not exact crops.',
            smallSymbolStrategy: {
                preferred: 'tier-switch',
                mapping:
                    'columnCount 7→tier1(112), 6→2(130), 5→3(156), 4→4(196), 3→5(262), 2→6(392)',
                fallback: 'uniform scale of tallest canonical sprite into cell',
                note: 'Never create 6 SymbolEntry per logical id. Board picks SpriteFrame by column occupancy.',
            },
            bonusOrientation: {
                vertical: 'symbols/01-bonus.png (icon_1_1)',
                horizontal: 'symbols/01-bonus-horizontal.png (icon_1)',
                horizontalWide: 'symbols/01-bonus-horizontal-wide.png (icon_1_2)',
            },
            winFx: {
                status: 'placeholder',
                note: 'Unity 高亮/消除特效逐像素还原已放弃（多层发光 + 湍流 shader + ParticleSystem，静态贴图无法复现）。运行时用 scripts/editor-app/PlaceholderFx.ts 占位。',
            },
        },
        symbols: [],
        shared: [],
    };

    for (const symbol of SYMBOLS) {
        const fileName = `${String(symbol.id).padStart(2, '0')}-${symbol.name}.png`;
        const copied = copyMapped(map, symbol.source, path.join(DEST, 'symbols', fileName));
        const tierSources = symbol.id === 1 ? [] : sizeTierReferences(symbol);
        const tiers = tierSources.map((source, index) => {
            const key = `tier-${index + 1}`;
            const output = path.join(
                DEST,
                'tiers',
                `${String(symbol.id).padStart(2, '0')}-${symbol.name}`,
                `${key}.png`,
            );
            return {
                key,
                label: `${TIER_COLUMN_COUNTS[index]}个/列 · ${TIER_HEIGHTS[index]}px`,
                columnCount: TIER_COLUMN_COUNTS[index],
                designHeight: TIER_HEIGHTS[index],
                ...copyMapped(map, source, output),
            };
        });
        manifest.symbols.push({
            id: symbol.id,
            name: symbol.name,
            ...copied,
            tiers,
            originalTierSources: sizeTierReferences(symbol),
        });
    }

    for (const item of [...SHARED, ...BONUS_ORIENTATIONS]) {
        const destDir = item.kind === 'bonus-orientation' ? 'symbols' : item.kind;
        const copied = copyMapped(map, item.source, path.join(DEST, destDir, item.name));
        manifest.shared.push({ kind: item.kind, name: item.name, note: item.note, ...copied });
    }

    const manifestPath = path.join(DEST, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[export-lvbu-static-assets] ${manifest.symbols.length} symbols + ${manifest.shared.length} shared assets`);
    console.log(`[export-lvbu-static-assets] -> ${DEST}`);
}

main();
