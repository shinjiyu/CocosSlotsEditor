/**
 * 帧级 extensions.frame 的类型与读写工具。
 * 与 illyasviel-candy `game/ir/core/irFrameExtensions.ts` 对齐（frameKind 枚举一致），
 * 但归属 editor-core：Editor 写入、Playfield/Director 读取。
 */

import type { PresentationState } from '../vendor/slot-presentation-ir/index';

export type IrFrameKind =
    | 'reveal'
    | 'bonus-reveal'
    | 'highlight'
    | 'bonus-highlight'
    | 'enter-table-mid-cascade'
    | 'postClear'
    | 'compact'
    | 'expandPre'
    | 'expandPost'
    | 'multiCollect'
    | 'spinEnd'
    | 'enter-table';

export const IR_FRAME_KINDS: IrFrameKind[] = [
    'enter-table',
    'reveal',
    'bonus-reveal',
    'highlight',
    'bonus-highlight',
    'enter-table-mid-cascade',
    'postClear',
    'compact',
    'expandPre',
    'expandPost',
    'multiCollect',
    'spinEnd',
];

export interface IrFrameExtension {
    cascadeIndex: number;
    frameIndex: number;
    frameKind: IrFrameKind;
    clearTime?: number;
    clearType?: number;
    /** Editor 专用：本帧动画模板 override（缺省时按 frameKind 走默认模板） */
    templateId?: string;
    /** Editor 专用：模板参数 override */
    templateParams?: Record<string, unknown>;
    /** Editor 专用：本帧转移与上一帧转移并行播放（如 compact 与 reveal 同播） */
    playWithPrev?: boolean;
}

export function readFrameExt(state: PresentationState): IrFrameExtension | null {
    const frame = state.extensions?.['frame'];
    if (!frame || typeof frame !== 'object') return null;
    const ext = frame as Record<string, unknown>;
    if (typeof ext.frameKind !== 'string') return null;
    return frame as unknown as IrFrameExtension;
}

export function writeFrameExt(state: PresentationState, ext: IrFrameExtension): void {
    state.extensions = state.extensions ?? {};
    state.extensions['frame'] = ext;
}

export function isIrFrameKind(v: unknown): v is IrFrameKind {
    return typeof v === 'string' && (IR_FRAME_KINDS as string[]).indexOf(v) >= 0;
}
