/**
 * SymbolEditorMain — H5 符号编辑器入口。
 * 加载当前 Spine 区符号包 → 素材库 + 符号草稿 → 预览墙编辑 → 导出 JSON。
 */

import { _decorator, Component, Node, UITransform, Color, Graphics, Label, director, EventTouch, Mask } from 'cc';
import { SymbolCatalog } from './SymbolCatalog';
import { SymbolView } from './SymbolView';
import { SymbolEditorHud } from './SymbolEditorHud';
import type { SymbolAssetField, SymbolHudCallbacks, PackFxField } from './SymbolEditorHud';
import {
    draftFromEntry,
    makeEmptyDraft,
    parseSheet,
    resolveDraft,
    serializeSheet,
    type SymbolDraft,
    type SymbolSheetDoc,
} from './SymbolDraft';
import { SymbolKind, type SymbolEntry, type SymbolProvider, DESIGN_CELL_W, DESIGN_CELL_H } from './SymbolDefs';
import type { CellFxDef } from './SymbolDefs';
import type { AssetEntry, AssetProvider } from './AssetDefs';
import { PLACEMENT_RECIPE_IDS } from './placement';
import {
    cyclePackId,
    getGamePack,
    listActiveGamePacks,
    loadStoredPackId,
    storePackId,
    tryGetSymbolPack,
    type GamePackDef,
} from './GamePack';
import { loadActiveSpineZone, getActiveSpineZoneSync } from './SpineZone';
import { bootRemoteConsole } from '../debug/remoteConsoleBoot';

const { ccclass } = _decorator;

const STORE_PREFIX = 'symbolEditor.symbolSheet.';
/** 预览墙：竖卡，默认每行数量；实际尺寸按可用区重算 */
const PER_ROW = 5;
const PROBE_VERSION = 5;

@ccclass('SymbolEditorMain')
export class SymbolEditorMain extends Component {
    private catalog = new SymbolCatalog();
    private hud: SymbolEditorHud | null = null;
    private pack: GamePackDef | null = null;
    private drafts: SymbolDraft[] = [];
    private selectedId: number | null = null;
    private wallCells = new Map<number, { node: Node; view: SymbolView; cellW: number; cellH: number; labelGap: number }>();
    private provider: DraftProvider | null = null;
    private switching = false;

    async start(): Promise<void> {
        bootRemoteConsole();
        console.log(`[SymbolEditorMain] PROBE_VERSION=${PROBE_VERSION}`);
        (globalThis as Record<string, unknown>).__SYMBOL_EDITOR_PROBE__ = PROBE_VERSION;
        // 清掉场景里误挂的 prefab 实例（旧调试残留，会以原尺寸盖在正中间）
        this.stripStrayPrefabInstances();
        try {
            const zone = await loadActiveSpineZone();
            const pack = tryGetSymbolPack(loadStoredPackId(), zone);
            if (!pack) {
                this.buildEmptyHud(`当前区 ${zone} 无符号包`);
                return;
            }
            this.pack = getGamePack(pack.id);
            await this.catalog.loadPack(this.pack);
            this.drafts = this.loadDrafts();
            this.provider = new DraftProvider(this.drafts, this.catalog);
            this.buildUi();
            this.rebuildWall();
            this.selectFirst();
            this.hud?.setStatus(`符号编辑 · ${this.pack.id} · ${this.drafts.length} 个`);
            console.log(`[SymbolEditorMain] ready pack=${this.pack.id} symbols=${this.drafts.length}`);
        } catch (e) {
            console.error('[SymbolEditorMain] load failed', e);
        }
    }

    /** 场景里误放的符号 prefab（如 lvbu-low-symbol）会以设计尺寸出现在 Canvas 中心 */
    private stripStrayPrefabInstances(): void {
        const canvas = this.node.parent;
        if (!canvas) return;
        for (const child of [...canvas.children]) {
            if (child === this.node) continue;
            if (child.name === 'Camera' || child.name === 'EditorRoot') continue;
            // 常见残留：符号 prefab 根节点
            if (/symbol|lvbu-|seth-/i.test(child.name)) {
                console.warn(`[SymbolEditorMain] remove stray scene node: ${child.name}`);
                child.destroy();
            }
        }
    }

    private buildEmptyHud(msg: string): void {
        const hudNode = new Node('Hud');
        hudNode.addComponent(UITransform);
        this.node.addChild(hudNode);
        this.hud = hudNode.addComponent(SymbolEditorHud);
        this.hud.init(this.makeCallbacks(), msg);
        this.hud.setStatus(msg);
    }

    private buildUi(): void {
        const hudNode = new Node('Hud');
        hudNode.addComponent(UITransform);
        this.node.addChild(hudNode);
        this.hud = hudNode.addComponent(SymbolEditorHud);
        const zone = getActiveSpineZoneSync();
        const packs = listActiveGamePacks();
        const i = Math.max(0, packs.findIndex((p) => p.id === this.pack!.id)) + 1;
        this.hud.init(this.makeCallbacks(), `${this.pack!.name} (${i}/${packs.length}) · ${zone}`);
        this.hud.ensureWallRoot();
    }

    private makeCallbacks(): SymbolHudCallbacks {
        return {
            onPickSymbol: (id) => this.selectSymbol(id),
            onAddSymbol: () => this.addSymbol(),
            onRemoveSymbol: () => this.removeSelected(),
            onCyclePack: (dir) => void this.cyclePack(dir),
            onExport: () => this.exportSheet(),
            onImport: () => void this.importSheet(),
            onOpenBoard: () => this.openBoard(),
            onPatchField: (key, dir) => this.patchField(key, dir),
            onPickAsset: (field, assetId) => this.pickAsset(field, assetId),
            onPickPackFx: (field, assetId) => this.pickPackFx(field, assetId),
            onPickVariantAsset: (index, assetId) => this.pickVariantAsset(index, assetId),
            onPreviewAnim: (kind) => void this.previewAnim(kind),
        };
    }

    private refreshPackFxHud(): void {
        this.hud?.setPackFx(
            this.catalog.packWinCellFxAssetId(),
            this.catalog.packVanishCellFxAssetId(),
        );
    }

    private loadDrafts(): SymbolDraft[] {
        const packId = this.pack!.id;
        try {
            const raw = localStorage.getItem(STORE_PREFIX + packId);
            if (raw) {
                const doc = parseSheet(raw);
                if (doc.packId === packId && doc.symbols.length) {
                    // 恢复包级通用 FX（若草稿里存过）
                    if (doc.winCellFxAssetId != null) {
                        this.catalog.setPackCellFx('win', doc.winCellFxAssetId);
                    }
                    if (doc.vanishCellFxAssetId != null) {
                        this.catalog.setPackCellFx('vanish', doc.vanishCellFxAssetId);
                    }
                    // 旧本地草稿没有 visualVariants：从新版包定义补齐一次，保留用户其它字段。
                    const sourceById = new Map(
                        this.catalog.getSourceEntries().map((entry) => [entry.id, draftFromEntry(entry)]),
                    );
                    for (const draft of doc.symbols) {
                        const source = sourceById.get(draft.id);
                        if ((draft.visualVariants?.length ?? 0) === 0) {
                            if ((source?.visualVariants?.length ?? 0) > 0) {
                                draft.visualVariants = source!.visualVariants.map((variant) => ({
                                    ...variant,
                                }));
                            } else if (!Array.isArray(draft.visualVariants)) {
                                draft.visualVariants = [];
                            }
                        }
                        // 旧草稿无 placement：从包定义补齐（有任一字段则视为已配置）
                        if (
                            source &&
                            !(draft.placementMainId || draft.placementTopStripId)
                        ) {
                            draft.placementMainId = source.placementMainId || '';
                            draft.placementTopStripId = source.placementTopStripId || '';
                            draft.placementTopStripCells = source.placementTopStripCells || 2;
                            draft.placementTopStripVariantKey =
                                source.placementTopStripVariantKey || '';
                        } else {
                            draft.placementMainId = draft.placementMainId || '';
                            draft.placementTopStripId = draft.placementTopStripId || '';
                            draft.placementTopStripCells = Math.max(
                                1,
                                draft.placementTopStripCells | 0 || 2,
                            );
                            draft.placementTopStripVariantKey =
                                draft.placementTopStripVariantKey || '';
                        }
                        // 旧草稿缺横版 visualVariants：从包定义补齐 orientation 键
                        if (source?.visualVariants?.length) {
                            const have = new Set((draft.visualVariants ?? []).map((v) => v.key));
                            for (const v of source.visualVariants) {
                                if (!have.has(v.key)) {
                                    draft.visualVariants = draft.visualVariants ?? [];
                                    draft.visualVariants.push({ ...v });
                                }
                            }
                        }
                    }
                    return doc.symbols;
                }
            }
        } catch {
            /* ignore */
        }
        // 从 catalog 源表倒出草稿（保留 assetId；兼容旧包直接引用）
        return this.catalog.getSourceEntries().map((e) => draftFromEntry(e));
    }

    private persist(): void {
        if (!this.pack) return;
        const doc: SymbolSheetDoc = {
            docVersion: 1,
            packId: this.pack.id,
            zone: getActiveSpineZoneSync(),
            symbols: this.drafts,
            winCellFxAssetId: this.catalog.packWinCellFxAssetId(),
            vanishCellFxAssetId: this.catalog.packVanishCellFxAssetId(),
            updatedAt: new Date().toISOString(),
        };
        try {
            localStorage.setItem(STORE_PREFIX + this.pack.id, serializeSheet(doc, 0));
        } catch {
            /* ignore */
        }
    }

    private assets(): readonly AssetEntry[] {
        return this.catalog.assetLibrary?.assets ?? [];
    }

    private rebuildWall(): void {
        const root = this.hud?.ensureWallRoot();
        if (!root || !this.provider) return;
        root.removeAllChildren();
        this.wallCells.clear();

        const area = this.hud!.wallAreaSize();
        const count = Math.max(1, this.drafts.length);
        const cols = Math.min(PER_ROW, count);
        const rows = Math.ceil(count / cols);
        const gap = 8;
        const labelGap = 14;
        // 在可用区内算格子，竖卡比例约 0.72
        const maxCellW = Math.floor((area.w - gap * (cols - 1)) / cols);
        const maxCellH = Math.floor((area.h - (labelGap + gap) * rows + gap) / rows);
        const cellW = Math.max(64, Math.min(110, maxCellW));
        const cellH = Math.max(84, Math.min(148, Math.min(maxCellH, Math.round(cellW / 0.72))));
        const pitchX = cellW + gap;
        const pitchY = cellH + gap + labelGap;
        const gridW = cols * cellW + (cols - 1) * gap;
        const gridH = rows * cellH + (rows - 1) * (gap + labelGap) + labelGap;
        // content 原点在视口左上；把网格整体居中
        const originX = (area.w - gridW) / 2 + cellW / 2;
        const originY = -(area.h - gridH) / 2 - cellH / 2;

        for (let i = 0; i < this.drafts.length; i++) {
            const d = this.drafts[i]!;
            const cell = new Node(`sym_${d.id}`);
            cell.addComponent(UITransform).setContentSize(cellW, cellH + labelGap);
            const col = i % cols;
            const row = Math.floor(i / cols);
            cell.setPosition(originX + col * pitchX, originY - row * pitchY, 0);

            const bg = new Node('bg');
            bg.addComponent(UITransform).setContentSize(cellW, cellH);
            bg.setPosition(0, labelGap / 2, 0);
            const g = bg.addComponent(Graphics);
            g.fillColor = new Color(36, 40, 58, 255);
            g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 6);
            g.fill();
            cell.addChild(bg);

            const viewHost = new Node('view');
            viewHost.addComponent(UITransform).setContentSize(cellW - 6, cellH - 6);
            viewHost.addComponent(Mask).type = Mask.Type.RECT;
            viewHost.setPosition(0, labelGap / 2, 0);
            const view = viewHost.addComponent(SymbolView);
            view.setup(this.provider, cellW - 6, cellH - 6, 0.9);
            view.setSymbol(d.id);
            cell.addChild(viewHost);

            const lab = new Node('lab');
            lab.addComponent(UITransform).setContentSize(cellW, 14);
            lab.setPosition(0, -cellH / 2 + labelGap / 2 - 8, 0);
            const label = lab.addComponent(Label);
            label.string = `#${d.id}`;
            label.fontSize = 11;
            label.color = new Color(190, 200, 220, 255);
            label.overflow = Label.Overflow.SHRINK;
            cell.addChild(lab);

            cell.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.selectSymbol(d.id);
            });

            root.addChild(cell);
            this.wallCells.set(d.id, { node: cell, view, cellW, cellH, labelGap });
        }
        this.refreshSelectionChrome();
    }

    private selectFirst(): void {
        this.refreshPackFxHud();
        if (this.drafts.length) this.selectSymbol(this.drafts[0]!.id);
        else {
            this.selectedId = null;
            this.hud?.setSelected(null, null, this.assets());
        }
    }

    private selectSymbol(id: number): void {
        this.selectedId = id;
        const draft = this.drafts.find((d) => d.id === this.selectedId) ?? null;
        this.refreshPackFxHud();
        this.hud?.setSelected(this.selectedId, draft, this.assets());
        this.refreshSelectionChrome();
    }

    private refreshSelectionChrome(): void {
        for (const [id, cell] of this.wallCells) {
            const g = cell.node.getChildByName('bg')?.getComponent(Graphics);
            if (!g) continue;
            const { cellW, cellH } = cell;
            g.clear();
            const selected = id === this.selectedId;
            g.fillColor = selected ? new Color(55, 70, 110, 255) : new Color(36, 40, 58, 255);
            g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 6);
            g.fill();
            if (selected) {
                g.strokeColor = new Color(255, 210, 60, 255);
                g.lineWidth = 2;
                g.roundRect(-cellW / 2, -cellH / 2, cellW, cellH, 6);
                g.stroke();
            }
        }
    }

    private draftSelected(): SymbolDraft | null {
        return this.drafts.find((d) => d.id === this.selectedId) ?? null;
    }

    private addSymbol(): void {
        const used = new Set(this.drafts.map((d) => d.id));
        let id = 1;
        while (used.has(id)) id++;
        this.drafts.push(makeEmptyDraft(id));
        this.provider?.sync(this.drafts);
        this.persist();
        this.rebuildWall();
        this.selectSymbol(id);
        this.hud?.setStatus(`已添加符号 #${id}`);
    }

    private removeSelected(): void {
        if (this.selectedId == null) return;
        const id = this.selectedId;
        this.drafts = this.drafts.filter((d) => d.id !== id);
        this.provider?.sync(this.drafts);
        this.persist();
        this.rebuildWall();
        this.selectFirst();
        this.hud?.setStatus(`已删除 #${id}`);
    }

    private patchField(key: keyof SymbolDraft, dir: 1 | -1): void {
        const d = this.draftSelected();
        if (!d) return;
        if (key === 'kind') {
            d.kind = d.kind === SymbolKind.multi ? SymbolKind.normal : SymbolKind.multi;
        } else if (key === 'placementMainId') {
            d.placementMainId = cyclePlacementId(d.placementMainId, dir, ['', ...PLACEMENT_RECIPE_IDS]);
        } else if (key === 'placementTopStripId') {
            d.placementTopStripId = cyclePlacementId(d.placementTopStripId, dir, [
                '',
                ...PLACEMENT_RECIPE_IDS,
            ]);
            if (d.placementTopStripId === 'top-row-span' && !d.placementTopStripVariantKey) {
                d.placementTopStripVariantKey = 'top-horizontal-wide';
                d.placementTopStripCells = 2;
            }
        } else if (key === 'scaleMul') {
            d.scaleMul = Math.max(0.2, Math.round((d.scaleMul + dir * 0.1) * 10) / 10);
        } else if (
            key === 'idleAnim' ||
            key === 'enterAnim' ||
            key === 'winAnim' ||
            key === 'vanishAnim'
        ) {
            const list = this.animListFor(d);
            d[key] = cycleString(d[key], list, dir);
        } else if (key === 'name') {
            /* name 用导入导出改；H5 暂不提供键盘输入 */
        }
        this.provider?.sync(this.drafts);
        this.persist();
        this.refreshCell(d.id);
        this.hud?.setSelected(d.id, d, this.assets());
    }

    private pickAsset(field: SymbolAssetField, assetId: string): void {
        const d = this.draftSelected();
        if (!d) return;
        d[field] = assetId;
        // 切 spine 时若 idle 空，带上素材 defaultAnim
        if (field === 'spineAssetId' && d.spineAssetId) {
            const a = this.assets().find((x) => x.id === d.spineAssetId);
            if (a?.defaultAnim && !d.idleAnim) d.idleAnim = a.defaultAnim;
        }
        this.provider?.sync(this.drafts);
        this.persist();
        this.refreshCell(d.id);
        this.refreshPackFxHud();
        this.hud?.setSelected(d.id, d, this.assets());
        const label = assetId || '(无)';
        this.hud?.setStatus(`${d.name} ${field} → ${label}`);
    }

    private pickPackFx(field: PackFxField, assetId: string): void {
        this.catalog.setPackCellFx(field, assetId);
        this.persist();
        // 包级 FX 变了：所有用全局回退的符号试播需重解析
        this.provider?.sync(this.drafts);
        if (this.selectedId != null) this.refreshCell(this.selectedId);
        this.refreshPackFxHud();
        const draft = this.draftSelected();
        this.hud?.setSelected(this.selectedId, draft, this.assets());
        const label = assetId || '(无)';
        this.hud?.setStatus(`包级${field === 'win' ? '通用高亮' : '通用消除'} → ${label}`);
    }

    private pickVariantAsset(index: number, assetId: string): void {
        const draft = this.draftSelected();
        const variant = draft?.visualVariants?.[index];
        if (!draft || !variant) return;
        variant.textureAssetId = assetId;
        this.provider?.sync(this.drafts);
        this.persist();
        this.hud?.setSelected(draft.id, draft, this.assets());
        this.hud?.setStatus(
            `${draft.name} ${variant.key} → ${variant.textureAssetId || '(无纹理)'}`,
        );
    }

    private animListFor(d: SymbolDraft): string[] {
        const empty = [''];
        if (!d.spineAssetId) return empty;
        const a = this.assets().find((x) => x.id === d.spineAssetId);
        const skel = a?.spine;
        if (!skel?.getAnimsEnum) return empty;
        try {
            const en = skel.getAnimsEnum() as Record<string, number>;
            return ['', ...Object.keys(en).filter((k) => k !== '<None>')];
        } catch {
            return empty;
        }
    }

    private refreshCell(id: number): void {
        const cell = this.wallCells.get(id);
        if (!cell || !this.provider) return;
        cell.view.setSymbol(null);
        cell.view.setSymbol(id);
        const d = this.drafts.find((x) => x.id === id);
        const lab = cell.node.getChildByName('lab')?.getComponent(Label);
        if (lab && d) lab.string = `#${d.id} ${d.name}`;
    }

    private async previewAnim(kind: 'idle' | 'enter' | 'win' | 'vanish'): Promise<void> {
        if (this.selectedId == null) return;
        const cell = this.wallCells.get(this.selectedId);
        if (!cell) return;
        const view = cell.view;
        try {
            if (kind === 'idle') {
                view.setSymbol(null);
                view.setSymbol(this.selectedId);
                return;
            }
            const anim =
                kind === 'enter'
                    ? view.buildEnterAnim()
                    : kind === 'win'
                      ? view.buildWinAnim()
                      : view.buildVanishAnim();
            if (!anim) {
                this.hud?.setStatus(`无 ${kind} 动画可播`);
                return;
            }
            await anim.play();
            if (kind === 'vanish') view.setSymbol(this.selectedId);
        } catch (e) {
            this.hud?.setStatus(`试播失败: ${(e as Error).message ?? e}`);
        }
    }

    private exportSheet(): void {
        if (!this.pack) return;
        const doc: SymbolSheetDoc = {
            docVersion: 1,
            packId: this.pack.id,
            zone: getActiveSpineZoneSync(),
            symbols: this.drafts,
            updatedAt: new Date().toISOString(),
        };
        const json = serializeSheet(doc);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `symbol-sheet-${this.pack.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.persist();
        this.hud?.setStatus('已导出 symbol-sheet JSON');
    }

    private async importSheet(): Promise<void> {
        try {
            const json = await pickJsonFile();
            const doc = parseSheet(json);
            this.drafts = doc.symbols;
            this.provider?.sync(this.drafts);
            this.persist();
            this.rebuildWall();
            this.selectFirst();
            this.hud?.setStatus(`已导入 ${this.drafts.length} 个符号`);
        } catch (e) {
            this.hud?.setStatus(`导入失败: ${(e as Error).message ?? e}`);
        }
    }

    private async cyclePack(dir: 1 | -1): Promise<void> {
        if (this.switching || !this.pack) return;
        if (listActiveGamePacks().length <= 1) {
            this.hud?.setStatus(`当前区仅一个包：${this.pack.id}`);
            return;
        }
        this.switching = true;
        try {
            const next = cyclePackId(this.pack.id, dir);
            storePackId(next.id);
            this.pack = getGamePack(next.id);
            await this.catalog.loadPack(this.pack);
            this.drafts = this.loadDrafts();
            this.provider = new DraftProvider(this.drafts, this.catalog);
            const packs = listActiveGamePacks();
            const i = Math.max(0, packs.findIndex((p) => p.id === next.id)) + 1;
            this.hud?.setPackLabel(`${next.name} (${i}/${packs.length}) · ${getActiveSpineZoneSync()}`);
            this.refreshPackFxHud();
            this.rebuildWall();
            this.selectFirst();
            this.hud?.setStatus(`已切换包 → ${next.id}`);
        } catch (e) {
            this.hud?.setStatus(`切包失败: ${(e as Error).message ?? e}`);
        } finally {
            this.switching = false;
        }
    }

    private openBoard(): void {
        director.loadScene('BoardEditor', (err) => {
            if (err) {
                console.error(err);
                this.hud?.setStatus('无法打开 BoardEditor 场景');
            }
        });
    }
}

class DraftProvider implements SymbolProvider {
    private resolved = new Map<number, SymbolEntry>();
    private _designW = DESIGN_CELL_W;
    private _designH = DESIGN_CELL_H;
    private assets: AssetProvider | null = null;
    private fallbacks = new Map<number, SymbolEntry>();

    constructor(drafts: SymbolDraft[], private catalog: SymbolCatalog) {
        this._designW = catalog.designW;
        this._designH = catalog.designH;
        this.assets = catalog.assetLibrary;
        for (const e of catalog.getSourceEntries()) this.fallbacks.set(e.id, e);
        this.sync(drafts);
    }

    sync(drafts: SymbolDraft[]): void {
        this.resolved.clear();
        for (const d of drafts) {
            this.resolved.set(d.id, resolveDraft(d, this.assets, this.fallbacks.get(d.id) ?? null));
        }
    }

    getEntry(id: number): SymbolEntry | null {
        return this.resolved.get(id) ?? null;
    }

    get designW(): number {
        return this._designW;
    }
    get designH(): number {
        return this._designH;
    }

    winCellFxFor(id: number): CellFxDef | null {
        const e = this.getEntry(id);
        if (e?.winCellFx?.valid) return e.winCellFx;
        // 符号未配专用 FX 时，回退包级通用 win/vanish（与 SymbolCatalog 一致）
        return this.catalog.winCellFxFor(id);
    }

    vanishCellFxFor(id: number): CellFxDef | null {
        const e = this.getEntry(id);
        if (e?.vanishCellFx?.valid) return e.vanishCellFx;
        return this.catalog.vanishCellFxFor(id);
    }

    vanishDissolveFor(id: number) {
        return this.catalog.vanishDissolveFor(id);
    }
}

function cycleString(cur: string, list: string[], dir: 1 | -1): string {
    if (list.length === 0) return cur;
    let i = list.indexOf(cur);
    if (i < 0) i = 0;
    return list[(i + dir + list.length) % list.length]!;
}

function cyclePlacementId(cur: string, dir: 1 | -1, list: string[]): string {
    return cycleString(cur || '', list, dir);
}

function pickJsonFile(): Promise<string> {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return reject(new Error('未选文件'));
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('读文件失败'));
            reader.readAsText(file);
        };
        input.click();
    });
}
