/**
 * ResourceGalleryMain — 当前资源包的完整、临时审阅墙。
 *
 * 目标不是展示“已经配置成 symbol 的资源”，而是绕开 SymbolLibrary，
 * 递归列出当前包内所有可导入资源，防止资源在抽象/筛选阶段被悄悄漏掉：
 *
 *  1. 静态图片（static/**）
 *  2. Spine 贴图与 SkeletonData（spines/**）
 *  3. Prefab
 *  4. AudioClip（点击播放）
 *  5. TextAsset / manifest / atlas 等支持文件
 *
 * 鼠标滚轮或上下拖动浏览；Spine 卡片点击切动画；音频卡片点击试听。
 */

import {
    _decorator,
    Asset,
    AudioClip,
    AudioSource,
    Color,
    Component,
    EventMouse,
    EventTouch,
    Graphics,
    instantiate,
    Label,
    Mask,
    Node,
    Prefab,
    resources,
    Sprite,
    SpriteFrame,
    TextAsset,
    UITransform,
    Vec3,
    director,
    sp,
} from 'cc';
import { loadActiveSpineZone, packResourcePath } from './SpineZone';
import { loadStoredPackId, tryGetSymbolPack } from './GamePack';
import { bootRemoteConsole } from '../debug/remoteConsoleBoot';
import { AssetLibrary } from './AssetLibrary';
import { SymbolLibrary } from './SymbolLibrary';

const { ccclass } = _decorator;

/** 预览热更探针：每次改本文件递增，运行时打日志 + window.__GALLERY_PROBE__ */
const PROBE_VERSION = 8;

const VIEW_W = 1240;
const VIEW_H = 570;
const PER_ROW = 6;
const CELL_W = 188;
const CELL_H = 190;
const GAP_X = 14;
const GAP_Y = 16;
const SECTION_H = 38;
const PREVIEW_H = 140;

interface Loaded<T extends Asset> {
    asset: T;
    path: string;
}

interface SpineCell {
    node: Node;
    skeleton: sp.Skeleton;
    anims: string[];
    index: number;
    animLabel: Label;
}

interface GallerySection {
    title: string;
    items: Loaded<Asset>[];
    kind: 'image' | 'spine' | 'prefab' | 'audio' | 'text';
}

@ccclass('ResourceGalleryMain')
export class ResourceGalleryMain extends Component {
    private viewport: Node | null = null;
    private content: Node | null = null;
    private status: Label | null = null;
    private audio: AudioSource | null = null;
    private spineCells: SpineCell[] = [];
    private contentHeight = VIEW_H;
    private scrollY = 0;
    private spineScale = 0.28;

    async start(): Promise<void> {
        bootRemoteConsole();
        console.log(`[ResourceGallery] PROBE_VERSION=${PROBE_VERSION}`);
        (globalThis as Record<string, unknown>).__GALLERY_PROBE__ = PROBE_VERSION;
        try {
            const zone = await loadActiveSpineZone();
            const pack = tryGetSymbolPack(loadStoredPackId(), zone);
            if (!pack) {
                this.buildChrome(`资源全集 · 当前区 ${zone} 无符号包`);
                return;
            }

            this.buildChrome(`资源全集 · ${pack.id} · ${zone}`);
            const root = packResourcePath(zone, pack.id, '');
            const [frames, skeletons, prefabs, audios, texts] = await Promise.all([
                this.loadDir(root, SpriteFrame),
                this.loadDir(root, sp.SkeletonData),
                this.loadDir(root, Prefab),
                this.loadDir(root, AudioClip),
                this.loadDir(root, TextAsset),
            ]);

            const staticFrames = frames.filter((x) => this.normalizedPath(x).includes('/static/'));
            const spineFrames = frames.filter((x) => this.normalizedPath(x).includes('/spines/'));
            const otherFrames = frames.filter((x) => !staticFrames.includes(x) && !spineFrames.includes(x));

            const sections: GallerySection[] = [
                { title: '静态图片 static/**（符号 / 字母 / 框 / 溶解）', items: staticFrames, kind: 'image' },
                { title: 'Spine 骨骼 SkeletonData（点击切动画）', items: skeletons, kind: 'spine' },
                { title: 'Spine / 其它支持贴图', items: [...spineFrames, ...otherFrames], kind: 'image' },
                { title: 'Prefab（纯视觉 prefab 会实例化预览）', items: prefabs, kind: 'prefab' },
                { title: '音频 AudioClip（点击试听）', items: audios, kind: 'audio' },
                { title: '文本 / manifest / atlas 支持文件', items: texts, kind: 'text' },
            ].filter((s) => s.items.length > 0);

            this.buildAllSections(sections);
            const total = sections.reduce((n, s) => n + s.items.length, 0);
            this.setStatus(
                `共 ${total} 项 · 图片 ${frames.length} · Spine ${skeletons.length} · ` +
                    `Prefab ${prefabs.length} · 音频 ${audios.length} · 文本 ${texts.length} · 滚轮/拖动浏览`,
            );
            console.log('[ResourceGallery] complete pack scan', {
                root,
                total,
                frames: frames.length,
                skeletons: skeletons.length,
                prefabs: prefabs.length,
                audios: audios.length,
                texts: texts.length,
            });
        } catch (e) {
            console.error('[ResourceGallery] start failed', e);
            this.buildChrome('资源全集');
            this.setStatus(`加载失败: ${(e as Error).message ?? e}`);
        }
    }

    private loadDir<T extends Asset>(dir: string, type: new (...args: never[]) => T): Promise<Loaded<T>[]> {
        return new Promise((resolve) => {
            (
                resources.loadDir as unknown as (
                    path: string,
                    t: unknown,
                    cb: (err: Error | null, assets: T[]) => void,
                ) => void
            )(dir, type, (err, assets) => {
                if (err) {
                    console.warn(`[ResourceGallery] loadDir ${type.name} failed`, dir, err.message);
                    resolve([]);
                    return;
                }
                // 3.x 的 loadDir 回调没有 urls 参数，真实 bundle 路径要用 getDirWithPath 按 uuid 反查
                const infos = (
                    resources.getDirWithPath as unknown as (
                        path: string,
                        t: unknown,
                    ) => Array<{ uuid: string; path: string }>
                )(dir, type);
                const pathByUuid = new Map(infos.map((i) => [i.uuid, i.path]));
                const seen = new Set<string>();
                const out: Loaded<T>[] = [];
                assets.forEach((asset) => {
                    if (seen.has(asset.uuid)) return;
                    seen.add(asset.uuid);
                    out.push({ asset, path: pathByUuid.get(asset.uuid) ?? asset.name ?? asset.uuid });
                });
                out.sort((a, b) => this.normalizedPath(a).localeCompare(this.normalizedPath(b)));
                resolve(out);
            });
        });
    }

    private normalizedPath(item: Loaded<Asset>): string {
        return item.path.replace(/\\/g, '/').toLowerCase();
    }

    private buildChrome(title: string): void {
        const bar = new Node('Toolbar');
        bar.addComponent(UITransform).setContentSize(VIEW_W, 110);
        bar.setPosition(0, 300, 0);
        this.node.addChild(bar);

        this.makeLabel(bar, title, 0, 34, 22, new Color(220, 224, 238, 255), 720);

        const buttons: Array<[string, () => void]> = [
            ['◀动画', () => this.cycleAllAnims(-1)],
            ['动画▶', () => this.cycleAllAnims(1)],
            ['骨骼−', () => this.zoomSpines(-1)],
            ['骨骼＋', () => this.zoomSpines(1)],
            ['回顶部', () => this.setScroll(0)],
            ['重载', () => director.loadScene('ResourceGallery')],
        ];
        const bw = 92;
        buttons.forEach(([text, cb], i) => {
            this.makeButton(bar, text, -((buttons.length - 1) * 102) / 2 + i * 102, -4, bw, cb);
        });

        this.status = this.makeLabel(bar, '', 0, -43, 14, new Color(145, 205, 165, 255), 1120);

        const viewport = new Node('Viewport');
        viewport.addComponent(UITransform).setContentSize(VIEW_W, VIEW_H);
        viewport.addComponent(Mask).type = Mask.Type.RECT;
        viewport.setPosition(0, -60, 0);
        this.node.addChild(viewport);
        this.viewport = viewport;

        const content = new Node('Content');
        const transform = content.addComponent(UITransform);
        transform.setAnchorPoint(0.5, 1);
        transform.setContentSize(VIEW_W, VIEW_H);
        content.setPosition(0, VIEW_H / 2, 0);
        viewport.addChild(content);
        this.content = content;

        viewport.on(Node.EventType.MOUSE_WHEEL, (e: EventMouse) => {
            this.setScroll(this.scrollY - e.getScrollY() * 0.35);
        });
        viewport.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            this.setScroll(this.scrollY + e.getDeltaY());
        });
    }

    private buildAllSections(sections: GallerySection[]): void {
        if (!this.content) return;
        this.spineCells = [];
        let cursorY = -12;

        for (const section of sections) {
            this.makeSectionHeader(section.title, section.items.length, cursorY);
            cursorY -= SECTION_H;
            const rows = Math.ceil(section.items.length / PER_ROW);
            section.items.forEach((item, i) => {
                const col = i % PER_ROW;
                const row = Math.floor(i / PER_ROW);
                const x = (col - (PER_ROW - 1) / 2) * (CELL_W + GAP_X);
                const y = cursorY - CELL_H / 2 - row * (CELL_H + GAP_Y);
                this.makeCell(section.kind, item, x, y);
            });
            cursorY -= rows * (CELL_H + GAP_Y) + 18;
        }

        this.contentHeight = Math.max(VIEW_H, -cursorY + 20);
        this.content.getComponent(UITransform)?.setContentSize(VIEW_W, this.contentHeight);
        this.setScroll(0);
    }

    private makeSectionHeader(title: string, count: number, y: number): void {
        if (!this.content) return;
        const n = new Node(`section_${title}`);
        n.addComponent(UITransform).setContentSize(VIEW_W - 20, 30);
        n.setPosition(0, y - 15, 0);
        const g = n.addComponent(Graphics);
        g.fillColor = new Color(45, 50, 70, 255);
        g.roundRect(-(VIEW_W - 20) / 2, -15, VIEW_W - 20, 30, 5);
        g.fill();
        this.makeLabel(n, `${title}  ·  ${count} 项`, -(VIEW_W - 60) / 2, 0, 17, new Color(255, 211, 128, 255), VIEW_W - 80, Label.HorizontalAlign.LEFT);
        this.content.addChild(n);
    }

    private makeCell(kind: GallerySection['kind'], item: Loaded<Asset>, x: number, y: number): void {
        if (!this.content) return;
        const cell = new Node(`cell_${item.asset.name}`);
        cell.addComponent(UITransform).setContentSize(CELL_W, CELL_H);
        cell.setPosition(x, y, 0);
        this.content.addChild(cell);
        this.drawCard(cell);

        const preview = new Node('preview');
        preview.addComponent(UITransform).setContentSize(CELL_W - 8, PREVIEW_H);
        preview.addComponent(Mask).type = Mask.Type.RECT;
        preview.setPosition(0, 20, 0);
        cell.addChild(preview);

        if (kind === 'image') this.renderImage(preview, item.asset as SpriteFrame);
        else if (kind === 'spine') this.renderSpine(cell, preview, item.asset as sp.SkeletonData);
        else if (kind === 'prefab') this.renderPrefab(preview, item as Loaded<Prefab>);
        else this.renderTypeIcon(preview, kind === 'audio' ? '♫' : 'TXT');

        const name = item.asset.name || this.basename(item.path);
        this.makeLabel(cell, name, 0, -62, 14, new Color(235, 236, 242, 255), CELL_W - 10);
        this.makeLabel(
            cell,
            this.shortPath(item.path),
            0,
            -80,
            11,
            new Color(140, 169, 210, 255),
            CELL_W - 10,
        );

        if (kind === 'audio') {
            cell.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.playAudio(item.asset as AudioClip);
            });
        }
    }

    private drawCard(cell: Node): void {
        const g = cell.addComponent(Graphics);
        g.fillColor = new Color(29, 32, 44, 255);
        g.roundRect(-CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H, 7);
        g.fill();
        g.strokeColor = new Color(68, 77, 105, 255);
        g.lineWidth = 2;
        g.roundRect(-CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H, 7);
        g.stroke();
    }

    private renderImage(host: Node, frame: SpriteFrame): void {
        const n = new Node('image');
        const size = frame.originalSize;
        n.addComponent(UITransform).setContentSize(size.width, size.height);
        const sprite = n.addComponent(Sprite);
        sprite.spriteFrame = frame;
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const scale = Math.min((CELL_W - 18) / Math.max(1, size.width), (PREVIEW_H - 8) / Math.max(1, size.height));
        n.setScale(scale, scale, 1);
        host.addChild(n);
    }

    private renderSpine(cell: Node, host: Node, data: sp.SkeletonData): void {
        const n = new Node('spine');
        n.addComponent(UITransform);
        const skeleton = n.addComponent(sp.Skeleton);
        skeleton.skeletonData = data;
        skeleton.premultipliedAlpha = false;
        n.setScale(this.spineScale, this.spineScale, 1);
        host.addChild(n);

        const anims = this.animNames(data);
        if (anims.length) {
            try {
                skeleton.setAnimation(0, anims[0]!, true);
            } catch (e) {
                console.warn('[ResourceGallery] setAnimation failed', data.name, anims[0], e);
            }
        }
        const animLabel = this.makeLabel(
            cell,
            anims.length ? `1/${anims.length} ${anims[0]}` : '(无动画)',
            0,
            -46,
            11,
            new Color(176, 190, 225, 255),
            CELL_W - 10,
        );
        const record: SpineCell = { node: cell, skeleton, anims, index: 0, animLabel };
        cell.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.cycleCell(record, 1);
        });
        this.spineCells.push(record);
    }

    private renderPrefab(host: Node, item: Loaded<Prefab>): void {
        // 不能靠路径判断（loadDir 在部分版本不回传 urls）：一律实例化，
        // 有可视内容就按包围盒缩放进预览框，纯配置容器才回退占位图标。
        try {
            const instance = instantiate(item.asset);
            host.addChild(instance);

            if (!this.hasRenderableContent(instance)) {
                // 配置容器（AssetLibrary / SymbolLibrary）没有可视节点：展示条目摘要。
                const assetLib = instance.getComponent(AssetLibrary);
                const symbolLib = instance.getComponent(SymbolLibrary);
                const summary = assetLib
                    ? `素材库 · ${assetLib.assets.length} 条素材`
                    : symbolLib
                        ? `符号表 · ${symbolLib.symbols.length} 个符号`
                        : `配置容器 · ${instance.getComponentsInChildren(UITransform).length} 节点`;
                instance.destroy();
                this.renderTypeIcon(host, 'PREFAB');
                this.makeLabel(host, summary, 0, -48, 12, new Color(150, 200, 165, 255), CELL_W - 16);
                return;
            }
            this.fitInstanceToPreview(host, instance);
        } catch (e) {
            console.warn('[ResourceGallery] prefab preview failed', item.path, e);
            this.renderTypeIcon(host, 'PREFAB');
        }
    }

    private hasRenderableContent(instance: Node): boolean {
        if (instance.getComponentsInChildren(Sprite).some((s) => !!s.spriteFrame)) return true;
        if (instance.getComponentsInChildren(sp.Skeleton).some((s) => !!s.skeletonData)) return true;
        if (instance.getComponentsInChildren(Label).some((l) => !!l.string)) return true;
        return instance.getComponentsInChildren(Graphics).length > 0;
    }

    /** 按实例真实包围盒缩放并居中到预览框（instance 需已挂到 host 且 scale=1）。 */
    private fitInstanceToPreview(host: Node, instance: Node): void {
        const hostUT = host.getComponent(UITransform)!;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const ut of instance.getComponentsInChildren(UITransform)) {
            const box = ut.getBoundingBoxToWorld();
            if (!(box.width > 0 && box.height > 0)) continue;
            minX = Math.min(minX, box.xMin);
            minY = Math.min(minY, box.yMin);
            maxX = Math.max(maxX, box.xMax);
            maxY = Math.max(maxY, box.yMax);
        }
        if (!(maxX > minX && maxY > minY)) return;

        const local = hostUT.convertToNodeSpaceAR(new Vec3((minX + maxX) / 2, (minY + maxY) / 2, 0));
        const scale = Math.min(
            (CELL_W - 18) / (maxX - minX),
            (PREVIEW_H - 8) / (maxY - minY),
            1,
        );
        instance.setScale(scale, scale, 1);
        instance.setPosition(instance.position.x * scale - local.x * scale, instance.position.y * scale - local.y * scale, 0);
    }

    private renderTypeIcon(host: Node, text: string): void {
        this.makeLabel(host, text, 0, 0, text.length <= 2 ? 52 : 24, new Color(173, 184, 218, 255), CELL_W - 20);
    }

    private playAudio(clip: AudioClip): void {
        if (!this.audio) this.audio = this.node.getComponent(AudioSource) ?? this.node.addComponent(AudioSource);
        this.audio.playOneShot(clip, 1);
        this.setStatus(`试听：${clip.name}`);
    }

    private animNames(data: sp.SkeletonData): string[] {
        try {
            const en = data.getAnimsEnum?.() as Record<string, number> | undefined;
            return en ? Object.keys(en).filter((k) => k !== '<None>') : [];
        } catch {
            return [];
        }
    }

    private cycleCell(cell: SpineCell, dir: 1 | -1): void {
        if (!cell.anims.length) return;
        cell.index = (cell.index + dir + cell.anims.length) % cell.anims.length;
        const name = cell.anims[cell.index]!;
        try {
            cell.skeleton.setAnimation(0, name, true);
            cell.animLabel.string = `${cell.index + 1}/${cell.anims.length} ${name}`;
        } catch (e) {
            console.warn('[ResourceGallery] setAnimation failed', name, e);
        }
    }

    private cycleAllAnims(dir: 1 | -1): void {
        this.spineCells.forEach((cell) => this.cycleCell(cell, dir));
    }

    private zoomSpines(dir: 1 | -1): void {
        this.spineScale = Math.max(0.05, Math.min(1, this.spineScale + dir * 0.05));
        this.spineCells.forEach((cell) => cell.skeleton.node.setScale(this.spineScale, this.spineScale, 1));
        this.setStatus(`骨骼缩放 ×${this.spineScale.toFixed(2)}`);
    }

    private setScroll(value: number): void {
        const max = Math.max(0, this.contentHeight - VIEW_H);
        this.scrollY = Math.max(0, Math.min(max, value));
        this.content?.setPosition(0, VIEW_H / 2 + this.scrollY, 0);
    }

    private makeButton(parent: Node, text: string, x: number, y: number, width: number, cb: () => void): void {
        const btn = new Node(`btn_${text}`);
        btn.addComponent(UITransform).setContentSize(width, 30);
        btn.setPosition(x, y, 0);
        const g = btn.addComponent(Graphics);
        g.fillColor = new Color(50, 57, 82, 255);
        g.roundRect(-width / 2, -15, width, 30, 5);
        g.fill();
        this.makeLabel(btn, text, 0, 0, 15, new Color(225, 228, 238, 255), width);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            cb();
        });
        parent.addChild(btn);
    }

    private makeLabel(
        parent: Node,
        text: string,
        x: number,
        y: number,
        size: number,
        color: Color,
        width: number,
        align = Label.HorizontalAlign.CENTER,
    ): Label {
        const n = new Node('label');
        n.addComponent(UITransform).setContentSize(width, size + 7);
        n.setPosition(x, y, 0);
        const label = n.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 2;
        label.color = color;
        label.horizontalAlign = align;
        label.overflow = Label.Overflow.SHRINK;
        parent.addChild(n);
        return label;
    }

    private basename(path: string): string {
        return path.replace(/\\/g, '/').split('/').pop() ?? path;
    }

    private shortPath(path: string): string {
        const p = path.replace(/\\/g, '/');
        const marker = '/lvbu/';
        const i = p.toLowerCase().indexOf(marker);
        return i >= 0 ? p.slice(i + marker.length) : p;
    }

    private setStatus(message: string): void {
        if (this.status) this.status.string = message;
    }
}
