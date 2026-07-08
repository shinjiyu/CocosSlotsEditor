/**
 * PersistenceService — M2 持久化：
 * - localStorage 自动保存（每次命令后）
 * - 导出 JSON（浏览器下载）
 * - 从本地文件导入
 * 后续升级：POST 到 Creator 扩展 HTTP 桥直接写回 assets。
 */

import { sys } from 'cc';
import type { EditorDoc } from '../editor-core/index';
import { deserializeDoc, serializeDoc } from '../editor-core/index';

const KEY_PREFIX = 'symbolEditor.doc.';

export class PersistenceService {
    autosave(doc: EditorDoc): void {
        try {
            sys.localStorage.setItem(KEY_PREFIX + doc.id, serializeDoc(doc, 0));
        } catch (e) {
            console.warn('[Persistence] autosave failed', e);
        }
    }

    loadAutosave(docId: string): EditorDoc | null {
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

    /** 浏览器下载导出 */
    exportDownload(doc: EditorDoc): void {
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
