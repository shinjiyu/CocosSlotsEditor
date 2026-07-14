/**
 * editor-core 公开入口 — 纯逻辑，无 Cocos 依赖。
 */

export type { IrFrameKind, IrFrameExtension } from './frameExt';
export { IR_FRAME_KINDS, readFrameExt, writeFrameExt, isIrFrameKind } from './frameExt';

export type { EditorDoc, DocValidationIssue, MakeStateOptions } from './session';
export {
    makeGrid,
    makeEmptyState,
    makeEmptyDoc,
    makeCompactedState,
    makeExpandedState,
    validateDoc,
    serializeDoc,
    deserializeDoc,
} from './session';

export type { EditorCommand } from './commands';
export {
    AddStateCommand,
    RemoveStateCommand,
    MoveStateCommand,
    SetResolvedCellCommand,
    SetEntityMultiplierCommand,
    SetFrameKindCommand,
    PatchFrameExtCommand,
    CompositeCommand,
    CommandHistory,
} from './commands';

export { runEditorCoreSelfTest } from './selfTest';
