/**
 * SymbolEditorHud — 符号编辑 UI 布局。
 *
 * 1280×720：顶栏 | 左墙（裁剪） | 右 Inspector（固定宽，不压墙）
 * 素材用 2×2 缩略卡点选，不再左右切。
 */

import {
    _decorator,
    Component,
    Node,
    Label,
    UITransform,
    Color,
    Graphics,
    Sprite,
    Vec3,
    Mask,
    sp,
} from 'cc';
import type { PackLayoutConfig, SymbolDraft } from './SymbolDraft';
import { columnVAlignLabel } from './SymbolDraft';
import type { AssetEntry } from './AssetDefs';
import { AssetKind, assetLabel } from './AssetDefs';
import { SymbolKind } from './SymbolDefs';
import { openAssetPicker, type AssetPickKinds } from './SymbolAssetPicker';

const { ccclass } = _decorator;

export const SE_DESIGN_W = 1280;
export const SE_DESIGN_H = 720;
export const SE_PANEL_W = 340;
export const SE_TOOLBAR_H = 52;
export const SE_STATUS_H = 36;
export const SE_MARGIN = 14;

/** 左侧预览墙可用矩形（中心坐标 + 宽高） */
export function seWallRect(): { cx: number; cy: number; w: number; h: number } {
    const w = SE_DESIGN_W - SE_PANEL_W - SE_MARGIN * 3;
    const h = SE_DESIGN_H - SE_TOOLBAR_H - SE_STATUS_H - SE_MARGIN * 2;
    const left = -SE_DESIGN_W / 2 + SE_MARGIN;
    const top = SE_DESIGN_H / 2 - SE_TOOLBAR_H - SE_MARGIN;
    return {
        cx: left + w / 2,
        cy: top - h / 2,
        w,
        h,
    };
}

export type SymbolAssetField =
    | 'spineAssetId'
    | 'textureAssetId'
    | 'winCellFxAssetId'
    | 'vanishCellFxAssetId'
    | 'digitFontAssetId';

export type PackFxField = 'win' | 'vanish';

export type PackLayoutField =
    | 'designW'
    | 'designH'
    | 'boardColGap'
    | 'boardRowGap'
    | 'winCellFxScale'
    | 'vanishCellFxScale'
    | 'columnVAlign';

export interface SymbolHudCallbacks {
    onPickSymbol(id: number): void;
    onAddSymbol(): void;
    onRemoveSymbol(): void;
    onCyclePack(dir: 1 | -1): void;
    onExport(): void;
    onImport(): void;
    onOpenBoard(): void;
    onPatchField(key: keyof SymbolDraft, dir: 1 | -1): void;
    onPatchPackLayout(key: PackLayoutField, dir: 1 | -1): void;
    onTogglePackLayoutLock(axis: 'col' | 'row'): void;
    onPickAsset(field: SymbolAssetField, assetId: string): void;
    onPickPackFx(field: PackFxField, assetId: string): void;
    onPickVariantAsset(index: number, assetId: string): void;
    onPreviewAnim(kind: 'idle' | 'enter' | 'win' | 'vanish'): void;
}

@ccclass('SymbolEditorHud')
export class SymbolEditorHud extends Component {
    private callbacks: SymbolHudCallbacks | null = null;
    private statusLabel: Label | null = null;
    private packLabel: Label | null = null;
    private infoLabels = new Map<string, Label>();
    private wallViewport: Node | null = null;
    private wallContent: Node | null = null;
    private basePage: Node | null = null;
    private layoutPage: Node | null = null;
    private variantPage: Node | null = null;
    private variantGrid: Node | null = null;
    private assetSlotsRoot: Node | null = null;
    private packFxSlotsRoot: Node | null = null;
    private inspectorTab: 'base' | 'layout' | 'variants' = 'base';
    private assetsCache: readonly AssetEntry[] = [];
    private packWinFxId = '';
    private packVanishFxId = '';
    private packLayout: PackLayoutConfig | null = null;
    private pickerRoot: Node | null = null;
    /** 当前选中是否 multi（驱动动画区文案 / 素材槽） */
    private selectedIsMulti = false;
    private animSectionTitle: Label | null = null;
    private animRowTitles = new Map<string, Label>();
    private previewBtnLabels = new Map<string, Label>();
    private packFxSectionTitle: Label | null = null;

    init(callbacks: SymbolHudCallbacks, packLabel: string): void {
        this.callbacks = callbacks;
        this.buildToolbar(packLabel);
        this.buildInspector();
        this.buildStatus();
    }

    setStatus(text: string): void {
        if (this.statusLabel) this.statusLabel.string = text;
    }

    setPackLabel(text: string): void {
        if (this.packLabel) this.packLabel.string = text;
    }

    setSelected(id: number | null, draft: SymbolDraft | null, assets: readonly AssetEntry[]): void {
        this.assetsCache = assets;
        this.selectedIsMulti = draft?.kind === SymbolKind.multi;
        this.setInfo('sel', id == null ? '未选' : `#${id}`);
        if (!draft) {
            this.setInfo('name', '—');
            this.setInfo('kind', '—');
            this.setInfo('scaleMul', '—');
            this.setInfo('placeMain', '—');
            this.setInfo('placeTop', '—');
            this.setInfo('idle', '—');
            this.setInfo('enter', '—');
            this.setInfo('win', '—');
            this.setInfo('vanish', '—');
            this.applyKindMode(false);
            this.rebuildPackFxSlots();
            this.rebuildAssetSlots(null);
            this.rebuildVariantGrid(null, assets);
            return;
        }
        this.setInfo('name', draft.name || '(无名)');
        this.setInfo('kind', this.selectedIsMulti ? 'multi' : 'normal');
        this.setInfo('scaleMul', String(draft.scaleMul ?? 1));
        this.setInfo('placeMain', draft.placementMainId || '(无)');
        this.setInfo(
            'placeTop',
            draft.placementTopStripId
                ? `${draft.placementTopStripId}×${draft.placementTopStripCells || 2}`
                : '(无)',
        );
        this.setInfo('idle', draft.idleAnim || '(空)');
        this.setInfo('enter', draft.enterAnim || '(空)');
        this.setInfo(
            'win',
            this.selectedIsMulti
                ? draft.winAnim || '(默认 function)'
                : draft.winAnim || '(空)',
        );
        this.setInfo('vanish', draft.vanishAnim || '(空)');
        this.applyKindMode(this.selectedIsMulti);
        this.rebuildPackFxSlots();
        this.rebuildAssetSlots(draft);
        this.rebuildVariantGrid(draft, assets);
    }

    /** normal ↔ multi：动画标题 / 试播按钮文案 */
    private applyKindMode(isMulti: boolean): void {
        if (this.animSectionTitle) {
            this.animSectionTitle.string = isMulti ? '倍率动画' : '动画';
        }
        if (this.packFxSectionTitle) {
            this.packFxSectionTitle.string = isMulti
                ? '包级通用（倍率球不走高亮）'
                : '包级通用（所有符号）';
        }
        const rowTitles = isMulti
            ? { idle: 'idle', enter: 'enter', win: '收集', vanish: 'vanish' }
            : { idle: 'idle', enter: 'enter', win: 'win', vanish: 'vanish' };
        for (const [key, text] of Object.entries(rowTitles)) {
            const lab = this.animRowTitles.get(key);
            if (lab) lab.string = text;
        }
        const previewTitles = isMulti
            ? { idle: 'idle', enter: 'enter', win: '收集', vanish: 'vanish' }
            : { idle: 'idle', enter: 'enter', win: 'win', vanish: 'vanish' };
        for (const [key, text] of Object.entries(previewTitles)) {
            const lab = this.previewBtnLabels.get(key);
            if (lab) lab.string = text;
        }
    }

    /** 刷新包级通用高亮/消除展示 */
    setPackFx(winAssetId: string, vanishAssetId: string): void {
        this.packWinFxId = winAssetId || '';
        this.packVanishFxId = vanishAssetId || '';
        this.rebuildPackFxSlots();
    }

    /** 刷新包布局页（设计格 / 间距 / FX scale） */
    setPackLayout(layout: PackLayoutConfig | null | undefined): void {
        this.packLayout = layout ?? null;
        if (!layout) {
            for (const key of [
                'designW',
                'designH',
                'boardColGap',
                'boardRowGap',
                'lockCol',
                'lockRow',
                'columnVAlign',
                'winFxScale',
                'vanishFxScale',
            ]) {
                this.setInfo(key, '—');
            }
            return;
        }
        this.setInfo('designW', String(layout.designW));
        this.setInfo('designH', String(layout.designH));
        this.setInfo('boardColGap', String(layout.boardColGap));
        this.setInfo('boardRowGap', String(layout.boardRowGap));
        this.setInfo('lockCol', layout.lockBoardColGap ? '锁定' : '可调');
        this.setInfo('lockRow', layout.lockBoardRowGap ? '锁定' : '可调');
        this.setInfo('columnVAlign', columnVAlignLabel(layout.columnVAlign));
        this.setInfo('winFxScale', String(layout.winCellFxScale));
        this.setInfo('vanishFxScale', String(layout.vanishCellFxScale));
    }

    /** 裁剪视口内的墙根；Main 往 ensureWallRoot 塞格子 */
    ensureWallRoot(): Node {
        if (this.wallContent?.isValid) return this.wallContent;
        const rect = seWallRect();

        const viewport = new Node('WallViewport');
        viewport.addComponent(UITransform).setContentSize(rect.w, rect.h);
        viewport.addComponent(Mask).type = Mask.Type.RECT;
        viewport.setPosition(rect.cx, rect.cy, 0);
        const frame = viewport.addComponent(Graphics);
        frame.strokeColor = new Color(50, 58, 82, 180);
        frame.lineWidth = 1;
        frame.roundRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h, 8);
        frame.stroke();
        this.node.addChild(viewport);
        this.wallViewport = viewport;

        const content = new Node('SymbolWall');
        content.addComponent(UITransform).setContentSize(rect.w, rect.h);
        // 原点放在视口左上内侧，Main 按网格往右下排
        content.setPosition(-rect.w / 2 + 8, rect.h / 2 - 8, 0);
        viewport.addChild(content);
        this.wallContent = content;
        return content;
    }

    wallAreaSize(): { w: number; h: number } {
        const r = seWallRect();
        return { w: r.w - 16, h: r.h - 16 };
    }

    private setInfo(key: string, text: string): void {
        const lab = this.infoLabels.get(key);
        if (lab) lab.string = text;
    }

    private buildToolbar(packLabel: string): void {
        const cb = this.callbacks!;
        const barY = SE_DESIGN_H / 2 - SE_TOOLBAR_H / 2;
        const items: Array<[string, () => void, number]> = [
            ['◀包', () => cb.onCyclePack(-1), 56],
            ['包▶', () => cb.onCyclePack(1), 56],
            ['+符号', () => cb.onAddSymbol(), 70],
            ['−符号', () => cb.onRemoveSymbol(), 70],
            ['导出', () => cb.onExport(), 64],
            ['导入', () => cb.onImport(), 64],
            ['→盘面', () => cb.onOpenBoard(), 72],
        ];
        let x = -SE_DESIGN_W / 2 + SE_MARGIN;
        for (const [text, fn, w] of items) {
            this.node.addChild(this.makeButton(text, fn, new Vec3(x + w / 2, barY, 0), w, 32));
            x += w + 8;
        }
        const pack = new Node('pack');
        pack.addComponent(UITransform).setContentSize(280, 24);
        pack.setPosition(SE_DESIGN_W / 2 - SE_PANEL_W - 160, barY, 0);
        const lab = pack.addComponent(Label);
        lab.string = packLabel;
        lab.fontSize = 14;
        lab.color = new Color(190, 200, 220, 255);
        lab.overflow = Label.Overflow.SHRINK;
        lab.horizontalAlign = Label.HorizontalAlign.RIGHT;
        this.packLabel = lab;
        this.node.addChild(pack);
    }

    private buildStatus(): void {
        const n = new Node('status');
        n.addComponent(UITransform).setContentSize(seWallRect().w, 24);
        n.setPosition(seWallRect().cx, -SE_DESIGN_H / 2 + SE_STATUS_H / 2, 0);
        const lab = n.addComponent(Label);
        lab.fontSize = 14;
        lab.color = new Color(140, 190, 160, 255);
        lab.string = '';
        lab.overflow = Label.Overflow.SHRINK;
        this.statusLabel = lab;
        this.node.addChild(n);
    }

    private buildInspector(): void {
        const cb = this.callbacks!;
        const panel = new Node('Inspector');
        panel.addComponent(UITransform).setContentSize(SE_PANEL_W, SE_DESIGN_H);
        panel.setPosition(SE_DESIGN_W / 2 - SE_PANEL_W / 2, 0, 0);

        const bg = new Node('bg');
        bg.addComponent(UITransform).setContentSize(SE_PANEL_W, SE_DESIGN_H);
        const g = bg.addComponent(Graphics);
        g.fillColor = new Color(18, 22, 36, 250);
        g.rect(-SE_PANEL_W / 2, -SE_DESIGN_H / 2, SE_PANEL_W, SE_DESIGN_H);
        g.fill();
        g.strokeColor = new Color(55, 70, 110, 255);
        g.lineWidth = 1;
        g.moveTo(-SE_PANEL_W / 2, -SE_DESIGN_H / 2);
        g.lineTo(-SE_PANEL_W / 2, SE_DESIGN_H / 2);
        g.stroke();
        panel.addChild(bg);

        const tabY = SE_DESIGN_H / 2 - 28;
        const tabW = 100;
        panel.addChild(this.makeButton('符号', () => this.setInspectorTab('base'), new Vec3(-110, tabY, 0), tabW, 32));
        panel.addChild(this.makeButton('包布局', () => this.setInspectorTab('layout'), new Vec3(0, tabY, 0), tabW, 32));
        panel.addChild(this.makeButton('视觉档', () => this.setInspectorTab('variants'), new Vec3(110, tabY, 0), tabW, 32));

        const basePage = new Node('BasePage');
        basePage.addComponent(UITransform).setContentSize(SE_PANEL_W, SE_DESIGN_H - 56);
        this.basePage = basePage;
        panel.addChild(basePage);

        let y = SE_DESIGN_H / 2 - 58;

        // 选中摘要：一行
        const head = new Node('head');
        head.addComponent(UITransform).setContentSize(SE_PANEL_W - 20, 22);
        head.setPosition(0, y, 0);
        const headLab = head.addComponent(Label);
        headLab.fontSize = 18;
        headLab.color = new Color(230, 235, 245, 255);
        headLab.overflow = Label.Overflow.SHRINK;
        this.infoLabels.set('sel', headLab);
        basePage.addChild(head);
        y -= 22;

        const nameRow = new Node('nameRow');
        nameRow.addComponent(UITransform).setContentSize(SE_PANEL_W - 20, 20);
        nameRow.setPosition(0, y, 0);
        const nameLab = nameRow.addComponent(Label);
        nameLab.fontSize = 16;
        this.infoLabels.set('name', nameLab);
        basePage.addChild(nameRow);
        y -= 24;

        const valueKind = this.addCycleValueRow(
            basePage,
            y,
            '类型',
            () => cb.onPatchField('kind', -1),
            () => cb.onPatchField('kind', 1),
        );
        this.infoLabels.set('kind', valueKind);
        y -= 36;

        const valueScale = this.addCycleValueRow(
            basePage,
            y,
            '缩放',
            () => cb.onPatchField('scaleMul', -1),
            () => cb.onPatchField('scaleMul', 1),
        );
        this.infoLabels.set('scaleMul', valueScale);
        y -= 36;

        const valuePlaceMain = this.addCycleValueRow(
            basePage,
            y,
            '主盘落盘',
            () => cb.onPatchField('placementMainId', -1),
            () => cb.onPatchField('placementMainId', 1),
        );
        this.infoLabels.set('placeMain', valuePlaceMain);
        y -= 36;

        const valuePlaceTop = this.addCycleValueRow(
            basePage,
            y,
            '顶条落盘',
            () => cb.onPatchField('placementTopStripId', -1),
            () => cb.onPatchField('placementTopStripId', 1),
        );
        this.infoLabels.set('placeTop', valuePlaceTop);
        y -= 36;

        y = this.addTitle(basePage, '包级通用（所有符号）', y, (lab) => {
            this.packFxSectionTitle = lab;
        });
        const packSlots = new Node('PackFxSlots');
        packSlots.addComponent(UITransform).setContentSize(SE_PANEL_W - 16, 100);
        packSlots.setPosition(0, y - 48, 0);
        basePage.addChild(packSlots);
        this.packFxSlotsRoot = packSlots;
        y -= 108;

        y = this.addTitle(basePage, '素材（点图更换）', y);
        const slots = new Node('AssetSlots');
        slots.addComponent(UITransform).setContentSize(SE_PANEL_W - 16, 200);
        slots.setPosition(0, y - 96, 0);
        basePage.addChild(slots);
        this.assetSlotsRoot = slots;
        y -= 208;

        y = this.addTitle(basePage, '动画', y, (lab) => {
            this.animSectionTitle = lab;
        });
        for (const [key, label] of [
            ['idle', 'idle'],
            ['enter', 'enter'],
            ['win', 'win'],
            ['vanish', 'vanish'],
        ] as const) {
            const valueLab = this.addCycleValueRow(
                basePage,
                y,
                label,
                () => cb.onPatchField(`${key}Anim` as keyof SymbolDraft, -1),
                () => cb.onPatchField(`${key}Anim` as keyof SymbolDraft, 1),
                (titleLab) => this.animRowTitles.set(key, titleLab),
            );
            this.infoLabels.set(key, valueLab);
            y -= 36;
        }

        y -= 6;
        y = this.addTitle(basePage, '试播', y);
        const kinds: Array<[string, 'idle' | 'enter' | 'win' | 'vanish']> = [
            ['idle', 'idle'],
            ['enter', 'enter'],
            ['win', 'win'],
            ['vanish', 'vanish'],
        ];
        let px = -SE_PANEL_W / 2 + 46;
        for (const [text, kind] of kinds) {
            const btn = this.makeButton(text, () => cb.onPreviewAnim(kind), new Vec3(px, y - 8, 0), 68, 30);
            const lab = btn.getChildByName('lab')?.getComponent(Label);
            if (lab) this.previewBtnLabels.set(kind, lab);
            basePage.addChild(btn);
            px += 76;
        }

        const layoutPage = new Node('LayoutPage');
        layoutPage.addComponent(UITransform).setContentSize(SE_PANEL_W, SE_DESIGN_H - 56);
        this.layoutPage = layoutPage;
        panel.addChild(layoutPage);
        this.buildLayoutPage(layoutPage);

        const variantPage = new Node('VariantPage');
        variantPage.addComponent(UITransform).setContentSize(SE_PANEL_W, SE_DESIGN_H - 56);
        this.variantPage = variantPage;
        const variantGrid = new Node('VariantGrid');
        variantGrid.addComponent(UITransform);
        variantPage.addChild(variantGrid);
        this.variantGrid = variantGrid;
        panel.addChild(variantPage);

        this.setInspectorTab('base');
        this.node.addChild(panel);
    }

    private buildLayoutPage(page: Node): void {
        const cb = this.callbacks!;
        let y = SE_DESIGN_H / 2 - 70;
        y = this.addTitle(page, '设计格（盘面中心 pitch）', y);

        const designW = this.addCycleValueRow(
            page,
            y,
            '格宽',
            () => cb.onPatchPackLayout('designW', -1),
            () => cb.onPatchPackLayout('designW', 1),
        );
        this.infoLabels.set('designW', designW);
        y -= 36;

        const designH = this.addCycleValueRow(
            page,
            y,
            '格高',
            () => cb.onPatchPackLayout('designH', -1),
            () => cb.onPatchPackLayout('designH', 1),
        );
        this.infoLabels.set('designH', designH);
        y -= 40;

        y = this.addTitle(page, '盘面间距（BoardEditor 同步）', y);
        const colGap = this.addCycleValueRow(
            page,
            y,
            '列距',
            () => cb.onPatchPackLayout('boardColGap', -1),
            () => cb.onPatchPackLayout('boardColGap', 1),
        );
        this.infoLabels.set('boardColGap', colGap);
        y -= 36;

        const rowGap = this.addCycleValueRow(
            page,
            y,
            '行距',
            () => cb.onPatchPackLayout('boardRowGap', -1),
            () => cb.onPatchPackLayout('boardRowGap', 1),
        );
        this.infoLabels.set('boardRowGap', rowGap);
        y -= 36;

        const lockCol = this.addCycleValueRow(
            page,
            y,
            '列锁',
            () => cb.onTogglePackLayoutLock('col'),
            () => cb.onTogglePackLayoutLock('col'),
        );
        this.infoLabels.set('lockCol', lockCol);
        y -= 36;

        const lockRow = this.addCycleValueRow(
            page,
            y,
            '行锁',
            () => cb.onTogglePackLayoutLock('row'),
            () => cb.onTogglePackLayoutLock('row'),
        );
        this.infoLabels.set('lockRow', lockRow);
        y -= 40;

        y = this.addTitle(page, '不等高列对齐', y);
        const valign = this.addCycleValueRow(
            page,
            y,
            '对齐',
            () => cb.onPatchPackLayout('columnVAlign', -1),
            () => cb.onPatchPackLayout('columnVAlign', 1),
        );
        this.infoLabels.set('columnVAlign', valign);
        y -= 40;

        y = this.addTitle(page, '包级格子 FX scale', y);
        const winScale = this.addCycleValueRow(
            page,
            y,
            '高亮',
            () => cb.onPatchPackLayout('winCellFxScale', -1),
            () => cb.onPatchPackLayout('winCellFxScale', 1),
        );
        this.infoLabels.set('winFxScale', winScale);
        y -= 36;

        const vanishScale = this.addCycleValueRow(
            page,
            y,
            '消除',
            () => cb.onPatchPackLayout('vanishCellFxScale', -1),
            () => cb.onPatchPackLayout('vanishCellFxScale', 1),
        );
        this.infoLabels.set('vanishFxScale', vanishScale);
        y -= 40;

        const hint = new Node('hint');
        hint.addComponent(UITransform).setContentSize(SE_PANEL_W - 24, 80);
        hint.setPosition(0, y - 20, 0);
        const hintLab = hint.addComponent(Label);
        hintLab.string =
            '原 Creator Inspector 配置已废弃。\n此处改动写入 symbol-sheet 草稿，\n盘面编辑器自动叠加。';
        hintLab.fontSize = 13;
        hintLab.lineHeight = 18;
        hintLab.color = new Color(140, 155, 180, 255);
        hintLab.overflow = Label.Overflow.RESIZE_HEIGHT;
        page.addChild(hint);
    }

    private setInspectorTab(tab: 'base' | 'layout' | 'variants'): void {
        this.inspectorTab = tab;
        if (this.basePage) this.basePage.active = tab === 'base';
        if (this.layoutPage) this.layoutPage.active = tab === 'layout';
        if (this.variantPage) this.variantPage.active = tab === 'variants';
    }

    private rebuildPackFxSlots(): void {
        const root = this.packFxSlotsRoot;
        if (!root) return;
        root.removeAllChildren();
        const cardW = 150;
        const cardH = 88;
        const gapX = 10;
        // multi 不走中奖高亮：只展示通用消除；normal 展示高亮+消除
        const slots: Array<{ title: string; field: PackFxField; id: string }> = this.selectedIsMulti
            ? [{ title: '通用消除', field: 'vanish', id: this.packVanishFxId }]
            : [
                  { title: '通用高亮', field: 'win', id: this.packWinFxId },
                  { title: '通用消除', field: 'vanish', id: this.packVanishFxId },
              ];
        slots.forEach((slot, i) => {
            const x =
                slots.length === 1 ? 0 : (i - 0.5) * (cardW + gapX);
            root.addChild(
                this.makeAssetCard(
                    {
                        title: slot.title,
                        field: slot.field === 'win' ? 'winCellFxAssetId' : 'vanishCellFxAssetId',
                        kinds: [AssetKind.effect, AssetKind.spine],
                        id: slot.id,
                        packField: slot.field,
                    },
                    x,
                    0,
                    cardW,
                    cardH,
                ),
            );
        });
    }

    private rebuildAssetSlots(draft: SymbolDraft | null): void {
        const root = this.assetSlotsRoot;
        if (!root) return;
        root.removeAllChildren();

        const packWinName = this.assetName(this.packWinFxId);
        const packVanishName = this.assetName(this.packVanishFxId);
        const isMulti = draft?.kind === SymbolKind.multi;
        const slots: Array<{
            title: string;
            field: SymbolAssetField;
            kinds: AssetPickKinds;
            id: string;
            emptyHint?: string;
        }> = [
            { title: '纹理', field: 'textureAssetId', kinds: AssetKind.texture, id: draft?.textureAssetId || '' },
            { title: 'Spine', field: 'spineAssetId', kinds: AssetKind.spine, id: draft?.spineAssetId || '' },
        ];
        if (isMulti) {
            slots.push({
                title: '倍数字体',
                field: 'digitFontAssetId',
                kinds: AssetKind.font,
                id: draft?.digitFontAssetId || '',
                emptyHint: '(用包级字体)',
            });
            slots.push({
                title: '符号消除',
                field: 'vanishCellFxAssetId',
                kinds: [AssetKind.effect, AssetKind.spine],
                id: draft?.vanishCellFxAssetId || '',
                emptyHint: packVanishName ? `→${packVanishName}` : '(用包级)',
            });
        } else {
            slots.push({
                title: '符号中奖',
                field: 'winCellFxAssetId',
                kinds: [AssetKind.effect, AssetKind.spine],
                id: draft?.winCellFxAssetId || '',
                emptyHint: packWinName ? `→${packWinName}` : '(用包级)',
            });
            slots.push({
                title: '符号消除',
                field: 'vanishCellFxAssetId',
                kinds: [AssetKind.effect, AssetKind.spine],
                id: draft?.vanishCellFxAssetId || '',
                emptyHint: packVanishName ? `→${packVanishName}` : '(用包级)',
            });
        }

        const cardW = 150;
        const cardH = 88;
        const gapX = 10;
        const gapY = 10;
        slots.forEach((slot, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = (col - 0.5) * (cardW + gapX);
            const y = (0.5 - row) * (cardH + gapY);
            root.addChild(this.makeAssetCard(slot, x, y, cardW, cardH));
        });
    }

    private assetName(id: string): string {
        if (!id) return '';
        const a = this.assetsCache.find((x) => x.id === id);
        return a ? short(assetLabel(a), 10) : '';
    }

    private makeAssetCard(
        slot: {
            title: string;
            field: SymbolAssetField;
            kinds: AssetPickKinds;
            id: string;
            emptyHint?: string;
            packField?: PackFxField;
        },
        x: number,
        y: number,
        w: number,
        h: number,
    ): Node {
        const card = new Node(`slot_${slot.packField ? `pack_${slot.packField}` : slot.field}`);
        card.addComponent(UITransform).setContentSize(w, h);
        card.setPosition(x, y, 0);
        const bg = card.addComponent(Graphics);
        bg.fillColor = slot.packField ? new Color(36, 48, 72, 255) : new Color(30, 36, 54, 255);
        bg.roundRect(-w / 2, -h / 2, w, h, 8);
        bg.fill();
        bg.strokeColor = slot.packField ? new Color(120, 160, 220, 255) : new Color(70, 90, 130, 255);
        bg.lineWidth = 1;
        bg.roundRect(-w / 2, -h / 2, w, h, 8);
        bg.stroke();

        const thumbSize = 48;
        const thumb = new Node('thumb');
        thumb.addComponent(UITransform).setContentSize(thumbSize, thumbSize);
        thumb.addComponent(Mask).type = Mask.Type.RECT;
        thumb.setPosition(0, 10, 0);
        const tbg = new Node('tbg');
        tbg.addComponent(UITransform).setContentSize(thumbSize, thumbSize);
        const tg = tbg.addComponent(Graphics);
        tg.fillColor = new Color(16, 20, 32, 255);
        tg.roundRect(-thumbSize / 2, -thumbSize / 2, thumbSize, thumbSize, 6);
        tg.fill();
        thumb.addChild(tbg);
        const asset = this.assetsCache.find((a) => a.id === slot.id) ?? null;
        fillMiniPreview(thumb, asset, thumbSize - 6);
        card.addChild(thumb);

        const title = new Node('title');
        title.addComponent(UITransform).setContentSize(w - 8, 16);
        title.setPosition(0, -h / 2 + 26, 0);
        const titleLab = title.addComponent(Label);
        titleLab.string = slot.title;
        titleLab.fontSize = 12;
        titleLab.color = new Color(140, 165, 210, 255);
        card.addChild(title);

        const name = new Node('name');
        name.addComponent(UITransform).setContentSize(w - 10, 16);
        name.setPosition(0, -h / 2 + 10, 0);
        const nameLab = name.addComponent(Label);
        nameLab.string = asset
            ? short(assetLabel(asset), 12)
            : slot.emptyHint || '(无)';
        nameLab.fontSize = 12;
        nameLab.overflow = Label.Overflow.SHRINK;
        nameLab.color = asset ? new Color(230, 235, 245, 255) : new Color(160, 170, 190, 255);
        card.addChild(name);

        const open = (): void => {
            this.openPicker(`选择${slot.title}`, slot.kinds, slot.id, (assetId) => {
                if (slot.packField) {
                    this.callbacks?.onPickPackFx(slot.packField, assetId);
                } else {
                    this.callbacks?.onPickAsset(slot.field, assetId);
                }
            });
        };
        card.on(Node.EventType.TOUCH_END, open);
        return card;
    }

    private openPicker(
        title: string,
        kinds: AssetPickKinds,
        selectedId: string,
        onPick: (assetId: string) => void,
    ): void {
        if (this.pickerRoot?.isValid) {
            this.pickerRoot.destroy();
            this.pickerRoot = null;
        }
        this.pickerRoot = openAssetPicker(this.node, {
            title,
            assets: this.assetsCache,
            kinds,
            selectedId,
            allowEmpty: true,
            onPick: (id) => {
                onPick(id);
                this.pickerRoot = null;
            },
            onClose: () => {
                this.pickerRoot = null;
            },
        });
    }

    private rebuildVariantGrid(draft: SymbolDraft | null, assets: readonly AssetEntry[]): void {
        const root = this.variantGrid;
        if (!root) return;
        root.removeAllChildren();

        const title = new Node('title');
        title.addComponent(UITransform).setContentSize(SE_PANEL_W - 20, 24);
        title.setPosition(0, SE_DESIGN_H / 2 - 70, 0);
        const titleLabel = title.addComponent(Label);
        titleLabel.string = draft
            ? `#${draft.id} ${draft.name} · ${draft.visualVariants?.length ?? 0} 档`
            : '未选择符号';
        titleLabel.fontSize = 15;
        titleLabel.color = new Color(140, 180, 255, 255);
        root.addChild(title);

        const variants = draft?.visualVariants ?? [];
        if (!variants.length) {
            const empty = new Node('empty');
            empty.addComponent(UITransform).setContentSize(SE_PANEL_W - 30, 60);
            empty.setPosition(0, 80, 0);
            const label = empty.addComponent(Label);
            label.string = '无视觉变体\n使用基础纹理 / Spine';
            label.fontSize = 15;
            label.lineHeight = 22;
            label.color = new Color(160, 168, 185, 255);
            root.addChild(empty);
            return;
        }

        const textures = new Map(
            assets.filter((a) => a.kind === AssetKind.texture).map((a) => [a.id, a.texture] as const),
        );
        const cardW = 148;
        const cardH = 150;
        const startY = SE_DESIGN_H / 2 - 170;
        variants.forEach((variant, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const card = new Node(`variant_${variant.key || index}`);
            card.addComponent(UITransform).setContentSize(cardW, cardH);
            card.setPosition((col - 0.5) * (cardW + 12), startY - row * (cardH + 12), 0);

            const cardBg = card.addComponent(Graphics);
            cardBg.fillColor = new Color(30, 36, 54, 255);
            cardBg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 8);
            cardBg.fill();

            const previewHost = new Node('previewHost');
            previewHost.addComponent(UITransform).setContentSize(120, 100);
            previewHost.addComponent(Mask).type = Mask.Type.RECT;
            previewHost.setPosition(0, 14, 0);
            card.addChild(previewHost);

            const frame = textures.get(variant.textureAssetId) ?? null;
            if (frame) {
                const preview = new Node('preview');
                const size = frame.originalSize;
                preview.addComponent(UITransform).setContentSize(size.width, size.height);
                const sprite = preview.addComponent(Sprite);
                sprite.spriteFrame = frame;
                sprite.trim = false;
                sprite.sizeMode = Sprite.SizeMode.CUSTOM;
                const scale = Math.min(110 / Math.max(1, size.width), 90 / Math.max(1, size.height));
                preview.setScale(scale, scale, 1);
                previewHost.addChild(preview);
            } else {
                const el = previewHost.addComponent(Label);
                el.string = '点选';
                el.fontSize = 14;
                el.color = new Color(150, 160, 180, 255);
            }

            const keyNode = new Node('key');
            keyNode.addComponent(UITransform).setContentSize(cardW - 8, 16);
            keyNode.setPosition(0, -cardH / 2 + 28, 0);
            const keyLabel = keyNode.addComponent(Label);
            keyLabel.string = `${variant.key} · ${variant.label}`;
            keyLabel.fontSize = 11;
            keyLabel.overflow = Label.Overflow.SHRINK;
            keyLabel.color = new Color(235, 215, 150, 255);
            card.addChild(keyNode);

            const assetNode = new Node('asset');
            assetNode.addComponent(UITransform).setContentSize(cardW - 10, 14);
            assetNode.setPosition(0, -cardH / 2 + 12, 0);
            const assetLab = assetNode.addComponent(Label);
            assetLab.string = short(variant.textureAssetId || '(无)', 16);
            assetLab.fontSize = 10;
            assetLab.overflow = Label.Overflow.SHRINK;
            assetLab.color = new Color(160, 170, 195, 255);
            card.addChild(assetNode);

            card.on(Node.EventType.TOUCH_END, () => {
                this.openPicker(`变体 ${variant.key}`, AssetKind.texture, variant.textureAssetId, (assetId) => {
                    this.callbacks?.onPickVariantAsset(index, assetId);
                });
            });
            root.addChild(card);
        });
    }

    private addTitle(
        parent: Node,
        text: string,
        y: number,
        onLab?: (lab: Label) => void,
    ): number {
        const n = new Node('t');
        n.addComponent(UITransform).setContentSize(SE_PANEL_W - 20, 20);
        const lab = n.addComponent(Label);
        lab.string = text;
        lab.fontSize = 14;
        lab.color = new Color(130, 170, 240, 255);
        n.setPosition(0, y, 0);
        parent.addChild(n);
        onLab?.(lab);
        return y - 22;
    }

    private addInfo(parent: Node, y: number, width: number): Label {
        const n = new Node('info');
        n.addComponent(UITransform).setContentSize(width, 22);
        const lab = n.addComponent(Label);
        lab.fontSize = 16;
        lab.overflow = Label.Overflow.SHRINK;
        lab.horizontalAlign = Label.HorizontalAlign.LEFT;
        lab.color = new Color(230, 235, 245, 255);
        lab.string = '—';
        n.setPosition(20, y, 0);
        parent.addChild(n);
        return lab;
    }

    /**
     * 一行：左侧标题 + 中间大号当前值 + 右侧 ◀▶
     * 避免把值塞进两个箭头中间导致 Overflow.SHRINK 缩成蚂蚁字。
     */
    private addCycleValueRow(
        parent: Node,
        y: number,
        title: string,
        onPrev: () => void,
        onNext: () => void,
        onTitleLab?: (lab: Label) => void,
    ): Label {
        const rowH = 32;
        const titleW = 64;
        const btnW = 36;
        const gap = 6;
        const left = -SE_PANEL_W / 2 + 12;
        const right = SE_PANEL_W / 2 - 12;

        const t = new Node('rowt');
        t.addComponent(UITransform).setContentSize(titleW, rowH);
        t.setPosition(left + titleW / 2, y, 0);
        const tLab = t.addComponent(Label);
        tLab.string = title;
        tLab.fontSize = 16;
        tLab.horizontalAlign = Label.HorizontalAlign.LEFT;
        tLab.verticalAlign = Label.VerticalAlign.CENTER;
        tLab.color = new Color(160, 175, 200, 255);
        parent.addChild(t);
        onTitleLab?.(tLab);

        parent.addChild(this.makeButton('▶', onNext, new Vec3(right - btnW / 2, y, 0), btnW, rowH));
        parent.addChild(this.makeButton('◀', onPrev, new Vec3(right - btnW - gap - btnW / 2, y, 0), btnW, rowH));

        const valueLeft = left + titleW + 8;
        const valueRight = right - btnW * 2 - gap * 2 - 4;
        const valueW = Math.max(80, valueRight - valueLeft);
        const value = new Node('value');
        value.addComponent(UITransform).setContentSize(valueW, rowH);
        value.setPosition(valueLeft + valueW / 2, y, 0);
        const vLab = value.addComponent(Label);
        vLab.string = '—';
        vLab.fontSize = 18;
        vLab.lineHeight = 22;
        vLab.overflow = Label.Overflow.CLAMP;
        vLab.horizontalAlign = Label.HorizontalAlign.LEFT;
        vLab.verticalAlign = Label.VerticalAlign.CENTER;
        vLab.color = new Color(255, 230, 150, 255);
        parent.addChild(value);
        return vLab;
    }

    private addRow(parent: Node, y: number, title: string, onPrev: () => void, onNext: () => void): number {
        const t = new Node('rowt');
        t.addComponent(UITransform);
        const lab = t.addComponent(Label);
        lab.string = title;
        lab.fontSize = 15;
        lab.color = new Color(150, 160, 180, 255);
        t.setPosition(-SE_PANEL_W / 2 + 42, y, 0);
        parent.addChild(t);
        parent.addChild(this.makeButton('◀', onPrev, new Vec3(SE_PANEL_W / 2 - 66, y, 0), 34, 28));
        parent.addChild(this.makeButton('▶', onNext, new Vec3(SE_PANEL_W / 2 - 28, y, 0), 34, 28));
        return y - 18;
    }

    private makeButton(text: string, onClick: () => void, pos: Vec3, w: number, h = 34): Node {
        const n = new Node(`btn_${text}`);
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(pos);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(42, 52, 84, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 6);
        g.fill();
        const labN = new Node('lab');
        labN.addComponent(UITransform);
        const lab = labN.addComponent(Label);
        lab.string = text;
        lab.fontSize = 15;
        lab.color = Color.WHITE;
        n.addChild(labN);
        n.on(Node.EventType.TOUCH_END, () => onClick());
        return n;
    }
}

function short(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fillMiniPreview(host: Node, asset: AssetEntry | null, box: number): void {
    if (!asset) {
        const labN = new Node('empty');
        labN.addComponent(UITransform).setContentSize(box, 18);
        const lab = labN.addComponent(Label);
        lab.string = '无';
        lab.fontSize = 14;
        lab.color = new Color(110, 120, 140, 255);
        host.addChild(labN);
        return;
    }
    if (asset.kind === AssetKind.texture && asset.texture) {
        const n = new Node('tex');
        const size = asset.texture.originalSize;
        const ow = Math.max(1, size.width);
        const oh = Math.max(1, size.height);
        n.addComponent(UITransform).setContentSize(ow, oh);
        const sprite = n.addComponent(Sprite);
        sprite.spriteFrame = asset.texture;
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const scale = Math.min(box / ow, box / oh);
        n.setScale(scale, scale, 1);
        host.addChild(n);
        return;
    }
    if ((asset.kind === AssetKind.spine || asset.kind === AssetKind.effect) && asset.spine) {
        const n = new Node('spine');
        n.addComponent(UITransform);
        const sk = n.addComponent(sp.Skeleton);
        sk.skeletonData = asset.spine;
        sk.premultipliedAlpha = false;
        if (asset.defaultAnim) {
            try {
                sk.setAnimation(0, asset.defaultAnim, true);
            } catch {
                /* ignore */
            }
        }
        n.setScale(0.16, 0.16, 1);
        host.addChild(n);
        return;
    }
    const labN = new Node('kind');
    labN.addComponent(UITransform).setContentSize(box, 18);
    const lab = labN.addComponent(Label);
    lab.string = asset.kind === AssetKind.effect ? 'FX' : 'SP';
    lab.fontSize = 14;
    lab.color = new Color(120, 170, 255, 255);
    host.addChild(labN);
}
