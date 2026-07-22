/**
 * Rebuild LvBu AssetLibrary/SymbolLibrary from the canonical static export.
 *
 * Requires Creator to have imported static/*.png first so SpriteFrame UUIDs
 * exist in the generated .meta files.
 *
 * Usage:
 *   node tools/build-lvbu-static-libraries.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-4.2/packs/lvbu');
const STATIC = path.join(PACK, 'static');
const ASSET_LIB = path.join(PACK, 'asset-library.prefab');
const SYMBOL_LIB = path.join(PACK, 'symbol-library.prefab');

const SPINES = {
    1: 'spine_bonus',
    2: 'spine_wild',
    3: 'spine_scatter',
    4: 'spine_h1',
    5: 'spine_h2',
    6: 'spine_h3',
    7: 'spine_h4',
};

const ANIMS = {
    1: { idle: 'spirit', win: 'spirit', vanish: '' },
    2: { idle: 'spirit_1', win: 'spirit_1', vanish: '' },
    3: { idle: 'Idle1', win: 'spirit1', vanish: 'spirit1_k' },
    4: { idle: 'spirit_1', win: 'spirit_1', vanish: 'spirit_k_1' },
    5: { idle: 'spirit_1', win: 'spirit_1', vanish: 'spirit_k_1' },
    6: { idle: 'spirit_1', win: 'spirit_1', vanish: 'spirit_k_1' },
    7: { idle: 'spirit_1', win: 'spirit_1', vanish: 'spirit_k_1' },
};

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function spriteFrameUuid(pngPath) {
    const meta = readJson(`${pngPath}.meta`);
    const sf = Object.values(meta.subMetas ?? {}).find((m) => m.importer === 'sprite-frame');
    if (!sf?.uuid) throw new Error(`No SpriteFrame subMeta: ${pngPath}.meta`);
    return sf.uuid;
}

function assetEntryBase(id, name, kind) {
    return {
        __type__: 'AssetEntry',
        id,
        name,
        kind,
        texture: null,
        spine: null,
        audio: null,
        font: null,
        prefab: null,
        defaultAnim: '',
        effectFront: true,
        effectScale: 1,
        effectOffset: { __type__: 'cc.Vec2', x: 0, y: 0 },
        volume: 1,
    };
}

function makeTextureEntry(symbol) {
    const entry = assetEntryBase(`tex_lvbu_${String(symbol.id).padStart(2, '0')}`, symbol.name, 0);
    entry.texture = {
        __uuid__: spriteFrameUuid(path.join(ROOT, symbol.output)),
        __expectedType__: 'cc.SpriteFrame',
    };
    return entry;
}

function makeTierTextureEntry(symbol, tier) {
    const sid = String(symbol.id).padStart(2, '0');
    const index = Number(tier.key.replace('tier-', ''));
    const entry = assetEntryBase(`tex_lvbu_${sid}_tier_${index}`, `${symbol.name} · ${tier.label}`, 0);
    entry.texture = {
        __uuid__: spriteFrameUuid(path.join(ROOT, tier.output)),
        __expectedType__: 'cc.SpriteFrame',
    };
    return entry;
}

function makeAudioEntry() {
    const meta = readJson(path.join(STATIC, 'audio/lvbu-clear.mp3.meta'));
    const entry = assetEntryBase('sfx_lvbu_clear', 'LvBu Clear', 2);
    entry.audio = { __uuid__: meta.uuid, __expectedType__: 'cc.AudioClip' };
    return entry;
}

/** 低符号共享 prefab（panel+letter，零脚本；view 类运行时挂载） */
function makeLowSymbolPrefabEntry() {
    const meta = readJson(path.join(PACK, 'prefabs/lvbu-low-symbol.prefab.meta'));
    const entry = assetEntryBase('prefab_lvbu_low', 'LvBu Low Symbol (panel+letter)', 4);
    entry.prefab = { __uuid__: meta.uuid, __expectedType__: 'cc.Prefab' };
    return entry;
}

function makeExtraTextureEntry(extra) {
    const stem = path.basename(extra.name, path.extname(extra.name));
    const idBase = stem.replace(/[^a-zA-Z0-9]+/g, '_');
    const pretty =
        stem === '01-bonus-horizontal'
            ? 'bonus · 横向方天戟'
            : stem === '01-bonus-horizontal-wide'
              ? 'bonus · 横向方天戟(宽)'
              : extra.note || stem;
    const entry = assetEntryBase(`tex_lvbu_${idBase}`, pretty, 0);
    entry.texture = {
        __uuid__: spriteFrameUuid(path.join(ROOT, extra.output)),
        __expectedType__: 'cc.SpriteFrame',
    };
    return entry;
}

function rebuildAssetLibrary(manifest) {
    const doc = readJson(ASSET_LIB);
    const component = doc[2];
    const oldSpines = doc.slice(3).filter((entry) => entry?.__type__ === 'AssetEntry' && entry.kind === 1);
    const tierTextures = manifest.symbols.flatMap((symbol) =>
        (symbol.tiers ?? []).map((tier) => makeTierTextureEntry(symbol, tier)),
    );
    const orientationTextures = (manifest.shared ?? [])
        .filter((extra) => extra.kind === 'bonus-orientation')
        .map(makeExtraTextureEntry);
    const entries = [
        ...oldSpines,
        ...manifest.symbols.map(makeTextureEntry),
        ...tierTextures,
        ...orientationTextures,
        makeAudioEntry(),
        makeLowSymbolPrefabEntry(),
    ];
    doc.splice(3, doc.length - 3, ...entries);
    component.assets = entries.map((_, i) => ({ __id__: i + 3 }));
    writeJson(ASSET_LIB, doc);
    return { total: entries.length, orientations: orientationTextures.length };
}

function cellFx() {
    return {
        __type__: 'CellFxDef',
        spine: null,
        anim: '',
        front: true,
        scale: 1,
        offset: { __type__: 'cc.Vec2', x: 0, y: 0 },
        sound: null,
        soundVolume: 1,
    };
}

function visualVariant(symbol, tier) {
    const sid = String(symbol.id).padStart(2, '0');
    const index = Number(tier.key.replace('tier-', ''));
    return {
        __type__: 'SymbolVisualVariantDef',
        key: tier.key,
        label: tier.label,
        textureAssetId: `tex_lvbu_${sid}_tier_${index}`,
        spineAssetId: '',
        prefabAssetId: '',
        texture: null,
        spine: null,
        prefab: null,
    };
}

function orientationVariant(key, label, textureAssetId) {
    return {
        __type__: 'SymbolVisualVariantDef',
        key,
        label,
        textureAssetId,
        spineAssetId: '',
        prefabAssetId: '',
        texture: null,
        spine: null,
        prefab: null,
    };
}

function symbolEntry(symbol, variantIds, winFxId, vanishFxId) {
    const anim = ANIMS[symbol.id] ?? { idle: '', win: '', vanish: '' };
    // 低符号（8..13 = A/K/Q/J/10/9）走共享 panel+letter prefab（零脚本，view 类运行时挂载）
    const isLow = symbol.id >= 8 && symbol.id <= 13;
    const isBonus = symbol.id === 1;
    return {
        __type__: 'SymbolEntry',
        id: symbol.id,
        name: symbol.name,
        kind: 0,
        textureAssetId: `tex_lvbu_${String(symbol.id).padStart(2, '0')}`,
        spineAssetId: SPINES[symbol.id] ?? '',
        prefabAssetId: isLow ? 'prefab_lvbu_low' : '',
        visualVariants: variantIds.map((id) => ({ __id__: id })),
        placementMainId: isBonus ? 'column-fill' : '',
        placementTopStripId: isBonus ? 'top-row-span' : '',
        placementTopStripCells: isBonus ? 2 : 2,
        placementTopStripVariantKey: isBonus ? 'top-horizontal-wide' : '',
        enterSoundAssetId: '',
        winSoundAssetId: '',
        vanishSoundAssetId: symbol.id >= 8 && symbol.id <= 13 ? 'sfx_lvbu_clear' : '',
        digitFontAssetId: '',
        winCellFxAssetId: '',
        vanishCellFxAssetId: '',
        texture: null,
        spine: null,
        prefab: null,
        idleAnim: anim.idle,
        enterAnim: '',
        winAnim: anim.win,
        vanishAnim: anim.vanish,
        enterSound: null,
        winSound: null,
        vanishSound: null,
        enterFx: 0,
        scaleMul: 1,
        digitFont: null,
        winCellFx: { __id__: winFxId },
        vanishCellFx: { __id__: vanishFxId },
    };
}

function rebuildSymbolLibrary(manifest) {
    const doc = readJson(SYMBOL_LIB);
    const component = doc[2];
    const objects = [];
    const refs = [];
    for (const symbol of manifest.symbols) {
        const entryId = 3 + objects.length;
        const tiers = symbol.tiers ?? [];
        const orientVariants =
            symbol.id === 1
                ? [
                      orientationVariant(
                          'top-horizontal',
                          '顶条横戟',
                          'tex_lvbu_01_bonus_horizontal',
                      ),
                      orientationVariant(
                          'top-horizontal-wide',
                          '顶条横戟(宽·2格)',
                          'tex_lvbu_01_bonus_horizontal_wide',
                      ),
                  ]
                : [];
        const allVariants = [...tiers.map((tier) => visualVariant(symbol, tier)), ...orientVariants];
        const variantIds = allVariants.map((_, index) => entryId + 1 + index);
        const winFxId = entryId + 1 + allVariants.length;
        const vanishFxId = winFxId + 1;
        refs.push({ __id__: entryId });
        objects.push(
            symbolEntry(symbol, variantIds, winFxId, vanishFxId),
            ...allVariants,
            cellFx(),
            cellFx(),
        );
    }
    const globalWinFxId = 3 + objects.length;
    const globalVanishFxId = globalWinFxId + 1;
    objects.push(cellFx(), cellFx());
    doc.splice(3, doc.length - 3, ...objects);
    component.symbols = refs;
    component.symbolWidth = 280;
    component.symbolHeight = 392;
    component.winCellFx = { __id__: globalWinFxId };
    component.vanishCellFx = { __id__: globalVanishFxId };
    component.multiDigitFont = null;
    component.expandSplitParticle = null;
    component.expandSplitB = null;
    component.expandSplitBAnim = 'split_B';
    writeJson(SYMBOL_LIB, doc);
    return refs.length;
}

function main() {
    const manifest = readJson(path.join(STATIC, 'manifest.json'));
    const assetInfo = rebuildAssetLibrary(manifest);
    const symbolCount = rebuildSymbolLibrary(manifest);
    console.log(
        `[build-lvbu-static-libraries] assets=${assetInfo.total} (orientations=${assetInfo.orientations}), symbols=${symbolCount}`,
    );
}

main();
