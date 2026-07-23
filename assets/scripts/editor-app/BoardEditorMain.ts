/**
 * BoardEditorMain — 编辑器场景主入口（横板 + 常驻 Inspector）。
 * 点格 = 选中（黄框 + Inspector 显示）；点 Inspector symbol 面板 = 应用到选中格。
 */

import { _decorator, Component, JsonAsset, Node, UITransform, director, Mask, Graphics, Color, Label, Vec3, EventTouch } from 'cc';
import {
    deserializeDoc,
    serializeDoc,
    validateDoc,
    readFrameExt,
    frameKindLabel,
    ensureTopStripSymbols,
    makeCompactedState,
    makeExpandedState,
    makeMultiCollectedState,
    makeEmptyDoc,
    AddStateCommand,
    RemoveStateCommand,
    SetResolvedCellCommand,
    SetEntityMultiplierCommand,
    SetColumnVisibleRowsCommand,
    SetBoardColsCommand,
    SetTopStripCellCommand,
    PatchFrameExtCommand,
    CompositeCommand,
    CommandHistory,
} from '../editor-core/index';
import type { EditorDoc, EditorCommand, IrFrameKind } from '../editor-core/index';
import type { PresentationState } from '../vendor/slot-presentation-ir/index';
import { SymbolCatalog, loadRes } from './SymbolCatalog';
import {
    draftFromEntry,
    loadSymbolSheetDoc,
    normalizePackLayout,
    saveSymbolSheetDoc,
    COLUMN_VALIGN_CYCLE,
    columnVAlignLabel,
} from './SymbolDraft';
import { BoardView } from './BoardView';
import type { TopStripReelHost } from './BoardView';
import { EditorHud, boardAreaRect } from './EditorHud';
import type { AnimSectionModel } from './EditorHud';
import { PersistenceService } from './PersistenceService';
import { BoardDirector } from './BoardDirector';
import { allowedTemplateIds, isTemplateAllowed, resolveTemplateForState, animStyleFromBoardView } from './animTemplates';
import type { AnimStyleId } from './animStyles';
import { ANIM_STYLE_FAKE_REEL } from './animStyles';
import { makeJiDiffuseState } from './jiDiffuse';
import { makeTopStepState } from './topStep';
import {
    cycleGameId,
    getGamePack,
    listActiveGamePacks,
    loadStoredGameId,
    storeGameId,
    tryGetSymbolPack,
} from './GamePack';
import type { GamePackDef } from './GamePack';
import { loadActiveSpineZone, getActiveSpineZoneSync } from './SpineZone';
import { isMultiEntry } from './SymbolDefs';
import { bootRemoteConsole } from '../debug/remoteConsoleBoot';
import {
    WAYS_6X7_TOP_MID4,
    columnCountToTier,
    tierKey,
    tierDesignHeight,
    LVBU_COLUMN_COUNT_MIN,
    LVBU_COLUMN_COUNT_MAX,
    LVBU_TOP_STRIP_COLUMN_COUNT,
    columnSpanAnchorRow,
    findColumnSpanRow,
    topStripDesignHeight,
} from './board-layout';
import type { BoardLayoutProfile } from './board-layout';
import {
    isColumnFillEntry,
    isTopRowSpanEntry,
    resolvePlacement,
    readPlacementBinding,
    topRowSpanAnchor,
    topRowSpanIndices,
    findTopRowSpanAnchorAt,
    listTopRowSpanAnchors,
} from './placement';
import { SymbolView } from './SymbolView';

const { ccclass, property } = _decorator;

/** 刷 multi 球时的默认倍率 */
const DEFAULT_MULTI_VALUE = 2;

/** 编辑器 UI 循环用的常用 frameKind 子集（数据层仍支持完整 IR_FRAME_KINDS） */
const EDITOR_FRAME_KINDS: IrFrameKind[] = [
    'enter-table',
    'reveal',
    'highlight',
    'postClear',
    'compact',
    'expandPre',
    'expandPost',
    'topStep',
    'multiCollect',
    'spinEnd',
];

@ccclass('BoardEditorMain')
export class BoardEditorMain extends Component {
    @property docPath = 'configs/presentation/doc_example';
    @property docId = 'doc_example';

    private catalog = new SymbolCatalog();
    private persistence = new PersistenceService();
    private doc: EditorDoc | null = null;
    private history: CommandHistory | null = null;
    private boardView: BoardView | null = null;
    private hud: EditorHud | null = null;
    private director: BoardDirector | null = null;
    private currentIndex = 0;
    /** 当前刷子：undefined = 无；null = 橡皮擦；number = symbolId */
    private brush: number | null | undefined = undefined;
    /**
     * 刷子槽键：与 HUD hlKey 一致。
     * 同逻辑 id 的竖/横分槽（如 "1" vs "1@top-horizontal-wide"），避免两格共用一个刷子状态。
     */
    private brushKey: string | undefined = undefined;
    /** 进行中的一笔（touch 期间累积，end 时合成一次 undo） */
    private stroke: EditorCommand[] = [];
    private disposeHostBridge: (() => void) | null = null;
    private gamePack: GamePackDef | null = null;
    private switchingGame = false;
    /** 刷子视觉档：null=跟列自动；1..6=指定档（刷盘时同步列符号数） */
    private brushTier: number | null = null;
    private boardHost: Node | null = null;
    private boardViewport: Node | null = null;
    private topStripRoot: Node | null = null;
    private topStripViews: SymbolView[] = [];
    private selectedCol: number | null = null;

    async start(): Promise<void> {
        bootRemoteConsole();
        try {
            const zone = await loadActiveSpineZone();
            const pack = tryGetSymbolPack(loadStoredGameId(), zone);
            if (!pack) {
                console.warn(
                    `[BoardEditorMain] zone=${zone} 无符号包；盘面布局可用 ${WAYS_6X7_TOP_MID4.id}（逻辑已加载）。请导入 spine-4.2/packs 或切回 3.8。`,
                );
                return;
            }
            this.gamePack = getGamePack(pack.id);
            this.applyDocBindingForPack(this.gamePack.id);
            console.log(`[BoardEditorMain] spine zone=${zone} pack=${this.gamePack.id}`);
            await this.catalog.loadPack(this.gamePack);
            console.log(
                `[BoardEditorMain] design=${this.catalog.designW}x${this.catalog.designH} gaps=${JSON.stringify(this.catalog.boardSpacing)}`,
            );
            this.applyLocalSymbolSheet();
            // 包专属种子：一律忽略浏览器自动存档（否则会一直停在旧 doc_example 的 1/4 帧）
            const forceSeed =
                this.gamePack.id === 'power-of-thor2' || this.gamePack.id === 'lvbu';
            let source = 'localStorage 自动存档';
            if (forceSeed) {
                this.migrateSeedAutosave();
                this.persistence.clearAutosave(this.docId);
                this.persistence.clearAutosave('doc_example');
                this.doc = await this.loadSeedDoc();
                source = `resources/seed(forced:${this.docId})`;
            } else {
                this.migrateSeedAutosave();
                this.doc = this.persistence.loadAutosave(this.docId);
                if (!this.doc) {
                    this.doc = await this.loadSeedDoc();
                    source = this.doc ? 'resources/seed' : 'resources';
                } else if (!this.docMatchesPack(this.doc, this.gamePack.id) || this.doc.id !== this.docId) {
                    console.warn(
                        `[BoardEditorMain] autosave id=${this.doc.id} 与目标 docId=${this.docId}/pack=${this.gamePack.id} 不匹配，改用种子文档`,
                    );
                    this.persistence.clearAutosave(this.docId);
                    this.persistence.clearAutosave(this.doc.id);
                    this.doc = await this.loadSeedDoc();
                    source = 'resources/seed(replaced-autosave)';
                }
            }
            const issues = validateDoc(this.doc);
            if (issues.length) {
                console.error('[BoardEditorMain] validateDoc issues', issues);
                this.persistence.clearAutosave(this.docId);
                throw new Error(`文档校验失败(${source}): ${issues[0].code} ${issues[0].message}`);
            }
            this.history = new CommandHistory(this.doc);
            this.buildLayout();
            this.showState(0);
            this.installAiwsBridge();
            const probe = {
                pack: this.gamePack.id,
                docId: this.doc.id,
                docPath: this.docPath,
                frames: this.doc.states.length,
                source,
                designW: this.catalog.designW,
                designH: this.catalog.designH,
                cellW: this.boardView?.cellW,
                cellH: this.boardView?.cellH,
                gaps: this.catalog.boardSpacing,
            };
            (globalThis as { __BOARD_PROBE__?: typeof probe }).__BOARD_PROBE__ = probe;
            this.hud?.setStatus(
                `${this.gamePack.id} · ${this.doc.id} · ${this.doc.states.length}帧 · 格${this.catalog.designW}×${this.catalog.designH}`,
            );
            console.log('[BoardEditorMain] ready', probe);
        } catch (e) {
            console.error('[BoardEditorMain] load failed', e);
        }
    }

    /** 按符号包登记表绑定默认种子盘面（可自由配置，勿再写死 if packId） */
    private applyDocBindingForPack(packId: string): void {
        const pack = getGamePack(packId);
        this.docId = pack.seedDocId || 'doc_example';
        this.docPath = pack.seedDocPath || 'configs/presentation/doc_example';
    }

    /** SymbolEditor「→盘面」：叠加 localStorage 符号草稿（含 packLayout），立刻吃到布局/素材改动 */
    private applyLocalSymbolSheet(): void {
        if (!this.gamePack) return;
        let sheet = loadSymbolSheetDoc(this.gamePack.id);
        if (!sheet) {
            const base = this.catalog.readPackLayout();
            sheet = {
                docVersion: 1,
                packId: this.gamePack.id,
                zone: getActiveSpineZoneSync(),
                symbols: this.catalog.getSourceEntries().map((e) => draftFromEntry(e)),
                packLayout: normalizePackLayout({
                    ...base,
                    ...(this.gamePack.id === 'bounty-hunter' ? { columnVAlign: 'center' as const } : {}),
                }),
                winCellFxAssetId: this.catalog.packWinCellFxAssetId(),
                vanishCellFxAssetId: this.catalog.packVanishCellFxAssetId(),
                updatedAt: new Date().toISOString(),
            };
            saveSymbolSheetDoc(sheet);
        } else if (!sheet.packLayout) {
            sheet = {
                ...sheet,
                packLayout: normalizePackLayout({
                    ...this.catalog.readPackLayout(),
                    ...(this.gamePack.id === 'bounty-hunter' ? { columnVAlign: 'center' as const } : {}),
                }),
                updatedAt: new Date().toISOString(),
            };
            saveSymbolSheetDoc(sheet);
        }
        if (this.catalog.applySymbolSheet(sheet)) {
            console.log(
                `[BoardEditorMain] symbol sheet overlay pack=${sheet.packId} symbols=${sheet.symbols.length} layout=${JSON.stringify(sheet.packLayout)}`,
            );
        }
        if (this.boardView && sheet.packLayout) {
            this.boardView.setColumnVAlign(sheet.packLayout.columnVAlign);
        }
    }

    private docMatchesPack(doc: EditorDoc, packId: string): boolean {
        const topo = doc.states[0]?.board.topology;
        if (!topo) return false;
        if (packId === 'lvbu') {
            return topo.cols === WAYS_6X7_TOP_MID4.topology.cols;
        }
        return true;
    }

    private async loadSeedDoc(): Promise<EditorDoc> {
        try {
            const jsonAsset = await loadRes<JsonAsset>(this.docPath, JsonAsset);
            return deserializeDoc(JSON.stringify(jsonAsset.json));
        } catch (e) {
            if (this.gamePack?.id === 'lvbu') {
                console.warn('[BoardEditorMain] 缺少 lvbu 种子 JSON，运行时生成 ways-6x7 空盘', e);
                const rows = WAYS_6X7_TOP_MID4.topology.visibleRows.slice();
                return makeEmptyDoc(this.docId, '吕布 ways-6x7', WAYS_6X7_TOP_MID4.topology.cols, rows);
            }
            throw e;
        }
    }

    onDestroy(): void {
        this.disposeHostBridge?.();
        this.disposeHostBridge = null;
    }

    private installAiwsBridge(): void {
        if (!this.persistence.aiwsEmbed) return;
        this.disposeHostBridge = this.persistence.installHostBridge({
            onLoadDoc: (doc) => this.applyHostDoc(doc),
            onRequestDoc: () => this.doc,
        });
        this.persistence.notifyReady(this.docId);
    }

    private applyHostDoc(doc: EditorDoc): void {
        const issues = validateDoc(doc);
        if (issues.length) {
            console.error('[BoardEditorMain] host load-doc 校验失败', issues);
            this.hud?.setStatus(`加载失败: ${issues[0].code}`);
            return;
        }
        this.doc = doc;
        this.history = new CommandHistory(this.doc);
        this.clearSelection();
        this.showState(0);
        this.hud?.setStatus(`已从 Workspace 加载 · ${doc.states.length} 帧`);
        // 不写 localStorage，避免盖住工程 cfg；仍通知 parent 当前内容
        if (this.persistence.aiwsEmbed) {
            try {
                window.parent.postMessage(
                    {
                        source: 'aiws-board',
                        type: 'doc',
                        id: doc.id,
                        json: serializeDoc(doc, 0),
                        dirty: false,
                    },
                    '*',
                );
            } catch {
                /* ignore */
            }
        }
    }

    // ------------------------------------------------------------------
    // 布局
    // ------------------------------------------------------------------

    private static readonly GAP_STORE_KEY = 'symbolEditor.boardGaps';

    /**
     * 浏览器会把旧盘面写进 localStorage（symbolEditor.doc.*）。
     * 种子升版或切到包专属 doc 时清掉，避免继续显示「帧 1/4」的 doc_example。
     */
    private migrateSeedAutosave(): void {
        const rev = this.gamePack?.seedRev ?? null;
        if (rev == null) return;
        const key = `symbolEditor.seedRev.${this.docId}`;
        try {
            const cur = localStorage.getItem(key);
            if (cur === String(rev)) return;
            this.persistence.clearAutosave(this.docId);
            this.persistence.clearAutosave('doc_example');
            // 扫掉其它残留盘面存档，避免旧 4 帧继续冒出来
            this.persistence.clearAllDocAutosaves();
            try {
                localStorage.setItem(key, String(rev));
            } catch {
                /* ignore */
            }
            console.log(
                `[BoardEditorMain] seedRev ${this.docId}=${rev} → cleared all doc autosaves (was ${cur ?? 'none'})`,
            );
        } catch (e) {
            console.warn('[BoardEditorMain] migrateSeedAutosave failed', e);
        }
    }

    private buildLayout(): void {
        const area = boardAreaRect();

        // 可视裁剪区：盘面（含顶条）等比缩进此矩形
        const viewport = new Node('BoardViewport');
        viewport.addComponent(UITransform).setContentSize(area.w, area.h);
        viewport.setPosition(area.cx, area.cy, 0);
        viewport.addComponent(Mask).type = Mask.Type.RECT;
        this.node.addChild(viewport);
        this.boardViewport = viewport;

        const host = new Node('BoardHost');
        host.addComponent(UITransform);
        viewport.addChild(host);
        this.boardHost = host;

        // 顶条（吕布：映射主盘 col1..4 的 row0）
        const strip = new Node('TopStrip');
        strip.addComponent(UITransform);
        host.addChild(strip);
        this.topStripRoot = strip;
        this.buildTopStripScaffold();

        const boardNode = new Node('BoardView');
        boardNode.addComponent(UITransform);
        this.boardView = boardNode.addComponent(BoardView);
        this.boardView.setCatalog(this.catalog);
        // 逻辑格 = 纹理设计尺寸（吕布 280×档高）；整盘再由 host 缩进可视区。
        // 切勿把 cellW 压小：会触发 fitScale 按宽缩，列内出现上下 padding。
        this.boardView.cellW = this.catalog.designW;
        this.boardView.cellH = this.catalog.designH;
        this.boardView.cellFill = 1;
        // 顶条与主盘数据分离；setTopStripMap 仅用于列对齐参考，不再把顶条当 row0 别名
        if (this.gamePack?.id === 'lvbu') {
            this.boardView.setTopStripMap(null);
            this.boardView.setLayoutProfile(WAYS_6X7_TOP_MID4);
        } else {
            this.boardView.setTopStripMap(null);
            this.boardView.setLayoutProfile(null);
        }
        this.applyLayoutSpacingDefaults();
        this.restoreGaps();
        this.enforceLockedGaps();
        this.boardView.onCellPress = (col, row) => this.onCellPress(col, row);
        this.boardView.onStrokeEnd = () => this.onStrokeEnd();
        host.addChild(boardNode);
        // 顶条 scaffold 早于 BoardView 创建；此处再绑假轮带宿主
        this.bindTopStripReelHost();
        this.director = new BoardDirector(this.boardView, () => this.doc);

        this.director.events.on('symbol-vanish', (e) => {
            console.log(`[BoardEvents demo] 消除 → 加分点：symbol=${e.symbolId} @ (${e.col},${e.row}) 帧${e.frameIndex + 1}`);
        });
        this.director.events.on('multi-expand', (e) => {
            console.log(
                `[BoardEvents demo] 倍率飞出(音效槽) ×${e.multiplier ?? '?'} symbol=${e.symbolId} → (${e.col},${e.row})`,
            );
        });
        this.director.events.on('multi-expand-land', (e) => {
            console.log(
                `[BoardEvents demo] 倍率落地(音效槽) ×${e.multiplier ?? '?'} symbol=${e.symbolId} @ (${e.col},${e.row})`,
            );
        });
        this.director.events.on('multi-collect', (e) => {
            console.log(
                `[BoardEvents demo] 倍率收集(音效/结算) ×${e.multiplier ?? '?'} symbol=${e.symbolId} @ (${e.col},${e.row})`,
            );
        });
        this.director.events.on('*', (e) => {
            if (e.type === 'transition-start' || e.type === 'transition-end') {
                console.log(`[BoardEvents] ${e.type} 帧${e.frameIndex + 1} kind=${e.frameKind ?? '-'}`);
            }
        });

        const hudNode = new Node('EditorHud');
        hudNode.addComponent(UITransform);
        this.hud = hudNode.addComponent(EditorHud);
        this.node.addChild(hudNode);
        this.hud.init(
            {
                onPrevFrame: () => this.showState(this.currentIndex - 1),
                onNextFrame: () => this.showState(this.currentIndex + 1),
                onAddFrame: () => this.addFrame(),
                onRemoveFrame: () => this.removeFrame(),
                onUndo: () => this.undo(),
                onRedo: () => this.redo(),
                onExport: () => this.doc && this.persistence.exportDownload(this.doc),
                onImport: () => void this.importDoc(),
                onPlay: () => void this.playFromCurrent(),
                onStop: () => this.stopPlayback(),
                onPickBrush: (id, brushKey) => this.pickBrush(id, brushKey),
                onCycleBrushTier: (dir) => this.cycleBrushTier(dir),
                onCycleFrameKind: (dir) => this.cycleFrameKind(dir),
                onCycleTemplate: (dir) => this.cycleTemplate(dir),
                onParamAdjust: (key, dir) => this.adjustParam(key, dir),
                onTogglePlayWithPrev: () => this.togglePlayWithPrev(),
                onPlayCurrentTransition: () => void this.playCurrentTransition(),
                onGenerateCompactFrame: () => this.generateCompactFrame(),
                onGenerateExpandFrame: () => this.generateExpandFrame(),
                onGenerateTopStepFrame: () => this.generateTopStepFrame(),
                onGenerateMultiCollectFrame: () => this.generateMultiCollectFrame(),
                onAdjustGap: (axis, dir) => this.adjustGap(axis, dir),
                onCycleColumnVAlign: (dir) => this.cycleColumnVAlign(dir),
                onCycleGame: (dir) => void this.cycleGame(dir),
                onAdjustMultiplier: (dir) => this.adjustMultiplier(dir),
                onSetMultiplier: (value) => this.setMultiplierValue(value),
                onAdjustColumnRows: (dir, col) => this.adjustColumnRows(dir, col),
                onAdjustBoardCols: (dir) => this.adjustBoardCols(dir),
                onPickColumn: (col) => this.pickColumn(col),
                onOpenSymbolEditor: () => this.openSymbolEditor(),
            },
            this.catalog,
            this.formatGameLabel(this.gamePack),
            {
                variableColumns: !!this.gamePack?.variableColumns,
                tallSymbolTiers: !!this.gamePack?.tallSymbolTiers,
            },
        );
        this.refreshGapHud();
        this.refreshBrushTierHud();
        this.refreshSizeInfo(null);
    }

    /** 顶条：设计格对齐主盘列；符号 1:1 可超框，不把格撑成纹理包围盒 */
    private buildTopStripScaffold(): void {
        if (!this.topStripRoot) return;
        this.topStripRoot.removeAllChildren();
        this.topStripViews = [];
        const show = this.gamePack?.id === 'lvbu';
        this.topStripRoot.active = show;
        if (!show) return;

        const title = new Node('top_title');
        title.addComponent(UITransform);
        const lab = title.addComponent(Label);
        lab.string = '顶条（独立数据 · 对齐 col1~4）';
        lab.fontSize = 16;
        lab.color = new Color(255, 210, 120, 255);
        title.setPosition(0, 0, 0);
        this.topStripRoot.addChild(title);

        const map = WAYS_6X7_TOP_MID4.topStrip!.mapToMain;
        const cellW = this.catalog.designW;
        const cellH = topStripDesignHeight();
        for (let i = 0; i < map.length; i++) {
            const ref = map[i]!;
            const stripIndex = i;
            const n = new Node(`top_${ref.col}`);
            n.addComponent(UITransform).setContentSize(cellW, cellH);
            n.setPosition(0, 0, 0);
            const g = n.addComponent(Graphics);
            g.fillColor = new Color(40, 36, 20, 120);
            g.strokeColor = new Color(255, 200, 80, 220);
            g.lineWidth = 2;
            g.rect(-cellW / 2, -cellH / 2, cellW, cellH);
            g.fill();
            g.stroke();
            const view = n.addComponent(SymbolView);
            view.setup(this.catalog, cellW, cellH, 1);
            view.setPixelPerfect(true);
            view.setColumnContext(LVBU_TOP_STRIP_COLUMN_COUNT, null);
            n.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                e.propagationStopped = true;
                this.onTopStripPress(stripIndex);
            });
            n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.onStrokeEnd();
            });
            n.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => {
                e.propagationStopped = true;
                this.onStrokeEnd();
            });
            this.topStripRoot.addChild(n);
            this.topStripViews.push(view);
        }
        this.bindTopStripReelHost();
    }

    /** 把顶条挂到 BoardView，供 fake-reel 横滚；无顶条时清空 */
    private bindTopStripReelHost(): void {
        if (!this.boardView) return;
        if (!this.topStripRoot?.active || this.topStripViews.length === 0) {
            this.boardView.setTopStripReelHost(null);
            return;
        }
        const root = this.topStripRoot;
        const map = WAYS_6X7_TOP_MID4.topStrip!.mapToMain;
        const cellW = this.catalog.designW;
        const cellH = topStripDesignHeight();
        const host: TopStripReelHost = {
            root,
            count: map.length,
            cellW,
            cellH,
            slotCenterX: (index: number) => {
                const ref = map[index];
                return ref ? this.boardView!.columnCenterX(ref.col) : 0;
            },
            hideCells: () => {
                const hidden: Node[] = [];
                for (let i = 0; i < map.length; i++) {
                    const n = root.getChildByName(`top_${map[i]!.col}`);
                    if (n?.active) {
                        n.active = false;
                        hidden.push(n);
                    }
                }
                return hidden;
            },
            landState: (state) => {
                // 必须用传入的 curr，不能读 currentIndex（播转移时 index 还停在 A）
                this.refreshTopStrip(state);
            },
            getCellNode: (index: number) => {
                const ref = map[index];
                return ref ? root.getChildByName(`top_${ref.col}`) : null;
            },
            getSymbolView: (index: number) => this.topStripViews[index] ?? null,
        };
        this.boardView.setTopStripReelHost(host);
    }

    /** 把 BoardHost（顶条+主盘）等比缩进可视区；顶条 X 与主盘 col 对齐 */
    private fitBoardInViewport(): void {
        if (!this.boardHost || !this.boardView || !this.boardViewport) return;
        const area = boardAreaRect();
        const vpUi = this.boardViewport.getComponent(UITransform)!;
        vpUi.setContentSize(area.w, area.h);
        this.boardViewport.setPosition(area.cx, area.cy, 0);

        const cols = this.doc?.states[this.currentIndex]?.board.topology.cols ?? 6;
        const rows =
            this.doc?.states[this.currentIndex]?.board.topology.visibleRows ??
            Array.from({ length: cols }, () => 7);
        const { w: boardW, h: boardH } = this.boardView.boardSize(cols, rows);
        const stripH = this.topStripRoot?.active ? topStripDesignHeight() : 0;
        // 顶条符号按高度铺满后左右可超框（横戟尖不能被 Mask 裁掉）
        const overflowPad = this.topStripRoot?.active ? 200 : 40;
        const stripGap = this.topStripRoot?.active ? 16 : 0;
        const titleH = this.topStripRoot?.active ? 22 : 0;
        const totalH = boardH + stripGap + stripH + titleH + overflowPad;
        const totalW = boardW + overflowPad;
        const scale = Math.min(1, (area.w - 8) / Math.max(1, totalW), (area.h - 8) / Math.max(1, totalH));
        this.boardHost.setScale(scale, scale, 1);

        const boardNode = this.boardView.node;
        boardNode.setPosition(0, 0, 0);

        if (this.topStripRoot?.active) {
            const stripCenterY = boardH / 2 + stripGap + stripH / 2;
            this.topStripRoot.setPosition(0, stripCenterY, 0);
            const title = this.topStripRoot.getChildByName('top_title');
            if (title) title.setPosition(0, stripH / 2 + titleH / 2 + 2, 0);

            const map = WAYS_6X7_TOP_MID4.topStrip!.mapToMain;
            for (let i = 0; i < map.length; i++) {
                const ref = map[i]!;
                const cell = this.topStripRoot.getChildByName(`top_${ref.col}`);
                if (!cell) continue;
                cell.setPosition(this.boardView.columnCenterX(ref.col), 0, 0);
            }
            // 列心归位后再按 span 合并（避免 fit 覆盖横跨布局）
            this.refreshTopStrip();
        }
    }

    private refreshTopStrip(stateOverride?: PresentationState | null): void {
        if (!this.doc || !this.topStripRoot?.active) return;
        const state = stateOverride ?? this.doc.states[this.currentIndex];
        if (!state) return;
        const map = WAYS_6X7_TOP_MID4.topStrip!.mapToMain;
        const stripCount = map.length;
        const symbols = ensureTopStripSymbols(readFrameExt(state), stripCount);
        const cellW = this.catalog.designW;
        // 顶条格高 = 主盘「一列 4 个」档高，不是满列 7 个的矮格
        const cellH = topStripDesignHeight();

        const spans = listTopRowSpanAnchors(symbols, this.isTopRowSpanId, this.topRowSpanCellsOf);
        const coverOf = new Map<number, { anchor: number; cells: number; symbolId: number }>();
        for (const s of spans) {
            for (let k = 0; k < s.cells; k++) {
                coverOf.set(s.anchor + k, s);
            }
        }

        for (let i = 0; i < map.length; i++) {
            const ref = map[i]!;
            const view = this.topStripViews[i];
            const cellNode = this.topStripRoot.getChildByName(`top_${ref.col}`);
            if (!view || !cellNode) continue;

            const cover = coverOf.get(i);
            if (cover && i !== cover.anchor) {
                cellNode.active = false;
                view.setVariantKey(null);
                view.setSymbol(null);
                continue;
            }

            cellNode.active = true;
            const symbolId = symbols[i] ?? null;
            const spanCells = cover && i === cover.anchor ? cover.cells : 1;
            const spanW = cellW * spanCells;
            const leftCol = map[i]!.col;
            const rightCol = map[Math.min(i + spanCells - 1, map.length - 1)]!.col;
            const leftX = this.boardView?.columnCenterX(leftCol) ?? 0;
            const rightX = this.boardView?.columnCenterX(rightCol) ?? leftX;
            const centerX = (leftX + rightX) / 2;

            const entry = symbolId != null ? this.catalog.getEntry(symbolId) : null;
            const placed = resolvePlacement(entry, 'topStrip');
            const variantKey =
                spanCells > 1 && placed?.recipeId === 'top-row-span'
                    ? placed.variantKey || null
                    : null;

            // 命中/选中框：固定为顶条设计格（4 个/列档高）；符号高度铺满、左右可超框
            const boxH = cellH;
            cellNode.setPosition(centerX, 0, 0);
            cellNode.getComponent(UITransform)?.setContentSize(spanW, boxH);

            view.setup(this.catalog, spanW, boxH, 1);
            view.setVariantKey(variantKey);
            view.setPixelPerfect(false);
            if (spanCells > 1) {
                view.setColumnContext(null, null);
            } else {
                view.setColumnContext(LVBU_TOP_STRIP_COLUMN_COUNT, null);
            }
            view.setSymbol(symbolId);

            // 高度铺满顶条格；不强制塞进 spanW（否则戟尖/立绘被压进框里显得「显示不全」）
            const content = view.contentNode;
            const ut = content?.getComponent(UITransform);
            const iw = ut?.contentSize.width ?? 0;
            const ih = ut?.contentSize.height ?? 0;
            if (content && iw > 0 && ih > 0 && boxH > 0) {
                const s = boxH / ih;
                content.setScale(s, s, 1);
            }

            const g = cellNode.getComponent(Graphics);
            if (g) {
                g.clear();
                g.fillColor = new Color(40, 36, 20, 90);
                g.strokeColor = new Color(255, 200, 80, 220);
                g.lineWidth = 2;
                // 描边略内收，避免盖住超框后的符号边缘
                const inset = 1;
                g.rect(-spanW / 2 + inset, -boxH / 2 + inset, spanW - inset * 2, boxH - inset * 2);
                g.fill();
                g.stroke();
            }
        }
    }

    /** 顶条点击：读写 frame.topStrip，不碰主盘 */
    private onTopStripPress(stripIndex: number): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        const stripCount = WAYS_6X7_TOP_MID4.topStrip!.count;
        if (stripIndex < 0 || stripIndex >= stripCount) return;

        const state = this.doc.states[this.currentIndex];
        const symbols = ensureTopStripSymbols(readFrameExt(state), stripCount);
        const current = symbols[stripIndex] ?? null;

        if (this.brush === undefined) {
            const name =
                current !== null ? this.catalog.getEntry(current)?.name ?? String(current) : '空';
            this.hud?.setCellInfo(`顶条 [${stripIndex}] · ${name}（独立于主盘）`);
            this.hud?.setMultiplierEditor(null);
            this.refreshSizeInfo(current);
            return;
        }

        // 竖版槽（同 id 无 @）：有 column-fill 时禁止进顶条，请改选「·横」槽
        if (
            this.brush !== null &&
            this.isColumnFillId(this.brush) &&
            this.isTopRowSpanId(this.brush) &&
            !this.brushIsTopVariant()
        ) {
            this.hud?.setStatus('当前是竖版刷子，请改选「bonus·横」再刷上部横轮');
            return;
        }

        // 仅挂了 column-fill、没有 top-row-span 的符号 → 禁止进顶条
        const brushEntry = this.brush !== null ? this.catalog.getEntry(this.brush) : null;
        const topPlace = resolvePlacement(brushEntry, 'topStrip');
        const mainOnlyFill =
            this.brush !== null &&
            this.isColumnFillId(this.brush) &&
            !this.isTopRowSpanId(this.brush);
        if (mainOnlyFill) {
            this.hud?.setStatus('该符号仅主盘整列占满，不能放入上部横轮（请挂 top-row-span）');
            return;
        }

        // 横版槽：必须走 top-row-span
        if (this.brushIsTopVariant() && this.brush !== null) {
            if (topPlace?.recipeId !== 'top-row-span') {
                this.hud?.setStatus('横版刷子未配置 top-row-span');
                return;
            }
            this.paintTopRowSpan(stripIndex, this.brush, topPlace.cells, stripCount);
            return;
        }

        // 点在已有 top-row-span 段上
        const hitAnchor = findTopRowSpanAnchorAt(
            symbols,
            stripIndex,
            this.isTopRowSpanId,
            this.topRowSpanCellsOf,
        );
        if (hitAnchor != null && this.brush === null) {
            this.clearTopRowSpan(hitAnchor, symbols, stripCount);
            return;
        }
        if (hitAnchor != null && this.brush !== null && !this.isTopRowSpanId(this.brush)) {
            this.replaceTopRowSpanWithCell(hitAnchor, stripIndex, this.brush, symbols, stripCount);
            return;
        }

        // 刷 top-row-span：一次写 N 格
        if (this.brush !== null && topPlace?.recipeId === 'top-row-span') {
            this.paintTopRowSpan(stripIndex, this.brush, topPlace.cells, stripCount);
            return;
        }

        if (current === this.brush) {
            const name =
                current !== null ? this.catalog.getEntry(current)?.name ?? String(current) : '空';
            this.hud?.setCellInfo(`顶条 [${stripIndex}] · ${name}`);
            return;
        }

        const cmd = new SetTopStripCellCommand(this.currentIndex, stripIndex, this.brush, stripCount);
        cmd.apply(this.doc);
        this.stroke.push(cmd);
        this.refreshTopStrip();
        const name =
            this.brush !== null ? this.catalog.getEntry(this.brush)?.name ?? String(this.brush) : '空';
        this.hud?.setCellInfo(`顶条 [${stripIndex}] · ${name}`);
        this.refreshSizeInfo(this.brush);
    }

    private paintTopRowSpan(
        stripIndex: number,
        symbolId: number,
        cells: number,
        stripCount: number,
    ): void {
        if (!this.doc) return;
        const anchor = topRowSpanAnchor(stripIndex, stripCount, cells);
        if (anchor == null) {
            this.hud?.setStatus(`顶条不足 ${cells} 格，无法横跨`);
            return;
        }
        const state = this.doc.states[this.currentIndex];
        const symbols = ensureTopStripSymbols(readFrameExt(state), stripCount);
        const indices = topRowSpanIndices(anchor, cells);
        let changed = false;
        for (const i of indices) {
            if (symbols[i] === symbolId) continue;
            const cmd = new SetTopStripCellCommand(this.currentIndex, i, symbolId, stripCount);
            cmd.apply(this.doc);
            this.stroke.push(cmd);
            changed = true;
        }
        // 清掉与本段重叠的其它旧符号（锚点段外同次 stroke 已覆盖写入）
        if (!changed) {
            const entry = this.catalog.getEntry(symbolId);
            this.hud?.setCellInfo(`顶条 [${anchor}..${anchor + cells - 1}] · ${entry?.name ?? symbolId}`);
            this.refreshTopStrip();
            return;
        }
        this.refreshTopStrip();
        const entry = this.catalog.getEntry(symbolId);
        this.hud?.setStatus(
            `${entry?.name ?? symbolId} · 顶条横跨 ${cells} 格（${anchor}..${anchor + cells - 1}）`,
        );
        this.hud?.setCellInfo(`顶条 [${anchor}..${anchor + cells - 1}] · ${entry?.name ?? symbolId}`);
        this.refreshSizeInfo(symbolId);
    }

    private clearTopRowSpan(
        anchor: number,
        symbols: Array<number | null>,
        stripCount: number,
    ): void {
        if (!this.doc) return;
        const id = symbols[anchor];
        if (id == null) return;
        const cells = this.topRowSpanCellsOf(id);
        for (const i of topRowSpanIndices(anchor, cells)) {
            if (symbols[i] == null) continue;
            const cmd = new SetTopStripCellCommand(this.currentIndex, i, null, stripCount);
            cmd.apply(this.doc);
            this.stroke.push(cmd);
        }
        this.refreshTopStrip();
        this.hud?.setCellInfo(`顶条 [${anchor}] · 空`);
    }

    private replaceTopRowSpanWithCell(
        anchor: number,
        clickIndex: number,
        symbolId: number | null,
        symbols: Array<number | null>,
        stripCount: number,
    ): void {
        if (!this.doc) return;
        const id = symbols[anchor];
        if (id == null) return;
        const cells = this.topRowSpanCellsOf(id);
        for (const i of topRowSpanIndices(anchor, cells)) {
            const want = i === clickIndex ? symbolId : null;
            if (symbols[i] === want) continue;
            const cmd = new SetTopStripCellCommand(this.currentIndex, i, want, stripCount);
            cmd.apply(this.doc);
            this.stroke.push(cmd);
        }
        this.refreshTopStrip();
        const name =
            symbolId !== null ? this.catalog.getEntry(symbolId)?.name ?? String(symbolId) : '空';
        this.hud?.setCellInfo(`顶条 [${clickIndex}] · ${name}`);
        this.refreshSizeInfo(symbolId);
    }

    private isColumnFillId = (symbolId: number): boolean => {
        const entry = this.catalog.getEntry(symbolId);
        return isColumnFillEntry(entry);
    };

    private isTopRowSpanId = (symbolId: number): boolean => {
        return isTopRowSpanEntry(this.catalog.getEntry(symbolId));
    };

    private topRowSpanCellsOf = (symbolId: number): number => {
        const b = readPlacementBinding(this.catalog.getEntry(symbolId));
        return Math.max(1, b.topStripCells || 2);
    };

    private refreshOccupancyHud(): void {
        if (!this.doc || !this.hud) return;
        const rows = this.doc.states[this.currentIndex].board.topology.visibleRows;
        this.hud.setColumnOccupancy(rows, this.selectedCol);
        if (this.selectedCol !== null) {
            const n = rows[this.selectedCol] ?? 0;
            if (this.gamePack?.id === 'lvbu') {
                const tier = columnCountToTier(n);
                this.hud.setColumnRowsEditor(n, tier != null ? tierKey(tier) : '');
            } else {
                this.hud.setColumnRowsEditor(n, '');
            }
        } else {
            this.hud.setColumnRowsEditor(null);
        }
    }

    private refreshBrushTierHud(): void {
        if (!this.hud) return;
        if (this.gamePack?.id !== 'lvbu') {
            this.hud.setBrushTierInfo('', false);
            return;
        }
        if (this.brushTier == null) {
            this.hud.setBrushTierInfo('跟列(auto)');
        } else {
            const rows = LVBU_COLUMN_COUNT_MAX + 1 - this.brushTier;
            this.hud.setBrushTierInfo(
                `${tierKey(this.brushTier)} · ${rows}个/列 · ${tierDesignHeight(this.brushTier)}px`,
            );
        }
    }

    private cycleBrushTier(dir: 1 | -1): void {
        if (this.gamePack?.id !== 'lvbu') return;
        const order: Array<number | null> = [null, 1, 2, 3, 4, 5, 6];
        const i = Math.max(0, order.indexOf(this.brushTier));
        this.brushTier = order[(i + dir + order.length) % order.length]!;
        this.refreshBrushTierHud();
        if (this.brushTier != null && this.selectedCol !== null) {
            const targetRows = LVBU_COLUMN_COUNT_MAX + 1 - this.brushTier;
            this.adjustColumnRows(0, this.selectedCol, targetRows);
        }
        this.hud?.setStatus(
            this.brushTier == null
                ? '刷子大小：跟列（由列符号数决定档位）'
                : `刷子大小：${tierKey(this.brushTier)}（刷盘时同步该列符号数）`,
        );
    }

    private pickColumn(col: number): void {
        if (!this.doc || !this.boardView) return;
        const rows = this.doc.states[this.currentIndex].board.topology.visibleRows[col] ?? 1;
        const row = Math.min(rows - 1, this.boardView.getSelected()?.row ?? 0);
        this.selectedCol = col;
        this.boardView.setSelected(col, Math.max(0, row));
        this.refreshSelectedCellUi(col, Math.max(0, row));
        this.refreshOccupancyHud();
    }

    private formatGameLabel(pack: GamePackDef): string {
        const packs = listActiveGamePacks();
        const n = packs.length;
        const i = Math.max(0, packs.findIndex((p) => p.id === pack.id)) + 1;
        const zone = getActiveSpineZoneSync();
        const base = n > 1 ? `${pack.name}  (${i}/${n})` : pack.name;
        return `${base} · ${zone}`;
    }

    /** 切换当前 Spine 区内的符号包：重载 library、刷子面板与盘面显示 */
    private openSymbolEditor(): void {
        director.loadScene('SymbolEditor', (err) => {
            if (err) {
                console.error(err);
                this.hud?.setStatus('无法打开 SymbolEditor 场景（请确认已加入构建设置）');
            }
        });
    }

    private async cycleGame(dir: 1 | -1): Promise<void> {
        if (this.switchingGame || this.director?.isPlaying || !this.gamePack) return;
        if (listActiveGamePacks().length <= 1) {
            this.hud?.setStatus(`当前区 ${getActiveSpineZoneSync()} 仅一个符号包：${this.gamePack.id}`);
            return;
        }
        const next = cycleGameId(this.gamePack.id, dir);
        if (next.id === this.gamePack.id) return;
        this.switchingGame = true;
        this.hud?.setStatus(`切换游戏包 → ${next.id} …`);
        try {
            // 先落盘当前包编辑（含列格数），否则切走就丢
            if (this.doc) this.persistence.autosave(this.doc);

            await this.catalog.loadPack(next);
            this.gamePack = next;
            storeGameId(next.id);
            this.applyDocBindingForPack(next.id);
            this.applyLocalSymbolSheet();

            // 优先恢复该包 autosave；没有再读种子（不再 clear，避免把刚存的冲掉）
            this.migrateSeedAutosave();
            let source = 'localStorage 自动存档';
            let loaded = this.persistence.loadAutosave(this.docId);
            if (!loaded) {
                loaded = await this.loadSeedDoc();
                source = 'resources/seed';
            } else if (!this.docMatchesPack(loaded, next.id) || loaded.id !== this.docId) {
                console.warn(
                    `[BoardEditorMain] switch autosave id=${loaded.id} 与目标 docId=${this.docId}/pack=${next.id} 不匹配，改用种子`,
                );
                this.persistence.clearAutosave(this.docId);
                this.persistence.clearAutosave(loaded.id);
                loaded = await this.loadSeedDoc();
                source = 'resources/seed(replaced-autosave)';
            }
            const issues = validateDoc(loaded);
            if (issues.length) {
                console.error('[BoardEditorMain] switch validateDoc', issues);
                loaded = await this.loadSeedDoc();
                source = 'resources/seed(after-invalid-autosave)';
            }
            this.doc = loaded;
            this.history = new CommandHistory(this.doc);
            console.log(`[BoardEditorMain] switch doc source=${source} frames=${this.doc.states.length}`);

            if (this.boardView) {
                this.boardView.setCatalog(this.catalog);
                this.boardView.cellW = this.catalog.designW;
                this.boardView.cellH = this.catalog.designH;
                this.boardView.setTopStripMap(null);
                this.boardView.setLayoutProfile(next.id === 'lvbu' ? WAYS_6X7_TOP_MID4 : null);
                this.applyLayoutSpacingDefaults();
                this.restoreGaps();
                this.enforceLockedGaps();
                this.refreshGapHud();
            }
            this.buildTopStripScaffold();
            this.brush = undefined;
            this.brushKey = undefined;
            this.brushTier = null;
            this.hud?.setVariableColumnUi(!!next.variableColumns, !!next.tallSymbolTiers);
            this.hud?.setGameInfo(this.formatGameLabel(next));
            this.hud?.rebuildBrushes(this.catalog);
            this.hud?.setBrushHighlight(undefined);
            this.refreshBrushTierHud();
            this.clearSelection();
            this.boardView?.invalidateLayout();
            this.showState(0);
            this.refreshOccupancyHud();
            this.hud?.setStatus(`游戏包：${next.id} · ${this.doc?.states.length ?? 0} 帧`);
            console.log(`[BoardEditorMain] game pack → ${next.id} (${next.libraryPath})`);
        } catch (e) {
            console.error('[BoardEditorMain] switch game failed', e);
            this.hud?.setStatus(`切换失败：${next.id}`);
        } finally {
            this.switchingGame = false;
        }
    }

    // ------------------------------------------------------------------
    // 盘面间距
    // ------------------------------------------------------------------

    private layoutSpacing() {
        // 吕布仍走专用 profile；其它包读 H5 packLayout → SymbolCatalog.boardSpacing
        if (this.gamePack?.id === 'lvbu') return WAYS_6X7_TOP_MID4.spacing;
        return this.catalog.boardSpacing;
    }

    private applyLayoutSpacingDefaults(): void {
        if (!this.boardView) return;
        const spacing = this.layoutSpacing();
        this.boardView.colGap = spacing.colGap;
        this.boardView.rowGap = spacing.rowGap;
        this.boardView.setColumnVAlign(
            (spacing as { columnVAlign?: string }).columnVAlign ??
                this.catalog.readPackLayout().columnVAlign,
        );
    }

    private refreshGapHud(): void {
        if (!this.boardView || !this.hud) return;
        const spacing = this.layoutSpacing();
        this.hud.setGapInfo(
            this.boardView.colGap,
            this.boardView.rowGap,
            {
                lockCol: !!spacing?.lockColGap,
                lockRow: !!spacing?.lockRowGap,
            },
            columnVAlignLabel(this.boardView.getColumnVAlign()),
        );
    }

    /** 吕布 / 包锁定轴：强制回包设定（忽略误调） */
    private enforceLockedGaps(): void {
        const spacing = this.layoutSpacing();
        if (!this.boardView || !spacing) return;
        if (spacing.lockColGap) this.boardView.colGap = spacing.colGap;
        if (spacing.lockRowGap) this.boardView.rowGap = spacing.rowGap;
    }

    /**
     * 间距以 SymbolSheetDoc.packLayout 为准（H5 唯一配置）。
     * 旧 boardGaps.* 本地存档仅作一次性迁移后清除。
     */
    private restoreGaps(): void {
        if (!this.boardView) return;
        const spacing = this.layoutSpacing();
        // 清掉旧版无 pack 后缀 + 本包 gap 存档（已迁入 packLayout）
        try {
            localStorage.removeItem(BoardEditorMain.GAP_STORE_KEY);
            localStorage.removeItem(this.gapStoreKey());
        } catch {
            /* ignore */
        }
        this.boardView.colGap = spacing.colGap;
        this.boardView.rowGap = spacing.rowGap;
        this.enforceLockedGaps();
    }

    private gapStoreKey(): string {
        return `${BoardEditorMain.GAP_STORE_KEY}.${this.gamePack?.id ?? 'default'}`;
    }

    /** 把当前 BoardView 间距写回 H5 symbol-sheet.packLayout */
    private persistGapsToSymbolSheet(): void {
        if (!this.gamePack || !this.boardView) return;
        if (this.gamePack.id === 'lvbu') return; // 吕布用 profile，不写 sheet
        let sheet = loadSymbolSheetDoc(this.gamePack.id);
        const layout = normalizePackLayout({
            ...(sheet?.packLayout ?? this.catalog.readPackLayout()),
            boardColGap: this.boardView.colGap,
            boardRowGap: this.boardView.rowGap,
            columnVAlign: this.boardView.getColumnVAlign(),
        });
        if (!sheet) {
            sheet = {
                docVersion: 1,
                packId: this.gamePack.id,
                zone: getActiveSpineZoneSync(),
                symbols: this.catalog.getSourceEntries().map((e) => draftFromEntry(e)),
                packLayout: layout,
                winCellFxAssetId: this.catalog.packWinCellFxAssetId(),
                vanishCellFxAssetId: this.catalog.packVanishCellFxAssetId(),
                updatedAt: new Date().toISOString(),
            };
        } else {
            sheet = {
                ...sheet,
                packLayout: {
                    ...layout,
                    lockBoardColGap: sheet.packLayout?.lockBoardColGap ?? layout.lockBoardColGap,
                    lockBoardRowGap: sheet.packLayout?.lockBoardRowGap ?? layout.lockBoardRowGap,
                },
                updatedAt: new Date().toISOString(),
            };
        }
        saveSymbolSheetDoc(sheet);
        this.catalog.applyPackLayout(sheet.packLayout);
    }

    private adjustGap(axis: 'col' | 'row', dir: 1 | -1): void {
        if (!this.boardView) return;
        if (this.director?.isPlaying) return;
        const spacing = this.layoutSpacing();
        if (axis === 'col' && spacing?.lockColGap) {
            this.enforceLockedGaps();
            this.refreshGapHud();
            this.hud?.setStatus(`列距已锁定为 ${spacing.colGap}（H5 包布局）`);
            return;
        }
        if (axis === 'row' && spacing?.lockRowGap) {
            this.enforceLockedGaps();
            this.refreshGapHud();
            this.hud?.setStatus(`行距已锁定为 ${spacing.rowGap}（H5 包布局）`);
            return;
        }
        const step = 2;
        const cur = axis === 'col' ? this.boardView.colGap : this.boardView.rowGap;
        const next = Math.max(-60, Math.min(60, cur + dir * step));
        if (next === cur) return;
        if (axis === 'col') this.boardView.colGap = next;
        else this.boardView.rowGap = next;
        this.enforceLockedGaps();
        this.persistGapsToSymbolSheet();
        this.refreshGapHud();
        this.boardView.invalidateLayout();
        this.showState(this.currentIndex);
    }

    private cycleColumnVAlign(dir: 1 | -1): void {
        if (!this.boardView) return;
        if (this.director?.isPlaying) return;
        const cur = this.boardView.getColumnVAlign();
        const i = Math.max(0, COLUMN_VALIGN_CYCLE.indexOf(cur));
        const next = COLUMN_VALIGN_CYCLE[(i + dir + COLUMN_VALIGN_CYCLE.length) % COLUMN_VALIGN_CYCLE.length]!;
        this.boardView.setColumnVAlign(next);
        this.persistGapsToSymbolSheet();
        this.refreshGapHud();
        this.boardView.invalidateLayout();
        this.showState(this.currentIndex);
        this.hud?.setStatus(`列对齐 → ${columnVAlignLabel(next)}`);
    }

    // ------------------------------------------------------------------
    // 播放
    // ------------------------------------------------------------------

    private async playFromCurrent(): Promise<void> {
        if (!this.doc || !this.director || this.director.isPlaying) return;
        this.clearSelection();
        const from = this.currentIndex >= this.doc.states.length - 1 ? 0 : this.currentIndex;
        this.hud?.setStatus(`播放中 ${from + 1} → ${this.doc.states.length} …`);
        const landed = await this.director.playRange(from, this.doc.states.length - 1, (i) => {
            this.currentIndex = i;
            this.refreshFrameInfo();
            this.refreshTopStrip();
        });
        this.currentIndex = landed;
        this.refreshFrameInfo();
        this.refreshStatus();
        this.refreshTopStrip();
        this.hud?.setStatus(`播放结束 · 帧 ${landed + 1}/${this.doc.states.length}`);
    }

    private stopPlayback(): void {
        if (!this.director) return;
        this.director.stop();
        this.showState(this.currentIndex);
    }

    // ------------------------------------------------------------------
    // 帧导航 / 渲染
    // ------------------------------------------------------------------

    private showState(index: number): void {
        if (!this.doc || !this.boardView) return;
        if (this.director?.isPlaying) this.director.stop();
        const clamped = Math.max(0, Math.min(index, this.doc.states.length - 1));
        this.currentIndex = clamped;
        const state = this.doc.states[clamped];
        // multiCollect 帧语义：数字已收集；静态预览也不得再显示倍数
        const suppressMultiDigits = readFrameExt(state)?.frameKind === 'multiCollect';
        this.boardView.render(state, { suppressMultiDigits });
        this.refreshTopStrip();
        this.fitBoardInViewport();
        this.refreshOccupancyHud();
        this.refreshFrameInfo();
        this.refreshCellInfo();
        this.refreshStatus();
        const sel = this.boardView.getSelected();
        if (sel) this.refreshSelectedCellUi(sel.col, sel.row);
        else this.hud?.setMultiplierEditor(null);
    }

    private refreshStatus(): void {
        if (!this.doc || !this.hud) return;
        const undo = this.history?.canUndo ? '●' : '○';
        const redo = this.history?.canRedo ? '●' : '○';
        this.hud.setStatus(`帧 ${this.currentIndex + 1}/${this.doc.states.length} · undo${undo} redo${redo}`);
    }

    private refreshFrameInfo(): void {
        if (!this.doc || !this.hud) return;
        const state = this.doc.states[this.currentIndex];
        const kind = readFrameExt(state)?.frameKind ?? '?';
        this.hud.setFrameInfo(`帧 ${this.currentIndex + 1}/${this.doc.states.length} · ${frameKindLabel(kind)}`);
        this.hud.setAnimSection(this.buildAnimModel());
    }

    private animStyle(): AnimStyleId {
        // 只认布局 profile 上的 animStyleId，不认 pack
        return animStyleFromBoardView(this.boardView);
    }

    private buildAnimModel(): AnimSectionModel {
        const state = this.doc!.states[this.currentIndex];
        const ext = readFrameExt(state);
        const style = this.animStyle();
        const { template, params } = resolveTemplateForState(state, style);
        const kind = ext?.frameKind ?? 'reveal';
        const isOverride = ext?.templateId !== undefined && isTemplateAllowed(kind, ext.templateId, style);
        const templateLabel = isOverride ? template.label : `auto(${template.label})`;
        return {
            frameKind: frameKindLabel(ext?.frameKind),
            templateLabel,
            params: template.paramSchema
                .filter((f) => f.type === 'number')
                .map((f) => ({
                    key: f.key,
                    label: f.label,
                    value: typeof params[f.key] === 'number' ? (params[f.key] as number) : 0,
                })),
            canPlayTransition: this.currentIndex > 0,
            playWithPrev: ext?.playWithPrev === true,
        };
    }

    // ------------------------------------------------------------------
    // 动画编辑
    // ------------------------------------------------------------------

    private cycleFrameKind(dir: 1 | -1): void {
        if (!this.doc || !this.history) return;
        const state = this.doc.states[this.currentIndex];
        const ext = readFrameExt(state);
        const current = ext?.frameKind ?? 'reveal';
        const kinds = EDITOR_FRAME_KINDS;
        // 当前是子集外的 kind（如导入文档带 bonus-reveal）时，从头开始循环
        const idx = kinds.indexOf(current);
        const next = kinds[(Math.max(idx, dir === 1 ? -1 : 0) + dir + kinds.length) % kinds.length];
        // 换 frameKind 后，原 templateId override 若不兼容则一并清除（回落 auto）
        const staleOverride = ext?.templateId !== undefined && !isTemplateAllowed(next, ext.templateId, this.animStyle());
        this.history.execute(
            new PatchFrameExtCommand(this.currentIndex, {
                frameKind: next,
                ...(staleOverride ? { templateId: undefined, templateParams: undefined } : {}),
            }),
        );
        this.afterEdit();
        this.refreshFrameInfo();
    }

    private cycleTemplate(dir: 1 | -1): void {
        if (!this.doc || !this.history) return;
        const state = this.doc.states[this.currentIndex];
        const kind = readFrameExt(state)?.frameKind ?? 'reveal';
        // 只在该 frameKind 允许的模板内循环；undefined = auto（默认模板）
        const ids: Array<string | undefined> = [undefined, ...allowedTemplateIds(kind, this.animStyle())];
        const current = readFrameExt(state)?.templateId;
        const idx = Math.max(0, ids.indexOf(current));
        const next = ids[(idx + dir + ids.length) % ids.length];
        // 切模板时清掉旧参数 override（不同模板参数不通用）
        this.history.execute(
            new PatchFrameExtCommand(this.currentIndex, { templateId: next, templateParams: undefined }),
        );
        this.afterEdit();
        this.refreshFrameInfo();
    }

    private adjustParam(key: string, dir: 1 | -1): void {
        if (!this.doc || !this.history) return;
        const state = this.doc.states[this.currentIndex];
        const { template, params } = resolveTemplateForState(state, this.animStyle());
        const field = template.paramSchema.find((f) => f.key === key);
        if (!field || field.type !== 'number') return;
        const step = field.step ?? 1;
        const cur = typeof params[key] === 'number' ? (params[key] as number) : 0;
        let next = Math.round((cur + dir * step) * 1000) / 1000;
        if (field.min !== undefined) next = Math.max(field.min, next);
        if (field.max !== undefined) next = Math.min(field.max, next);
        if (next === cur) return;
        const override = { ...(readFrameExt(state)?.templateParams ?? {}), [key]: next };
        this.history.execute(new PatchFrameExtCommand(this.currentIndex, { templateParams: override }));
        this.afterEdit();
        this.refreshFrameInfo();
    }

    private togglePlayWithPrev(): void {
        if (!this.doc || !this.history || this.currentIndex <= 0) return;
        const cur = readFrameExt(this.doc.states[this.currentIndex])?.playWithPrev === true;
        this.history.execute(
            new PatchFrameExtCommand(this.currentIndex, { playWithPrev: cur ? undefined : true }),
        );
        this.afterEdit();
        this.refreshFrameInfo();
    }

    /** 基于当前帧生成重力压缩后的 compact 帧，插到当前帧之后 */
    private generateCompactFrame(): void {
        if (!this.doc || !this.history) return;
        const compacted = makeCompactedState(this.doc.states[this.currentIndex]);
        if (!compacted) {
            this.hud?.setStatus('当前帧已是压缩态，无需生成 compact 帧');
            return;
        }
        this.history.execute(new AddStateCommand(this.currentIndex + 1, compacted));
        this.afterEdit();
        this.showState(this.currentIndex + 1);
    }

    /** 基于当前帧生成扩散帧：假轮带=横JI→竖JI；cascade=倍率球四邻 */
    private generateExpandFrame(): void {
        if (!this.doc || !this.history) return;
        const src = this.doc.states[this.currentIndex];
        if (this.animStyle() === ANIM_STYLE_FAKE_REEL) {
            const profile = this.boardView?.getLayoutProfile();
            if (!profile) {
                this.hud?.setStatus('无布局 profile，无法生成戟扩散帧');
                return;
            }
            const diffused = makeJiDiffuseState(src, profile);
            if (!diffused) {
                this.hud?.setStatus('顶条需连续≥2格横 JI（Bonus）才可扩散');
                return;
            }
            this.history.execute(new AddStateCommand(this.currentIndex + 1, diffused));
            this.afterEdit();
            this.showState(this.currentIndex + 1);
            this.hud?.setStatus('已生成戟扩散帧 ·「与上帧同播」请保持否 · 点「播本帧转移」');
            return;
        }
        const expanded = makeExpandedState(src);
        if (!expanded) {
            this.hud?.setStatus('无可扩散的倍率球邻格（需 multi + 四邻空位）');
            return;
        }
        this.history.execute(new AddStateCommand(this.currentIndex + 1, expanded));
        this.afterEdit();
        this.showState(this.currentIndex + 1);
        this.hud?.setStatus('已生成 expandPost 扩散帧 · 点「播本帧转移」预览');
    }

    /** 顶条整体左移一格 */
    private generateTopStepFrame(): void {
        if (!this.doc || !this.history) return;
        const count = this.boardView?.getLayoutProfile()?.topStrip?.count ?? 0;
        if (count <= 0) {
            this.hud?.setStatus('当前布局无顶条');
            return;
        }
        const stepped = makeTopStepState(this.doc.states[this.currentIndex], count);
        if (!stepped) {
            this.hud?.setStatus('顶条左移后无变化（可能已全空）');
            return;
        }
        this.history.execute(new AddStateCommand(this.currentIndex + 1, stepped));
        this.afterEdit();
        this.showState(this.currentIndex + 1);
        this.hud?.setStatus('已生成 topStep 横栏步进帧 · 点「播本帧转移」预览');
    }

    /** 基于当前帧生成倍率数字收集后的 multiCollect 帧（球保留、数字清掉） */
    private generateMultiCollectFrame(): void {
        if (!this.doc || !this.history) return;
        const collected = makeMultiCollectedState(this.doc.states[this.currentIndex]);
        if (!collected) {
            this.hud?.setStatus('当前帧没有可收集的倍率数字');
            return;
        }
        this.history.execute(new AddStateCommand(this.currentIndex + 1, collected));
        this.afterEdit();
        this.showState(this.currentIndex + 1);
        this.hud?.setStatus('已生成 multiCollect 倍率收集帧 · 点「播本帧转移」预览');
    }

    private async playCurrentTransition(): Promise<void> {
        if (!this.doc || !this.director || this.director.isPlaying) return;
        if (this.currentIndex <= 0) return;
        this.clearSelection();
        const target = this.currentIndex;
        const from = target - 1;
        this.hud?.setStatus(`播放转移 ${from + 1} → ${target + 1} …`);
        // 先把顶条/时间轴落到 A，再开转（否则仍显示 B）
        this.currentIndex = from;
        this.refreshTopStrip();
        await this.director.playRange(from, target);
        this.currentIndex = target;
        // 假轮带已 settle：勿再 refreshTopStrip/showState（会闪）
        this.refreshFrameInfo();
        this.refreshStatus();
        this.hud?.setStatus(`帧 ${target + 1}/${this.doc.states.length}`);
    }

    private refreshCellInfo(): void {
        if (!this.hud) return;
        if (this.brush === undefined) {
            this.hud.setCellInfo('未选刷子（点右侧 symbol 选刷子）');
        } else if (this.brush === null) {
            this.hud.setCellInfo('刷子: 橡皮擦（盘面点/拖清空）');
        } else {
            const name = this.catalog.getEntry(this.brush)?.name ?? String(this.brush);
            this.hud.setCellInfo(`刷子: ${name}（盘面点/拖绘制）`);
        }
        this.refreshSizeInfo(typeof this.brush === 'number' ? this.brush : null);
    }

    // ------------------------------------------------------------------
    // 尺寸信息
    // ------------------------------------------------------------------

    /** 刷新 HUD 尺寸行：格子配置尺寸 + 指定 symbol 的实际渲染尺寸 */
    private refreshSizeInfo(symbolId: number | null): void {
        if (!this.hud || !this.boardView) return;
        this.hud.setSizeInfo(this.describeSymbolSize(symbolId));
    }

    /**
     * 尺寸描述文本。symbol 渲染逻辑与 SymbolView.fitScale 一致：
     * 设计盒(designW×designH)等比缩进 格子×cellFill，再乘条目 scaleMul；
     * 纹理走 RAW 模式 → 实际显示 = 纹理原始尺寸 × 该缩放。
     */
    private describeSymbolSize(symbolId: number | null): string {
        const cellText = `设计格 ${this.catalog.designW}×${this.catalog.designH} · 符号纹理1:1可超框`;
        const entry = symbolId !== null ? this.catalog.getEntry(symbolId) : null;
        if (!entry) return `${cellText}\n符号缩放请在「符号编辑器」调`;
        const name = entry.name || String(entry.id);
        const variants = entry.visualVariants?.length ?? 0;
        return `${cellText}\n${name}: ${variants} 档 · 不按包围盒撑格\n资源缩放请在符号编辑器调整`;
    }

    // ------------------------------------------------------------------
    // 刷子编辑
    // ------------------------------------------------------------------

    private pickBrush(symbolId: number | null, brushKey?: string): void {
        const key =
            symbolId === null ? 'eraser' : brushKey && brushKey.length > 0 ? brushKey : String(symbolId);
        // 重复点同一槽 = 取消（竖/横分槽，不能只比 symbolId）
        if (this.brushKey !== undefined && this.brushKey === key) {
            this.brush = undefined;
            this.brushKey = undefined;
        } else {
            this.brush = symbolId;
            this.brushKey = key;
        }
        this.hud?.setBrushHighlight(this.brushKey);
        this.refreshCellInfo();
        if (this.brushKey?.includes('@')) {
            this.hud?.setStatus('横版刷子：只能刷上部横轮（占两格）');
        } else if (
            this.brush != null &&
            this.isColumnFillId(this.brush) &&
            this.isTopRowSpanId(this.brush)
        ) {
            this.hud?.setStatus('竖版刷子：只能刷主盘整列');
        }
    }

    /** 当前刷子是否为「横版变体槽」（hlKey 含 @variant） */
    private brushIsTopVariant(): boolean {
        return !!this.brushKey && this.brushKey.includes('@');
    }

    private clearSelection(): void {
        this.selectedCol = null;
        this.boardView?.setSelected(null);
        this.hud?.setMultiplierEditor(null);
        this.refreshOccupancyHud();
    }

    private layoutProfile(): BoardLayoutProfile | null {
        return this.gamePack?.id === 'lvbu' ? WAYS_6X7_TOP_MID4 : null;
    }

    private onCellPress(col: number, row: number): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        this.selectedCol = col;
        const profile = this.layoutProfile();
        const board = this.doc.states[this.currentIndex].board;
        const colRows = board.topology.visibleRows[col] ?? 0;
        const isTop = this.boardView.isTopMappedCell(col, row);

        if (this.brush === undefined) {
            // 无刷子：列占满符号时选中锚点行
            let selRow = row;
            if (profile && !isTop) {
                const span = findColumnSpanRow(
                    profile,
                    col,
                    colRows,
                    board.resolved,
                    this.isColumnFillId,
                );
                if (span != null) selRow = span;
            }
            this.boardView.setSelected(col, selRow);
            this.refreshSelectedCellUi(col, selRow);
            this.refreshOccupancyHud();
            this.refreshTopStrip();
            return;
        }

        // 刷子指定了大小档 → 先同步该列符号数（column-fill 整列占满，不跟档）
        if (
            this.brushTier != null &&
            this.brush !== null &&
            !this.isColumnFillId(this.brush)
        ) {
            const want = LVBU_COLUMN_COUNT_MAX + 1 - this.brushTier;
            const cur = colRows;
            if (want !== cur) {
                this.history.execute(new SetColumnVisibleRowsCommand(this.currentIndex, col, want));
                this.afterEdit();
                this.boardView.render(this.doc.states[this.currentIndex]);
                this.fitBoardInViewport();
                this.refreshTopStrip();
                row = Math.min(row, want - 1);
            }
        }

        const maxRow = (this.doc.states[this.currentIndex].board.topology.visibleRows[col] ?? 1) - 1;
        if (row < 0 || row > maxRow) return;

        // 横版槽只能刷顶条
        if (this.brushIsTopVariant()) {
            this.hud?.setStatus('当前是横版刷子，只能刷上部横轮（请改选竖版 bonus）');
            return;
        }

        // —— column-fill：主盘整列唯一落点，视觉占满整列 ——
        if (this.brush !== null && this.isColumnFillId(this.brush) && !isTop && profile) {
            this.paintColumnSpanBonus(col, profile, this.brush);
            return;
        }

        // 主盘列已有 column-fill：擦除则整列清空；换成其它符号则拆掉再写当前格
        if (profile && !isTop) {
            const spanRow = findColumnSpanRow(
                profile,
                col,
                this.doc.states[this.currentIndex].board.topology.visibleRows[col] ?? 0,
                this.doc.states[this.currentIndex].board.resolved,
                this.isColumnFillId,
            );
            if (spanRow != null) {
                if (this.brush === null) {
                    this.clearColumnSpan(col, profile);
                    return;
                }
                this.replaceColumnSpanWithCell(col, row, this.brush, profile);
                return;
            }
        }

        const current = this.doc.states[this.currentIndex].board.resolved[col]?.[row]?.symbolId ?? null;
        if (current === this.brush) {
            this.boardView.setSelected(col, row);
            this.refreshSelectedCellUi(col, row);
            this.refreshOccupancyHud();
            this.refreshTopStrip();
            return;
        }
        const entry = this.brush !== null ? this.catalog.getEntry(this.brush) : null;
        const multi = isMultiEntry(entry) ? { multiplier: DEFAULT_MULTI_VALUE } : null;
        const cmd = new SetResolvedCellCommand(this.currentIndex, col, row, this.brush, multi);
        cmd.apply(this.doc);
        this.stroke.push(cmd);
        this.boardView.applyCell(col, row, this.brush, multi?.multiplier ?? null);
        this.boardView.setSelected(col, row);
        this.refreshSelectedCellUi(col, row);
        this.refreshTopStrip();
        this.refreshOccupancyHud();
    }

    /** 主盘写入 column-fill：锚点一行有符号，其余主盘格清空 */
    private paintColumnSpanBonus(col: number, profile: BoardLayoutProfile, symbolId: number): void {
        if (!this.doc || !this.boardView) return;
        const board = this.doc.states[this.currentIndex].board;
        const colRows = board.topology.visibleRows[col] ?? 0;
        const anchor = columnSpanAnchorRow(profile, col, colRows);
        if (anchor == null) {
            this.hud?.setStatus('该列没有可放整列占满符号的主盘格');
            return;
        }
        const existing = findColumnSpanRow(
            profile,
            col,
            colRows,
            board.resolved,
            this.isColumnFillId,
        );
        if (existing === anchor && board.resolved[col]?.[anchor]?.symbolId === symbolId) {
            this.boardView.setSelected(col, anchor);
            this.refreshSelectedCellUi(col, anchor);
            this.refreshOccupancyHud();
            this.refreshTopStrip();
            return;
        }
        for (let r = 0; r < colRows; r++) {
            const want = r === anchor ? symbolId : null;
            const cur = board.resolved[col]?.[r]?.symbolId ?? null;
            if (cur === want) continue;
            const cmd = new SetResolvedCellCommand(this.currentIndex, col, r, want, null);
            cmd.apply(this.doc);
            this.stroke.push(cmd);
        }
        this.boardView.render(this.doc.states[this.currentIndex]);
        this.fitBoardInViewport();
        this.boardView.setSelected(col, anchor);
        this.refreshSelectedCellUi(col, anchor);
        this.refreshTopStrip();
        this.refreshOccupancyHud();
        const name = this.catalog.getEntry(symbolId)?.name ?? String(symbolId);
        this.hud?.setStatus(`${name} · 整列占满（列${col}）`);
    }

    private clearColumnSpan(col: number, profile: BoardLayoutProfile): void {
        if (!this.doc || !this.boardView) return;
        const board = this.doc.states[this.currentIndex].board;
        const colRows = board.topology.visibleRows[col] ?? 0;
        for (let r = 0; r < colRows; r++) {
            const cur = board.resolved[col]?.[r]?.symbolId ?? null;
            if (cur === null) continue;
            const cmd = new SetResolvedCellCommand(this.currentIndex, col, r, null, null);
            cmd.apply(this.doc);
            this.stroke.push(cmd);
        }
        this.boardView.render(this.doc.states[this.currentIndex]);
        this.fitBoardInViewport();
        const anchor = columnSpanAnchorRow(profile, col, colRows) ?? 0;
        this.boardView.setSelected(col, anchor);
        this.refreshSelectedCellUi(col, anchor);
        this.refreshTopStrip();
        this.refreshOccupancyHud();
    }

    private replaceColumnSpanWithCell(
        col: number,
        row: number,
        symbolId: number | null,
        profile: BoardLayoutProfile,
    ): void {
        if (!this.doc || !this.boardView) return;
        const board = this.doc.states[this.currentIndex].board;
        const colRows = board.topology.visibleRows[col] ?? 0;
        const entry = symbolId !== null ? this.catalog.getEntry(symbolId) : null;
        const multi = isMultiEntry(entry) ? { multiplier: DEFAULT_MULTI_VALUE } : null;
        for (let r = 0; r < colRows; r++) {
            const want = r === row ? symbolId : null;
            const cur = board.resolved[col]?.[r]?.symbolId ?? null;
            if (cur === want && !(r === row && multi)) continue;
            const cmd = new SetResolvedCellCommand(
                this.currentIndex,
                col,
                r,
                want,
                r === row ? multi : null,
            );
            cmd.apply(this.doc);
            this.stroke.push(cmd);
        }
        this.boardView.render(this.doc.states[this.currentIndex]);
        this.fitBoardInViewport();
        this.boardView.setSelected(col, row);
        this.refreshSelectedCellUi(col, row);
        this.refreshTopStrip();
        this.refreshOccupancyHud();
    }

    private refreshSelectedCellUi(col: number, row: number): void {
        if (!this.doc) return;
        this.selectedCol = col;
        const board = this.doc.states[this.currentIndex].board;
        const cell = board.resolved[col]?.[row];
        const name =
            cell && cell.symbolId !== null
                ? this.catalog.getEntry(cell.symbolId)?.name ?? String(cell.symbolId)
                : '空';
        const ent = cell?.entityRef ? board.entities[cell.entityRef] : null;
        const isMulti = !!ent && (ent.kind === 'multi' || isMultiEntry(this.catalog.getEntry(ent.symbolId)));
        const mult = isMulti ? ent!.multiplier ?? DEFAULT_MULTI_VALUE : null;
        const colRows = board.topology.visibleRows[col] ?? 0;
        const tier = columnCountToTier(colRows);
        const tierText = tier != null ? tierKey(tier) : '';
        const topTag = this.boardView?.isTopMappedCell(col, row) ? '顶条 · ' : '';
        const spanTag =
            !topTag && cell?.symbolId != null && this.isColumnFillId(cell.symbolId)
                ? '整列占满 · '
                : '';
        this.hud?.setCellInfo(
            mult !== null
                ? `${topTag}${spanTag}格 (${col},${row}) · ${name} · ${mult}x · ${colRows}个/列`
                : `${topTag}${spanTag}格 (${col},${row}) · ${name} · ${colRows}个/列${tierText ? '/' + tierText : ''}`,
        );
        this.hud?.setMultiplierEditor(mult);
        this.hud?.setColumnRowsEditor(colRows, tierText);
        this.refreshOccupancyHud();
        this.refreshSizeInfo(cell?.symbolId ?? null);
    }

    /**
     * 调整列符号数。
     * @param absolute 若给出，则直接设为该值（忽略 dir）
     */
    private adjustColumnRows(dir: 1 | -1 | 0, colArg?: number, absolute?: number): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        const col = colArg ?? this.selectedCol ?? this.boardView.getSelected()?.col ?? null;
        if (col === null) {
            this.hud?.setStatus('先点选一列（盘面格或下方列头）');
            return;
        }
        const cur = Number(this.doc.states[this.currentIndex].board.topology.visibleRows[col] ?? 0);
        const isLvbu = this.gamePack?.id === 'lvbu';
        const min = isLvbu ? LVBU_COLUMN_COUNT_MIN : 1;
        const max = isLvbu ? LVBU_COLUMN_COUNT_MAX : 12;
        const next =
            absolute !== undefined
                ? Math.max(min, Math.min(max, Math.trunc(Number(absolute))))
                : Math.max(min, Math.min(max, cur + dir));
        if (next === cur) {
            this.pickColumn(col);
            return;
        }
        this.history.execute(new SetColumnVisibleRowsCommand(this.currentIndex, col, next));
        this.afterEdit();
        const sel = this.boardView.getSelected();
        const row = Math.min(sel?.col === col ? sel.row : 0, next - 1);
        this.showState(this.currentIndex);
        this.boardView.setSelected(col, Math.max(0, row));
        this.selectedCol = col;
        this.refreshSelectedCellUi(col, Math.max(0, row));
        this.refreshOccupancyHud();
        const tier = isLvbu ? columnCountToTier(next) : null;
        const tierH = tier != null ? tierDesignHeight(tier) : null;
        this.hud?.setStatus(
            `列 ${col} → ${next} 格${
                tier != null ? ` · ${tierKey(tier)}${tierH != null ? ` · ${tierH}px` : ''}` : ''
            }`,
        );
    }

    /** 增减盘面列数（右侧增减；吕布顶条布局锁定 6 列） */
    private adjustBoardCols(dir: 1 | -1): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        if (this.gamePack?.id === 'lvbu') {
            this.hud?.setStatus('吕布 ways-6x7 顶条布局锁定 6 列');
            return;
        }
        const cur = this.doc.states[this.currentIndex].board.topology.cols;
        const next = Math.max(1, Math.min(12, cur + dir));
        if (next === cur) return;
        this.history.execute(new SetBoardColsCommand(next));
        this.afterEdit();
        this.clearSelection();
        this.boardView.invalidateLayout();
        this.showState(this.currentIndex);
        this.refreshOccupancyHud();
        this.fitBoardInViewport();
        this.hud?.setStatus(`盘面列数 → ${next}`);
    }

    private adjustMultiplier(dir: 1 | -1): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        const selected = this.boardView.getSelected();
        if (!selected) return;
        const { col, row } = selected;
        const board = this.doc.states[this.currentIndex].board;
        const cell = board.resolved[col]?.[row];
        const ent = cell?.entityRef ? board.entities[cell.entityRef] : null;
        if (!ent || (ent.kind !== 'multi' && !isMultiEntry(this.catalog.getEntry(ent.symbolId)))) return;
        const cur = ent.multiplier ?? DEFAULT_MULTI_VALUE;
        const next = Math.max(1, Math.min(999, cur + dir));
        if (next === cur) return;
        this.applyMultiplier(col, row, cell!.symbolId, next);
    }

    private setMultiplierValue(value: number): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        const selected = this.boardView.getSelected();
        if (!selected) return;
        const { col, row } = selected;
        const board = this.doc.states[this.currentIndex].board;
        const cell = board.resolved[col]?.[row];
        const ent = cell?.entityRef ? board.entities[cell.entityRef] : null;
        if (!ent || (ent.kind !== 'multi' && !isMultiEntry(this.catalog.getEntry(ent.symbolId)))) return;
        const next = Math.max(1, Math.min(999, Math.round(value)));
        if (next === (ent.multiplier ?? DEFAULT_MULTI_VALUE)) {
            this.hud?.setMultiplierEditor(next);
            return;
        }
        this.applyMultiplier(col, row, cell!.symbolId, next);
    }

    private applyMultiplier(col: number, row: number, symbolId: number, next: number): void {
        this.history!.execute(new SetEntityMultiplierCommand(this.currentIndex, col, row, next));
        this.boardView!.applyCell(col, row, symbolId, next);
        this.refreshSelectedCellUi(col, row);
        this.afterEdit();
    }

    private onStrokeEnd(): void {
        if (!this.history || !this.stroke.length) return;
        this.history.pushApplied(new CompositeCommand('brushStroke', this.stroke));
        this.stroke = [];
        this.afterEdit();
    }

    private addFrame(): void {
        if (!this.doc || !this.history) return;
        this.history.execute(
            new AddStateCommand(this.currentIndex + 1, this.doc.states[this.currentIndex], 'reveal'),
        );
        this.afterEdit();
        this.showState(this.currentIndex + 1);
    }

    private removeFrame(): void {
        if (!this.doc || !this.history) return;
        if (this.doc.states.length <= 1) return;
        this.history.execute(new RemoveStateCommand(this.currentIndex));
        this.afterEdit();
        this.showState(Math.min(this.currentIndex, this.doc.states.length - 1));
    }

    private undo(): void {
        if (this.history?.undo()) {
            this.afterEdit();
            this.showState(this.currentIndex);
        }
    }

    private redo(): void {
        if (this.history?.redo()) {
            this.afterEdit();
            this.showState(this.currentIndex);
        }
    }

    private async importDoc(): Promise<void> {
        const imported = await this.persistence.importFromFile();
        if (!imported) return;
        const issues = validateDoc(imported);
        if (issues.length) {
            console.error('[BoardEditorMain] import 校验失败', issues);
            this.hud?.setStatus(`导入失败: ${issues[0].code}`);
            return;
        }
        this.doc = imported;
        this.history = new CommandHistory(this.doc);
        this.persistence.autosave(this.doc);
        this.clearSelection();
        this.showState(0);
    }

    private afterEdit(): void {
        if (this.doc) this.persistence.autosave(this.doc);
        this.refreshStatus();
    }
}
