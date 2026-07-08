/**
 * animTemplates — frameKind → 动画模板注册表（M3）。
 *
 * 模板契约：给 (prev, curr[, next]) 两帧快照 + BoardView，产出一个 IAnim。
 * frameKind ↔ 模板存在兼容约束（KIND_ALLOWED），每个 frameKind 只能选列表内模板，
 * 首项为 auto 默认。例如：
 *   enter-table / reveal → dropIn | noop（屏外落入，下排先落，落地弹跳）
 *   highlight            → symbolWin（符号winAnim+格子特效，缺省回落脉冲）| pulse | noop
 *   postClear            → vanish | dropOut（重力掉出）| noop
 *   compact              → compactFall | noop（列内现有符号下沉补位，无新符号）
 * 「满盘换新盘」演出 = reveal 前插一个 postClear 全空帧（dropOut）+ reveal（dropIn）。
 * 帧可用 extensions.frame.templateId / templateParams 在允许范围内覆盖默认模板。
 */

import { Node, Tween, tween, UIOpacity, UITransform, Vec3, view } from 'cc';
import type { IAnim } from '../common/anim/IAnim';
import { call, delay, par, seq, starterAnim } from '../common/anim/compose';
import { loop } from '../common/anim/compose';
import type { PresentationState } from '../vendor/slot-presentation-ir/index';
import type { IrFrameKind } from '../editor-core/index';
import { readFrameExt } from '../editor-core/index';
import type { BoardView } from './BoardView';
import type { BoardEvents, BoardEventType } from './boardEvents';

// ============================================================================
// 上下文 / 参数
// ============================================================================

export interface TemplateContext {
    boardView: BoardView;
    prev: PresentationState;
    curr: PresentationState;
    /** 时间轴上的下一帧（highlight 推断消除格用；可缺省） */
    next?: PresentationState;
    params: Record<string, unknown>;
    /** 播放事件总线（BoardDirector 注入；模板在动画连接处发事件） */
    events?: BoardEvents;
    /** 本转移的目标帧 index（事件 payload 用） */
    frameIndex?: number;
}

export interface ParamField {
    key: string;
    label: string;
    type: 'number' | 'select';
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string; label: string }>;
}

export interface AnimTemplate {
    id: string;
    label: string;
    defaultParams: Record<string, unknown>;
    paramSchema: ParamField[];
    build(ctx: TemplateContext): IAnim;
}

// ============================================================================
// 工具
// ============================================================================

function num(params: Record<string, unknown>, key: string, fallback: number): number {
    const v = params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 把 cc.tween 包成 IAnim 步 */
function tweenStep(node: Node, setup: (t: Tween<Node>) => Tween<Node>): IAnim {
    return starterAnim((finish) => {
        const t = setup(tween(node)).call(() => finish()).start();
        return () => t.stop();
    });
}

function ensureOpacity(node: Node): UIOpacity {
    return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
}

interface CellDiff {
    col: number;
    row: number;
    prevId: number | null;
    currId: number | null;
}

function diffCells(prev: PresentationState, curr: PresentationState): CellDiff[] {
    const out: CellDiff[] = [];
    const { cols, visibleRows } = curr.board.topology;
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < visibleRows[c]; r++) {
            const p = prev.board.resolved[c]?.[r]?.symbolId ?? null;
            const q = curr.board.resolved[c]?.[r]?.symbolId ?? null;
            if (p !== q) out.push({ col: c, row: r, prevId: p, currId: q });
        }
    }
    return out;
}

// ============================================================================
// 模板实现
// ============================================================================

/**
 * 事件步：在动画连接处发一个盘面事件并等待所有 handler。
 * handler 返回 Promise 时动画链会停在这里直到 resolve（暂停/继续语义）。
 */
function eventStep(
    ctx: TemplateContext,
    type: BoardEventType,
    cell?: { col: number; row: number; symbolId: number | null },
): IAnim {
    const ev = ctx.events;
    if (!ev) return call(() => undefined);
    return call(() =>
        ev.emit({
            type,
            frameIndex: ctx.frameIndex ?? -1,
            frameKind: readFrameExt(ctx.curr)?.frameKind ?? null,
            col: cell?.col,
            row: cell?.row,
            symbolId: cell?.symbolId,
        }),
    );
}

/** 播放时才构建（symbol 钩子必须等落地/生效时再取） */
function lazyCellAnim(build: () => IAnim | null): IAnim {
    return starterAnim((finish) => {
        const anim = build();
        if (!anim) {
            finish();
            return;
        }
        void anim.play().then(
            () => finish(),
            () => finish(),
        );
        return () => {
            if (anim.isPlaying) anim.cancel();
        };
    });
}

/** 惰性播放格子 symbol 的入场动效（prefab SymbolTemplate 或 spine enterAnim / 内置 enterFx；无则直接完成） */
function symbolEnterStep(boardView: BoardView, col: number, row: number): IAnim {
    return lazyCellAnim(() => boardView.getSymbolView(col, row)?.buildEnterAnim() ?? null);
}

/** 盘面节点局部坐标系下「屏幕上缘之外」的起始 y（保证从屏外落入） */
function offscreenTopY(boardView: BoardView): number {
    const ui = boardView.node.getComponent(UITransform);
    const screenTopLocal = ui
        ? ui.convertToNodeSpaceAR(new Vec3(0, view.getVisibleSize().height, 0)).y
        : 400;
    return screenTopLocal + boardView.cellH;
}

/**
 * 下落进场阶段：curr 有值且与 prev 不同的格子从屏外落下。
 * 下排先落（rowStagger 按 rows-1-row 计），重力加速（quadIn），落地后可配弹跳，不淡入。
 */
function buildDropInPhase(
    ctx: TemplateContext,
    opts: { dur: number; rowStagger: number; colStagger: number; bouncePx: number; bounceDur: number },
): IAnim {
    const { boardView, prev, curr } = ctx;
    const { cols, visibleRows } = curr.board.topology;
    const rows = Math.max(...visibleRows);
    const startY = offscreenTopY(boardView);
    const changed = diffCells(prev, curr).filter((d) => d.currId !== null);
    // 落距最长的格子用满 opts.dur，其余按距离等比缩短 → 各 symbol 下落速度一致
    const maxDist = Math.max(
        1,
        ...changed.map((d) => startY - boardView.cellPosition(d.col, d.row, cols, rows).y),
    );

    const steps: IAnim[] = changed.map((d) => {
        const node = boardView.getCellNode(d.col, d.row);
        if (!node) return call(() => undefined);
        const target = boardView.cellPosition(d.col, d.row, cols, rows);
        const fallDur = opts.dur * ((startY - target.y) / maxDist);
        return seq(
            delay(d.col * opts.colStagger + (rows - 1 - d.row) * opts.rowStagger),
            call(() => {
                boardView.applyCell(d.col, d.row, d.currId);
                node.setPosition(target.x, startY, 0);
                ensureOpacity(node).opacity = 255;
            }),
            tweenStep(node, (t) => {
                let tw = t.to(fallDur, { position: new Vec3(target.x, target.y, 0) }, { easing: 'quadIn' });
                if (opts.bouncePx > 0 && opts.bounceDur > 0) {
                    tw = tw
                        .to(opts.bounceDur * 0.5, { position: new Vec3(target.x, target.y + opts.bouncePx, 0) }, { easing: 'quadOut' })
                        .to(opts.bounceDur * 0.5, { position: new Vec3(target.x, target.y, 0) }, { easing: 'quadIn' });
                }
                return tw;
            }),
            eventStep(ctx, 'symbol-land', { col: d.col, row: d.row, symbolId: d.currId }),
            symbolEnterStep(boardView, d.col, d.row),
        );
    });
    return par(...steps);
}

/** 重力掉出阶段：prev 有值且将变化的格子加速掉出盘面下缘 */
function buildDropOutPhase(
    ctx: TemplateContext,
    opts: { dur: number; rowStagger: number; colStagger: number },
): IAnim {
    const { boardView, prev, curr } = ctx;
    const { cols, visibleRows } = curr.board.topology;
    const rows = Math.max(...visibleRows);
    const { h } = boardView.boardSize(cols, rows);
    const gone = diffCells(prev, curr).filter((d) => d.prevId !== null);

    const steps: IAnim[] = gone.map((d) => {
        const node = boardView.getCellNode(d.col, d.row);
        if (!node) return call(() => undefined);
        const home = boardView.cellPosition(d.col, d.row, cols, rows);
        const exitY = -h / 2 - boardView.cellH * 1.3;
        return seq(
            delay(d.col * opts.colStagger + (rows - 1 - d.row) * opts.rowStagger),
            par(
                tweenStep(node, (t) =>
                    t.to(opts.dur, { position: new Vec3(home.x, exitY, 0) }, { easing: 'quadIn' }),
                ),
                starterAnim((finish) => {
                    const op = ensureOpacity(node);
                    const tw = tween(op).delay(opts.dur * 0.5).to(opts.dur * 0.5, { opacity: 0 }).call(() => finish()).start();
                    return () => tw.stop();
                }),
            ),
            call(() => {
                // 掉出后清格并归位（若 curr 有新值，dropIn 阶段会重新摆）
                boardView.applyCell(d.col, d.row, null);
                node.setPosition(home);
                ensureOpacity(node).opacity = 255;
            }),
        );
    });
    return par(...steps);
}

const dropInTemplate: AnimTemplate = {
    id: 'dropIn',
    label: '下落进场',
    defaultParams: { fallDuration: 0.45, rowStagger: 0.06, colStagger: 0.05, bouncePx: 18, bounceDuration: 0.12 },
    paramSchema: [
        { key: 'fallDuration', label: '时长(s)', type: 'number', min: 0.05, max: 2, step: 0.05 },
        { key: 'rowStagger', label: '行交错(s)', type: 'number', min: 0, max: 0.5, step: 0.01 },
        { key: 'colStagger', label: '列交错(s)', type: 'number', min: 0, max: 0.5, step: 0.01 },
        { key: 'bouncePx', label: '弹跳高度(px)', type: 'number', min: 0, max: 80, step: 2 },
        { key: 'bounceDuration', label: '弹跳时长(s)', type: 'number', min: 0, max: 0.5, step: 0.02 },
    ],
    build(ctx: TemplateContext): IAnim {
        return buildDropInPhase(ctx, {
            dur: num(ctx.params, 'fallDuration', 0.45),
            rowStagger: num(ctx.params, 'rowStagger', 0.06),
            colStagger: num(ctx.params, 'colStagger', 0.05),
            bouncePx: num(ctx.params, 'bouncePx', 18),
            bounceDur: num(ctx.params, 'bounceDuration', 0.12),
        });
    },
};

// ---------------------------------------------------------------------------
// compactFall：压缩补位（列内现有符号下沉，无新符号进入）
// ---------------------------------------------------------------------------

interface CompactMove {
    fromRow: number;
    toRow: number;
    symbolId: number;
}

function columnSymbols(state: PresentationState, col: number, rows: number): Array<{ row: number; id: number }> {
    const out: Array<{ row: number; id: number }> = [];
    for (let r = 0; r < rows; r++) {
        const id = state.board.resolved[col]?.[r]?.symbolId ?? null;
        if (id !== null) out.push({ row: r, id });
    }
    return out;
}

const compactFallTemplate: AnimTemplate = {
    id: 'compactFall',
    label: '压缩补位',
    defaultParams: { fallDuration: 0.3, colStagger: 0, bouncePx: 14, bounceDuration: 0.1 },
    paramSchema: [
        { key: 'fallDuration', label: '时长(s)', type: 'number', min: 0.05, max: 2, step: 0.05 },
        { key: 'colStagger', label: '列交错(s)', type: 'number', min: 0, max: 0.5, step: 0.01 },
        { key: 'bouncePx', label: '弹跳高度(px)', type: 'number', min: 0, max: 80, step: 2 },
        { key: 'bounceDuration', label: '弹跳时长(s)', type: 'number', min: 0, max: 0.5, step: 0.02 },
    ],
    build(ctx: TemplateContext): IAnim {
        const { boardView, prev, curr, params } = ctx;
        const maxDur = num(params, 'fallDuration', 0.3);
        const colStagger = num(params, 'colStagger', 0);
        const bouncePx = num(params, 'bouncePx', 14);
        const bounceDur = num(params, 'bounceDuration', 0.1);
        const { cols, visibleRows } = curr.board.topology;
        const rows = Math.max(...visibleRows);

        // 逐列配对：prev 非空序列（自上而下保序）必须与 curr 非空序列一致，否则该列降级为直接切帧
        const perCol: Array<{ col: number; moves: CompactMove[] } | { col: number; invalid: true }> = [];
        let maxDistRows = 1;
        for (let c = 0; c < cols; c++) {
            const pv = columnSymbols(prev, c, visibleRows[c]);
            const cv = columnSymbols(curr, c, visibleRows[c]);
            const paired = pv.length === cv.length && pv.every((s, i) => s.id === cv[i].id);
            if (!paired) {
                console.warn(`[compactFall] 列 ${c} 前后帧不构成压缩关系（符号序列不一致），该列直接切帧`);
                perCol.push({ col: c, invalid: true });
                continue;
            }
            const moves = pv
                .map((s, i) => ({ fromRow: s.row, toRow: cv[i].row, symbolId: s.id }))
                .filter((m) => m.fromRow !== m.toRow);
            for (const m of moves) maxDistRows = Math.max(maxDistRows, m.toRow - m.fromRow);
            perCol.push({ col: c, moves });
        }

        const colAnims: IAnim[] = [];
        for (const entry of perCol) {
            const c = entry.col;
            if ('invalid' in entry) {
                colAnims.push(
                    call(() => {
                        for (let r = 0; r < visibleRows[c]; r++) {
                            boardView.applyCell(c, r, curr.board.resolved[c]?.[r]?.symbolId ?? null);
                        }
                    }),
                );
                continue;
            }
            if (!entry.moves.length) continue;
            const tweens: IAnim[] = entry.moves.map((m) => {
                const node = boardView.getCellNode(c, m.toRow);
                if (!node) return call(() => undefined);
                const to = boardView.cellPosition(c, m.toRow, cols, rows);
                const dur = maxDur * ((m.toRow - m.fromRow) / maxDistRows);
                return tweenStep(node, (t) => {
                    let tw = t.to(dur, { position: new Vec3(to.x, to.y, 0) }, { easing: 'quadIn' });
                    if (bouncePx > 0 && bounceDur > 0) {
                        tw = tw
                            .to(bounceDur * 0.5, { position: new Vec3(to.x, to.y + bouncePx, 0) }, { easing: 'quadOut' })
                            .to(bounceDur * 0.5, { position: new Vec3(to.x, to.y, 0) }, { easing: 'quadIn' });
                    }
                    return tw;
                });
            });
            colAnims.push(
                seq(
                    delay(c * colStagger),
                    // 同一列的清源/摆目标放同一个 call，避免源格与目标格重叠时相互覆盖
                    call(() => {
                        for (const m of entry.moves) boardView.applyCell(c, m.fromRow, null);
                        for (const m of entry.moves) {
                            boardView.applyCell(c, m.toRow, m.symbolId);
                            const from = boardView.cellPosition(c, m.fromRow, cols, rows);
                            boardView.getCellNode(c, m.toRow)?.setPosition(from.x, from.y, 0);
                        }
                    }),
                    par(...tweens),
                ),
            );
        }
        return par(...colAnims);
    },
};

const dropOutTemplate: AnimTemplate = {
    id: 'dropOut',
    label: '重力掉出',
    defaultParams: { fallDuration: 0.4, rowStagger: 0.05, colStagger: 0.05 },
    paramSchema: [
        { key: 'fallDuration', label: '时长(s)', type: 'number', min: 0.05, max: 2, step: 0.05 },
        { key: 'rowStagger', label: '行交错(s)', type: 'number', min: 0, max: 0.5, step: 0.01 },
        { key: 'colStagger', label: '列交错(s)', type: 'number', min: 0, max: 0.5, step: 0.01 },
    ],
    build(ctx: TemplateContext): IAnim {
        return buildDropOutPhase(ctx, {
            dur: num(ctx.params, 'fallDuration', 0.4),
            rowStagger: num(ctx.params, 'rowStagger', 0.05),
            colStagger: num(ctx.params, 'colStagger', 0.05),
        });
    },
};

const pulseTemplate: AnimTemplate = {
    id: 'pulse',
    label: '中奖脉冲',
    defaultParams: { scaleUp: 1.25, pulseDuration: 0.18, times: 2 },
    paramSchema: [
        { key: 'scaleUp', label: '放大倍数', type: 'number', min: 1, max: 2, step: 0.05 },
        { key: 'pulseDuration', label: '单次时长(s)', type: 'number', min: 0.05, max: 1, step: 0.01 },
        { key: 'times', label: '次数', type: 'number', min: 1, max: 6, step: 1 },
    ],
    build(ctx: TemplateContext): IAnim {
        const { boardView, curr, next, params } = ctx;
        const scaleUp = num(params, 'scaleUp', 1.25);
        const dur = num(params, 'pulseDuration', 0.18);
        const times = Math.round(num(params, 'times', 2));

        const cells = highlightCells(curr, next);
        if (!cells.length) return call(() => undefined);

        const steps: IAnim[] = cells.map(({ col, row }) => {
            const node = boardView.getCellNode(col, row);
            if (!node) return call(() => undefined);
            const base = node.scale.x;
            return loop(
                times,
                seq(
                    tweenStep(node, (t) =>
                        t.to(dur, { scale: new Vec3(base * scaleUp, base * scaleUp, 1) }, { easing: 'quadOut' }),
                    ),
                    tweenStep(node, (t) =>
                        t.to(dur, { scale: new Vec3(base, base, 1) }, { easing: 'quadIn' }),
                    ),
                ),
            );
        });
        return par(...steps);
    },
};

/** 高亮格集合：优先 wins；否则用「下一帧会变化的格子」推断 */
function highlightCells(
    curr: PresentationState,
    next: PresentationState | undefined,
): Array<{ col: number; row: number }> {
    const cells: Array<{ col: number; row: number }> = [];
    for (const win of curr.board.wins) cells.push(...win.cells);
    if (!cells.length && next) {
        for (const d of diffCells(curr, next)) cells.push({ col: d.col, row: d.row });
    }
    return cells;
}

const symbolWinTemplate: AnimTemplate = {
    id: 'symbolWin',
    label: '符号中奖动画',
    defaultParams: { stagger: 0 },
    paramSchema: [
        { key: 'stagger', label: '交错(s)', type: 'number', min: 0, max: 0.3, step: 0.01 },
    ],
    build(ctx: TemplateContext): IAnim {
        const { boardView, curr, next, params } = ctx;
        const stagger = num(params, 'stagger', 0);
        const cells = highlightCells(curr, next);
        if (!cells.length) return call(() => undefined);

        const steps: IAnim[] = cells.map(({ col, row }, i) =>
            seq(
                delay(i * stagger),
                eventStep(ctx, 'symbol-win', {
                    col,
                    row,
                    symbolId: curr.board.resolved[col]?.[row]?.symbolId ?? null,
                }),
                lazyCellAnim(() => {
                    // 符号自身 winAnim + 格子特效；都没配则回落一次小脉冲
                    const custom = boardView.getSymbolView(col, row)?.buildWinAnim();
                    if (custom) return custom;
                    const node = boardView.getCellNode(col, row);
                    if (!node) return null;
                    const base = node.scale.x;
                    return seq(
                        tweenStep(node, (t) =>
                            t.to(0.14, { scale: new Vec3(base * 1.2, base * 1.2, 1) }, { easing: 'quadOut' }),
                        ),
                        tweenStep(node, (t) =>
                            t.to(0.14, { scale: new Vec3(base, base, 1) }, { easing: 'quadIn' }),
                        ),
                    );
                }),
            ),
        );
        return par(...steps);
    },
};

const vanishTemplate: AnimTemplate = {
    id: 'vanish',
    label: '消除',
    defaultParams: { vanishDuration: 0.25, stagger: 0.02 },
    paramSchema: [
        { key: 'vanishDuration', label: '时长(s)', type: 'number', min: 0.05, max: 1, step: 0.05 },
        { key: 'stagger', label: '交错(s)', type: 'number', min: 0, max: 0.3, step: 0.01 },
    ],
    build(ctx: TemplateContext): IAnim {
        const { boardView, prev, curr, params } = ctx;
        const dur = num(params, 'vanishDuration', 0.25);
        const stagger = num(params, 'stagger', 0.02);
        const gone = diffCells(prev, curr).filter((d) => d.prevId !== null && d.currId === null);

        const steps: IAnim[] = gone.map((d, i) => {
            const node = boardView.getCellNode(d.col, d.row);
            if (!node) return call(() => undefined);
            return seq(
                delay(i * stagger),
                // 消除连接处事件：加分等业务挂这里；handler 返回 Promise 可暂停动画链
                eventStep(ctx, 'symbol-vanish', { col: d.col, row: d.row, symbolId: d.prevId }),
                lazyCellAnim(() =>
                    // 符号自身演出 + 格子特效并行；本体缺省缩淡由 SymbolView 内部
                    // 作用在 content 子节点上（不缩 cell，避免波及格子特效）
                    boardView.getSymbolView(d.col, d.row)?.buildVanishAnim(dur) ?? null,
                ),
                call(() => {
                    boardView.applyCell(d.col, d.row, null);
                    // cell 节点是动画载体，消除后仍归位一次（防其它模板残留缩放/透明度）
                    node.setScale(1, 1, 1);
                    ensureOpacity(node).opacity = 255;
                }),
            );
        });
        return par(...steps);
    },
};

const noopTemplate: AnimTemplate = {
    id: 'noop',
    label: '无动画',
    defaultParams: {},
    paramSchema: [],
    build(): IAnim {
        return call(() => undefined);
    },
};

// ============================================================================
// 注册表
// ============================================================================

const TEMPLATES: Record<string, AnimTemplate> = {
    dropIn: dropInTemplate,
    dropOut: dropOutTemplate,
    compactFall: compactFallTemplate,
    pulse: pulseTemplate,
    symbolWin: symbolWinTemplate,
    vanish: vanishTemplate,
    noop: noopTemplate,
};

/**
 * frameKind → 允许的模板列表（兼容表）。
 * 第一项为该 frameKind 的默认（auto）模板；override 只能在列表内选。
 */
const KIND_ALLOWED: Record<IrFrameKind, string[]> = {
    'enter-table': ['dropIn', 'noop'],
    reveal: ['dropIn', 'noop'],
    'bonus-reveal': ['dropIn', 'noop'],
    highlight: ['symbolWin', 'pulse', 'noop'],
    'bonus-highlight': ['symbolWin', 'pulse', 'noop'],
    'enter-table-mid-cascade': ['dropIn', 'noop'],
    postClear: ['vanish', 'dropOut', 'noop'],
    compact: ['compactFall', 'noop'],
    expandPre: ['noop', 'pulse'],
    expandPost: ['noop', 'pulse'],
    spinEnd: ['noop', 'pulse'],
};

export function getTemplate(id: string): AnimTemplate | null {
    return TEMPLATES[id] ?? null;
}

export function allTemplates(): AnimTemplate[] {
    return Object.values(TEMPLATES);
}

/** 某 frameKind 允许的模板 id 列表（首项为默认） */
export function allowedTemplateIds(kind: IrFrameKind): string[] {
    return KIND_ALLOWED[kind] ?? ['noop'];
}

/** override 对该 frameKind 是否合法 */
export function isTemplateAllowed(kind: IrFrameKind, templateId: string): boolean {
    return allowedTemplateIds(kind).includes(templateId);
}

/** 按帧的 frameKind + templateId override 解析模板与参数（非法 override 回落默认） */
export function resolveTemplateForState(state: PresentationState): {
    template: AnimTemplate;
    params: Record<string, unknown>;
} {
    const ext = readFrameExt(state);
    const allowed = ext ? allowedTemplateIds(ext.frameKind) : ['noop'];
    const overrideId = ext?.templateId;
    const effectiveId = overrideId && allowed.includes(overrideId) ? overrideId : allowed[0];
    const template = TEMPLATES[effectiveId] ?? noopTemplate;
    const params = { ...template.defaultParams, ...(ext?.templateParams ?? {}) };
    return { template, params };
}
