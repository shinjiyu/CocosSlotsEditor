/**
 * SymbolDraft — H5 符号表可序列化草稿（只存 id 引用 + 动画名，不嵌 UUID）。
 * 运行时经 AssetLibrary 解析成 SymbolEntry 供预览墙 / 盘面使用。
 */

import { SymbolEntry, SymbolKind, SymbolVisualVariantDef } from './SymbolDefs';
import type { AssetProvider } from './AssetDefs';
import { resolveSymbolEntry } from './SymbolResolve';

export interface SymbolDraft {
    id: number;
    name: string;
    kind: SymbolKind;
    textureAssetId: string;
    spineAssetId: string;
    prefabAssetId: string;
    /** 同一逻辑符号的视觉变体；选择规则由盘面 profile / placement 决定。 */
    visualVariants: SymbolVisualVariantDraft[];
    /** 主盘落盘 recipeId；空=普通单格 */
    placementMainId: string;
    /** 顶条落盘 recipeId；空=普通单格 */
    placementTopStripId: string;
    placementTopStripCells: number;
    placementTopStripVariantKey: string;
    enterSoundAssetId: string;
    winSoundAssetId: string;
    vanishSoundAssetId: string;
    digitFontAssetId: string;
    winCellFxAssetId: string;
    vanishCellFxAssetId: string;
    idleAnim: string;
    enterAnim: string;
    winAnim: string;
    vanishAnim: string;
    scaleMul: number;
}

export interface SymbolVisualVariantDraft {
    key: string;
    label: string;
    textureAssetId: string;
    spineAssetId: string;
    prefabAssetId: string;
}

export interface SymbolSheetDoc {
    docVersion: 1;
    packId: string;
    zone: string;
    symbols: SymbolDraft[];
    updatedAt: string;
}

export function draftFromEntry(e: SymbolEntry): SymbolDraft {
    return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        textureAssetId: e.textureAssetId || '',
        spineAssetId: e.spineAssetId || '',
        prefabAssetId: e.prefabAssetId || '',
        visualVariants: (e.visualVariants ?? []).map((variant) => ({
            key: variant.key || '',
            label: variant.label || '',
            textureAssetId: variant.textureAssetId || '',
            spineAssetId: variant.spineAssetId || '',
            prefabAssetId: variant.prefabAssetId || '',
        })),
        placementMainId: e.placementMainId || '',
        placementTopStripId: e.placementTopStripId || '',
        placementTopStripCells: Math.max(1, e.placementTopStripCells | 0 || 2),
        placementTopStripVariantKey: e.placementTopStripVariantKey || '',
        enterSoundAssetId: e.enterSoundAssetId || '',
        winSoundAssetId: e.winSoundAssetId || '',
        vanishSoundAssetId: e.vanishSoundAssetId || '',
        digitFontAssetId: e.digitFontAssetId || '',
        winCellFxAssetId: e.winCellFxAssetId || '',
        vanishCellFxAssetId: e.vanishCellFxAssetId || '',
        idleAnim: e.idleAnim || '',
        enterAnim: e.enterAnim || '',
        winAnim: e.winAnim || '',
        vanishAnim: e.vanishAnim || '',
        scaleMul: e.scaleMul > 0 ? e.scaleMul : 1,
    };
}

export function entryFromDraft(d: SymbolDraft): SymbolEntry {
    const e = new SymbolEntry();
    e.id = d.id;
    e.name = d.name;
    e.kind = d.kind;
    e.textureAssetId = d.textureAssetId;
    e.spineAssetId = d.spineAssetId;
    e.prefabAssetId = d.prefabAssetId;
    e.visualVariants = (d.visualVariants ?? []).map((variant) => {
        const def = new SymbolVisualVariantDef();
        def.key = variant.key;
        def.label = variant.label;
        def.textureAssetId = variant.textureAssetId;
        def.spineAssetId = variant.spineAssetId;
        def.prefabAssetId = variant.prefabAssetId;
        return def;
    });
    e.placementMainId = d.placementMainId || '';
    e.placementTopStripId = d.placementTopStripId || '';
    e.placementTopStripCells = Math.max(1, d.placementTopStripCells | 0 || 2);
    e.placementTopStripVariantKey = d.placementTopStripVariantKey || '';
    e.enterSoundAssetId = d.enterSoundAssetId;
    e.winSoundAssetId = d.winSoundAssetId;
    e.vanishSoundAssetId = d.vanishSoundAssetId;
    e.digitFontAssetId = d.digitFontAssetId;
    e.winCellFxAssetId = d.winCellFxAssetId;
    e.vanishCellFxAssetId = d.vanishCellFxAssetId;
    e.idleAnim = d.idleAnim;
    e.enterAnim = d.enterAnim;
    e.winAnim = d.winAnim;
    e.vanishAnim = d.vanishAnim;
    e.scaleMul = d.scaleMul > 0 ? d.scaleMul : 1;
    return e;
}

/**
 * 旧包无 assetId、只有直接引用时：把当前解析结果的直接引用抄到 entry，
 * 再叠加草稿字段（H5 仍可预览；导出 sheet 不带 UUID，需素材库才可迁移）。
 */
export function resolveDraft(d: SymbolDraft, assets: AssetProvider | null, fallback?: SymbolEntry | null): SymbolEntry {
    const e = entryFromDraft(d);
    if (fallback) {
        if (!e.texture) e.texture = fallback.texture;
        if (!e.spine) e.spine = fallback.spine;
        if (!e.prefab) e.prefab = fallback.prefab;
        if (!e.enterSound) e.enterSound = fallback.enterSound;
        if (!e.winSound) e.winSound = fallback.winSound;
        if (!e.vanishSound) e.vanishSound = fallback.vanishSound;
        if (!e.digitFont) e.digitFont = fallback.digitFont;
        for (const variant of e.visualVariants) {
            const source = fallback.visualVariants?.find((candidate) => candidate.key === variant.key);
            if (!source) continue;
            if (!variant.texture) variant.texture = source.texture;
            if (!variant.spine) variant.spine = source.spine;
            if (!variant.prefab) variant.prefab = source.prefab;
        }
    }
    return resolveSymbolEntry(e, assets);
}

export function makeEmptyDraft(id: number): SymbolDraft {
    return {
        id,
        name: `symbol_${id}`,
        kind: SymbolKind.normal,
        textureAssetId: '',
        spineAssetId: '',
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
        idleAnim: '',
        enterAnim: '',
        winAnim: '',
        vanishAnim: '',
        scaleMul: 1,
    };
}

export function serializeSheet(doc: SymbolSheetDoc, space = 2): string {
    return JSON.stringify(doc, null, space);
}

export function parseSheet(json: string): SymbolSheetDoc {
    const raw = JSON.parse(json) as SymbolSheetDoc;
    if (!raw || raw.docVersion !== 1 || !Array.isArray(raw.symbols)) {
        throw new Error('不是合法 SymbolSheetDoc');
    }
    raw.symbols = raw.symbols.map((symbol) => ({
        ...symbol,
        visualVariants: Array.isArray(symbol.visualVariants) ? symbol.visualVariants : [],
    }));
    return raw;
}
