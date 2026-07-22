/**
 * SymbolAssetPicker — 所见即所得素材选择浮层。
 * 纹理显示缩略图；spine / effect 播默认动画预览；点选即回写。
 */

import {
    Color,
    EventMouse,
    EventTouch,
    Graphics,
    Label,
    Mask,
    Node,
    Sprite,
    UITransform,
    Vec3,
    sp,
} from 'cc';
import { AssetEntry, AssetKind, assetLabel } from './AssetDefs';

export type AssetPickKinds = AssetKind | readonly AssetKind[];

export interface AssetPickerOptions {
    title: string;
    assets: readonly AssetEntry[];
    kinds: AssetPickKinds;
    selectedId: string;
    allowEmpty?: boolean;
    onPick: (assetId: string) => void;
    onClose: () => void;
}

const PANEL_W = 860;
const PANEL_H = 560;
const CELL = 108;
const GAP = 10;
const PER_ROW = 7;
const VIEW_H = 450;

export function openAssetPicker(host: Node, opts: AssetPickerOptions): Node {
    const root = new Node('AssetPicker');
    root.addComponent(UITransform).setContentSize(1280, 720);
    root.setPosition(0, 0, 0);
    host.addChild(root);

    const dim = new Node('dim');
    dim.addComponent(UITransform).setContentSize(1280, 720);
    const dimG = dim.addComponent(Graphics);
    dimG.fillColor = new Color(0, 0, 0, 170);
    dimG.rect(-640, -360, 1280, 720);
    dimG.fill();
    dim.on(Node.EventType.TOUCH_END, () => {
        opts.onClose();
        root.destroy();
    });
    root.addChild(dim);

    const panel = new Node('panel');
    panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
    panel.setPosition(-40, 10, 0);
    const bg = panel.addComponent(Graphics);
    bg.fillColor = new Color(24, 28, 46, 255);
    bg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 12);
    bg.fill();
    bg.strokeColor = new Color(90, 120, 190, 255);
    bg.lineWidth = 2;
    bg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 12);
    bg.stroke();
    // 吞掉点击，避免点到 dim 关闭
    panel.on(Node.EventType.TOUCH_END, () => undefined);
    root.addChild(panel);

    const title = makeLabel(panel, opts.title, 0, PANEL_H / 2 - 28, 22, new Color(235, 215, 150, 255), PANEL_W - 40);
    title.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;

    makeButton(panel, '关闭', () => {
        opts.onClose();
        root.destroy();
    }, new Vec3(PANEL_W / 2 - 50, PANEL_H / 2 - 28, 0), 80);

    if (opts.allowEmpty !== false) {
        makeButton(panel, '清除(无)', () => {
            opts.onPick('');
            root.destroy();
        }, new Vec3(PANEL_W / 2 - 150, PANEL_H / 2 - 28, 0), 110);
    }

    const kinds = normalizeKinds(opts.kinds);
    const list = opts.assets.filter((a) => kinds.includes(a.kind));
    const hint = makeLabel(
        panel,
        list.length ? `共 ${list.length} 项 · 点选即应用 · 滚轮浏览` : '素材库里没有这类资源',
        0,
        PANEL_H / 2 - 56,
        14,
        new Color(150, 165, 195, 255),
        PANEL_W - 40,
    );
    hint.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;

    const viewport = new Node('Viewport');
    viewport.addComponent(UITransform).setContentSize(PANEL_W - 36, VIEW_H);
    viewport.addComponent(Mask).type = Mask.Type.RECT;
    viewport.setPosition(0, -20, 0);
    panel.addChild(viewport);

    const content = new Node('Content');
    const contentUi = content.addComponent(UITransform);
    contentUi.setAnchorPoint(0.5, 1);
    content.setPosition(0, VIEW_H / 2, 0);
    viewport.addChild(content);

    const rows = Math.max(1, Math.ceil(list.length / PER_ROW));
    const contentH = Math.max(VIEW_H, rows * (CELL + GAP) + 16);
    contentUi.setContentSize(PANEL_W - 36, contentH);

    list.forEach((asset, i) => {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        const x = (col - (PER_ROW - 1) / 2) * (CELL + GAP);
        const y = -CELL / 2 - 8 - row * (CELL + GAP);
        content.addChild(makeThumb(asset, opts.selectedId === asset.id, x, y, () => {
            opts.onPick(asset.id);
            root.destroy();
        }));
    });

    let scrollY = 0;
    const maxScroll = Math.max(0, contentH - VIEW_H);
    const applyScroll = (next: number): void => {
        scrollY = Math.max(0, Math.min(maxScroll, next));
        content.setPosition(0, VIEW_H / 2 + scrollY, 0);
    };
    viewport.on(Node.EventType.MOUSE_WHEEL, (e: EventMouse) => {
        applyScroll(scrollY - e.getScrollY() * 0.4);
    });
    viewport.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
        applyScroll(scrollY + e.getDeltaY());
    });

    return root;
}

function normalizeKinds(kinds: AssetPickKinds): AssetKind[] {
    return Array.isArray(kinds) ? [...kinds] : [kinds];
}

function makeThumb(asset: AssetEntry, selected: boolean, x: number, y: number, onPick: () => void): Node {
    const cell = new Node(`pick_${asset.id}`);
    cell.addComponent(UITransform).setContentSize(CELL, CELL);
    cell.setPosition(x, y, 0);

    const bg = cell.addComponent(Graphics);
    bg.fillColor = selected ? new Color(55, 70, 40, 255) : new Color(36, 42, 64, 255);
    bg.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 8);
    bg.fill();
    if (selected) {
        bg.strokeColor = new Color(255, 210, 70, 255);
        bg.lineWidth = 3;
        bg.roundRect(-CELL / 2, -CELL / 2, CELL, CELL, 8);
        bg.stroke();
    }

    const preview = new Node('preview');
    preview.addComponent(UITransform).setContentSize(CELL - 10, CELL - 28);
    preview.addComponent(Mask).type = Mask.Type.RECT;
    preview.setPosition(0, 8, 0);
    cell.addChild(preview);
    fillPreview(preview, asset);

    const name = makeLabel(
        cell,
        shortName(asset),
        0,
        -CELL / 2 + 12,
        12,
        new Color(220, 225, 235, 255),
        CELL - 8,
    );
    name.getComponent(Label)!.overflow = Label.Overflow.SHRINK;

    cell.on(Node.EventType.TOUCH_END, onPick);
    return cell;
}

function fillPreview(host: Node, asset: AssetEntry): void {
    if (asset.kind === AssetKind.texture && asset.texture) {
        const n = new Node('tex');
        const size = asset.texture.originalSize;
        n.addComponent(UITransform).setContentSize(size.width, size.height);
        const sprite = n.addComponent(Sprite);
        sprite.spriteFrame = asset.texture;
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const box = 84;
        const scale = Math.min(box / Math.max(1, size.width), box / Math.max(1, size.height));
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
        const anim = asset.defaultAnim || firstAnim(asset.spine);
        if (anim) {
            try {
                sk.setAnimation(0, anim, true);
            } catch {
                /* ignore */
            }
        }
        n.setScale(0.28, 0.28, 1);
        host.addChild(n);
        return;
    }
    const fallback = makeLabel(host, kindTag(asset.kind), 0, 0, 20, new Color(120, 170, 255, 255), 80);
    fallback.getComponent(Label)!.horizontalAlign = Label.HorizontalAlign.CENTER;
}

function firstAnim(data: sp.SkeletonData): string {
    try {
        const en = data.getAnimsEnum() as Record<string, number>;
        return Object.keys(en).find((k) => k !== '<None>') || '';
    } catch {
        return '';
    }
}

function shortName(asset: AssetEntry): string {
    const raw = assetLabel(asset);
    return raw.length > 14 ? `${raw.slice(0, 12)}…` : raw;
}

function kindTag(k: AssetKind): string {
    switch (k) {
        case AssetKind.texture:
            return 'TEX';
        case AssetKind.spine:
            return 'SPN';
        case AssetKind.effect:
            return 'FX';
        case AssetKind.prefab:
            return 'PFB';
        default:
            return '?';
    }
}

function makeLabel(
    parent: Node,
    text: string,
    x: number,
    y: number,
    size: number,
    color: Color,
    width: number,
): Node {
    const n = new Node('lab');
    n.addComponent(UITransform).setContentSize(width, size + 8);
    n.setPosition(x, y, 0);
    const lab = n.addComponent(Label);
    lab.string = text;
    lab.fontSize = size;
    lab.lineHeight = size + 4;
    lab.color = color;
    lab.overflow = Label.Overflow.SHRINK;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    parent.addChild(n);
    return n;
}

function makeButton(parent: Node, text: string, onClick: () => void, pos: Vec3, w: number): Node {
    const n = new Node(`btn_${text}`);
    n.addComponent(UITransform).setContentSize(w, 32);
    n.setPosition(pos);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(50, 62, 100, 255);
    g.roundRect(-w / 2, -16, w, 32, 6);
    g.fill();
    const labN = new Node('lab');
    labN.addComponent(UITransform);
    const lab = labN.addComponent(Label);
    lab.string = text;
    lab.fontSize = 15;
    lab.color = Color.WHITE;
    n.addChild(labN);
    n.on(Node.EventType.TOUCH_END, onClick);
    parent.addChild(n);
    return n;
}
