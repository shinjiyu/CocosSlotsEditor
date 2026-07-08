/**
 * 编辑命令层 — 所有对 EditorDoc 的修改都经由 Command，天然支持 undo/redo。
 *
 * M0 只提供最小集：addState / removeState / moveState / setResolvedCell / setFrameKind。
 * revert 采用 apply 时捕获的逆数据（非全文档快照）。
 */

import type { PresentationState } from '../vendor/slot-presentation-ir/index';
import { deserialize, serialize } from '../vendor/slot-presentation-ir/index';
import type { EditorDoc } from './session';
import type { IrFrameKind, IrFrameExtension } from './frameExt';
import { readFrameExt, writeFrameExt } from './frameExt';

export interface EditorCommand {
    readonly label: string;
    apply(doc: EditorDoc): void;
    revert(doc: EditorDoc): void;
}

function cloneState(state: PresentationState): PresentationState {
    return deserialize(serialize(state));
}

// ============================================================================
// 命令实现
// ============================================================================

/** 在 index 处插入 state（默认克隆前一帧，保持盘面连续） */
export class AddStateCommand implements EditorCommand {
    readonly label = 'addState';
    private inserted: PresentationState;
    constructor(
        private index: number,
        source: PresentationState,
        frameKind?: IrFrameKind,
    ) {
        this.inserted = cloneState(source);
        if (frameKind) {
            const ext = readFrameExt(this.inserted);
            writeFrameExt(this.inserted, {
                cascadeIndex: ext?.cascadeIndex ?? 0,
                frameIndex: (ext?.frameIndex ?? 0) + 1,
                frameKind,
            });
        }
    }
    apply(doc: EditorDoc): void {
        doc.states.splice(this.index, 0, this.inserted);
    }
    revert(doc: EditorDoc): void {
        doc.states.splice(this.index, 1);
    }
}

export class RemoveStateCommand implements EditorCommand {
    readonly label = 'removeState';
    private removed: PresentationState | null = null;
    constructor(private index: number) {}
    apply(doc: EditorDoc): void {
        if (doc.states.length <= 1) throw new Error('至少保留一帧');
        this.removed = doc.states.splice(this.index, 1)[0] ?? null;
    }
    revert(doc: EditorDoc): void {
        if (this.removed) doc.states.splice(this.index, 0, this.removed);
    }
}

export class MoveStateCommand implements EditorCommand {
    readonly label = 'moveState';
    constructor(
        private from: number,
        private to: number,
    ) {}
    apply(doc: EditorDoc): void {
        const [s] = doc.states.splice(this.from, 1);
        doc.states.splice(this.to, 0, s);
    }
    revert(doc: EditorDoc): void {
        const [s] = doc.states.splice(this.to, 1);
        doc.states.splice(this.from, 0, s);
    }
}

/** 改 resolved 某格 symbolId（Editor 网格点击的核心命令） */
export class SetResolvedCellCommand implements EditorCommand {
    readonly label = 'setResolvedCell';
    private prev: number | null = null;
    constructor(
        private stateIndex: number,
        private col: number,
        private row: number,
        private symbolId: number | null,
    ) {}
    apply(doc: EditorDoc): void {
        const cell = doc.states[this.stateIndex].board.resolved[this.col][this.row];
        this.prev = cell.symbolId;
        cell.symbolId = this.symbolId;
    }
    revert(doc: EditorDoc): void {
        doc.states[this.stateIndex].board.resolved[this.col][this.row].symbolId = this.prev;
    }
}

export class SetFrameKindCommand implements EditorCommand {
    readonly label = 'setFrameKind';
    private prev: IrFrameKind | null = null;
    constructor(
        private stateIndex: number,
        private frameKind: IrFrameKind,
    ) {}
    apply(doc: EditorDoc): void {
        const state = doc.states[this.stateIndex];
        const ext = readFrameExt(state);
        this.prev = ext?.frameKind ?? null;
        writeFrameExt(state, {
            cascadeIndex: ext?.cascadeIndex ?? 0,
            frameIndex: ext?.frameIndex ?? this.stateIndex,
            frameKind: this.frameKind,
            clearTime: ext?.clearTime,
            clearType: ext?.clearType,
            templateId: ext?.templateId,
            templateParams: ext?.templateParams,
        });
    }
    revert(doc: EditorDoc): void {
        if (this.prev === null) return;
        const state = doc.states[this.stateIndex];
        const ext = readFrameExt(state);
        writeFrameExt(state, {
            cascadeIndex: ext?.cascadeIndex ?? 0,
            frameIndex: ext?.frameIndex ?? this.stateIndex,
            frameKind: this.prev,
            clearTime: ext?.clearTime,
            clearType: ext?.clearType,
            templateId: ext?.templateId,
            templateParams: ext?.templateParams,
        });
    }
}

/** 修改帧扩展（templateId / templateParams / clearTime…），整体快照回退 */
export class PatchFrameExtCommand implements EditorCommand {
    readonly label = 'patchFrameExt';
    private prev: IrFrameExtension | null = null;
    constructor(
        private stateIndex: number,
        private patch: Partial<IrFrameExtension>,
    ) {}
    apply(doc: EditorDoc): void {
        const state = doc.states[this.stateIndex];
        const ext = readFrameExt(state);
        this.prev = ext ? JSON.parse(JSON.stringify(ext)) : null;
        const base: IrFrameExtension = ext ?? {
            cascadeIndex: 0,
            frameIndex: this.stateIndex,
            frameKind: 'reveal',
        };
        const merged: IrFrameExtension = { ...base, ...this.patch };
        // patch 里显式给 undefined 的键 = 删除该键
        for (const key of Object.keys(this.patch) as Array<keyof IrFrameExtension>) {
            if (this.patch[key] === undefined) delete merged[key];
        }
        writeFrameExt(state, merged);
    }
    revert(doc: EditorDoc): void {
        if (this.prev) writeFrameExt(doc.states[this.stateIndex], this.prev);
    }
}

/** 复合命令：一组命令合成一次 undo（如刷子一笔）。 */
export class CompositeCommand implements EditorCommand {
    constructor(
        readonly label: string,
        private commands: EditorCommand[],
    ) {}
    get size(): number {
        return this.commands.length;
    }
    apply(doc: EditorDoc): void {
        for (const c of this.commands) c.apply(doc);
    }
    revert(doc: EditorDoc): void {
        for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].revert(doc);
    }
}

// ============================================================================
// 历史栈
// ============================================================================

export class CommandHistory {
    private undoStack: EditorCommand[] = [];
    private redoStack: EditorCommand[] = [];
    constructor(private doc: EditorDoc) {}

    execute(cmd: EditorCommand): void {
        cmd.apply(this.doc);
        this.undoStack.push(cmd);
        this.redoStack.length = 0;
    }

    /** 命令已被外部逐步 apply 过（如刷子一笔），只入栈不再执行 */
    pushApplied(cmd: EditorCommand): void {
        this.undoStack.push(cmd);
        this.redoStack.length = 0;
    }

    undo(): boolean {
        const cmd = this.undoStack.pop();
        if (!cmd) return false;
        cmd.revert(this.doc);
        this.redoStack.push(cmd);
        return true;
    }

    redo(): boolean {
        const cmd = this.redoStack.pop();
        if (!cmd) return false;
        cmd.apply(this.doc);
        this.undoStack.push(cmd);
        return true;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }
    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }
}
