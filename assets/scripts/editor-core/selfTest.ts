/**
 * editor-core 自测 — 不依赖 Cocos，可在预览页 / 浏览器控制台直接跑。
 * 返回 { ok, failures }；每条断言失败都收集，不抛异常中断。
 */

import { makeEmptyDoc, makeEmptyState, validateDoc, serializeDoc, deserializeDoc } from './session';
import {
    AddStateCommand,
    RemoveStateCommand,
    SetResolvedCellCommand,
    SetFrameKindCommand,
    CommandHistory,
} from './commands';
import { readFrameExt } from './frameExt';

export interface SelfTestResult {
    ok: boolean;
    total: number;
    failures: string[];
}

export function runEditorCoreSelfTest(): SelfTestResult {
    const failures: string[] = [];
    let total = 0;
    const check = (name: string, cond: boolean) => {
        total++;
        if (!cond) failures.push(name);
    };

    // 1. 空文档合法
    const doc = makeEmptyDoc('doc_test', '自测文档', 6, 5);
    check('empty doc valid', validateDoc(doc).length === 0);
    check('initial frameKind', readFrameExt(doc.states[0])?.frameKind === 'enter-table');

    // 2. 命令 + undo/redo
    const history = new CommandHistory(doc);
    history.execute(new AddStateCommand(1, doc.states[0], 'reveal'));
    check('addState count', doc.states.length === 2);
    check('addState kind', readFrameExt(doc.states[1])?.frameKind === 'reveal');

    history.execute(new SetResolvedCellCommand(1, 2, 3, 7));
    check('setCell value', doc.states[1].board.resolved[2][3].symbolId === 7);
    check('setCell isolated', doc.states[0].board.resolved[2][3].symbolId === null);

    history.execute(new SetFrameKindCommand(1, 'highlight'));
    check('setFrameKind', readFrameExt(doc.states[1])?.frameKind === 'highlight');

    history.undo();
    check('undo frameKind', readFrameExt(doc.states[1])?.frameKind === 'reveal');
    history.undo();
    check('undo setCell', doc.states[1].board.resolved[2][3].symbolId === null);
    history.redo();
    check('redo setCell', doc.states[1].board.resolved[2][3].symbolId === 7);

    // 3. removeState 守护
    let threw = false;
    const single = makeEmptyDoc('doc_single', '单帧', 2, 2);
    try {
        new RemoveStateCommand(0).apply(single);
    } catch {
        threw = true;
    }
    check('removeState guard', threw);

    // 4. 编辑后仍然是合法 SPIR
    check('doc valid after edits', validateDoc(doc).length === 0);

    // 5. serde round-trip（含 anchors Set）
    doc.states[0].board.anchors.locks.add('1,1');
    const restored = deserializeDoc(serializeDoc(doc));
    check('roundtrip states', restored.states.length === doc.states.length);
    check('roundtrip cell', restored.states[1].board.resolved[2][3].symbolId === 7);
    check('roundtrip Set', restored.states[0].board.anchors.locks.has('1,1'));
    check('roundtrip valid', validateDoc(restored).length === 0);

    // 6. makeEmptyState 各 frameKind 不变式
    const reveal = makeEmptyState({ sessionId: 's', cols: 3, rows: 3, frameKind: 'reveal' });
    check('reveal phase', reveal.phase === 'consequence');

    return { ok: failures.length === 0, total, failures };
}
