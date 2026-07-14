/**
 * SymbolView — 单元格的符号视图（资源注入层）。
 *
 * 两层节点结构：
 *   cell 节点（BoardView 创建，位移/脉冲动画的载体，scale 恒为 1）
 *     └─ content 子节点（本组件管理：sprite / spine / prefab 实例，适配缩放在这层）
 *
 * 配置来自 SymbolLibrary（SymbolProvider），静态显示优先级：prefab > 纹理 > spine。
 * 配了 spine 的符号平时仍显示纹理，spine 只在演出（enter/win/vanish）时临时挂载、
 * 播完拆除还原 sprite；只有"未配纹理"的 spine 符号才常驻骨骼（idle 循环或 setup pose）。
 * 尺寸契约：符号资源统一按全局设计尺寸（provider.designW×designH，缺省 152×128）制作；
 * 纹理走 Sprite RAW 模式原样显示，本组件把设计盒等比缩到实际格子（cellW×cellH×cellFill）。
 *
 * 动画钩子（enter/win/vanish）：prefab 的 SymbolTemplate > spine 动画名 > 内置 enterFx；
 * win/vanish 还会并行叠加 provider 解析出的格子特效（CellFxDef）。
 */

import { _decorator, Color, Component, instantiate, Label, Node, Sprite, UIOpacity, UITransform, Vec3, sp, tween } from 'cc';
import type { IAnim } from '../common/anim/IAnim';
import { par, playSpine, starterAnim } from '../common/anim/compose';
import { DESIGN_CELL_H, DESIGN_CELL_W, isMultiEntry, spawnCellFx } from './SymbolDefs';
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
    private multiLabel: Label | null = null;
    private multiValue: number | null = null;

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

    /** 内容固有尺寸：优先纹理 originalSize（保比例），否则用全局设计盒 */
    private contentIntrinsicSize(entry: SymbolEntry): { w: number; h: number } {
        const tex = entry.texture;
        const ow = tex?.originalSize?.width ?? 0;
        const oh = tex?.originalSize?.height ?? 0;
        if (ow > 0 && oh > 0) return { w: ow, h: oh };
        return {
            w: this.provider?.designW ?? DESIGN_CELL_W,
            h: this.provider?.designH ?? DESIGN_CELL_H,
        };
    }

    /** 符号固有尺寸 → 实际格子的等比缩放（含 scaleMul；不拉伸变形） */
    private fitScale(entry: SymbolEntry): number {
        const { w, h } = this.contentIntrinsicSize(entry);
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
        // 归位 content 变换（fx / 消除演出中断可能留下残余缩放/旋转/透明度/隐藏的 sprite）
        this.content.setRotationFromEuler(0, 0, 0);
        const contentOp = this.content.getComponent(UIOpacity);
        if (contentOp) contentOp.opacity = 255;
        sprite.enabled = true;

        const entry = symbolId !== null ? this.provider.getEntry(symbolId) : null;
        if (!entry) {
            this.clearRichContent();
            sprite.spriteFrame = null;
            this.content.setScale(1, 1, 1);
            this.currentId = null;
            this.setMultiplier(null);
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
        } else if (kind === 'spine' && !entry.texture) {
            // 常驻 spine：没有静态纹理可回退，只能骨骼常显（idle 循环或 setup pose）
            sprite.spriteFrame = null;
            this.clearPrefabInstance();
            if (this.currentId !== symbolId || !this.spineSkeleton) {
                this.setupSpine(entry);
            }
        } else {
            // 静态显示一律用纹理；配了 spine 的符号，骨骼只在演出时临时挂载
            this.clearRichContent();
            sprite.spriteFrame = entry.texture;
            if (entry.texture) {
                // CUSTOM + 纹理固有尺寸：保宽高比（倍率球 152² 正圆不会被压成 152×128 椭圆）
                // 再由 fitScale 等比缩进格子；不用 RAW，避免部分 SpriteFrame vertices 在编辑期空白
                sprite.trim = false;
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                const ut = this.content.getComponent(UITransform);
                if (ut) {
                    const { w, h } = this.contentIntrinsicSize(entry);
                    ut.setContentSize(w, h);
                }
            }
        }
        this.content.setScale(new Vec3(s, s, 1));
        this.currentId = symbolId;
        // 非 multi 清空数字；multi 由 BoardView 再调 setMultiplier
        if (!isMultiEntry(entry)) this.setMultiplier(null);
    }

    /**
     * 倍率球数字 (entity.multiplier). null = 隐藏.
     * times 挂在 content 下，随球等比缩放；本地坐标对齐原版 (0, 2.5) + 底锚点.
     */
    setMultiplier(value: number | null): void {
        this.multiValue = value !== null && value > 0 ? value : null;
        if (this.multiValue === null) {
            if (this.multiLabel) this.multiLabel.node.active = false;
            return;
        }
        const label = this.ensureMultiLabel();
        if (!label) return;
        label.node.active = true;
        // countup_02 只有 0-9/,/./x；必须先写安全字符串再建位图字，
        // 否则 Label 默认 "label" 会狂刷 atlas miss（b/e/l/a）。
        const text = `${this.multiValue}x`;
        label.string = text;
        const font = this.currentId !== null ? this.provider?.digitFontFor?.(this.currentId) ?? null : null;
        if (font) {
            label.useSystemFont = false;
            if (label.font !== font) label.font = font;
        } else {
            label.useSystemFont = true;
        }
        // 再次写回：切 font 时引擎会按当前 string rebuild
        if (label.string !== text) label.string = text;

        // 原版 times：fontSize=10, lineHeight=58, pos=(0,2.5), anchor=(0.5,0)
        // 挂 content 后不再乘 cell 缩放（content.fitScale 已吃掉）
        const ut = label.node.getComponent(UITransform)!;
        ut.setAnchorPoint(0.5, 0);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.BOTTOM;
        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        label.fontSize = 10;
        label.lineHeight = 58;
        ut.setContentSize(0, 26);
        // 原版 y=2.5；编辑器里球为正圆缩放后光学中心略偏上，再抬一点
        label.node.setPosition(0, 12, 0);
    }

    private ensureMultiLabel(): Label | null {
        if (this.multiLabel?.isValid) {
            // content 重建后把 times 挂回去
            if (this.content && this.multiLabel.node.parent !== this.content) {
                this.multiLabel.node.removeFromParent();
                this.content.addChild(this.multiLabel.node);
            }
            return this.multiLabel;
        }
        if (!this.content) return null;
        const n = new Node('times');
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0.5, 0);
        const label = n.addComponent(Label);
        // Cocos Label 默认 string="label"；立刻清空，避免后续挂位图字时 miss
        label.string = '';
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.BOTTOM;
        label.color = new Color(255, 255, 255, 255);
        label.overflow = Label.Overflow.NONE;
        this.content.addChild(n);
        this.multiLabel = label;
        return label;
    }

    /** 当前符号是否"临时挂载"型 spine（配了纹理，骨骼只在演出时出现） */
    get isTempSpine(): boolean {
        const entry = this.currentId !== null ? this.provider?.getEntry(this.currentId) : null;
        return !!entry?.spine && !!entry.texture && entry.contentKind !== 'prefab';
    }

    /**
     * 确保 spine 已挂载并返回骨骼组件（演出/预览用）。
     * 临时型：隐藏 sprite 后挂骨骼；常驻型：直接返回现有骨骼。无 spine 配置返回 null。
     */
    mountSpine(): sp.Skeleton | null {
        if (this.spineSkeleton) return this.spineSkeleton;
        if (this.currentId === null || !this.content) return null;
        const entry = this.provider?.getEntry(this.currentId);
        if (!entry?.spine) return null;
        const sprite = this.content.getComponent(Sprite);
        if (sprite) sprite.enabled = false;
        this.setupSpine(entry);
        return this.spineSkeleton;
    }

    /**
     * 拆除临时挂载的 spine。常驻型（无纹理回退）不拆。
     * restoreSprite=false 用于消除演出：符号即将被清空，不再闪回静态图。
     */
    unmountTempSpine(restoreSprite = true): void {
        if (!this.spineNode) return;
        const entry = this.currentId !== null ? this.provider?.getEntry(this.currentId) : null;
        if (entry?.spine && !entry.texture) return;
        this.clearSpine();
        const sprite = this.content?.getComponent(Sprite);
        if (sprite && restoreSprite) sprite.enabled = true;
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

    /**
     * 倍率球收集时的 spine「转一下」。只用骨骼动画（默认名 function），不做节点旋转 tween。
     * @param animName 覆盖条目 winAnim；最终回落 'function'（倍率球骨骼约定）
     */
    buildMultiSpinAnim(animName?: string): IAnim | null {
        if (this.currentId === null || !this.content) return null;
        const entry = this.provider?.getEntry(this.currentId);
        if (!isMultiEntry(entry)) return null;
        const name = (animName?.trim() || entry?.winAnim?.trim() || 'function').trim();
        if (!name) return null;
        return this.buildSpineHook(name, true);
    }

    /**
     * 倍率数字收集消失：times 标签缩淡后隐藏（球本身不动）。
     */
    buildMultiDigitCollectAnim(dur = 0.22): IAnim | null {
        if (!this.multiLabel?.isValid || !this.multiLabel.node.active) return null;
        const labelNode = this.multiLabel.node;
        const op = labelNode.getComponent(UIOpacity) ?? labelNode.addComponent(UIOpacity);
        return starterAnim((finish) => {
            if (!labelNode.isValid) {
                finish();
                return;
            }
            const base = labelNode.scale.clone();
            const t1 = tween(labelNode)
                .to(dur, { scale: new Vec3(base.x * 1.35, base.y * 1.35, 1) }, { easing: 'quadOut' })
                .to(dur * 0.85, { scale: new Vec3(0, 0, 1) }, { easing: 'backIn' })
                .start();
            const t2 = tween(op)
                .delay(dur * 0.4)
                .to(dur * 0.85, { opacity: 0 })
                .call(() => {
                    this.setMultiplier(null);
                    labelNode.setScale(1, 1, 1);
                    op.opacity = 255;
                    finish();
                })
                .start();
            return () => {
                t1.stop();
                t2.stop();
                this.setMultiplier(null);
                if (labelNode.isValid) {
                    labelNode.setScale(1, 1, 1);
                    op.opacity = 255;
                }
            };
        });
    }

    /** 中奖动画：符号自身（SymbolTemplate / spine winAnim）+ 中奖音效 + 格子特效并行 */
    buildWinAnim(): IAnim | null {
        if (this.currentId === null) return null;
        const entry = this.provider?.getEntry(this.currentId);
        // 倍率球不走中奖高亮（扩散 / 倍率飞出是独立帧模板）
        if (isMultiEntry(entry)) return null;
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
        else {
            // 消除后格子即将清空：不回 idle、临时骨骼拆除后也不闪回静态图
            const spine = this.buildSpineHook(entry?.vanishAnim, false);
            if (spine) parts.push(spine);
            else parts.push(this.buildDefaultVanish(defaultDur));
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

    /**
     * 播一段 spine 动画。
     * 常驻骨骼：crossfade 进入，播完按需用 spine 原生队列平滑接回 idle 循环。
     * 临时骨骼（配了纹理的符号）：演出时挂载、播完拆除还原静态纹理。
     * backToStatic=false（消除）：播完不还原静态显示（格子随后被清空）。
     */
    private buildSpineHook(animName: string | undefined, backToStatic = true): IAnim | null {
        if (!animName || this.currentId === null) return null;
        const entry = this.provider?.getEntry(this.currentId);
        if (!entry?.spine) return null;

        if (!this.isTempSpine) {
            const sk = this.spineSkeleton;
            if (!sk) return null;
            const idle = entry.idleAnim;
            return playSpine(sk, animName, {
                mixIn: SPINE_MIX,
                followUp: backToStatic && idle ? { anim: idle, loop: true, mix: SPINE_MIX } : undefined,
            });
        }

        // 临时挂载：藏 sprite → 挂骨骼播动画 → 拆除还原
        return starterAnim((finish) => {
            const sk = this.mountSpine();
            if (!sk) {
                finish();
                return;
            }
            const inner = playSpine(sk, animName, {});
            void inner
                .play()
                .then(() => {
                    this.unmountTempSpine(backToStatic);
                    finish();
                })
                .catch(() => {
                    /* cancelled：dispose 里已做拆除 */
                });
            return () => {
                inner.cancel();
                this.unmountTempSpine(backToStatic);
            };
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
