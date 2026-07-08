/**
 * SymbolView — 单元格的符号视图（资源注入层）。
 *
 * 两层节点结构：
 *   cell 节点（BoardView 创建，位移/脉冲动画的载体，scale 恒为 1）
 *     └─ content 子节点（本组件管理：sprite / spine / prefab 实例，适配缩放在这层）
 *
 * 配置来自 SymbolLibrary（SymbolProvider），条目内容形态：prefab > spine > 纹理。
 * 尺寸契约：符号资源统一按全局设计尺寸（provider.designW×designH，缺省 152×128）制作；
 * 纹理走 Sprite RAW 模式原样显示，本组件把设计盒等比缩到实际格子（cellW×cellH×cellFill）。
 *
 * 动画钩子（enter/win/vanish）：prefab 的 SymbolTemplate > spine 动画名 > 内置 enterFx；
 * win/vanish 还会并行叠加 provider 解析出的格子特效（CellFxDef）。
 */

import { _decorator, Component, instantiate, Node, Sprite, UIOpacity, UITransform, Vec3, sp, tween } from 'cc';
import type { IAnim } from '../common/anim/IAnim';
import { par, playSpine, starterAnim } from '../common/anim/compose';
import { DESIGN_CELL_H, DESIGN_CELL_W, spawnCellFx } from './SymbolDefs';
import type { CellFxDef, SymbolEntry, SymbolProvider } from './SymbolDefs';
import { buildSymbolFx, enterFxName } from './symbolFx';
import { playSfx, sfxStep } from './sfx';
import { SymbolTemplate } from './SymbolTemplate';

const { ccclass } = _decorator;

/** spine 动画切换的默认 crossfade 时长（enter→idle / idle→win 等） */
const SPINE_MIX = 0.2;

@ccclass('SymbolView')
export class SymbolView extends Component {
    private provider: SymbolProvider | null = null;
    private cellW = 100;
    private cellH = 84;
    private cellFill = 0.9;
    private content: Node | null = null;
    private prefabInstance: Node | null = null;
    private spineNode: Node | null = null;
    private spineSkeleton: sp.Skeleton | null = null;
    private currentId: number | null = null;

    setup(provider: SymbolProvider, cellW: number, cellH: number, cellFill: number): void {
        this.provider = provider;
        this.cellW = cellW;
        this.cellH = cellH;
        this.cellFill = cellFill;
        if (!this.content) {
            const n = new Node('content');
            n.addComponent(UITransform);
            n.addComponent(Sprite);
            this.node.addChild(n);
            this.content = n;
        }
    }

    get symbolId(): number | null {
        return this.currentId;
    }

    /** content 子节点（内置 fx 的作用目标） */
    get contentNode(): Node | null {
        return this.content;
    }

    /** 当前 spine 骨骼组件（编辑期预览墙直接驱动用） */
    get spineComp(): sp.Skeleton | null {
        return this.spineSkeleton;
    }

    /** 符号设计盒（全局配置）→ 实际格子的等比缩放（含 scaleMul） */
    private fitScale(entry: SymbolEntry): number {
        const w = this.provider?.designW ?? DESIGN_CELL_W;
        const h = this.provider?.designH ?? DESIGN_CELL_H;
        return Math.min((this.cellW * this.cellFill) / w, (this.cellH * this.cellFill) / h) * entry.scaleMul;
    }

    /** 设计格 → 实际格子的换算比（格子特效用） */
    private cellUnitScale(): number {
        const w = this.provider?.designW ?? DESIGN_CELL_W;
        const h = this.provider?.designH ?? DESIGN_CELL_H;
        return Math.min(this.cellW / w, this.cellH / h);
    }

    setSymbol(symbolId: number | null): void {
        if (!this.content || !this.provider) return;
        const sprite = this.content.getComponent(Sprite)!;
        // 归位 content 变换（fx / 消除演出中断可能留下残余缩放/旋转/透明度）
        this.content.setRotationFromEuler(0, 0, 0);
        const contentOp = this.content.getComponent(UIOpacity);
        if (contentOp) contentOp.opacity = 255;

        const entry = symbolId !== null ? this.provider.getEntry(symbolId) : null;
        if (!entry) {
            this.clearRichContent();
            sprite.spriteFrame = null;
            this.content.setScale(1, 1, 1);
            this.currentId = null;
            return;
        }

        const s = this.fitScale(entry);
        const kind = entry.contentKind;
        if (kind === 'prefab') {
            sprite.spriteFrame = null;
            this.clearSpine();
            if (this.currentId !== symbolId || !this.prefabInstance) {
                this.clearPrefabInstance();
                this.prefabInstance = instantiate(entry.prefab!);
                this.content.addChild(this.prefabInstance);
            }
        } else if (kind === 'spine') {
            sprite.spriteFrame = null;
            this.clearPrefabInstance();
            if (this.currentId !== symbolId || !this.spineSkeleton) {
                this.setupSpine(entry);
            }
        } else {
            this.clearRichContent();
            sprite.spriteFrame = entry.texture;
            if (entry.texture) {
                // RAW：按纹理原始尺寸显示（含透明留白），不裁切不变形；
                // 资产按全局设计尺寸制作，fitScale 负责缩进格子
                sprite.trim = false;
                sprite.sizeMode = Sprite.SizeMode.RAW;
            }
        }
        this.content.setScale(new Vec3(s, s, 1));
        this.currentId = symbolId;
    }

    private setupSpine(entry: SymbolEntry): void {
        this.clearSpine();
        if (!entry.spine || !this.content) return;
        const n = new Node('spine');
        n.addComponent(UITransform);
        const sk = n.addComponent(sp.Skeleton);
        sk.skeletonData = entry.spine;
        sk.premultipliedAlpha = false;
        if (entry.idleAnim) sk.setAnimation(0, entry.idleAnim, true);
        this.content.addChild(n);
        this.spineNode = n;
        this.spineSkeleton = sk;
    }

    /** 入场动效优先级：prefab SymbolTemplate > spine enterAnim > 内置 enterFx；入场音效并行 */
    buildEnterAnim(): IAnim | null {
        if (this.currentId === null || !this.content) return null;
        const entry = this.provider?.getEntry(this.currentId);
        let visual: IAnim | null = null;
        const tpl = this.prefabInstance?.getComponent(SymbolTemplate);
        if (tpl) visual = tpl.buildEnterAnim();
        if (!visual && entry) {
            visual = this.buildSpineHook(entry.enterAnim);
            if (!visual) {
                const fxName = enterFxName(entry.enterFx);
                if (fxName) visual = buildSymbolFx(fxName, this.content);
            }
        }
        const sound = entry?.enterSound ? sfxStep(entry.enterSound) : null;
        if (visual && sound) return par(visual, sound);
        return visual ?? sound;
    }

    /** 中奖动画：符号自身（SymbolTemplate / spine winAnim）+ 中奖音效 + 格子特效并行 */
    buildWinAnim(): IAnim | null {
        if (this.currentId === null) return null;
        const entry = this.provider?.getEntry(this.currentId);
        const parts: IAnim[] = [];
        const tpl = this.prefabInstance?.getComponent(SymbolTemplate)?.buildWinAnim();
        if (tpl) parts.push(tpl);
        else {
            const spine = this.buildSpineHook(entry?.winAnim);
            if (spine) parts.push(spine);
        }
        if (entry?.winSound) parts.push(sfxStep(entry.winSound));
        const fx = this.buildCellFxAnim(this.provider?.winCellFxFor(this.currentId) ?? null);
        if (fx) parts.push(fx);
        return parts.length ? par(...parts) : null;
    }

    /**
     * 消除动画：符号自身与格子特效并行。注意消除后不回 idle（随后格子会被清空）。
     * 符号自身没有消失演出（无 SymbolTemplate / spine vanishAnim）时，
     * 用缺省缩没淡出顶上——注意演出目标是 content 子节点而不是 cell 节点：
     * cell 节点上还挂着消除格子特效（spawnCellFx），缩 cell 会把特效一起缩没。
     */
    buildVanishAnim(defaultDur = 0.25): IAnim | null {
        if (this.currentId === null) return null;
        const entry = this.provider?.getEntry(this.currentId);
        const parts: IAnim[] = [];
        const tpl = this.prefabInstance?.getComponent(SymbolTemplate)?.buildVanishAnim();
        if (tpl) parts.push(tpl);
        else if (this.spineSkeleton && entry?.vanishAnim) {
            parts.push(playSpine(this.spineSkeleton, entry.vanishAnim, { mixIn: SPINE_MIX }));
        } else {
            parts.push(this.buildDefaultVanish(defaultDur));
        }
        if (entry?.vanishSound) parts.push(sfxStep(entry.vanishSound));
        const fx = this.buildCellFxAnim(this.provider?.vanishCellFxFor(this.currentId) ?? null);
        if (fx) parts.push(fx);
        return par(...parts);
    }

    /** 本体缺省消失演出：只缩淡 content（不动 cell，避免波及同挂在 cell 上的格子特效） */
    private buildDefaultVanish(dur: number): IAnim {
        return starterAnim((finish) => {
            const content = this.content;
            if (!content?.isValid) {
                finish();
                return;
            }
            const op = content.getComponent(UIOpacity) ?? content.addComponent(UIOpacity);
            const t1 = tween(content).to(dur, { scale: new Vec3(0, 0, 1) }, { easing: 'backIn' }).start();
            const t2 = tween(op)
                .to(dur, { opacity: 0 })
                .call(() => finish())
                .start();
            return () => {
                t1.stop();
                t2.stop();
            };
        });
    }

    /** 播一段 spine 动画（带 crossfade 进入），播完用 spine 原生队列平滑接回 idle 循环 */
    private buildSpineHook(animName: string | undefined): IAnim | null {
        const sk = this.spineSkeleton;
        if (!sk || !animName) return null;
        const idle = this.currentId !== null ? this.provider?.getEntry(this.currentId)?.idleAnim : undefined;
        return playSpine(sk, animName, {
            mixIn: SPINE_MIX,
            followUp: idle ? { anim: idle, loop: true, mix: SPINE_MIX } : undefined,
        });
    }

    /** 格子特效（多媒体）：cell 节点上生成 spine 播一次 + 音效同时触发，播完/取消自动销毁 */
    private buildCellFxAnim(def: CellFxDef | null): IAnim | null {
        if (!def) return null;
        return starterAnim((finish) => {
            playSfx(def.sound, def.soundVolume);
            const sk = spawnCellFx(def, this.node, this.cellUnitScale());
            if (!sk) {
                // 只配了音效没配 spine：触发完即完成
                finish();
                return;
            }
            const fxNode = sk.node;
            let done = false;
            sk.setAnimation(0, def.anim, false);
            sk.setCompleteListener(() => {
                if (done) return;
                done = true;
                if (fxNode.isValid) fxNode.destroy();
                finish();
            });
            return () => {
                done = true;
                if (fxNode.isValid) fxNode.destroy();
            };
        });
    }

    private clearRichContent(): void {
        this.clearPrefabInstance();
        this.clearSpine();
    }

    private clearPrefabInstance(): void {
        if (this.prefabInstance) {
            this.prefabInstance.destroy();
            this.prefabInstance = null;
        }
    }

    private clearSpine(): void {
        if (this.spineNode) {
            this.spineNode.destroy();
            this.spineNode = null;
            this.spineSkeleton = null;
        }
    }
}
