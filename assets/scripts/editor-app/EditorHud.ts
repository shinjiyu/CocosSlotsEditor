/**
 * EditorHud — 横板(1280×720)编辑 UI：
 *   顶部工具栏 | 左侧盘面(由 Main 摆放) | 右侧常驻 Inspector 面板 | 底部帧导航
 * Inspector：帧信息 + 选中格信息 + symbol 面板（点选即应用，无弹窗）。
 * 后续动画参数(M4)继续往 Inspector 里加分区。
 */

import {
    _decorator,
    Component,
    Node,
    Label,
    EditBox,
    Sprite,
    SpriteFrame,
    UITransform,
    Color,
    Graphics,
    Vec3,
} from 'cc';
import type { SymbolCatalog } from './SymbolCatalog';

const { ccclass } = _decorator;

export interface HudCallbacks {
    onPrevFrame(): void;
    onNextFrame(): void;
    onAddFrame(): void;
    onRemoveFrame(): void;
    onUndo(): void;
    onRedo(): void;
    onExport(): void;
    onImport(): void;
    onPlay(): void;
    onStop(): void;
    /** 选刷子（null = 橡皮擦/清空刷）；重复点同一个 = 取消刷子 */
    onPickBrush(symbolId: number | null): void;
    /** 动画分区 */
    onCycleFrameKind(dir: 1 | -1): void;
    onCycleTemplate(dir: 1 | -1): void;
    onParamAdjust(key: string, dir: 1 | -1): void;
    onTogglePlayWithPrev(): void;
    onPlayCurrentTransition(): void;
    /** 基于当前帧自动生成压缩后的 compact 帧并插到后面 */
    onGenerateCompactFrame(): void;
    /** 基于当前帧自动生成倍率球扩散 expandPost 帧 */
    onGenerateExpandFrame(): void;
    /** 基于当前帧自动生成倍率数字收集 multiCollect 帧 */
    onGenerateMultiCollectFrame(): void;
    /** 盘面列距/行距调整 */
    onAdjustGap(axis: 'col' | 'row', dir: 1 | -1): void;
    /** 切换游戏符号包（dir=±1 循环） */
    onCycleGame(dir: 1 | -1): void;
    /** 选中格为倍率球时调整 multiplier */
    onAdjustMultiplier(dir: 1 | -1): void;
    /** 选中格倍率直接设值（输入框） */
    onSetMultiplier(value: number): void;
}

/** Main 每次切帧/改动后喂给 HUD 的动画分区数据 */
export interface AnimSectionModel {
    frameKind: string;
    /** 模板显示名；override 为空时形如 "auto(下落进场)" */
    templateLabel: string;
    params: Array<{ key: string; label: string; value: number }>;
    canPlayTransition: boolean;
    /** 本帧转移是否与上一帧转移并行播放 */
    playWithPrev: boolean;
}

const DESIGN_W = 1280;
const DESIGN_H = 720;
const PANEL_W = 340;
const BTN_H = 40;

@ccclass('EditorHud')
export class EditorHud extends Component {
    private callbacks: HudCallbacks | null = null;
    private statusLabel: Label | null = null;
    private frameInfoLabel: Label | null = null;
    private cellInfoLabel: Label | null = null;
    /** brush key(String(id)|'eraser') → 高亮框节点 */
    private brushHighlights = new Map<string, Node>();
    private animSectionRoot: Node | null = null;
    private animSectionTop = 0;
    private colGapLabel: Label | null = null;
    private rowGapLabel: Label | null = null;
    private sizeInfoLabel: Label | null = null;
    private gameLabel: Label | null = null;
    private brushRoot: Node | null = null;
    private inspectorPanel: Node | null = null;
    /** 刷子区顶部 Y（重建刷子时复用） */
    private brushSectionTop = 0;
    /** 动画区标题节点（刷子高度变化时需下移） */
    private animTitleNode: Node | null = null;
    private multiRow: Node | null = null;
    private multiValueEdit: EditBox | null = null;
    /** 避免 setMultiplierEditor 回写时触发 editing 回调 */
    private multiEditSilent = false;

    /** 盘面区中心（给 Main 摆 BoardView 用） */
    static readonly BOARD_CENTER = new Vec3(-(PANEL_W / 2) - 10, -10, 0);

    init(callbacks: HudCallbacks, catalog: SymbolCatalog, gameLabel = ''): void {
        this.callbacks = callbacks;
        this.buildToolbar();
        this.buildFrameNav();
        this.buildInspector(catalog, gameLabel);
    }

    setStatus(text: string): void {
        if (this.statusLabel) this.statusLabel.string = text;
    }

    setFrameInfo(text: string): void {
        if (this.frameInfoLabel) this.frameInfoLabel.string = text;
    }

    setCellInfo(text: string): void {
        if (this.cellInfoLabel) this.cellInfoLabel.string = text;
    }

    /** 更新当前游戏包显示 */
    setGameInfo(text: string): void {
        if (this.gameLabel) this.gameLabel.string = text;
    }

    /**
     * 选中格倍率编辑条。
     * value=null → 隐藏（非 multi / 未选中）；否则显示数字输入与 −/+。
     */
    setMultiplierEditor(value: number | null): void {
        if (!this.multiRow) return;
        if (value === null) {
            this.multiRow.active = false;
            return;
        }
        this.multiRow.active = true;
        if (this.multiValueEdit) {
            this.multiEditSilent = true;
            this.multiValueEdit.string = String(value);
            this.multiEditSilent = false;
        }
    }

    /** 换游戏包后重建刷子面板 */
    rebuildBrushes(catalog: SymbolCatalog): void {
        if (!this.inspectorPanel || !this.callbacks) return;
        this.brushHighlights.clear();
        if (this.brushRoot?.isValid) this.brushRoot.destroy();
        this.brushRoot = null;

        const { root, height } = this.makeBrushGrid(catalog, this.callbacks);
        root.setPosition(0, this.brushSectionTop, 0);
        this.inspectorPanel.addChild(root);
        this.brushRoot = root;

        // 动画区紧跟刷子下方
        const animTop = this.brushSectionTop - height - 18;
        this.animSectionTop = animTop - 28;
        if (this.animTitleNode?.isValid) this.animTitleNode.setPosition(0, animTop, 0);
        if (this.animSectionRoot?.isValid) {
            // setAnimSection 会按 animSectionTop 布局；先清掉旧内容高度差
            this.animSectionRoot.removeAllChildren();
        }
    }

    /** 更新盘面间距显示 */
    setGapInfo(colGap: number, rowGap: number): void {
        if (this.colGapLabel) this.colGapLabel.string = String(colGap);
        if (this.rowGapLabel) this.rowGapLabel.string = String(rowGap);
    }

    /** 更新尺寸显示（格子尺寸 / 当前 symbol 实际渲染尺寸） */
    setSizeInfo(text: string): void {
        if (this.sizeInfoLabel) this.sizeInfoLabel.string = text;
    }

    /** 高亮当前刷子槽位；undefined = 全部取消 */
    setBrushHighlight(symbolId: number | null | undefined): void {
        const key = symbolId === undefined ? '' : symbolId === null ? 'eraser' : String(symbolId);
        this.brushHighlights.forEach((n, k) => {
            n.active = k === key;
        });
    }

    // ------------------------------------------------------------------
    // 顶部工具栏（盘面区上方一行）
    // ------------------------------------------------------------------

    private buildToolbar(): void {
        const cb = this.callbacks!;
        const items: Array<[string, () => void, number]> = [
            ['撤销', () => cb.onUndo(), 76],
            ['重做', () => cb.onRedo(), 76],
            ['+帧', () => cb.onAddFrame(), 68],
            ['-帧', () => cb.onRemoveFrame(), 68],
            ['▶播放', () => cb.onPlay(), 88],
            ['■停止', () => cb.onStop(), 88],
            ['导出', () => cb.onExport(), 76],
            ['导入', () => cb.onImport(), 76],
        ];
        const gap = 8;
        const total = items.reduce((s, it) => s + it[2], 0) + gap * (items.length - 1);
        const areaCenterX = EditorHud.BOARD_CENTER.x;
        let x = areaCenterX - total / 2;
        const y = DESIGN_H / 2 - 36;
        for (const [text, fn, w] of items) {
            this.node.addChild(this.makeButton(text, fn, new Vec3(x + w / 2, y, 0), w));
            x += w + gap;
        }
    }

    // ------------------------------------------------------------------
    // 底部帧导航
    // ------------------------------------------------------------------

    private buildFrameNav(): void {
        const cb = this.callbacks!;
        const y = -DESIGN_H / 2 + 40;
        const cx = EditorHud.BOARD_CENTER.x;
        this.node.addChild(this.makeButton('◀ 上一帧', () => cb.onPrevFrame(), new Vec3(cx - 220, y, 0), 130));
        this.node.addChild(this.makeButton('下一帧 ▶', () => cb.onNextFrame(), new Vec3(cx + 220, y, 0), 130));

        const n = new Node('HudStatus');
        n.addComponent(UITransform);
        const label = n.addComponent(Label);
        label.fontSize = 20;
        label.lineHeight = 26;
        label.color = new Color(220, 230, 255, 255);
        n.setPosition(cx, y, 0);
        this.node.addChild(n);
        this.statusLabel = label;
    }

    // ------------------------------------------------------------------
    // 右侧常驻 Inspector
    // ------------------------------------------------------------------

    private buildInspector(catalog: SymbolCatalog, gameLabel: string): void {
        const cb = this.callbacks!;
        const panel = new Node('Inspector');
        panel.addComponent(UITransform);
        const px = DESIGN_W / 2 - PANEL_W / 2;
        panel.setPosition(px, 0, 0);
        this.inspectorPanel = panel;

        // 面板背景
        const bg = new Node('panel_bg');
        const bgUi = bg.addComponent(UITransform);
        bgUi.setContentSize(PANEL_W, DESIGN_H);
        const g = bg.addComponent(Graphics);
        g.fillColor = new Color(22, 26, 44, 245);
        g.rect(-PANEL_W / 2, -DESIGN_H / 2, PANEL_W, DESIGN_H);
        g.fill();
        g.strokeColor = new Color(90, 110, 180, 160);
        g.lineWidth = 1.5;
        g.moveTo(-PANEL_W / 2, -DESIGN_H / 2);
        g.lineTo(-PANEL_W / 2, DESIGN_H / 2);
        g.stroke();
        panel.addChild(bg);

        let cursorY = DESIGN_H / 2 - 30;

        // — 帧信息 —
        cursorY = this.addSectionTitle(panel, 'Inspector', cursorY);
        this.frameInfoLabel = this.addInfoLabel(panel, '帧 -', cursorY);
        cursorY -= 30;
        this.cellInfoLabel = this.addInfoLabel(panel, '未选刷子', cursorY);
        cursorY -= 36;

        // — 选中格倍率（仅 multi 球显示）—
        cursorY = this.buildMultiplierRow(panel, cursorY);

        // — 游戏包切换 —
        cursorY = this.addSectionTitle(panel, '游戏包 (gameId)', cursorY);
        cursorY = this.buildGameRow(panel, cursorY, gameLabel);

        // — 盘面间距（列距 / 行距，一行两组） —
        cursorY = this.buildGapRow(panel, cursorY);

        // — 尺寸信息（格子 / 当前 symbol 实际渲染尺寸） —
        this.sizeInfoLabel = this.addInfoLabel(panel, '尺寸 -', cursorY);
        this.sizeInfoLabel.fontSize = 15;
        this.sizeInfoLabel.lineHeight = 19;
        this.sizeInfoLabel.color = new Color(170, 220, 170, 255);
        cursorY -= 44;

        // — symbol 刷子面板 —
        cursorY = this.addSectionTitle(panel, 'Symbol 刷子（选中后在盘面刷）', cursorY);
        this.brushSectionTop = cursorY;
        const { root, height } = this.makeBrushGrid(catalog, cb);
        root.setPosition(0, cursorY, 0);
        panel.addChild(root);
        this.brushRoot = root;
        cursorY -= height + 18;

        // — 动画分区（内容由 setAnimSection 动态重建） —
        this.animTitleNode = this.addSectionTitleNode(panel, '动画（当前帧转移）', cursorY);
        cursorY -= 28;
        const animRoot = new Node('AnimSection');
        animRoot.addComponent(UITransform);
        panel.addChild(animRoot);
        this.animSectionRoot = animRoot;
        this.animSectionTop = cursorY;

        this.node.addChild(panel);
    }

    private buildGameRow(panel: Node, y: number, gameLabel: string): number {
        const cb = this.callbacks!;
        const left = -PANEL_W / 2 + 20;
        panel.addChild(this.makeButton('◀', () => cb.onCycleGame(-1), new Vec3(left + 22, y, 0), 44));
        panel.addChild(this.makeButton('▶', () => cb.onCycleGame(1), new Vec3(left + PANEL_W - 64, y, 0), 44));

        const n = new Node('game_label');
        const ui = n.addComponent(UITransform);
        ui.setContentSize(PANEL_W - 120, 28);
        const label = n.addComponent(Label);
        label.string = gameLabel || '-';
        label.fontSize = 16;
        label.lineHeight = 20;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        label.color = new Color(255, 230, 160, 255);
        n.setPosition(0, y, 0);
        panel.addChild(n);
        this.gameLabel = label;
        return y - 40;
    }

    /** 选中 multi 格时的倍率 − / 输入 / + */
    private buildMultiplierRow(panel: Node, y: number): number {
        const cb = this.callbacks!;
        const row = new Node('multi_row');
        row.addComponent(UITransform);
        row.setPosition(0, y, 0);
        row.active = false;

        const title = new Node('multi_title');
        const tui = title.addComponent(UITransform);
        tui.setAnchorPoint(0, 0.5);
        const tl = title.addComponent(Label);
        tl.string = '倍率';
        tl.fontSize = 16;
        tl.lineHeight = 20;
        tl.verticalAlign = Label.VerticalAlign.CENTER;
        tl.color = new Color(170, 185, 235, 255);
        title.setPosition(-PANEL_W / 2 + 20, 0, 0);
        row.addChild(title);

        const left = -PANEL_W / 2 + 80;
        const btnW = 44;
        const editW = 72;
        const gap = 8;
        const minusX = left + btnW / 2;
        const editX = minusX + btnW / 2 + gap + editW / 2;
        const plusX = editX + editW / 2 + gap + btnW / 2;

        row.addChild(this.makeButton('−', () => cb.onAdjustMultiplier(-1), new Vec3(minusX, 0, 0), btnW));
        row.addChild(this.makeButton('＋', () => cb.onAdjustMultiplier(1), new Vec3(plusX, 0, 0), btnW));
        row.addChild(this.makeMultiplierEdit(editW, new Vec3(editX, 0, 0)));

        panel.addChild(row);
        this.multiRow = row;
        return y - 44;
    }

    private makeMultiplierEdit(width: number, pos: Vec3): Node {
        const n = new Node('multi_edit');
        const ui = n.addComponent(UITransform);
        ui.setContentSize(width, BTN_H);

        const bg = n.addComponent(Graphics);
        bg.fillColor = new Color(28, 36, 68, 255);
        bg.strokeColor = new Color(140, 160, 230, 200);
        bg.lineWidth = 1.5;
        bg.roundRect(-width / 2, -BTN_H / 2, width, BTN_H, 8);
        bg.fill();
        bg.stroke();

        const mkLabel = (name: string, color: Color): Label => {
            const tn = new Node(name);
            const tut = tn.addComponent(UITransform);
            tut.setContentSize(width - 8, BTN_H - 4);
            const lab = tn.addComponent(Label);
            lab.fontSize = 20;
            lab.lineHeight = 24;
            lab.horizontalAlign = Label.HorizontalAlign.CENTER;
            lab.verticalAlign = Label.VerticalAlign.CENTER;
            lab.overflow = Label.Overflow.SHRINK;
            lab.color = color;
            n.addChild(tn);
            return lab;
        };
        const textLabel = mkLabel('TEXT_LABEL', new Color(255, 220, 120, 255));
        const phLabel = mkLabel('PLACEHOLDER_LABEL', new Color(120, 130, 160, 180));
        phLabel.string = '';

        const eb = n.addComponent(EditBox);
        eb.textLabel = textLabel;
        eb.placeholderLabel = phLabel;
        eb.inputMode = EditBox.InputMode.NUMERIC;
        eb.inputFlag = EditBox.InputFlag.DEFAULT;
        eb.returnType = EditBox.KeyboardReturnType.DONE;
        eb.maxLength = 3;
        eb.string = '2';
        n.setPosition(pos);

        const commit = (): void => {
            if (this.multiEditSilent || !this.callbacks) return;
            const raw = (eb.string || '').replace(/[^\d]/g, '');
            const nVal = Math.max(1, Math.min(999, parseInt(raw || '1', 10) || 1));
            this.multiEditSilent = true;
            eb.string = String(nVal);
            this.multiEditSilent = false;
            this.callbacks.onSetMultiplier(nVal);
        };
        n.on(EditBox.EventType.EDITING_DID_ENDED, commit);
        n.on(EditBox.EventType.EDITING_RETURN, commit);

        this.multiValueEdit = eb;
        return n;
    }

    /** 刷子网格；root 本地原点在区顶部中线，子项向下排布 */
    private makeBrushGrid(
        catalog: SymbolCatalog,
        cb: HudCallbacks,
    ): { root: Node; height: number } {
        const root = new Node('BrushGrid');
        root.addComponent(UITransform);

        const cell = 56;
        const gap = 4;
        const perRow = 5;
        const startX = -PANEL_W / 2 + 20 + cell / 2;
        const all: Array<{ id: number | null; frame: SpriteFrame | null; label: string }> = catalog.all.map(
            (e) => ({ id: e.id, frame: catalog.getFrame(e.id), label: e.name }),
        );
        all.push({ id: null, frame: null, label: '橡皮' });

        all.forEach((item, i) => {
            const col = i % perRow;
            const row = Math.floor(i / perRow);
            const n = new Node(`pick_${item.label}`);
            const ui = n.addComponent(UITransform);
            ui.setContentSize(cell, cell);
            n.setPosition(startX + col * (cell + gap), -cell / 2 - row * (cell + gap), 0);

            const slotG = n.addComponent(Graphics);
            slotG.fillColor = new Color(40, 46, 72, 255);
            slotG.roundRect(-cell / 2, -cell / 2, cell, cell, 6);
            slotG.fill();

            if (item.frame) {
                const iconNode = new Node('icon');
                const iconUi = iconNode.addComponent(UITransform);
                const sp = iconNode.addComponent(Sprite);
                sp.spriteFrame = item.frame;
                const rect = item.frame.rect;
                iconUi.setContentSize(rect.width, rect.height);
                const s = Math.min((cell - 12) / rect.width, (cell - 12) / rect.height);
                iconNode.setScale(new Vec3(s, s, 1));
                n.addChild(iconNode);
            } else {
                const t = new Node('txt');
                t.addComponent(UITransform);
                const l = t.addComponent(Label);
                l.string = item.label;
                l.fontSize = 16;
                l.color = new Color(255, 180, 180, 255);
                n.addChild(t);
            }

            const hl = new Node('brush_hl');
            hl.addComponent(UITransform);
            const hg = hl.addComponent(Graphics);
            hg.lineWidth = 3;
            hg.strokeColor = new Color(255, 210, 60, 255);
            hg.roundRect(-cell / 2, -cell / 2, cell, cell, 6);
            hg.stroke();
            hl.active = false;
            n.addChild(hl);
            this.brushHighlights.set(item.id === null ? 'eraser' : String(item.id), hl);

            n.on(Node.EventType.TOUCH_END, () => cb.onPickBrush(item.id));
            root.addChild(n);
        });

        const symbolRows = Math.ceil(all.length / perRow);
        const height = symbolRows * (cell + gap);
        return { root, height };
    }

    /** 与 addSectionTitle 相同，但返回节点以便换包时移动 */
    private addSectionTitleNode(parent: Node, text: string, y: number): Node {
        const n = new Node(`sec_${text}`);
        const ui = n.addComponent(UITransform);
        ui.setAnchorPoint(0, 0.5);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = 16;
        label.lineHeight = 20;
        label.color = new Color(140, 160, 220, 255);
        n.setPosition(-PANEL_W / 2 + 16, y, 0);
        parent.addChild(n);
        return n;
    }

    /** 一行放两组「标签 值 − ＋」：列距 与 行距 */
    private buildGapRow(panel: Node, y: number): number {
        const cb = this.callbacks!;
        const left = -PANEL_W / 2 + 20;

        const addCluster = (
            text: string,
            baseX: number,
            axis: 'col' | 'row',
        ): Label => {
            const labelNode = new Node(`gap_${axis}`);
            const lui = labelNode.addComponent(UITransform);
            lui.setAnchorPoint(0, 0.5);
            const ll = labelNode.addComponent(Label);
            ll.string = text;
            ll.fontSize = 16;
            ll.lineHeight = 20;
            ll.color = new Color(170, 185, 235, 255);
            labelNode.setPosition(baseX, y, 0);
            panel.addChild(labelNode);

            const valueNode = new Node(`gap_${axis}_val`);
            const vui = valueNode.addComponent(UITransform);
            vui.setAnchorPoint(0, 0.5);
            const vl = valueNode.addComponent(Label);
            vl.string = '-';
            vl.fontSize = 16;
            vl.lineHeight = 20;
            vl.color = new Color(240, 244, 255, 255);
            valueNode.setPosition(baseX + 42, y, 0);
            panel.addChild(valueNode);

            panel.addChild(this.makeMiniButton('−', () => cb.onAdjustGap(axis, -1), new Vec3(baseX + 88, y, 0)));
            panel.addChild(this.makeMiniButton('＋', () => cb.onAdjustGap(axis, 1), new Vec3(baseX + 124, y, 0)));
            return vl;
        };

        this.colGapLabel = addCluster('列距', left, 'col');
        this.rowGapLabel = addCluster('行距', left + 160, 'row');
        return y - 40;
    }

    // ------------------------------------------------------------------
    // 动画分区（动态重建）
    // ------------------------------------------------------------------

    setAnimSection(model: AnimSectionModel): void {
        const root = this.animSectionRoot;
        if (!root) return;
        root.removeAllChildren();
        const cb = this.callbacks!;
        const left = -PANEL_W / 2 + 20;
        const rowH = 30;
        let y = this.animSectionTop;

        const addRow = (
            label: string,
            value: string,
            onMinus: (() => void) | null,
            onPlus: (() => void) | null,
        ): void => {
            const labelNode = new Node('row_label');
            const lui = labelNode.addComponent(UITransform);
            lui.setAnchorPoint(0, 0.5);
            const ll = labelNode.addComponent(Label);
            ll.string = label;
            ll.fontSize = 16;
            ll.lineHeight = 20;
            ll.color = new Color(170, 185, 235, 255);
            labelNode.setPosition(left, y, 0);
            root.addChild(labelNode);

            const valueNode = new Node('row_value');
            const vui = valueNode.addComponent(UITransform);
            vui.setAnchorPoint(0, 0.5);
            const vl = valueNode.addComponent(Label);
            vl.string = value;
            vl.fontSize = 16;
            vl.lineHeight = 20;
            vl.color = new Color(240, 244, 255, 255);
            valueNode.setPosition(left + 92, y, 0);
            root.addChild(valueNode);

            if (onMinus) root.addChild(this.makeMiniButton('−', onMinus, new Vec3(left + 232, y, 0)));
            if (onPlus) root.addChild(this.makeMiniButton('＋', onPlus, new Vec3(left + 268, y, 0)));
            y -= rowH;
        };

        addRow('frameKind', model.frameKind, () => cb.onCycleFrameKind(-1), () => cb.onCycleFrameKind(1));
        addRow('模板', model.templateLabel, () => cb.onCycleTemplate(-1), () => cb.onCycleTemplate(1));
        for (const p of model.params) {
            addRow(p.label, this.formatNum(p.value), () => cb.onParamAdjust(p.key, -1), () => cb.onParamAdjust(p.key, 1));
        }
        if (model.canPlayTransition) {
            const toggle = (): void => cb.onTogglePlayWithPrev();
            addRow('与上帧同播', model.playWithPrev ? '是' : '否', toggle, toggle);
        }

        if (model.canPlayTransition) {
            root.addChild(
                this.makeButton('▶ 播本帧转移', () => cb.onPlayCurrentTransition(), new Vec3(-70, y - 12, 0), 150),
            );
        } else {
            const tip = new Node('tip');
            const tui = tip.addComponent(UITransform);
            tui.setAnchorPoint(0, 0.5);
            const tl = tip.addComponent(Label);
            tl.string = '首帧无转移（选第 2+ 帧）';
            tl.fontSize = 15;
            tl.lineHeight = 18;
            tl.color = new Color(150, 155, 180, 255);
            tip.setPosition(left, y - 12, 0);
            root.addChild(tip);
        }
        root.addChild(
            this.makeButton('⤵ 生成compact帧', () => cb.onGenerateCompactFrame(), new Vec3(85, y - 12, 0), 150),
        );
        root.addChild(
            this.makeButton('⤵ 生成扩散帧', () => cb.onGenerateExpandFrame(), new Vec3(85, y - 56, 0), 150),
        );
        root.addChild(
            this.makeButton('⤵ 生成倍率收集', () => cb.onGenerateMultiCollectFrame(), new Vec3(85, y - 100, 0), 150),
        );
    }

    private formatNum(v: number): string {
        return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    }

    private makeMiniButton(text: string, onClick: () => void, pos: Vec3): Node {
        const size = 30;
        const n = new Node(`mini_${text}`);
        const ui = n.addComponent(UITransform);
        ui.setContentSize(size, size);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(52, 66, 120, 255);
        g.strokeColor = new Color(140, 160, 230, 220);
        g.lineWidth = 1.5;
        g.roundRect(-size / 2, -size / 2, size, size, 6);
        g.fill();
        g.stroke();
        const tn = new Node('label');
        tn.addComponent(UITransform);
        const label = tn.addComponent(Label);
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 22;
        label.color = new Color(235, 240, 255, 255);
        n.addChild(tn);
        n.setPosition(pos);
        n.on(Node.EventType.TOUCH_END, onClick);
        return n;
    }

    private addSectionTitle(panel: Node, text: string, y: number): number {
        const n = new Node('section_' + text);
        n.addComponent(UITransform);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 24;
        label.color = new Color(150, 170, 240, 255);
        n.setPosition(-PANEL_W / 2 + 20 + 120, y, 0);
        const ui = n.getComponent(UITransform)!;
        ui.setAnchorPoint(0, 0.5);
        n.setPosition(-PANEL_W / 2 + 20, y, 0);
        panel.addChild(n);
        return y - 34;
    }

    private addInfoLabel(panel: Node, text: string, y: number): Label {
        const n = new Node('info');
        const ui = n.addComponent(UITransform);
        ui.setAnchorPoint(0, 0.5);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 24;
        label.color = new Color(230, 235, 255, 255);
        n.setPosition(-PANEL_W / 2 + 20, y, 0);
        panel.addChild(n);
        return label;
    }

    private makeButton(text: string, onClick: () => void, pos: Vec3, width: number): Node {
        const n = new Node(`btn_${text}`);
        const ui = n.addComponent(UITransform);
        ui.setContentSize(width, BTN_H);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(52, 66, 120, 255);
        g.strokeColor = new Color(140, 160, 230, 220);
        g.lineWidth = 1.5;
        g.roundRect(-width / 2, -BTN_H / 2, width, BTN_H, 8);
        g.fill();
        g.stroke();

        const tn = new Node('label');
        tn.addComponent(UITransform);
        const label = tn.addComponent(Label);
        label.string = text;
        label.fontSize = 18;
        label.lineHeight = 22;
        label.color = new Color(235, 240, 255, 255);
        n.addChild(tn);

        n.setPosition(pos);
        n.on(Node.EventType.TOUCH_END, onClick);
        return n;
    }
}
