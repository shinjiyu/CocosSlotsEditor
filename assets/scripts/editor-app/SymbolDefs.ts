/**
 * SymbolDefs — SymbolLibrary 的数据类（非 Component，可与库组件分文件共存）。
 *
 * SymbolEntry：一个符号的全部配置，资源直接拖引用（不走路径/约定目录）。
 * CellFxDef：格子级通用特效（中奖高亮框 / 消除爆光等），与符号自身动画并行播放。
 * 所有尺寸都在「设计像素」空间；符号设计尺寸是 SymbolLibrary 上的全局配置
 * （缺省 152×128，不逐符号配置），运行时按 board 格子大小整体等比缩放。
 */

import { _decorator, AudioClip, BitmapFont, Node, Prefab, SpriteFrame, UITransform, Vec2, ccenum, sp } from 'cc';
import { EnterFx } from './symbolFx';

const { ccclass, property } = _decorator;

/** 格子设计尺寸（格子级特效的缩放基准） */
export const DESIGN_CELL_W = 152;
export const DESIGN_CELL_H = 128;

/**
 * 符号业务分类（同库分型，不另起符号库）。
 * - normal：常规 enter / win / vanish + 格子特效
 * - multi：倍率球；不走中奖高亮；数字读 entity.multiplier，字体用 digitFont
 */
export enum SymbolKind {
    normal = 0,
    multi = 1,
}
ccenum(SymbolKind);

export function isMultiEntry(entry: SymbolEntry | null | undefined): boolean {
    return !!entry && entry.kind === SymbolKind.multi;
}

@ccclass('CellFxDef')
export class CellFxDef {
    @property({ type: sp.SkeletonData, tooltip: '格子特效 spine；留空 = 不启用（条目上留空 = 用全局）' })
    spine: sp.SkeletonData | null = null;

    @property({ tooltip: '播放的动画名（如 win / out）' })
    anim = '';

    @property({ tooltip: '盖在符号上层；不勾则垫在符号下层' })
    front = true;

    @property({ tooltip: '缩放微调（设计像素自适应之上再乘）' })
    scale = 1;

    @property({ tooltip: '相对格子中心的偏移（设计像素）' })
    offset = new Vec2(0, 0);

    @property({ type: AudioClip, tooltip: '特效音效：与 spine 同时触发（多媒体特效的音频半边）' })
    sound: AudioClip | null = null;

    @property({ tooltip: '音效音量', range: [0, 1, 0.05], slide: true })
    soundVolume = 1;

    /** 有视觉或有声音都算有效（可以只配音效不配 spine） */
    get valid(): boolean {
        return (!!this.spine && this.anim.length > 0) || !!this.sound;
    }

    get hasVisual(): boolean {
        return !!this.spine && this.anim.length > 0;
    }
}

@ccclass('SymbolEntry')
export class SymbolEntry {
    @property({ tooltip: '盘面数据(SPIR Cell.symbolId)引用的稳定 id；不要与其它条目重复' })
    id = 0;

    @property({ tooltip: '显示名（刷子面板 / 预览墙标注）' })
    name = '';

    @property({ type: SymbolKind, tooltip: '符号分类：normal=常规；multi=倍率球（不走中奖高亮，可挂倍数字体）' })
    kind = SymbolKind.normal;

    @property({ type: SpriteFrame, tooltip: '静态纹理：无 spine 时的显示，也是刷子面板图标' })
    texture: SpriteFrame | null = null;

    @property({ type: sp.SkeletonData, tooltip: '骨骼动画；拖入后优先于纹理显示' })
    spine: sp.SkeletonData | null = null;

    @property({ type: Prefab, tooltip: '特殊符号才用：自定义 prefab（根节点可挂 SymbolTemplate）' })
    prefab: Prefab | null = null;

    @property({ tooltip: 'spine 常驻循环动画名；空 = 停在 setup pose' })
    idleAnim = '';

    @property({ tooltip: 'spine 入场动画名；空 = 用下方内置入场动效' })
    enterAnim = '';

    @property({ tooltip: 'spine 中奖动画名（highlight 帧播）' })
    winAnim = '';

    @property({ tooltip: 'spine 消除动画名（postClear 帧播）' })
    vanishAnim = '';

    @property({ type: AudioClip, tooltip: '入场音效：与入场演出同时触发' })
    enterSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '中奖音效：与中奖演出同时触发' })
    winSound: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: '消除音效：与消除演出同时触发' })
    vanishSound: AudioClip | null = null;

    @property({ type: EnterFx, tooltip: '内置入场动效（tween，无 spine 入场动画时用）' })
    enterFx = EnterFx.none;

    @property({ tooltip: '缩放微调（设计尺寸自适应之上再乘）' })
    scaleMul = 1;

    @property({
        type: BitmapFont,
        tooltip: '倍率球数字位图字（仅 kind=multi）；空 = 用 SymbolLibrary.multiDigitFont',
    })
    digitFont: BitmapFont | null = null;

    @property({ type: CellFxDef, tooltip: '本符号专用中奖格子特效；spine 留空 = 用全局' })
    winCellFx = new CellFxDef();

    @property({ type: CellFxDef, tooltip: '本符号专用消除格子特效；spine 留空 = 用全局' })
    vanishCellFx = new CellFxDef();

    /** 内容形态：prefab > spine > 纹理 */
    get contentKind(): 'prefab' | 'spine' | 'sprite' {
        if (this.prefab) return 'prefab';
        if (this.spine) return 'spine';
        return 'sprite';
    }
}

/** SymbolView 取符号配置的抽象（运行时 SymbolCatalog / 编辑期 SymbolLibrary 都实现它） */
export interface SymbolProvider {
    getEntry(id: number): SymbolEntry | null;
    /** 全局符号设计尺寸（px，所有符号资产统一按此尺寸制作） */
    readonly designW: number;
    readonly designH: number;
    /** 解析后的中奖格子特效（条目覆盖 > 全局；无则 null） */
    winCellFxFor(id: number): CellFxDef | null;
    vanishCellFxFor(id: number): CellFxDef | null;
    /** 倍率球位图字（条目覆盖 > 库默认；非 multi 返回 null） */
    digitFontFor?(id: number): BitmapFont | null;
    /** 扩散帧：split 粒子飞弹 + split_B 落地 */
    expandSplitFx?: {
        splitParticle: SpriteFrame | null;
        splitB: sp.SkeletonData | null;
        splitBAnim: string;
    };
}

/**
 * 在 host（格子节点）上生成一个格子特效 spine 节点。
 * unitScale：设计像素 → host 实际像素的换算比。
 * 返回骨骼组件；播放与销毁由调用方负责。
 */
export function spawnCellFx(def: CellFxDef, host: Node, unitScale: number): sp.Skeleton | null {
    const data = def.spine;
    if (!data || !def.anim) return null;
    const n = new Node('cellFx');
    n.addComponent(UITransform);
    const sk = n.addComponent(sp.Skeleton);
    sk.skeletonData = data;
    sk.premultipliedAlpha = false;
    const s = unitScale * def.scale;
    n.setScale(s, s, 1);
    n.setPosition(def.offset.x * unitScale, def.offset.y * unitScale, 0);
    host.addChild(n);
    n.setSiblingIndex(def.front ? host.children.length - 1 : 0);
    return sk;
}
