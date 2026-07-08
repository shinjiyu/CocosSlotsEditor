/**
 * BoardEditorMain — 编辑器场景主入口（横板 + 常驻 Inspector）。
 * 点格 = 选中（黄框 + Inspector 显示）；点 Inspector symbol 面板 = 应用到选中格。
 */

import { _decorator, Component, JsonAsset, Node, UITransform } from 'cc';
import {
    deserializeDoc,
    validateDoc,
    readFrameExt,
    makeCompactedState,
    AddStateCommand,
    RemoveStateCommand,
    SetResolvedCellCommand,
    PatchFrameExtCommand,
    CompositeCommand,
    CommandHistory,
} from '../editor-core/index';
import type { EditorDoc, EditorCommand, IrFrameKind } from '../editor-core/index';
import { SymbolCatalog, loadRes } from './SymbolCatalog';
import { BoardView } from './BoardView';
import { EditorHud } from './EditorHud';
import type { AnimSectionModel } from './EditorHud';
import { PersistenceService } from './PersistenceService';
import { BoardDirector } from './BoardDirector';
import { allowedTemplateIds, isTemplateAllowed, resolveTemplateForState } from './animTemplates';

const { ccclass, property } = _decorator;

/** 编辑器 UI 循环用的常用 frameKind 子集（数据层仍支持完整 IR_FRAME_KINDS） */
const EDITOR_FRAME_KINDS: IrFrameKind[] = [
    'enter-table',
    'reveal',
    'highlight',
    'postClear',
    'compact',
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
    /** 进行中的一笔（touch 期间累积，end 时合成一次 undo） */
    private stroke: EditorCommand[] = [];

    async start(): Promise<void> {
        try {
            await this.catalog.load();
            this.doc = this.persistence.loadAutosave(this.docId);
            let source = 'localStorage 自动存档';
            if (!this.doc) {
                const jsonAsset = await loadRes<JsonAsset>(this.docPath, JsonAsset);
                this.doc = deserializeDoc(JSON.stringify(jsonAsset.json));
                source = 'resources';
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
            console.log(`[BoardEditorMain] ready, states=${this.doc.states.length}, source=${source}`);
        } catch (e) {
            console.error('[BoardEditorMain] load failed', e);
        }
    }

    // ------------------------------------------------------------------
    // 布局
    // ------------------------------------------------------------------

    private static readonly GAP_STORE_KEY = 'symbolEditor.boardGaps';

    private buildLayout(): void {
        const boardNode = new Node('BoardView');
        boardNode.addComponent(UITransform);
        this.boardView = boardNode.addComponent(BoardView);
        this.boardView.setCatalog(this.catalog);
        this.restoreGaps();
        this.boardView.onCellPress = (col, row) => this.onCellPress(col, row);
        this.boardView.onStrokeEnd = () => this.onStrokeEnd();
        boardNode.setPosition(EditorHud.BOARD_CENTER);
        this.node.addChild(boardNode);
        this.director = new BoardDirector(this.boardView, () => this.doc);

        // —— 事件用法示例（业务侧照此注册；handler 返回 Promise 可让动画停在连接处等待）——
        this.director.events.on('symbol-vanish', (e) => {
            console.log(`[BoardEvents demo] 消除 → 加分点：symbol=${e.symbolId} @ (${e.col},${e.row}) 帧${e.frameIndex + 1}`);
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
                onPickBrush: (id) => this.pickBrush(id),
                onCycleFrameKind: (dir) => this.cycleFrameKind(dir),
                onCycleTemplate: (dir) => this.cycleTemplate(dir),
                onParamAdjust: (key, dir) => this.adjustParam(key, dir),
                onTogglePlayWithPrev: () => this.togglePlayWithPrev(),
                onPlayCurrentTransition: () => void this.playCurrentTransition(),
                onGenerateCompactFrame: () => this.generateCompactFrame(),
                onAdjustGap: (axis, dir) => this.adjustGap(axis, dir),
            },
            this.catalog,
        );
        this.hud.setGapInfo(this.boardView.colGap, this.boardView.rowGap);
    }

    // ------------------------------------------------------------------
    // 盘面间距
    // ------------------------------------------------------------------

    private restoreGaps(): void {
        if (!this.boardView) return;
        try {
            const raw = localStorage.getItem(BoardEditorMain.GAP_STORE_KEY);
            if (!raw) return;
            const v = JSON.parse(raw) as { col?: number; row?: number };
            if (typeof v.col === 'number') this.boardView.colGap = v.col;
            if (typeof v.row === 'number') this.boardView.rowGap = v.row;
        } catch {
            /* 存档损坏则用默认值 */
        }
    }

    private adjustGap(axis: 'col' | 'row', dir: 1 | -1): void {
        if (!this.boardView) return;
        if (this.director?.isPlaying) return;
        const step = 2;
        const cur = axis === 'col' ? this.boardView.colGap : this.boardView.rowGap;
        // 允许负数（符号重叠排布）
        const next = Math.max(-60, Math.min(60, cur + dir * step));
        if (next === cur) return;
        if (axis === 'col') this.boardView.colGap = next;
        else this.boardView.rowGap = next;
        try {
            localStorage.setItem(
                BoardEditorMain.GAP_STORE_KEY,
                JSON.stringify({ col: this.boardView.colGap, row: this.boardView.rowGap }),
            );
        } catch {
            /* 无 localStorage 环境（如某些预览容器）时仅本次生效 */
        }
        this.hud?.setGapInfo(this.boardView.colGap, this.boardView.rowGap);
        this.showState(this.currentIndex);
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
        });
        this.showState(landed);
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
        this.boardView.render(this.doc.states[clamped]);
        this.refreshFrameInfo();
        this.refreshCellInfo();
        this.refreshStatus();
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
        this.hud.setFrameInfo(`帧 ${this.currentIndex + 1}/${this.doc.states.length} · ${kind}`);
        this.hud.setAnimSection(this.buildAnimModel());
    }

    private buildAnimModel(): AnimSectionModel {
        const state = this.doc!.states[this.currentIndex];
        const ext = readFrameExt(state);
        const { template, params } = resolveTemplateForState(state);
        const kind = ext?.frameKind ?? 'reveal';
        const isOverride = ext?.templateId !== undefined && isTemplateAllowed(kind, ext.templateId);
        const templateLabel = isOverride ? template.label : `auto(${template.label})`;
        return {
            frameKind: ext?.frameKind ?? '?',
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
        const staleOverride = ext?.templateId !== undefined && !isTemplateAllowed(next, ext.templateId);
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
        const ids: Array<string | undefined> = [undefined, ...allowedTemplateIds(kind)];
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
        const { template, params } = resolveTemplateForState(state);
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

    private async playCurrentTransition(): Promise<void> {
        if (!this.doc || !this.director || this.director.isPlaying) return;
        if (this.currentIndex <= 0) return;
        this.clearSelection();
        const target = this.currentIndex;
        this.hud?.setStatus(`播放转移 ${target} → ${target + 1} …`);
        await this.director.playRange(target - 1, target);
        this.currentIndex = target;
        this.showState(target);
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
    }

    // ------------------------------------------------------------------
    // 刷子编辑
    // ------------------------------------------------------------------

    private pickBrush(symbolId: number | null): void {
        // 重复点同一个刷子 = 取消
        if (this.brush !== undefined && this.brush === symbolId) {
            this.brush = undefined;
        } else {
            this.brush = symbolId;
        }
        this.hud?.setBrushHighlight(this.brush);
        this.refreshCellInfo();
    }

    private clearSelection(): void {
        this.boardView?.setSelected(null);
    }

    private onCellPress(col: number, row: number): void {
        if (!this.doc || !this.history || !this.boardView) return;
        if (this.director?.isPlaying) return;
        if (this.brush === undefined) {
            // 无刷子：仅高亮查看
            this.boardView.setSelected(col, row);
            const cell = this.doc.states[this.currentIndex].board.resolved[col]?.[row];
            const name =
                cell && cell.symbolId !== null
                    ? this.catalog.getEntry(cell.symbolId)?.name ?? String(cell.symbolId)
                    : '空';
            this.hud?.setCellInfo(`格 (${col},${row}) · ${name}（选刷子后可绘制）`);
            return;
        }
        const current = this.doc.states[this.currentIndex].board.resolved[col]?.[row]?.symbolId ?? null;
        if (current === this.brush) return;
        const cmd = new SetResolvedCellCommand(this.currentIndex, col, row, this.brush);
        cmd.apply(this.doc);
        this.stroke.push(cmd);
        this.boardView.applyCell(col, row, this.brush);
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
