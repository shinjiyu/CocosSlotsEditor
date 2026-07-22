/**
 * 列占满（兼容层）：委托 placement/column-fill。
 * 新代码请用 placement/resolvePlacement + findColumnFillRow。
 * 仍提供 isColumnSpanSymbol(profile, id) 时需传入 catalog 判断；此处保留
 * profile.roles.bonus 兜底，便于未挂 placement 字段的旧包。
 */

import type { BoardLayoutProfile, CellRef } from './BoardLayout';
import { columnFillAnchorRow, findColumnFillRow } from '../placement';

export function isTopMappedRef(profile: BoardLayoutProfile, col: number, row: number): boolean {
    return (profile.topStrip?.mapToMain ?? []).some((c: CellRef) => c.col === col && c.row === row);
}

/**
 * @deprecated 优先用 isColumnFillEntry(catalog.getEntry(id))
 * 兜底：未配置 placement 时仍认 profile.roles.bonus
 */
export function isColumnSpanSymbol(
    profile: BoardLayoutProfile | null | undefined,
    symbolId: number | null | undefined,
): boolean {
    if (!profile || symbolId == null) return false;
    return symbolId === profile.roles.bonus;
}

/** 主盘列内 column-fill 落点：始终 row0 */
export function columnSpanAnchorRow(
    _profile: BoardLayoutProfile,
    _col: number,
    columnCount: number,
): number | null {
    return columnFillAnchorRow(columnCount);
}

/**
 * 列内是否已有列占满符号。
 * 优先用 isColumnFillId；缺省回落 profile.roles.bonus。
 */
export function findColumnSpanRow(
    profile: BoardLayoutProfile,
    col: number,
    columnCount: number,
    resolved: ReadonlyArray<ReadonlyArray<{ symbolId: number | null } | null | undefined>>,
    isColumnFillId?: (symbolId: number) => boolean,
): number | null {
    const check =
        isColumnFillId ?? ((id: number) => id === profile.roles.bonus);
    return findColumnFillRow(col, columnCount, resolved, check);
}
