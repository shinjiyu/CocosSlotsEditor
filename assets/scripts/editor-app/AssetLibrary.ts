/**
 * AssetLibrary — 素材库（编辑器最小单位）。
 *
 * 用法：双击 packs/<packId>/asset-library.prefab → Inspector 登记纹理/spine/音频等。
 * 符号表只引用 AssetEntry.id；盘面编辑器只消费已解析的符号。
 */

import { _decorator, CCObject, Color, Component, Graphics, Label, Node, RenderRoot2D, Sprite, UITransform, sp } from 'cc';
import { EDITOR } from 'cc/env';
import { AssetEntry, AssetKind, type AssetProvider } from './AssetDefs';

const { ccclass, property, executeInEditMode } = _decorator;

const PREVIEW_NODE = '__asset_preview__';
const PREVIEW_PER_ROW = 6;
const CELL = 120;
const GAP = 20;

@ccclass('AssetLibrary')
@executeInEditMode
export class AssetLibrary extends Component implements AssetProvider {
    @property({ type: [AssetEntry], tooltip: '素材条目：+/− 增删，拖入对应类型资源' })
    assets: AssetEntry[] = [];

    getAsset(id: string): AssetEntry | null {
        if (!id) return null;
        return this.assets.find((a) => a.id === id) ?? null;
    }

    // ------------------------------------------------------------------
    // 编辑期素材墙
    // ------------------------------------------------------------------

    onLoad(): void {
        if (EDITOR) this.rebuildPreview();
    }

    onEnable(): void {
        if (EDITOR) this.rebuildPreview();
    }

    update(): void {
        if (!EDITOR) return;
        // 属性变更时轻量刷新标签（全量重建成本高，仅在条目数变化时重建）
        const root = this.node.getChildByName(PREVIEW_NODE);
        if (!root || root.children.length !== this.assets.length) {
            this.rebuildPreview();
        }
    }

    private rebuildPreview(): void {
        let root = this.node.getChildByName(PREVIEW_NODE);
        if (root) root.destroy();
        root = new Node(PREVIEW_NODE);
        root.hideFlags |= CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        if (!this.node.getComponent(RenderRoot2D) && !this.node.getComponent(UITransform)) {
            // prefab 舞台无 Canvas 时保证 2D 可画
            this.node.addComponent(UITransform);
        }
        if (!this.getComponent(RenderRoot2D) && !this.node.parent?.getComponent(RenderRoot2D)) {
            root.addComponent(RenderRoot2D);
        }
        this.node.addChild(root);

        for (let i = 0; i < this.assets.length; i++) {
            const e = this.assets[i]!;
            const cell = new Node(e.id || `asset_${i}`);
            cell.addComponent(UITransform).setContentSize(CELL, CELL);
            const col = i % PREVIEW_PER_ROW;
            const row = Math.floor(i / PREVIEW_PER_ROW);
            cell.setPosition(col * (CELL + GAP), -row * (CELL + GAP), 0);

            const bg = new Node('bg');
            bg.addComponent(UITransform).setContentSize(CELL, CELL);
            const g = bg.addComponent(Graphics);
            g.fillColor = new Color(40, 44, 52, 255);
            g.rect(-CELL / 2, -CELL / 2, CELL, CELL);
            g.fill();
            cell.addChild(bg);

            this.fillThumb(cell, e);

            const lab = new Node('label');
            lab.addComponent(UITransform).setContentSize(CELL, 24);
            lab.setPosition(0, -CELL / 2 - 12, 0);
            const label = lab.addComponent(Label);
            label.string = `${kindTag(e.kind)} ${e.id || e.name || i}`;
            label.fontSize = 14;
            label.lineHeight = 16;
            label.overflow = Label.Overflow.SHRINK;
            label.color = new Color(200, 200, 210, 255);
            cell.addChild(lab);

            root.addChild(cell);
        }
    }

    private fillThumb(cell: Node, e: AssetEntry): void {
        if (e.kind === AssetKind.texture && e.texture) {
            const n = new Node('tex');
            n.addComponent(UITransform).setContentSize(CELL - 16, CELL - 16);
            const spri = n.addComponent(Sprite);
            spri.spriteFrame = e.texture;
            spri.sizeMode = Sprite.SizeMode.RAW;
            cell.addChild(n);
            return;
        }
        if ((e.kind === AssetKind.spine || e.kind === AssetKind.effect) && e.spine) {
            const n = new Node('spine');
            n.addComponent(UITransform);
            const sk = n.addComponent(sp.Skeleton);
            sk.skeletonData = e.spine;
            sk.premultipliedAlpha = false;
            const anim = e.defaultAnim;
            if (anim) {
                try {
                    sk.setAnimation(0, anim, true);
                } catch {
                    /* ignore missing anim in edit */
                }
            }
            n.setScale(0.35, 0.35, 1);
            cell.addChild(n);
            return;
        }
        // 其它类型：只显示 kind 字
        const n = new Node('kind');
        n.addComponent(UITransform).setContentSize(CELL - 8, 40);
        const lab = n.addComponent(Label);
        lab.string = kindTag(e.kind);
        lab.fontSize = 22;
        lab.color = new Color(120, 180, 255, 255);
        cell.addChild(n);
    }
}

function kindTag(k: AssetKind): string {
    switch (k) {
        case AssetKind.texture:
            return 'TEX';
        case AssetKind.spine:
            return 'SPN';
        case AssetKind.audio:
            return 'SFX';
        case AssetKind.font:
            return 'FNT';
        case AssetKind.prefab:
            return 'PFB';
        case AssetKind.effect:
            return 'FX';
        default:
            return '?';
    }
}
