/**
 * 将 golden-seth 从「旧包直引 UUID」迁到 asset-library + *AssetId。
 *
 * 用法：
 *   node tools/migrate-golden-seth-asset-library.cjs
 *
 * 产出：
 *   - packs/golden-seth/asset-library.prefab (+ .meta)
 *   - 改写 packs/golden-seth/symbol-library.prefab（补齐 *AssetId / placement 空字段）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'assets/resources/spine-3.8/packs/golden-seth');
const SYMBOL_LIB = path.join(PACK, 'symbol-library.prefab');
const ASSET_LIB = path.join(PACK, 'asset-library.prefab');
const ASSET_LIB_META = `${ASSET_LIB}.meta`;

const ASSET_LIBRARY_TYPE = 'e260bCYLz1Pm69p8RcsW842';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function walkMeta(dir, acc = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkMeta(p, acc);
        else if (ent.name.endsWith('.meta')) acc.push(p);
    }
    return acc;
}

/** uuid → { file, subKey?, importer } */
function buildUuidIndex(packRoot) {
    const map = new Map();
    for (const metaPath of walkMeta(packRoot)) {
        const meta = readJson(metaPath);
        const file = metaPath.replace(/\.meta$/, '');
        if (meta.uuid) {
            map.set(meta.uuid, { file, importer: meta.importer || '', subKey: null });
        }
        for (const [subKey, sub] of Object.entries(meta.subMetas || {})) {
            if (sub?.uuid) {
                map.set(sub.uuid, {
                    file,
                    importer: sub.importer || '',
                    subKey,
                });
            }
        }
    }
    return map;
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

function slugFromPath(filePath, packRoot) {
    const rel = path.relative(packRoot, filePath).replace(/\\/g, '/');
    return rel
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function makeTextureRef(uuid) {
    return { __uuid__: uuid, __expectedType__: 'cc.SpriteFrame' };
}

function makeSpineRef(uuid) {
    return { __uuid__: uuid, __expectedType__: 'sp.SkeletonData' };
}

function makeFontRef(uuid) {
    return { __uuid__: uuid, __expectedType__: 'cc.BitmapFont' };
}

function emptyCellFxRef(id) {
    return { __id__: id };
}

function ensureSymbolEntryShape(entry) {
    // 旧包缺字段：补齐新契约默认值；保留已有 texture/spine 引用以便双轨过渡
    if (entry.textureAssetId == null) entry.textureAssetId = '';
    if (entry.spineAssetId == null) entry.spineAssetId = '';
    if (entry.prefabAssetId == null) entry.prefabAssetId = '';
    if (!Array.isArray(entry.visualVariants)) entry.visualVariants = [];
    if (entry.placementMainId == null) entry.placementMainId = '';
    if (entry.placementTopStripId == null) entry.placementTopStripId = '';
    if (entry.placementTopStripCells == null) entry.placementTopStripCells = 2;
    if (entry.placementTopStripVariantKey == null) entry.placementTopStripVariantKey = '';
    if (entry.enterSoundAssetId == null) entry.enterSoundAssetId = '';
    if (entry.winSoundAssetId == null) entry.winSoundAssetId = '';
    if (entry.vanishSoundAssetId == null) entry.vanishSoundAssetId = '';
    if (entry.digitFontAssetId == null) entry.digitFontAssetId = '';
    if (entry.winCellFxAssetId == null) entry.winCellFxAssetId = '';
    if (entry.vanishCellFxAssetId == null) entry.vanishCellFxAssetId = '';
    return entry;
}

function main() {
    const uuidIndex = buildUuidIndex(PACK);
    const symbolLib = readJson(SYMBOL_LIB);
    const libComp = symbolLib.find((x) => Array.isArray(x.symbols));
    if (!libComp) throw new Error('symbol-library.prefab: SymbolLibrary component not found');

    /** @type {Map<string, object>} assetId → AssetEntry */
    const assetsById = new Map();
    /** uuid → assetId（同类去重） */
    const uuidToAssetId = new Map();

    function register(kind, uuid, preferredId, displayName) {
        if (!uuid) return '';
        if (uuidToAssetId.has(uuid)) return uuidToAssetId.get(uuid);
        const info = uuidIndex.get(uuid) || uuidIndex.get(uuid.split('@')[0]);
        let id = preferredId;
        if (!id) {
            const base = info ? slugFromPath(info.file, PACK) : uuid.slice(0, 8);
            const prefix = kind === 0 ? 'tex_' : kind === 1 ? 'spine_' : kind === 3 ? 'font_' : 'asset_';
            id = `${prefix}${base}`;
        }
        // 冲突时加后缀
        let finalId = id;
        let n = 2;
        while (assetsById.has(finalId) && uuidToAssetId.get(uuid) !== finalId) {
            // 若同 id 已指向同一 uuid 则可复用；否则改名
            const existing = assetsById.get(finalId);
            const existingUuid =
                existing.texture?.__uuid__ ||
                existing.spine?.__uuid__ ||
                existing.font?.__uuid__ ||
                '';
            if (existingUuid === uuid) {
                uuidToAssetId.set(uuid, finalId);
                return finalId;
            }
            finalId = `${id}_${n++}`;
        }
        const entry = assetEntryBase(finalId, displayName || finalId, kind);
        if (kind === 0) entry.texture = makeTextureRef(uuid);
        else if (kind === 1) entry.spine = makeSpineRef(uuid);
        else if (kind === 3) entry.font = makeFontRef(uuid);
        assetsById.set(finalId, entry);
        uuidToAssetId.set(uuid, finalId);
        return finalId;
    }

    // 库级：倍率字 / 扩散粒子 / split_B
    const fontId = register(
        3,
        libComp.multiDigitFont?.__uuid__,
        'font_seth_countup_01',
        'countup_01',
    );
    register(
        0,
        libComp.expandSplitParticle?.__uuid__,
        'tex_seth_times_particle',
        'timesParticle',
    );
    register(1, libComp.expandSplitB?.__uuid__, 'spine_seth_split_b', 'split_B');

    // 库级通用格子特效（AssetKind.effect）：中奖/消除框 + split
    function registerEffect(uuid, id, name, defaultAnim, front = true) {
        if (!uuid) return '';
        // 允许同 uuid 注册多条（不同 defaultAnim），不走 uuidToAssetId 去重
        if (assetsById.has(id)) return id;
        const entry = assetEntryBase(id, name, 5);
        entry.spine = makeSpineRef(uuid);
        entry.defaultAnim = defaultAnim || '';
        entry.effectFront = front;
        assetsById.set(id, entry);
        return id;
    }
    const frameUuid = libComp.winCellFx?.spine?.__uuid__ || libComp.vanishCellFx?.spine?.__uuid__;
    // winCellFx / vanishCellFx 是 __id__ 引用，需从 symbolLib 解引用
    const winFxObj = libComp.winCellFx?.__id__ != null ? symbolLib[libComp.winCellFx.__id__] : null;
    const vanishFxObj = libComp.vanishCellFx?.__id__ != null ? symbolLib[libComp.vanishCellFx.__id__] : null;
    const frameSpineUuid = winFxObj?.spine?.__uuid__ || vanishFxObj?.spine?.__uuid__ || '';
    if (frameSpineUuid) {
        registerEffect(frameSpineUuid, 'fx_seth_frame_win', 'frame·win', winFxObj?.anim || 'win', false);
        registerEffect(frameSpineUuid, 'fx_seth_frame_out', 'frame·out', vanishFxObj?.anim || 'out', true);
    }
    // split_A / split_B 文件扫描
    for (const metaPath of walkMeta(path.join(PACK, 'effects'))) {
        const base = path.basename(metaPath, '.meta');
        if (!/\.(json|skel)$/i.test(base)) continue;
        const meta = readJson(metaPath);
        if (meta.importer !== 'spine-data' || !meta.uuid) continue;
        const stem = path.basename(base, path.extname(base));
        if (stem === 'split_A') registerEffect(meta.uuid, 'fx_seth_split_a', 'split_A', '', true);
        if (stem === 'split_B') registerEffect(meta.uuid, 'fx_seth_split_b', 'split_B', 'split_B', true);
    }
    for (const ref of libComp.symbols) {
        const entry = symbolLib[ref.__id__];
        if (!entry || entry.__type__ !== 'SymbolEntry') continue;
        ensureSymbolEntryShape(entry);

        const texUuid = entry.texture?.__uuid__;
        const spineUuid = entry.spine?.__uuid__;
        const sid = String(entry.id).padStart(2, '0');
        const texId = register(0, texUuid, `tex_seth_${sid}_${entry.name || 'sym'}`, entry.name);
        const spineId = register(
            1,
            spineUuid,
            spineUuid ? `spine_seth_${sid}_${entry.name || 'sym'}` : '',
            entry.name,
        );

        entry.textureAssetId = texId || '';
        entry.spineAssetId = spineId || '';
        entry.prefabAssetId = entry.prefabAssetId || '';
        entry.visualVariants = entry.visualVariants || [];
        entry.placementMainId = entry.placementMainId || '';
        entry.placementTopStripId = entry.placementTopStripId || '';
        entry.placementTopStripCells = Math.max(1, entry.placementTopStripCells | 0 || 2);
        entry.placementTopStripVariantKey = entry.placementTopStripVariantKey || '';

        if (entry.kind === 1 && fontId) {
            entry.digitFontAssetId = fontId;
        }

        // 清空直接引用：强制走 AssetLibrary 解析（SymbolResolve）
        entry.texture = null;
        entry.spine = null;
        entry.prefab = null;
        entry.digitFont = null;
        entry.enterSound = null;
        entry.winSound = null;
        entry.vanishSound = null;
    }

    // 写 asset-library.prefab
    const assetEntries = [...assetsById.values()].sort((a, b) => a.id.localeCompare(b.id));
    const assetNodes = [];
    // 0 Prefab
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
    // 1 Node
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
    // 2 AssetLibrary
    const assetRefs = assetEntries.map((_, i) => ({ __id__: 3 + i }));
    assetNodes.push({
        __type__: ASSET_LIBRARY_TYPE,
        _name: '',
        _objFlags: 0,
        __editorExtras__: {},
        node: { __id__: 1 },
        _enabled: true,
        __prefab: null,
        assets: assetRefs,
        _id: '',
    });
    for (const e of assetEntries) assetNodes.push(e);

    writeJson(ASSET_LIB, assetNodes);

    if (!fs.existsSync(ASSET_LIB_META)) {
        writeJson(ASSET_LIB_META, {
            ver: '1.1.50',
            importer: 'prefab',
            imported: false,
            uuid: crypto.randomUUID(),
            files: [],
            subMetas: {},
            userData: { syncNodeName: 'asset-library' },
        });
    }

    writeJson(SYMBOL_LIB, symbolLib);

    console.log(`[migrate-golden-seth] asset entries: ${assetEntries.length}`);
    console.log(`[migrate-golden-seth] wrote ${path.relative(ROOT, ASSET_LIB)}`);
    console.log(`[migrate-golden-seth] updated ${path.relative(ROOT, SYMBOL_LIB)}`);
    console.log('请在 Creator 中 refresh packs/golden-seth，再打开 SymbolEditor 验收。');
}

main();
