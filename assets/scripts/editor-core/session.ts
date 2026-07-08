/**
 * EditorDoc — 盘面编辑器的文档模型。
 *
 * canonical 数据就是 SPIR：一份文档 = 有序的 PresentationState[]。
 * Editor UI 直接反射本结构，不另设中间层。
 */

import type { PresentationState, SymbolGrid, Cell } from '../vendor/slot-presentation-ir/index';
import { SCHEMA_VERSION, serialize, deserialize, validateSchema } from '../vendor/slot-presentation-ir/index';
import type { IrFrameKind } from './frameExt';
import { readFrameExt, writeFrameExt } from './frameExt';

export interface EditorDoc {
    /** 文档格式版本（editor-core 自己的，不是 SPIR schema 版本） */
    docVersion: 1;
    id: string;
    name: string;
    states: PresentationState[];
}

export interface DocValidationIssue {
    stateIndex: number;
    code: string;
    message: string;
    path?: string;
}

// ============================================================================
// 工厂
// ============================================================================

export function makeGrid(cols: number, rows: number, symbolId: number | null = null): SymbolGrid {
    const grid: SymbolGrid = [];
    for (let c = 0; c < cols; c++) {
        const col: Cell[] = [];
        for (let r = 0; r < rows; r++) {
            col.push({ symbolId, entityRef: null });
        }
        grid.push(col);
    }
    return grid;
}

export interface MakeStateOptions {
    sessionId: string;
    cols: number;
    rows: number;
    frameKind: IrFrameKind;
    cascadeIndex?: number;
    frameIndex?: number;
    fillSymbolId?: number | null;
}

/** 生成一个结构合法的最小 PresentationState */
export function makeEmptyState(opts: MakeStateOptions): PresentationState {
    const { sessionId, cols, rows, frameKind } = opts;
    const visibleRows: number[] = [];
    const extra: number[] = [];
    for (let c = 0; c < cols; c++) {
        visibleRows.push(rows);
        extra.push(0);
    }
    const state: PresentationState = {
        version: SCHEMA_VERSION,
        sessionId,
        board: {
            topology: { cols, visibleRows, extraTop: extra.slice(), extraBottom: extra.slice() },
            display: makeGrid(cols, rows, opts.fillSymbolId ?? null),
            resolved: makeGrid(cols, rows, opts.fillSymbolId ?? null),
            entities: {},
            anchors: { locks: new Set<string>(), sticks: new Set<string>() },
            overlays: [],
            wins: [],
        },
        phase: frameKind === 'enter-table' || frameKind === 'spinEnd' ? 'idle' : 'consequence',
        sessionContext: { mode: 'ng' },
        totalWinDisplay: 0,
        extensions: {},
    };
    writeFrameExt(state, {
        cascadeIndex: opts.cascadeIndex ?? 0,
        frameIndex: opts.frameIndex ?? 0,
        frameKind,
    });
    return state;
}

/**
 * 由 source 生成压缩后的盘面：每列非空符号保序下沉到底部，空格聚到顶部。
 * 用于「自动生成 compact 帧」，保证 compact 前后帧的数据关联性一定正确。
 * 返回 null 表示盘面已经是压缩态（无需生成）。
 */
export function makeCompactedState(source: PresentationState): PresentationState | null {
    const next = deserialize(serialize(source));
    const { cols, visibleRows } = next.board.topology;
    let changed = false;
    for (let c = 0; c < cols; c++) {
        const rows = visibleRows[c];
        const ids: number[] = [];
        for (let r = 0; r < rows; r++) {
            const id = next.board.resolved[c][r].symbolId;
            if (id !== null) ids.push(id);
        }
        for (let r = 0; r < rows; r++) {
            const newId = r < rows - ids.length ? null : ids[r - (rows - ids.length)];
            if (next.board.resolved[c][r].symbolId !== newId) {
                next.board.resolved[c][r].symbolId = newId;
                changed = true;
            }
        }
    }
    if (!changed) return null;
    const ext = readFrameExt(next);
    writeFrameExt(next, {
        cascadeIndex: ext?.cascadeIndex ?? 0,
        frameIndex: (ext?.frameIndex ?? 0) + 1,
        frameKind: 'compact',
    });
    return next;
}

export function makeEmptyDoc(id: string, name: string, cols: number, rows: number): EditorDoc {
    return {
        docVersion: 1,
        id,
        name,
        states: [makeEmptyState({ sessionId: id, cols, rows, frameKind: 'enter-table' })],
    };
}

// ============================================================================
// 校验
// ============================================================================

/** 逐帧跑 vendor validateSchema；返回全部问题（空数组 = 通过） */
export function validateDoc(doc: EditorDoc): DocValidationIssue[] {
    const issues: DocValidationIssue[] = [];
    if (!doc || doc.docVersion !== 1) {
        issues.push({ stateIndex: -1, code: 'DOC', message: 'docVersion 必须为 1' });
        return issues;
    }
    if (!Array.isArray(doc.states) || doc.states.length === 0) {
        issues.push({ stateIndex: -1, code: 'DOC', message: 'states 不能为空' });
        return issues;
    }
    doc.states.forEach((state, i) => {
        const r = validateSchema(state);
        if (!r.ok) {
            issues.push({ stateIndex: i, code: r.code, message: r.message, path: r.path });
        }
    });
    return issues;
}

// ============================================================================
// 序列化（Set ⇄ $set 由 vendor serde 处理）
// ============================================================================

export function serializeDoc(doc: EditorDoc, indent = 2): string {
    const plain = {
        docVersion: doc.docVersion,
        id: doc.id,
        name: doc.name,
        states: doc.states.map((s) => JSON.parse(serialize(s))),
    };
    return JSON.stringify(plain, null, indent);
}

export function deserializeDoc(json: string): EditorDoc {
    const raw = JSON.parse(json) as {
        docVersion: number;
        id: string;
        name: string;
        states: unknown[];
    };
    return {
        docVersion: 1,
        id: raw.id,
        name: raw.name,
        states: (raw.states ?? []).map((s) => deserialize(JSON.stringify(s))),
    };
}
