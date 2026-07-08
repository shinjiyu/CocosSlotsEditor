/**
 * SymbolLibrary — 符号库组件（配置全在 Creator 原生 Inspector 完成）。
 *
 * 用法：双击 assets/resources/symbol-library.prefab 进入编辑，
 * 在 Inspector 的 symbols 数组上 +/− 条目、拖入纹理/spine/prefab、填动画名。
 * 编辑时场景视图会自动铺出「预览墙」：每个符号一格，spine 循环播 idle，
 * 改字段立即重建（所见即所得）。previewEnter/Win/Vanish 勾一下播对应动画。
 *
 * 运行时由 SymbolCatalog.load() 加载本 prefab 读取数据，本组件不进场景。
 */

import { _decorator, CCObject, Color, Component, Graphics, Label, Node, RenderRoot2D, UITransform, sp } from 'cc';
import { EDITOR } from 'cc/env';
import { CellFxDef, DESIGN_CELL_H, DESIGN_CELL_W, SymbolEntry, spawnCellFx } from './SymbolDefs';
import type { SymbolProvider } from './SymbolDefs';
import { SymbolView } from './SymbolView';

const { ccclass, property, executeInEditMode } = _decorator;

const PREVIEW_NODE = '__symbol_preview__';
const PREVIEW_PER_ROW = 6;
const PREVIEW_GAP = 26;

@ccclass('SymbolLibrary')
@executeInEditMode
export class SymbolLibrary extends Component implements SymbolProvider {
    @property({ type: [SymbolEntry], tooltip: '符号条目：+/− 增删，拖入资源即完成配置' })
    symbols: SymbolEntry[] = [];

    @property({ displayName: '符号设计宽(px)', tooltip: '全局：所有符号资产统一按此设计尺寸制作，运行时按格子等比缩放' })
    symbolWidth = DESIGN_CELL_W;

    @property({ displayName: '符号设计高(px)' })
    symbolHeight = DESIGN_CELL_H;

    @property({ type: CellFxDef, tooltip: '全局中奖格子特效（highlight 帧与符号 winAnim 并行播）' })
    winCellFx = new CellFxDef();

    @property({ type: CellFxDef, tooltip: '全局消除格子特效（postClear 帧与符号 vanishAnim 并行播）' })
    vanishCellFx = new CellFxDef();

    // ------------------------------------------------------------------
    // SymbolProvider
    // ------------------------------------------------------------------

    getEntry(id: number): SymbolEntry | null {
        return this.symbols.find((e) => e.id === id) ?? null;
    }

    get designW(): number {
        return this.symbolWidth > 0 ? this.symbolWidth : DESIGN_CELL_W;
    }

    get designH(): number {
        return this.symbolHeight > 0 ? this.symbolHeight : DESIGN_CELL_H;
    }

    winCellFxFor(id: number): CellFxDef | null {
        const override = this.getEntry(id)?.winCellFx;
        if (override?.valid) return override;
        return this.winCellFx.valid ? this.winCellFx : null;
    }

    vanishCellFxFor(id: number): CellFxDef | null {
        const override = this.getEntry(id)?.vanishCellFx;
        if (override?.valid) return override;
        return this.vanishCellFx.valid ? this.vanishCellFx : null;
    }

    // ------------------------------------------------------------------
    // 编辑期预览墙
    // ------------------------------------------------------------------

    @property({
        displayName: '▶ 播入场(触发钮)',
        tooltip: '触发按钮：勾一下立即在场景视图播一遍全部符号的入场动画（仅 spine enterAnim；tween 动效进预览看），会自动弹回',
    })
    get previewEnter(): boolean {
        return false;
    }
    set previewEnter(v: boolean) {
        if (v) this.playPreview('enter');
    }

    @property({
        displayName: '▶ 播中奖(触发钮)',
        tooltip: '触发按钮：勾一下立即在场景视图播一遍全部符号的中奖动画 + 格子特效，会自动弹回',
    })
    get previewWin(): boolean {
        return false;
    }
    set previewWin(v: boolean) {
        if (v) this.playPreview('win');
    }

    @property({
        displayName: '▶ 播消除(触发钮)',
        tooltip: '触发按钮：勾一下立即在场景视图播一遍全部符号的消除动画 + 格子特效（播完回 idle，不清符号），会自动弹回',
    })
    get previewVanish(): boolean {
        return false;
    }
    set previewVanish(v: boolean) {
        if (v) this.playPreview('vanish');
    }

    private wall: Node | null = null;
    private wallViews = new Map<number, SymbolView>();
    private sigTimer = 0;
    private lastSig = '';
    private editorTimer: ReturnType<typeof setInterval> | null = null;

    protected onEnable(): void {
        if (!EDITOR) return;
        this.rebuildPreview();
        // 编辑模式下引擎不跑 update()，用 interval 自驱 + 强制场景视图重绘
        const dt = 1 / 30;
        this.editorTimer = setInterval(() => this.editorTick(dt), 33);
    }

    protected onDisable(): void {
        if (!EDITOR) return;
        if (this.editorTimer !== null) {
            clearInterval(this.editorTimer);
            this.editorTimer = null;
        }
        this.destroyPreview();
    }

    private editorTick(dt: number): void {
        if (!this.node.isValid) return;
        // 数据变更侦测（0.5s 一次签名比对）
        this.sigTimer += dt;
        if (this.sigTimer >= 0.5) {
            this.sigTimer = 0;
            const sig = this.signature();
            if (sig !== this.lastSig) {
                this.lastSig = sig;
                this.rebuildPreview();
            }
        }
        // 编辑器不跑 spine 动画循环，手动 tick + 重绘
        if (!this.wall?.isValid) return;
        const skels = this.wall.getComponentsInChildren(sp.Skeleton);
        let animating = false;
        for (const sk of skels) {
            if (sk.isValid && sk.skeletonData) {
                // 引擎在编辑模式默认 paused=true，预览墙需要动起来
                if (sk.paused) sk.paused = false;
                sk.updateAnimation(dt);
                if (sk.animation) animating = true;
            }
        }
        if (animating) requestEditorRepaint();
    }

    private signature(): string {
        const parts = this.symbols.map((e) =>
            [
                e.id, e.name,
                e.texture?.uuid ?? '', e.spine?.uuid ?? '', e.prefab?.uuid ?? '',
                e.idleAnim, e.enterAnim, e.winAnim, e.vanishAnim,
                e.enterFx, e.scaleMul,
                fxSig(e.winCellFx), fxSig(e.vanishCellFx),
            ].join(','),
        );
        parts.push(fxSig(this.winCellFx), fxSig(this.vanishCellFx), `${this.symbolWidth}x${this.symbolHeight}`);
        return parts.join('|');
    }

    private destroyPreview(): void {
        this.node.getChildByName(PREVIEW_NODE)?.destroy();
        this.wall = null;
        this.wallViews.clear();
    }

    private rebuildPreview(): void {
        this.destroyPreview();
        const wall = new Node(PREVIEW_NODE);
        wall.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        wall.addComponent(UITransform);
        // prefab 编辑舞台没有 Canvas，2D 渲染需要自带渲染根
        wall.addComponent(RenderRoot2D);
        this.node.addChild(wall);
        this.wall = wall;

        const cw = this.designW;
        const ch = this.designH;
        const stepX = cw + PREVIEW_GAP;
        const stepY = ch + PREVIEW_GAP + 18;
        this.symbols.forEach((entry, i) => {
            const col = i % PREVIEW_PER_ROW;
            const row = Math.floor(i / PREVIEW_PER_ROW);
            const cell = new Node(`preview_${entry.id}`);
            cell.addComponent(UITransform).setContentSize(cw, ch);
            cell.setPosition(col * stepX, -row * stepY, 0);

            const g = cell.addComponent(Graphics);
            g.lineWidth = 2;
            g.strokeColor = new Color(120, 200, 255, 140);
            g.rect(-cw / 2, -ch / 2, cw, ch);
            g.stroke();

            const view = cell.addComponent(SymbolView);
            view.setup(this, cw, ch, 1);
            view.setSymbol(entry.id);
            this.wallViews.set(entry.id, view);

            const labelNode = new Node('label');
            labelNode.addComponent(UITransform);
            const label = labelNode.addComponent(Label);
            label.string = `${entry.id} ${entry.name}`;
            label.fontSize = 18;
            label.lineHeight = 20;
            const dup = this.symbols.some((o) => o !== entry && o.id === entry.id);
            label.color = dup ? new Color(255, 90, 90, 255) : new Color(220, 230, 255, 255);
            if (dup) label.string += ' (id重复!)';
            labelNode.setPosition(0, -ch / 2 - 16, 0);
            cell.addChild(labelNode);

            wall.addChild(cell);
        });
    }

    /** 预览墙上播一遍 spine 动画（enter/win/vanish）+ 对应格子特效 */
    private playPreview(kind: 'enter' | 'win' | 'vanish'): void {
        if (!EDITOR || !this.wall?.isValid) return;
        for (const entry of this.symbols) {
            const view = this.wallViews.get(entry.id);
            const cell = view?.node;
            if (!cell?.isValid) continue;
            // spine 动画
            const animName =
                kind === 'enter' ? entry.enterAnim : kind === 'win' ? entry.winAnim : entry.vanishAnim;
            const sk = view!.spineComp;
            if (sk && animName) {
                if (entry.idleAnim && entry.idleAnim !== animName) {
                    // 与运行时 SymbolView 一致：动画切换做 crossfade，避免硬切 pop
                    sk.setMix(entry.idleAnim, animName, 0.2);
                    sk.setMix(animName, entry.idleAnim, 0.2);
                }
                sk.setAnimation(0, animName, false);
                if (entry.idleAnim) sk.addAnimation(0, entry.idleAnim, true);
            }
            // 格子特效
            const fx = kind === 'win' ? this.winCellFxFor(entry.id) : kind === 'vanish' ? this.vanishCellFxFor(entry.id) : null;
            if (fx) {
                const fxSk = spawnCellFx(fx, cell, 1);
                if (fxSk) {
                    fxSk.setAnimation(0, fx.anim, false);
                    const fxNode = fxSk.node;
                    fxSk.setCompleteListener(() => {
                        fxSk.setCompleteListener(null!);
                        if (fxNode.isValid) fxNode.destroy();
                    });
                }
            }
        }
    }
}

function fxSig(fx: CellFxDef): string {
    return [fx.spine?.uuid ?? '', fx.anim, fx.front ? 1 : 0, fx.scale, fx.offset.x, fx.offset.y].join(',');
}

/** 编辑模式下强制场景视图重绘（cce 为场景进程注入的编辑器全局） */
function requestEditorRepaint(): void {
    const cce = (globalThis as Record<string, unknown>).cce as
        | { Engine?: { repaintInEditMode?: () => void } }
        | undefined;
    cce?.Engine?.repaintInEditMode?.();
}
