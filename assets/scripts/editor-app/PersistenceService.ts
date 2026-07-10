/**
 * PersistenceService — M2 持久化：
 * - localStorage 自动保存（每次命令后）
 * - 导出 JSON（浏览器下载）
 * - 从本地文件导入
 * - AI Game Workspace 嵌入：?aiws_board=1 时 postMessage 给 parent
 */

import { sys } from 'cc';
import type { EditorDoc } from '../editor-core/index';
import { deserializeDoc, serializeDoc } from '../editor-core/index';

const KEY_PREFIX = 'symbolEditor.doc.';
const HOST_SOURCE = 'aiws-board';
const PARENT_SOURCE = 'aiws-board-host';

function isAiwsBoardEmbed(): boolean {
    if (!sys.isBrowser || typeof window === 'undefined') return false;
    try {
        const q = new URLSearchParams(window.location.search);
        return q.get('aiws_board') === '1';
    } catch {
        return false;
    }
}

function postToHost(msg: Record<string, unknown>): void {
    if (!sys.isBrowser || typeof window === 'undefined') return;
    try {
        if (window.parent === window) return;
        window.parent.postMessage({ source: HOST_SOURCE, ...msg }, '*');
    } catch (e) {
        console.warn('[Persistence] postToHost failed', e);
    }
}

export class PersistenceService {
    /** Workspace 嵌入模式 */
    readonly aiwsEmbed = isAiwsBoardEmbed();

    autosave(doc: EditorDoc): void {
        try {
            sys.localStorage.setItem(KEY_PREFIX + doc.id, serializeDoc(doc, 0));
        } catch (e) {
            console.warn('[Persistence] autosave failed', e);
        }
        if (this.aiwsEmbed) {
            postToHost({
                type: 'doc',
                id: doc.id,
                json: serializeDoc(doc, 0),
                dirty: true,
            });
        }
    }

    loadAutosave(docId: string): EditorDoc | null {
        // 嵌入模式优先等 parent 推送，避免 localStorage 盖住工程 cfg
        if (this.aiwsEmbed) return null;
        try {
            const raw = sys.localStorage.getItem(KEY_PREFIX + docId);
            if (!raw) return null;
            return deserializeDoc(raw);
        } catch (e) {
            console.warn('[Persistence] loadAutosave failed', e);
            return null;
        }
    }

    clearAutosave(docId: string): void {
        sys.localStorage.removeItem(KEY_PREFIX + docId);
    }

    /** 浏览器下载导出；嵌入模式下改为通知 parent 写回 */
    exportDownload(doc: EditorDoc): void {
        if (this.aiwsEmbed) {
            postToHost({
                type: 'doc',
                id: doc.id,
                json: serializeDoc(doc, 0),
                dirty: true,
                export: true,
            });
            return;
        }
        if (!sys.isBrowser || typeof document === 'undefined') {
            console.warn('[Persistence] export 仅支持浏览器环境');
            return;
        }
        const blob = new Blob([serializeDoc(doc, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${doc.id}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /** 通知 parent 编辑器已就绪 */
    notifyReady(docId: string): void {
        if (!this.aiwsEmbed) return;
        postToHost({ type: 'ready', id: docId });
    }

    /**
     * 监听 parent：load-doc / request-doc
     * @returns dispose
     */
    installHostBridge(handlers: {
        onLoadDoc: (doc: EditorDoc) => void;
        onRequestDoc: () => EditorDoc | null;
    }): () => void {
        if (!this.aiwsEmbed || typeof window === 'undefined') return () => undefined;

        const onMessage = (ev: MessageEvent) => {
            const d = ev.data;
            if (!d || d.source !== PARENT_SOURCE) return;
            if (d.type === 'load-doc') {
                try {
                    const doc =
                        typeof d.json === 'string'
                            ? deserializeDoc(d.json)
                            : deserializeDoc(JSON.stringify(d.doc));
                    handlers.onLoadDoc(doc);
                } catch (e) {
                    console.error('[Persistence] load-doc failed', e);
                    postToHost({ type: 'error', error: String((e as Error)?.message || e) });
                }
            } else if (d.type === 'request-doc') {
                const doc = handlers.onRequestDoc();
                if (doc) {
                    postToHost({
                        type: 'doc',
                        id: doc.id,
                        json: serializeDoc(doc, 0),
                        dirty: true,
                        replyTo: d.requestId || null,
                    });
                } else {
                    postToHost({ type: 'error', error: 'no doc' });
                }
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }

    /** 弹出文件选择框导入 */
    importFromFile(): Promise<EditorDoc | null> {
        if (!sys.isBrowser || typeof document === 'undefined') {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = () => {
                const file = input.files && input.files[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        resolve(deserializeDoc(String(reader.result)));
                    } catch (e) {
                        console.error('[Persistence] import parse failed', e);
                        resolve(null);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        });
    }
}
