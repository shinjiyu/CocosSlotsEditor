'use strict';

/**
 * 导出 Symbol 包：从 symbol-library.prefab 出发收集依赖闭包
 * （纹理、spine 全套、自定义 prefab 递归），连同 .meta 拷到 temp/symbol-pack/。
 *
 * AI 主路径：exportPackForAi(opts) — 静默、无 Dialog、结构化返回。
 * 人工菜单：exportPack() — 兼容旧行为（默认可按盘面文档裁剪）。
 */

const path = require('path');
const fs = require('fs');

/**
 * 运行时脚本：单文件。
 * 覆盖完整播放闭环：符号库 + 盘面渲染 + 动画模板 + 播放编排 + 事件/音效。
 * 编辑器专属（EditorHud / BoardEditorMain / PersistenceService）不随包。
 */
const RUNTIME_SCRIPTS = [
    'assets/scripts/editor-app/SymbolDefs.ts',
    'assets/scripts/editor-app/SymbolLibrary.ts',
    'assets/scripts/editor-app/SymbolView.ts',
    'assets/scripts/editor-app/SymbolTemplate.ts',
    'assets/scripts/editor-app/SymbolCatalog.ts',
    'assets/scripts/editor-app/GamePack.ts',
    'assets/scripts/editor-app/SpineZone.ts',
    'assets/scripts/editor-app/symbolFx.ts',
    'assets/scripts/editor-app/sfx.ts',
    'assets/scripts/editor-app/boardEvents.ts',
    'assets/scripts/editor-app/animTemplates.ts',
    'assets/scripts/editor-app/BoardView.ts',
    'assets/scripts/editor-app/BoardDirector.ts',
    'assets/scripts/editor-app/BoardStage.ts',
];
/** 运行时脚本：整目录（IAnim 框架、SPIR 文档模型与 schema） */
const RUNTIME_DIRS = [
    'assets/scripts/common',
    'assets/scripts/editor-core',
    'assets/scripts/vendor/slot-presentation-ir',
];

/**
 * Collect symbolIds referenced by an EditorDoc / SPIR JSON.
 * @param {any} doc
 * @returns {number[]}
 */
function collectUsedSymbolIds(doc) {
    const used = new Set();
    if (!doc || !Array.isArray(doc.states)) return [];
    for (const state of doc.states) {
        const board = state && state.board;
        if (!board) continue;
        for (const grid of [board.display, board.resolved]) {
            if (!Array.isArray(grid)) continue;
            for (const col of grid) {
                if (!Array.isArray(col)) continue;
                for (const cell of col) {
                    if (cell && cell.symbolId != null && Number.isFinite(Number(cell.symbolId))) {
                        used.add(Number(cell.symbolId));
                    }
                }
            }
        }
        const ents = board.entities;
        if (ents && typeof ents === 'object') {
            for (const ent of Object.values(ents)) {
                if (ent && ent.symbolId != null && Number.isFinite(Number(ent.symbolId))) {
                    used.add(Number(ent.symbolId));
                }
            }
        }
    }
    return [...used].sort((a, b) => a - b);
}

function resolveLibraryPrefab(projectRoot, packId) {
    const resourcesRoot = path.join(projectRoot, 'assets/resources');
    const zoneRoots = ['spine-3.8/packs', 'spine-4.2/packs', 'games'].map((r) =>
        path.join(resourcesRoot, r),
    );

    if (packId) {
        for (const root of zoneRoots) {
            const p = path.join(root, packId, 'symbol-library.prefab');
            if (fs.existsSync(p)) return p;
        }
        throw new Error(`找不到 packs/${packId}/symbol-library.prefab（已查 spine-*/packs 与旧 games/）`);
    }
    const legacy = path.join(resourcesRoot, 'symbol-library.prefab');
    if (fs.existsSync(legacy)) return legacy;
    for (const root of zoneRoots) {
        if (!fs.existsSync(root)) continue;
        const dirs = fs
            .readdirSync(root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();
        for (const id of dirs) {
            const cand = path.join(root, id, 'symbol-library.prefab');
            if (fs.existsSync(cand)) return cand;
        }
    }
    throw new Error(
        '找不到 symbol-library.prefab（期望 assets/resources/spine-*/packs/<packId>/ 或旧 games/）',
    );
}

function inferGameId(rootPrefab, projectRoot) {
    const rel = path.relative(projectRoot, rootPrefab).replace(/\\/g, '/');
    const m =
        rel.match(/^assets\/resources\/spine-(?:3\.8|4\.2)\/packs\/([^/]+)\//) ||
        rel.match(/^assets\/resources\/games\/([^/]+)\//);
    return m ? m[1] : '';
}

/**
 * Rebuild a library prefab JSON keeping only SymbolEntry ids in usedSet.
 * Preserves Node / SymbolLibrary globals (win/vanish FX, digit font, expand FX).
 * @param {any[]} objs
 * @param {Set<number>} usedSet
 */
function pruneLibraryPrefab(objs, usedSet) {
    if (!Array.isArray(objs)) throw new Error('invalid prefab format');
    const byId = new Map();
    for (let i = 0; i < objs.length; i++) byId.set(i, objs[i]);

    const libIdx = objs.findIndex((o) => o && Array.isArray(o.symbols));
    if (libIdx < 0) throw new Error('SymbolLibrary component not found in prefab');
    const lib = objs[libIdx];

    /** @type {{ entry: any, winFx: any|null, vanishFx: any|null }[]} */
    const kept = [];
    const dropped = [];
    for (const ref of lib.symbols) {
        const idx = ref && ref.__id__;
        if (typeof idx !== 'number') continue;
        const e = byId.get(idx);
        if (!e || e.__type__ !== 'SymbolEntry') continue;
        const id = Number(e.id);
        if (!usedSet.has(id)) {
            dropped.push(id);
            continue;
        }
        const winFx =
            e.winCellFx && typeof e.winCellFx.__id__ === 'number'
                ? byId.get(e.winCellFx.__id__)
                : null;
        const vanishFx =
            e.vanishCellFx && typeof e.vanishCellFx.__id__ === 'number'
                ? byId.get(e.vanishCellFx.__id__)
                : null;
        kept.push({
            entry: JSON.parse(JSON.stringify(e)),
            winFx: winFx ? JSON.parse(JSON.stringify(winFx)) : null,
            vanishFx: vanishFx ? JSON.parse(JSON.stringify(vanishFx)) : null,
        });
    }
    if (!kept.length) {
        throw new Error(
            `按盘面裁剪后无符号条目（used=[${[...usedSet].join(',')}]; dropped=[${dropped.join(',')}])`,
        );
    }

    const prefab = objs.find((o) => o && o.__type__ === 'cc.Prefab');
    const node = objs.find((o) => o && o.__type__ === 'cc.Node' && o._name === 'symbol-library')
        || objs.find((o) => o && o.__type__ === 'cc.Node');
    const prefabInfo = objs.find((o) => o && o.__type__ === 'cc.PrefabInfo');
    const libCompInfo = objs.find(
        (o, i) => o && o.__type__ === 'cc.CompPrefabInfo' && i === libIdx + 1,
    ) || { __type__: 'cc.CompPrefabInfo', fileId: 'cb6YrypGFLYq+nAyn1fn7A' };

    const globalWin =
        lib.winCellFx && typeof lib.winCellFx.__id__ === 'number'
            ? JSON.parse(JSON.stringify(byId.get(lib.winCellFx.__id__)))
            : null;
    const globalVanish =
        lib.vanishCellFx && typeof lib.vanishCellFx.__id__ === 'number'
            ? JSON.parse(JSON.stringify(byId.get(lib.vanishCellFx.__id__)))
            : null;

    /** @type {any[]} */
    const out = [];
    out.push(JSON.parse(JSON.stringify(prefab))); // 0
    const nodeCopy = JSON.parse(JSON.stringify(node));
    nodeCopy._components = [{ __id__: 2 }];
    nodeCopy._prefab = { __id__: null }; // fill later
    out.push(nodeCopy); // 1

    const libCopy = JSON.parse(JSON.stringify(lib));
    libCopy.node = { __id__: 1 };
    libCopy.__prefab = { __id__: 3 };
    libCopy.symbols = [];
    out.push(libCopy); // 2
    out.push(JSON.parse(JSON.stringify(libCompInfo))); // 3

    for (const item of kept) {
        const entryId = out.length;
        const entry = item.entry;
        out.push(entry);
        if (item.winFx) {
            const wid = out.length;
            out.push(item.winFx);
            entry.winCellFx = { __id__: wid };
        } else {
            entry.winCellFx = { __id__: -1 };
        }
        if (item.vanishFx) {
            const vid = out.length;
            out.push(item.vanishFx);
            entry.vanishCellFx = { __id__: vid };
        } else {
            entry.vanishCellFx = { __id__: -1 };
        }
        // fix invalid -1: use empty CellFxDef inline
        if (entry.winCellFx.__id__ === -1) {
            const wid = out.length;
            out.push({
                __type__: 'CellFxDef',
                spine: null,
                anim: '',
                front: true,
                scale: 1,
                offset: { __type__: 'cc.Vec2', x: 0, y: 0 },
                sound: null,
                soundVolume: 1,
            });
            entry.winCellFx = { __id__: wid };
        }
        if (entry.vanishCellFx.__id__ === -1) {
            const vid = out.length;
            out.push({
                __type__: 'CellFxDef',
                spine: null,
                anim: '',
                front: true,
                scale: 1,
                offset: { __type__: 'cc.Vec2', x: 0, y: 0 },
                sound: null,
                soundVolume: 1,
            });
            entry.vanishCellFx = { __id__: vid };
        }
        libCopy.symbols.push({ __id__: entryId });
    }

    if (globalWin) {
        const wid = out.length;
        out.push(globalWin);
        libCopy.winCellFx = { __id__: wid };
    }
    if (globalVanish) {
        const vid = out.length;
        out.push(globalVanish);
        libCopy.vanishCellFx = { __id__: vid };
    }

    const pi = prefabInfo
        ? JSON.parse(JSON.stringify(prefabInfo))
        : {
              __type__: 'cc.PrefabInfo',
              root: { __id__: 1 },
              asset: { __id__: 0 },
              fileId: 'symbolLibraryRoot',
              instance: null,
              targetOverrides: null,
              nestedPrefabInstanceRoots: null,
          };
    pi.root = { __id__: 1 };
    pi.asset = { __id__: 0 };
    const piId = out.length;
    out.push(pi);
    out[1]._prefab = { __id__: piId };

    return { objs: out, keptIds: kept.map((k) => Number(k.entry.id)), droppedIds: dropped };
}

/**
 * @param {{
 *   gameId?: string,
 *   docRel?: string,
 *   usedSymbolIds?: number[],
 *   usedOnly?: boolean,
 *   includeRuntimeScripts?: boolean,
 *   outRel?: string,
 * }} [opts]
 */
async function exportPack(opts = {}) {
    const projectRoot = Editor.Project.path;
    const usedOnly = opts.usedOnly !== false; // AI default: prune
    const includeRuntimeScripts = !!opts.includeRuntimeScripts;
    const outRel = (opts.outRel || 'temp/symbol-pack').replace(/\\/g, '/');
    const outRoot = path.isAbsolute(outRel) ? outRel : path.join(projectRoot, outRel);
    fs.rmSync(outRoot, { recursive: true, force: true });
    fs.mkdirSync(outRoot, { recursive: true });

    const copied = new Set();
    const warnings = [];
    const assetRels = [];

    function copyFileWithMeta(absFile) {
        const rel = path.relative(projectRoot, absFile).replace(/\\/g, '/');
        if (copied.has(rel)) return;
        if (!fs.existsSync(absFile)) {
            warnings.push(`缺失文件: ${rel}`);
            return;
        }
        const dst = path.join(outRoot, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(absFile, dst);
        copied.add(rel);
        assetRels.push(rel);
        const meta = `${absFile}.meta`;
        if (fs.existsSync(meta)) fs.copyFileSync(meta, `${dst}.meta`);
        else warnings.push(`无 meta: ${rel}`);
    }

    function copyDirWithMeta(absDir) {
        for (const f of fs.readdirSync(absDir)) {
            if (f.endsWith('.meta')) continue;
            const p = path.join(absDir, f);
            if (fs.statSync(p).isDirectory()) copyDirWithMeta(p);
            else copyFileWithMeta(p);
        }
    }

    const gameId = opts.gameId || process.env.SYMBOL_GAME_ID || '';
    const rootPrefab = resolveLibraryPrefab(projectRoot, gameId);
    const resolvedGameId = gameId || inferGameId(rootPrefab, projectRoot);
    console.log(`[export-pack] library = ${path.relative(projectRoot, rootPrefab)}`);

    /** @type {number[]} */
    let usedSymbolIds = Array.isArray(opts.usedSymbolIds)
        ? opts.usedSymbolIds.map(Number).filter((n) => Number.isFinite(n))
        : [];

    if (!usedSymbolIds.length && opts.docRel) {
        const docAbs = path.isAbsolute(opts.docRel)
            ? opts.docRel
            : path.join(projectRoot, opts.docRel);
        if (!fs.existsSync(docAbs)) throw new Error(`docRel not found: ${opts.docRel}`);
        const doc = JSON.parse(fs.readFileSync(docAbs, 'utf8'));
        usedSymbolIds = collectUsedSymbolIds(doc);
    }

    // Default AI/doc path: configs/presentation/doc_example.json when usedOnly and no ids yet
    if (!usedSymbolIds.length && usedOnly) {
        const fallback = path.join(
            projectRoot,
            'assets/resources/configs/presentation/doc_example.json',
        );
        if (fs.existsSync(fallback)) {
            const doc = JSON.parse(fs.readFileSync(fallback, 'utf8'));
            usedSymbolIds = collectUsedSymbolIds(doc);
            warnings.push('usedSymbolIds 空，已回退 doc_example.json');
        }
    }

    let seedPrefab = rootPrefab;
    let keptIds = [];
    let droppedIds = [];
    let prunedRel = '';

    if (usedOnly) {
        if (!usedSymbolIds.length) {
            throw new Error(
                'usedOnly 需要 usedSymbolIds 或可读的盘面 docRel（未解析到任何 symbolId）',
            );
        }
        const objs = JSON.parse(fs.readFileSync(rootPrefab, 'utf8'));
        const pruned = pruneLibraryPrefab(objs, new Set(usedSymbolIds));
        keptIds = pruned.keptIds;
        droppedIds = pruned.droppedIds;
        const pruneDir = path.join(outRoot, '_prune');
        fs.mkdirSync(pruneDir, { recursive: true });
        seedPrefab = path.join(pruneDir, 'symbol-library.pruned.prefab');
        fs.writeFileSync(seedPrefab, `${JSON.stringify(pruned.objs, null, 2)}\n`, 'utf8');
        prunedRel = path.relative(projectRoot, seedPrefab).replace(/\\/g, '/');
        console.log(
            `[export-pack] prune kept=[${keptIds.join(',')}] dropped=[${droppedIds.join(',')}]`,
        );
    }

    // Dependency closure from seed prefab
    const visitedUuids = new Set();
    const queue = [seedPrefab];
    const libraryRelInPack = path
        .relative(projectRoot, rootPrefab)
        .replace(/\\/g, '/');

    while (queue.length) {
        const file = queue.pop();
        // Seed pruned prefab is not under assets/; write final library at original libraryRel
        if (file === seedPrefab && usedOnly) {
            const dstLib = path.join(outRoot, libraryRelInPack);
            fs.mkdirSync(path.dirname(dstLib), { recursive: true });
            fs.copyFileSync(seedPrefab, dstLib);
            const srcMeta = `${rootPrefab}.meta`;
            if (fs.existsSync(srcMeta)) fs.copyFileSync(srcMeta, `${dstLib}.meta`);
            copied.add(libraryRelInPack);
            assetRels.push(libraryRelInPack);
        } else {
            copyFileWithMeta(file);
        }
        if (!file.endsWith('.prefab') && !file.endsWith('.scene')) continue;
        const txt = fs.readFileSync(file, 'utf-8');
        const uuids = [...new Set([...txt.matchAll(/"__uuid__":\s*"([^"]+)"/g)].map((m) => m[1]))];
        for (const u of uuids) {
            const base = u.split('@')[0];
            if (visitedUuids.has(base)) continue;
            visitedUuids.add(base);
            const info = await Editor.Message.request('asset-db', 'query-asset-info', base);
            if (!info || !info.file) {
                warnings.push(`uuid 无法解析: ${u}`);
                continue;
            }
            if (info.type === 'sp.SkeletonData') {
                copyDirWithMeta(path.dirname(info.file));
            } else if (info.type === 'cc.Prefab') {
                queue.push(info.file);
            } else if (info.type === 'cc.BitmapFont') {
                // .fnt 单独 uuid；atlas png 在 meta.userData.textureUuid / 同目录 atlasName
                copyFileWithMeta(info.file);
                try {
                    const metaPath = `${info.file}.meta`;
                    if (fs.existsSync(metaPath)) {
                        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                        const texUuid = meta?.userData?.textureUuid
                            ? String(meta.userData.textureUuid).split('@')[0]
                            : '';
                        if (texUuid && !visitedUuids.has(texUuid)) {
                            visitedUuids.add(texUuid);
                            const texInfo = await Editor.Message.request(
                                'asset-db',
                                'query-asset-info',
                                texUuid,
                            );
                            if (texInfo?.file) copyFileWithMeta(texInfo.file);
                            else warnings.push(`BitmapFont atlas uuid 无法解析: ${texUuid}`);
                        }
                        const atlasName = meta?.userData?._fntConfig?.atlasName;
                        if (atlasName) {
                            const sibling = path.join(path.dirname(info.file), atlasName);
                            if (fs.existsSync(sibling)) copyFileWithMeta(sibling);
                        }
                    }
                } catch (e) {
                    warnings.push(`BitmapFont 依赖收集失败: ${e.message || e}`);
                }
            } else {
                copyFileWithMeta(info.file);
            }
        }
    }

    // Remove prune scratch from pack tree listing (keep files outside assets unused)
    const pruneScratch = path.join(outRoot, '_prune');
    if (fs.existsSync(pruneScratch)) fs.rmSync(pruneScratch, { recursive: true, force: true });

    if (includeRuntimeScripts) {
        for (const rel of RUNTIME_SCRIPTS) copyFileWithMeta(path.join(projectRoot, rel));
        for (const rel of RUNTIME_DIRS) copyDirWithMeta(path.join(projectRoot, rel));
    }

    const manifest = {
        ok: true,
        exportedAt: new Date().toISOString(),
        gameId: resolvedGameId,
        libraryRel: libraryRelInPack,
        usedOnly,
        usedSymbolIds: usedOnly ? keptIds : usedSymbolIds,
        droppedSymbolIds: droppedIds,
        includeRuntimeScripts,
        files: copied.size,
        assetRels: [...new Set(assetRels)].sort(),
        warnings,
        outRel,
    };
    fs.writeFileSync(
        path.join(outRoot, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
    );

    fs.writeFileSync(
        path.join(outRoot, 'README.md'),
        [
            '# Symbol 包',
            '',
            `导出自 symbolEditor，时间 ${manifest.exportedAt}`,
            `gameId=${resolvedGameId || '(legacy)'} usedOnly=${usedOnly}`,
            usedOnly ? `kept=[${keptIds.join(',')}] dropped=[${droppedIds.join(',')}]` : '',
            '',
            '## AI / AIWS',
            '',
            '1. 经 cocos-meta-mcp 调用 `symbol-tools/export-pack-for-ai`（静默）。',
            '2. 读取本目录 `manifest.json` → `outRel` / `assetRels`。',
            '3. 把 `assets/` 合并进目标工程 `assets/`（保留 .meta）。',
            '4. 脚本请用 AIWS `seRuntimeSync`，本包默认不含 runtime TS（`includeRuntimeScripts=false`）。',
            '',
            '## 人工',
            '',
            '1. 合并 `assets/` 到目标 Cocos 工程。',
            '2. Creator 打开目标工程等待导入。',
            '3. BoardStage / SymbolCatalog 指向库 prefab。',
        ]
            .filter(Boolean)
            .join('\n'),
    );

    return {
        ok: true,
        out: outRoot,
        outRel,
        gameId: resolvedGameId,
        libraryRel: libraryRelInPack,
        usedOnly,
        usedSymbolIds: usedOnly ? keptIds : usedSymbolIds,
        droppedSymbolIds: droppedIds,
        includeRuntimeScripts,
        files: copied.size,
        assetRels: manifest.assetRels,
        warnings,
        prunedRel: prunedRel || undefined,
    };
}

/** AI 静默入口（默认 usedOnly + 不含 runtime 脚本） */
async function exportPackForAi(opts = {}) {
    return exportPack({
        usedOnly: true,
        includeRuntimeScripts: false,
        ...opts,
    });
}

module.exports = {
    exportPack,
    exportPackForAi,
    collectUsedSymbolIds,
    RUNTIME_SCRIPTS,
    RUNTIME_DIRS,
};
