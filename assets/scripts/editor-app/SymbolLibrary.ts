/**
 * SymbolLibrary — 符号表（用素材库 id 组装逻辑符号）。
 *
 * 分层：
 *   1) asset-library.prefab  — 素材库
 *   2) symbol-library.prefab — 本组件（*AssetId + placement + 动画名）
 *   3) BoardEditor / SymbolEditor — 消费已解析符号
 *
 * 配置与预览请走 H5「符号编辑器」(SymbolEditor 场景)；
 * 本组件仅作运行时数据容器，不再在 Creator 场景视图画预览墙。
 */

import { _decorator, BitmapFont, Component, SpriteFrame, sp } from 'cc';
import {
    CellFxDef,
    DESIGN_CELL_H,
    DESIGN_CELL_W,
    SymbolEntry,
    isMultiEntry,
} from './SymbolDefs';
import type { SymbolProvider } from './SymbolDefs';

const { ccclass, property } = _decorator;

@ccclass('SymbolLibrary')
export class SymbolLibrary extends Component implements SymbolProvider {
    @property({ type: [SymbolEntry], tooltip: '符号条目；优先填 *AssetId，由 SymbolCatalog 解析' })
    symbols: SymbolEntry[] = [];

    @property({ displayName: '符号设计宽(px)', tooltip: '全局设计尺寸；运行时按格子等比缩放' })
    symbolWidth = DESIGN_CELL_W;

    @property({ displayName: '符号设计高(px)' })
    symbolHeight = DESIGN_CELL_H;

    @property({ type: CellFxDef, tooltip: '全局中奖格子特效' })
    winCellFx = new CellFxDef();

    @property({ type: CellFxDef, tooltip: '全局消除格子特效' })
    vanishCellFx = new CellFxDef();

    @property({
        type: BitmapFont,
        tooltip: '倍率球默认位图字（kind=multi 且条目 digitFont 为空时用）',
    })
    multiDigitFont: BitmapFont | null = null;

    @property({
        type: SpriteFrame,
        tooltip: '扩散拖尾粒子贴图（timesParticle / BlueTimesMoving）',
    })
    expandSplitParticle: SpriteFrame | null = null;

    @property({
        type: sp.SkeletonData,
        tooltip: '扩散落地 spine（split_B）',
    })
    expandSplitB: sp.SkeletonData | null = null;

    @property({ tooltip: '落地动画名' })
    expandSplitBAnim = 'split_B';

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
        if (isMultiEntry(this.getEntry(id))) return null;
        const override = this.getEntry(id)?.winCellFx;
        if (override?.valid) return override;
        return this.winCellFx.valid ? this.winCellFx : null;
    }

    digitFontFor(id: number): BitmapFont | null {
        const entry = this.getEntry(id);
        if (!isMultiEntry(entry)) return null;
        return entry!.digitFont ?? this.multiDigitFont;
    }

    get expandSplitFx() {
        return {
            splitParticle: this.expandSplitParticle,
            splitB: this.expandSplitB,
            splitBAnim: this.expandSplitBAnim || 'split_B',
        };
    }

    vanishCellFxFor(id: number): CellFxDef | null {
        const override = this.getEntry(id)?.vanishCellFx;
        if (override?.valid) return override;
        return this.vanishCellFx.valid ? this.vanishCellFx : null;
    }
}
