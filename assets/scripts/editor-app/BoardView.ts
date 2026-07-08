/**
 * BoardView — 渲染一个 PresentationState 的 resolved 盘面。
 * 节点两层：cell 节点（位移动画载体，scale 恒 1）→ SymbolView content（符号内容+适配缩放）。
 * 动画模板通过 getCellNode 做位移 tween，通过 getSymbolView 拿 enter/win/vanish 钩子。
 */

import { _decorator, Component, Node, UITransform, Vec3, Color, Graphics, EventTouch } from 'cc';
import type { PresentationState } from '../vendor/slot-presentation-ir/index';
import type { SymbolProvider } from './SymbolDefs';
import { SymbolView } from './SymbolView';

const { ccclass, property } = _decorator;

@ccclass('BoardView')
export class BoardView extends Component {
    @property cellW = 100;
    @property cellH = 84;
    @property colGap = 2;
    @property rowGap = 2;
    /** 格内符号相对格子的填充比例 */
    @property cellFill = 0.9;

    /** 按下/拖入新格回调（刷子绘制）；由 BoardEditorMain 注入 */
    onCellPress: ((col: number, row: number) => void) | null = null;
    /** 一笔结束（touch end/cancel） */
    onStrokeEnd: (() => void) | null = null;

    private catalog: SymbolProvider | null = null;
    private cellNodes: Node[][] = [];
    private symbolViews: SymbolView[][] = [];
    private gridBg: Node | null = null;

    setCatalog(catalog: SymbolProvider): void {
        this.catalog = catalog;
    }

    getCellNode(col: number, row: number): Node | null {
        return this.cellNodes[col]?.[row] ?? null;
    }

    getSymbolView(col: number, row: number): SymbolView | null {
        return this.symbolViews[col]?.[row] ?? null;
    }

    /** 全量重建并渲染 state.board.resolved */
    render(state: PresentationState): void {
        const { cols, visibleRows } = state.board.topology;
        const rows = Math.max(...visibleRows);
        this.rebuildGrid(cols, rows);
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < visibleRows[c]; r++) {
                this.applyCell(c, r, state.board.resolved[c][r].symbolId);
            }
        }
        if (this.selected) this.setSelected(this.selected.col, this.selected.row);
    }

    private selected: { col: number; row: number } | null = null;
    private selectionNode: Node | null = null;

    /** 高亮选中格；传 null 清除 */
    setSelected(col: number | null, row?: number): void {
        if (col === null) {
            this.selected = null;
            if (this.selectionNode) this.selectionNode.active = false;
            return;
        }
        this.selected = { col, row: row! };
        if (!this.selectionNode || !this.selectionNode.isValid || this.selectionNode.parent !== this.node) {
            const n = new Node('selection');
            n.addComponent(UITransform);
            const g = n.addComponent(Graphics);
            g.lineWidth = 3;
            g.strokeColor = new Color(255, 210, 60, 255);
            g.rect(-this.cellW / 2, -this.cellH / 2, this.cellW, this.cellH);
            g.stroke();
            this.node.addChild(n);
            this.selectionNode = n;
        }
        this.selectionNode.active = true;
        this.selectionNode.setPosition(this.cellPosition(col, row!, this.currentCols, this.currentRows));
        this.selectionNode.setSiblingIndex(this.node.children.length - 1);
    }

    applyCell(col: number, row: number, symbolId: number | null): void {
        this.symbolViews[col]?.[row]?.setSymbol(symbolId);
    }

    boardSize(cols: number, rows: number): { w: number; h: number } {
        return {
            w: cols * this.cellW + (cols - 1) * this.colGap,
            h: rows * this.cellH + (rows - 1) * this.rowGap,
        };
    }

    /** (col,row) → 本节点局部坐标；row 0 在顶部 */
    cellPosition(col: number, row: number, cols: number, rows: number): Vec3 {
        const { w, h } = this.boardSize(cols, rows);
        const x = -w / 2 + this.cellW / 2 + col * (this.cellW + this.colGap);
        const y = h / 2 - this.cellH / 2 - row * (this.cellH + this.rowGap);
        return new Vec3(x, y, 0);
    }

    /** 把节点局部坐标换算成 (col,row)；未命中返回 null */
    hitCell(localX: number, localY: number, cols: number, rows: number): { col: number; row: number } | null {
        const { w, h } = this.boardSize(cols, rows);
        const x = localX + w / 2;
        const y = h / 2 - localY;
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        const col = Math.floor(x / (this.cellW + this.colGap));
        const row = Math.floor(y / (this.cellH + this.rowGap));
        if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
        return { col, row };
    }

    private currentCols = 0;
    private currentRows = 0;

    private rebuildGrid(cols: number, rows: number): void {
        this.node.removeAllChildren();
        this.cellNodes = [];
        this.symbolViews = [];
        this.currentCols = cols;
        this.currentRows = rows;
        this.ensureTouch(cols, rows);
        this.drawGridBg(cols, rows);
        for (let c = 0; c < cols; c++) {
            const colNodes: Node[] = [];
            const colViews: SymbolView[] = [];
            for (let r = 0; r < rows; r++) {
                const n = new Node(`cell_${c}_${r}`);
                n.addComponent(UITransform).setContentSize(this.cellW, this.cellH);
                const view = n.addComponent(SymbolView);
                if (this.catalog) view.setup(this.catalog, this.cellW, this.cellH, this.cellFill);
                n.setPosition(this.cellPosition(c, r, cols, rows));
                this.node.addChild(n);
                colNodes.push(n);
                colViews.push(view);
            }
            this.cellNodes.push(colNodes);
            this.symbolViews.push(colViews);
        }
    }

    private drawGridBg(cols: number, rows: number): void {
        const bg = new Node('grid_bg');
        const ui = bg.addComponent(UITransform);
        const { w, h } = this.boardSize(cols, rows);
        ui.setContentSize(w, h);
        const g = bg.addComponent(Graphics);
        g.lineWidth = 1;
        g.strokeColor = new Color(255, 255, 255, 60);
        g.fillColor = new Color(20, 24, 40, 160);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        for (let c = 0; c <= cols; c++) {
            const x = -w / 2 + c * (this.cellW + this.colGap) - (c > 0 && c < cols ? this.colGap / 2 : 0);
            g.moveTo(x, -h / 2);
            g.lineTo(x, h / 2);
        }
        for (let r = 0; r <= rows; r++) {
            const y = -h / 2 + r * (this.cellH + this.rowGap) - (r > 0 && r < rows ? this.rowGap / 2 : 0);
            g.moveTo(-w / 2, y);
            g.lineTo(w / 2, y);
        }
        g.stroke();
        this.node.addChild(bg);
        this.gridBg = bg;
    }

    private touchBound = false;
    private lastPainted: { col: number; row: number } | null = null;

    private ensureTouch(cols: number, rows: number): void {
        const ui = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        const { w, h } = this.boardSize(cols, rows);
        ui.setContentSize(w, h);
        if (this.touchBound) return;
        this.touchBound = true;

        const hitFromEvent = (e: EventTouch): { col: number; row: number } | null => {
            const uiPos = e.getUILocation();
            const local = ui.convertToNodeSpaceAR(new Vec3(uiPos.x, uiPos.y, 0));
            return this.hitCell(local.x, local.y, this.currentCols, this.currentRows);
        };
        const press = (e: EventTouch): void => {
            const hit = hitFromEvent(e);
            if (!hit) return;
            if (this.lastPainted && this.lastPainted.col === hit.col && this.lastPainted.row === hit.row) {
                return;
            }
            this.lastPainted = hit;
            this.onCellPress?.(hit.col, hit.row);
        };
        const end = (): void => {
            this.lastPainted = null;
            this.onStrokeEnd?.();
        };
        this.node.on(Node.EventType.TOUCH_START, press);
        this.node.on(Node.EventType.TOUCH_MOVE, press);
        this.node.on(Node.EventType.TOUCH_END, end);
        this.node.on(Node.EventType.TOUCH_CANCEL, end);
    }
}
