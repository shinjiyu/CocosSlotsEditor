/**
 * 根据 bounty-hunter manifest + Creator .meta，写出 asset-library / symbol-library。
 *
 * 前置：已跑 import-bounty-hunter-pack.cjs，且 Creator 已 refresh 包目录。
 *
 * 用法：
 *   node tools/build-bounty-hunter-libraries.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-3.8/packs/bounty-hunter');
const MANIFEST = path.join(PACK, 'manifest.json');
const ASSET_LIB = path.join(PACK, 'asset-library.prefab');
const SYMBOL_LIB = path.join(PACK, 'symbol-library.prefab');
const ASSET_LIBRARY_TYPE = 'e260bCYLz1Pm69p8RcsW842';
const SYMBOL_LIBRARY_TYPE = '4ae26tQDjRABp/lkeoyV6xn';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function spriteFrameUuid(pngPath) {
    const metaPath = `${pngPath}.meta`;
    if (!fs.existsSync(metaPath)) {
        throw new Error(`缺少 meta（请先 refresh）：${path.relative(ROOT, metaPath)}`);
    }
    const meta = readJson(metaPath);
    const sf = Object.values(meta.subMetas ?? {}).find((m) => m.importer === 'sprite-frame');
    if (!sf?.uuid) throw new Error(`无 SpriteFrame subMeta: ${metaPath}`);
    return sf.uuid;
}

function spineUuid(jsonPath) {
    const metaPath = `${jsonPath}.meta`;
    if (!fs.existsSync(metaPath)) {
        throw new Error(`缺少 spine meta（请先 refresh）：${path.relative(ROOT, metaPath)}`);
    }
    const meta = readJson(metaPath);
    if (!meta.uuid) throw new Error(`spine meta 无 uuid: ${metaPath}`);
    return meta.uuid;
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

function emptyCellFx() {
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

function cellFxFromEffect(uuid, anim, front, scale) {
    const fx = emptyCellFx();
    if (uuid) {
        fx.spine = { __uuid__: uuid, __expectedType__: 'sp.SkeletonData' };
        fx.anim = anim || 'play';
        fx.front = front !== false;
        if (typeof scale === 'number') fx.scale = scale;
    }
    return fx;
}

function ensureMeta(prefabPath, syncNodeName) {
    const metaPath = `${prefabPath}.meta`;
    if (fs.existsSync(metaPath)) return;
    writeJson(metaPath, {
        ver: '1.1.50',
        importer: 'prefab',
        imported: false,
        uuid: crypto.randomUUID(),
        files: [],
        subMetas: {},
        userData: { syncNodeName },
    });
}

function kindEnum(kind) {
    if (kind === 'multi') return 1;
    return 0;
}

function main() {
    const manifest = readJson(MANIFEST);
    const assetsById = new Map();

    for (const sp of manifest.spines) {
        const jsonPath = path.join(PACK, sp.dir, sp.file);
        const uuid = spineUuid(jsonPath);
        const entry = assetEntryBase(sp.id, sp.id.replace(/^spine_bh_/, ''), 1);
        entry.spine = { __uuid__: uuid, __expectedType__: 'sp.SkeletonData' };
        assetsById.set(sp.id, entry);
    }

    for (const sym of manifest.symbols) {
        const pngPath = path.join(PACK, sym.textureFile);
        const uuid = spriteFrameUuid(pngPath);
        if (!assetsById.has(sym.textureId)) {
            const entry = assetEntryBase(sym.textureId, sym.name, 0);
            entry.texture = { __uuid__: uuid, __expectedType__: 'cc.SpriteFrame' };
            assetsById.set(sym.textureId, entry);
        }
    }

    /** @type {{ win?: { uuid: string, anim: string, front: boolean }, vanish?: { uuid: string, anim: string, front: boolean } }} */
    const packFx = {};
    for (const fx of manifest.effects || []) {
        const jsonPath = path.join(PACK, fx.dir, fx.file);
        const uuid = spineUuid(jsonPath);
        const entry = assetEntryBase(fx.id, fx.name || fx.id, 5);
        entry.spine = { __uuid__: uuid, __expectedType__: 'sp.SkeletonData' };
        entry.defaultAnim = fx.defaultAnim || 'play';
        entry.effectFront = fx.front !== false;
        entry.effectScale =
            typeof fx.effectScale === 'number' ? fx.effectScale : manifest.cellFxScale ?? 0.85;
        assetsById.set(fx.id, entry);
        const slot = fx.role === 'vanish' ? 'vanish' : 'win';
        packFx[slot] = { uuid, anim: entry.defaultAnim, front: entry.effectFront };
    }

    const assetEntries = [...assetsById.values()].sort((a, b) => a.id.localeCompare(b.id));

    const assetNodes = [];
    assetNodes.push({
        __type__: 'cc.Prefab',
        _name: 'asset-library',
        _objFlags: 0,
        __editorExtras__: {},
        _native: '',
        data: { __id__: 1 },
        optimizationPolicy: 0,
        persistent: false,
    });
    assetNodes.push({
        __type__: 'cc.Node',
        _name: 'asset-library',
        _objFlags: 0,
        __editorExtras__: {},
        _parent: null,
        _children: [],
        _active: true,
        _components: [{ __id__: 2 }],
        _prefab: null,
        _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _mobility: 0,
        _layer: 33554432,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _id: '',
    });
    assetNodes.push({
        __type__: ASSET_LIBRARY_TYPE,
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: 1 },
        _enabled: true,
        __prefab: null,
        assets: assetEntries.map((_, i) => ({ __id__: 3 + i })),
        _id: '',
    });
    for (const e of assetEntries) assetNodes.push(e);
    writeJson(ASSET_LIB, assetNodes);
    ensureMeta(ASSET_LIB, 'asset-library');

    const symbolNodes = [];
    symbolNodes.push({
        __type__: 'cc.Prefab',
        _name: 'symbol-library',
        _objFlags: 0,
        __editorExtras__: {},
        _native: '',
        data: { __id__: 1 },
        optimizationPolicy: 0,
        persistent: false,
    });
    symbolNodes.push({
        __type__: 'cc.Node',
        _name: 'symbol-library',
        _objFlags: 0,
        __editorExtras__: {},
        _parent: null,
        _children: [],
        _active: true,
        _components: [{ __id__: 2 }],
        _prefab: null,
        _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _mobility: 0,
        _layer: 33554432,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _id: '',
    });

    const globalWinFxId = 3;
    const globalVanishFxId = 4;
    const firstSymFx = 5;
    const n = manifest.symbols.length;
    const entryStart = firstSymFx + n * 2;

    symbolNodes.push({
        __type__: SYMBOL_LIBRARY_TYPE,
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: 1 },
        _enabled: true,
        __prefab: null,
        symbols: manifest.symbols.map((_, i) => ({ __id__: entryStart + i })),
        symbolWidth: manifest.designW || 120,
        symbolHeight: manifest.designH || 100,
        boardColGap: manifest.boardColGap ?? 0,
        boardRowGap: manifest.boardRowGap ?? 20,
        lockBoardColGap: true,
        lockBoardRowGap: true,
        columnVAlign: manifest.columnVAlign || 'center',
        winCellFx: { __id__: globalWinFxId },
        vanishCellFx: { __id__: globalVanishFxId },
        multiDigitFont: null,
        expandSplitParticle: null,
        expandSplitB: null,
        expandSplitBAnim: 'split_B',
        _id: '',
    });
    const fxScale = manifest.cellFxScale ?? 0.85;
    symbolNodes.push(
        cellFxFromEffect(packFx.win?.uuid, packFx.win?.anim, packFx.win?.front, fxScale),
    );
    symbolNodes.push(
        cellFxFromEffect(packFx.vanish?.uuid, packFx.vanish?.anim, packFx.vanish?.front, fxScale),
    );

    for (let i = 0; i < n; i++) {
        symbolNodes.push(emptyCellFx());
        symbolNodes.push(emptyCellFx());
    }

    for (let i = 0; i < n; i++) {
        const sym = manifest.symbols[i];
        const winFxId = firstSymFx + i * 2;
        const vanishFxId = winFxId + 1;
        symbolNodes.push({
            __type__: 'SymbolEntry',
            id: sym.id,
            name: sym.name,
            kind: kindEnum(sym.kind),
            textureAssetId: sym.textureId,
            spineAssetId: sym.spineId,
            prefabAssetId: '',
            visualVariants: [],
            placementMainId: '',
            placementTopStripId: '',
            placementTopStripCells: 2,
            placementTopStripVariantKey: '',
            enterSoundAssetId: '',
            winSoundAssetId: '',
            vanishSoundAssetId: '',
            digitFontAssetId: '',
            winCellFxAssetId: '',
            vanishCellFxAssetId: '',
            texture: null,
            spine: null,
            prefab: null,
            idleAnim: sym.idleAnim || '',
            enterAnim: '',
            winAnim: sym.winAnim || '',
            vanishAnim: '',
            spineSkin: sym.spineSkin || '',
            enterSound: null,
            winSound: null,
            vanishSound: null,
            enterFx: 0,
            scaleMul: 1,
            digitFont: null,
            winCellFx: { __id__: winFxId },
            vanishCellFx: { __id__: vanishFxId },
        });
    }

    writeJson(SYMBOL_LIB, symbolNodes);
    ensureMeta(SYMBOL_LIB, 'symbol-library');

    console.log(`[build-bounty-hunter] assets=${assetEntries.length} symbols=${n}`);
    console.log(
        `[build-bounty-hunter] packFx win=${packFx.win ? 'yes' : 'no'} vanish=${packFx.vanish ? 'yes' : 'no'}`,
    );
    console.log(`[build-bounty-hunter] wrote ${path.relative(ROOT, ASSET_LIB)}`);
    console.log(`[build-bounty-hunter] wrote ${path.relative(ROOT, SYMBOL_LIB)}`);
}

main();
