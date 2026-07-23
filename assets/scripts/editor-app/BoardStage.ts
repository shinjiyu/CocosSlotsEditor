/**
 * BoardStage — 盘面挂载组件（编辑期可视化 + 运行时装配，一份配置两用）。
 *
 * 用法：在业务 prefab/场景里建一个节点挂本组件，拖入
 *   - doc（symbolEditor 导出的盘面文档 JSON）
 *   - symbolLibrary（symbol-library.prefab）
 * 编辑模式立即用 BoardView 渲染文档首帧（与运行时同一渲染路径），
 * 在 Inspector 上调 cellW/cellH/行距/列距 直接看大小范围。
 * 运行时调 buildRuntime() 获得 BoardDirector 播放整个文档。
 */

import { _decorator, CCObject, Component, JsonAsset, Node, Prefab, RenderRoot2D } from 'cc';
import { EDITOR } from 'cc/env';
import type { EditorDoc } from '../editor-core/index';
import { deserializeDoc } from '../editor-core/index';
import { BoardDirector } from './BoardDirector';
import { BoardView } from './BoardView';
import { SymbolCatalog } from './SymbolCatalog';
import { SymbolLibrary } from './SymbolLibrary';
import { AssetLibrary } from './AssetLibrary';

const { ccclass, property, executeInEditMode } = _decorator;

const PREVIEW_NODE = '__board_preview__';

export interface BoardHandle {
    node: Node;
    view: BoardView;
    director: BoardDirector;
    doc: EditorDoc;
    /** 从头播放整个文档 */
    playAll(): Promise<number>;
}

@ccclass('BoardStage')
@executeInEditMode
export class BoardStage extends Component {
    @property({ type: JsonAsset, displayName: '盘面文档', tooltip: 'symbolEditor 导出的 EditorDoc JSON' })
    doc: JsonAsset | null = null;

    @property({ type: Prefab, displayName: '符号库', tooltip: 'symbol-library.prefab' })
    symbolLibrary: Prefab | null = null;

    @property({
        type: Prefab,
        displayName: '素材库',
        tooltip: '同包 asset-library.prefab；新包必填（*AssetId 解析）。旧包可空。',
    })
    assetLibrary: Prefab | null = null;

    @property({ displayName: '格宽(px)' })
    cellW = 126;

    @property({ displayName: '格高(px)' })
    cellH = 104;

    @property({ displayName: '列距(px)', tooltip: '支持负数' })
    colGap = 4;

    @property({ displayName: '行距(px)', tooltip: '支持负数' })
    rowGap = 4;

    @property({ displayName: '格内填充比例', range: [0.1, 1.5, 0.05] })
    cellFill = 0.9;

    @property({ displayName: '显示网格背景', tooltip: '调试用半透明网格；正式盘面关闭' })
    showGridBg = false;

    // ------------------------------------------------------------------
    // 运行时
    // ------------------------------------------------------------------

    /** 运行时装配：创建 BoardView 子节点、渲染首帧、返回播放句柄 */
    buildRuntime(): BoardHandle | null {
        const doc = this.parseDoc();
        const lib = this.libraryComponent();
        if (!doc || !lib) {
            console.error('[BoardStage] 缺少盘面文档或符号库配置');
            return null;
        }
        const catalog = this.makeCatalog(lib);
        const node = new Node('board');
        const view = this.attachBoardView(node, catalog);
        this.node.addChild(node);

        const director = new BoardDirector(view, () => doc);
        view.render(doc.states[0]);
        return {
            node,
            view,
            director,
            doc,
            playAll: () => director.playRange(0, doc.states.length - 1),
        };
    }

    private parseDoc(): EditorDoc | null {
        if (!this.doc?.json) return null;
        try {
            const doc = deserializeDoc(JSON.stringify(this.doc.json));
            return doc.states.length ? doc : null;
        } catch (e) {
            console.error('[BoardStage] 盘面文档解析失败', e);
            return null;
        }
    }

    private libraryComponent(): SymbolLibrary | null {
        return this.symbolLibrary?.data?.getComponent(SymbolLibrary) ?? null;
    }

    private assetLibraryComponent(): AssetLibrary | null {
        return this.assetLibrary?.data?.getComponent(AssetLibrary) ?? null;
    }

    private makeCatalog(lib: SymbolLibrary): SymbolCatalog {
        return SymbolCatalog.fromLibrary(lib, this.assetLibraryComponent());
    }

    private attachBoardView(host: Node, catalog: SymbolCatalog): BoardView {
        const view = host.addComponent(BoardView);
        view.cellW = this.cellW;
        view.cellH = this.cellH;
        view.colGap = this.colGap;
        view.rowGap = this.rowGap;
        view.cellFill = this.cellFill;
        view.showGridBg = this.showGridBg;
        view.setCatalog(catalog);
        return view;
    }

    // ------------------------------------------------------------------
    // 编辑期首帧预览
    // ------------------------------------------------------------------

    private preview: Node | null = null;
    private lastSig = '';
    private editorTimer: ReturnType<typeof setInterval> | null = null;

    protected onEnable(): void {
        if (!EDITOR) return;
        this.rebuildPreview();
        this.editorTimer = setInterval(() => this.editorTick(), 500);
    }

    protected onDisable(): void {
        if (!EDITOR) return;
        if (this.editorTimer !== null) {
            clearInterval(this.editorTimer);
            this.editorTimer = null;
        }
        this.destroyPreview();
    }

    private editorTick(): void {
        if (!this.node.isValid) return;
        const sig = this.signature();
        if (sig !== this.lastSig) {
            this.lastSig = sig;
            this.rebuildPreview();
        }
    }

    private signature(): string {
        return [
            this.doc?.uuid ?? '',
            this.symbolLibrary?.uuid ?? '',
            this.assetLibrary?.uuid ?? '',
            this.cellW, this.cellH, this.colGap, this.rowGap, this.cellFill,
            this.showGridBg ? 1 : 0,
        ].join('|');
    }

    private destroyPreview(): void {
        this.node.getChildByName(PREVIEW_NODE)?.destroy();
        this.preview = null;
    }

    private rebuildPreview(): void {
        this.destroyPreview();
        const doc = this.parseDoc();
        const lib = this.libraryComponent();
        if (!doc || !lib) return;

        const preview = new Node(PREVIEW_NODE);
        preview.hideFlags = CCObject.Flags.DontSave | CCObject.Flags.HideInHierarchy;
        // prefab 编辑舞台没有 Canvas，2D 渲染需要渲染根；场景里已有 Canvas 时不重复加
        if (!this.hasRenderRootAncestor()) preview.addComponent(RenderRoot2D);
        this.node.addChild(preview);
        this.preview = preview;

        const view = this.attachBoardView(preview, this.makeCatalog(lib));
        view.render(doc.states[0]);
        requestEditorRepaint();
    }

    private hasRenderRootAncestor(): boolean {
        let p: Node | null = this.node;
        while (p) {
            if (p.getComponent(RenderRoot2D)) return true;
            p = p.parent;
        }
        return false;
    }
}

/** 编辑模式下强制场景视图重绘 */
function requestEditorRepaint(): void {
    const cce = (globalThis as Record<string, unknown>).cce as
        | { Engine?: { repaintInEditMode?: () => void } }
        | undefined;
    cce?.Engine?.repaintInEditMode?.();
}
