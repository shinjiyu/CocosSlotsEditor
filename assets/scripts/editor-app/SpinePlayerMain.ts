/**
 * SpinePlayerMain — 纯 Spine 资源播放器。
 *
 * 左侧选择 SkeletonData，中间播放当前骨骼，右侧列出并选择全部动画。
 * 不经过 AssetLibrary / SymbolLibrary / SymbolEntry。
 */

import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, resources, sp } from 'cc';
import { bootRemoteConsole } from '../debug/remoteConsoleBoot';
import { loadStoredPackId, tryGetSymbolPack } from './GamePack';
import { loadActiveSpineZone, packResourcePath } from './SpineZone';

const { ccclass } = _decorator;

const LIST_X = 370;
const LIST_W = 230;
const PLAYER_W = 450;
const PLAYER_H = 500;

@ccclass('SpinePlayerMain')
export class SpinePlayerMain extends Component {
    private assets: sp.SkeletonData[] = [];
    private selectedAsset = 0;
    private selectedAnim = 0;
    private skeleton: sp.Skeleton | null = null;
    private playerRoot: Node | null = null;
    private assetListRoot: Node | null = null;
    private animListRoot: Node | null = null;
    private title: Label | null = null;
    private animTitle: Label | null = null;

    async start(): Promise<void> {
        bootRemoteConsole();
        const zone = await loadActiveSpineZone();
        const pack = tryGetSymbolPack(loadStoredPackId(), zone);
        this.buildShell();
        if (!pack) {
            this.setTitle(`当前区 ${zone} 没有 Spine 包`);
            return;
        }
        const dir = packResourcePath(zone, pack.id, 'spines');
        resources.loadDir(dir, sp.SkeletonData, (err, loaded) => {
            if (err) {
                console.error('[SpinePlayer] loadDir failed', err);
                this.setTitle(`加载失败：${dir}`);
                return;
            }
            const seen = new Set<string>();
            this.assets = loaded
                .filter((asset) => {
                    const key = asset.name || asset.uuid;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort((a, b) => a.name.localeCompare(b.name));
            console.log(`[SpinePlayer] loaded ${this.assets.length} skeletons from ${dir}`);
            this.rebuildAssetList();
            this.selectAsset(0);
        });
    }

    private buildShell(): void {
        this.panel('Skeletons', -LIST_X, 0, LIST_W, 590);
        this.panel('Animations', LIST_X, 0, LIST_W, 590);
        this.panel('', 0, 0, PLAYER_W, 590);

        this.assetListRoot = this.emptyRoot('AssetList', -LIST_X, 225);
        this.animListRoot = this.emptyRoot('AnimList', LIST_X, 225);
        this.playerRoot = this.emptyRoot('Player', 0, 0);

        this.title = this.text(this.node, 'Spine Player', 0, 260, 22, 430, new Color(235, 238, 248));
        this.animTitle = this.text(this.node, '', 0, -255, 16, 430, new Color(155, 195, 235));
        this.button(this.node, '◀ 上一个动画', -105, -285, 190, () => this.cycleAnim(-1));
        this.button(this.node, '下一个动画 ▶', 105, -285, 190, () => this.cycleAnim(1));
    }

    private panel(title: string, x: number, y: number, w: number, h: number): void {
        const n = new Node(`Panel_${title || 'Player'}`);
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(24, 27, 40, 245);
        g.roundRect(-w / 2, -h / 2, w, h, 8);
        g.fill();
        g.strokeColor = new Color(62, 70, 94, 255);
        g.lineWidth = 2;
        g.roundRect(-w / 2, -h / 2, w, h, 8);
        g.stroke();
        this.node.addChild(n);
        if (title) this.text(n, title, 0, h / 2 - 26, 18, w - 20, new Color(190, 200, 225));
    }

    private emptyRoot(name: string, x: number, y: number): Node {
        const n = new Node(name);
        n.addComponent(UITransform);
        n.setPosition(x, y, 0);
        this.node.addChild(n);
        return n;
    }

    private rebuildAssetList(): void {
        const root = this.assetListRoot;
        if (!root) return;
        root.removeAllChildren();
        this.assets.forEach((asset, i) => {
            this.listButton(root, shortName(asset.name), 0, -i * 48, LIST_W - 24, i === this.selectedAsset, () =>
                this.selectAsset(i),
            );
        });
    }

    private rebuildAnimList(anims: string[]): void {
        const root = this.animListRoot;
        if (!root) return;
        root.removeAllChildren();
        anims.forEach((anim, i) => {
            this.listButton(root, anim, 0, -i * 36, LIST_W - 24, i === this.selectedAnim, () => this.playAnim(i));
        });
    }

    private selectAsset(index: number): void {
        if (!this.assets.length) return;
        this.selectedAsset = (index + this.assets.length) % this.assets.length;
        this.selectedAnim = 0;
        this.rebuildAssetList();

        const player = this.playerRoot;
        if (!player) return;
        player.removeAllChildren();
        const asset = this.assets[this.selectedAsset]!;
        const host = new Node(`Skeleton_${asset.name}`);
        host.addComponent(UITransform);
        const sk = host.addComponent(sp.Skeleton);
        sk.skeletonData = asset;
        sk.premultipliedAlpha = false;
        player.addChild(host);
        this.skeleton = sk;
        this.fitSkeleton(host, asset);

        const anims = this.animNames(asset);
        this.rebuildAnimList(anims);
        this.setTitle(`${asset.name}  ·  ${anims.length} animations`);
        if (anims.length) this.playAnim(0);
        else if (this.animTitle) this.animTitle.string = '(无动画)';
    }

    private fitSkeleton(host: Node, asset: sp.SkeletonData): void {
        const runtime = (
            asset as sp.SkeletonData & {
                getRuntimeData?: () => { x?: number; y?: number; width?: number; height?: number } | null;
            }
        ).getRuntimeData?.();
        const x = runtime?.x ?? 0;
        const y = runtime?.y ?? 0;
        const w = Math.max(1, runtime?.width ?? 500);
        const h = Math.max(1, runtime?.height ?? 500);
        const scale = Math.min((PLAYER_W - 40) / w, (PLAYER_H - 70) / h) * 0.92;
        host.setScale(scale, scale, 1);
        host.setPosition(-(x + w / 2) * scale, -(y + h / 2) * scale + 5, 0);
        console.log(`[SpinePlayer] fit ${asset.name}: bounds=${x},${y},${w},${h} scale=${scale.toFixed(3)}`);
    }

    private playAnim(index: number): void {
        const asset = this.assets[this.selectedAsset];
        if (!asset || !this.skeleton) return;
        const anims = this.animNames(asset);
        if (!anims.length) return;
        this.selectedAnim = (index + anims.length) % anims.length;
        const name = anims[this.selectedAnim]!;
        this.skeleton.setAnimation(0, name, true);
        this.rebuildAnimList(anims);
        if (this.animTitle) this.animTitle.string = `${this.selectedAnim + 1}/${anims.length}  ${name}`;
        console.log(`[SpinePlayer] play ${asset.name} / ${name}`);
    }

    private cycleAnim(dir: 1 | -1): void {
        this.playAnim(this.selectedAnim + dir);
    }

    private animNames(asset: sp.SkeletonData): string[] {
        try {
            const values = asset.getAnimsEnum?.() as Record<string, number> | undefined;
            return values ? Object.keys(values).filter((name) => name !== '<None>') : [];
        } catch {
            return [];
        }
    }

    private listButton(
        parent: Node,
        text: string,
        x: number,
        y: number,
        w: number,
        selected: boolean,
        onClick: () => void,
    ): void {
        const h = 32;
        const n = new Node(`item_${text}`);
        n.addComponent(UITransform).setContentSize(w, h);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = selected ? new Color(65, 90, 145, 255) : new Color(40, 45, 64, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 5);
        g.fill();
        this.text(n, text, 0, 0, 14, w - 12, selected ? new Color(255, 225, 120) : new Color(215, 220, 232));
        n.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            onClick();
        });
        parent.addChild(n);
    }

    private button(parent: Node, text: string, x: number, y: number, w: number, onClick: () => void): void {
        const n = new Node(`btn_${text}`);
        n.addComponent(UITransform).setContentSize(w, 34);
        n.setPosition(x, y, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(52, 62, 92, 255);
        g.roundRect(-w / 2, -17, w, 34, 6);
        g.fill();
        this.text(n, text, 0, 0, 15, w - 10, new Color(225, 230, 242));
        n.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            onClick();
        });
        parent.addChild(n);
    }

    private text(parent: Node, value: string, x: number, y: number, size: number, w: number, color: Color): Label {
        const n = new Node('Text');
        n.addComponent(UITransform).setContentSize(w, size + 8);
        n.setPosition(x, y, 0);
        const label = n.addComponent(Label);
        label.string = value;
        label.fontSize = size;
        label.color = color;
        label.overflow = Label.Overflow.SHRINK;
        parent.addChild(n);
        return label;
    }

    private setTitle(value: string): void {
        if (this.title) this.title.string = value;
    }
}

function shortName(name: string): string {
    return name.replace(/^eff_spine_lvbu_/, '').replace(/^eff_lvbu_/, '');
}
