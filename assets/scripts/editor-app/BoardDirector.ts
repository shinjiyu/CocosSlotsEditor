/**
 * BoardDirector — 按 SPIR 帧序列播放转移动画（M3）。
 * 相邻两帧 (prev → curr)：先渲染 prev，再按 curr 的 frameKind 解析模板播放。
 * Playfield 的 Editor 简化版。
 */

import type { IAnim } from '../common/anim/IAnim';
import { CancelledError } from '../common/anim/IAnim';
import { par } from '../common/anim/compose';
import type { EditorDoc } from '../editor-core/index';
import { readFrameExt } from '../editor-core/index';
import type { BoardView } from './BoardView';
import { resolveTemplateForState } from './animTemplates';
import { BoardEvents } from './boardEvents';

export class BoardDirector {
    /** 播放事件总线：on('symbol-vanish'|...|'*')；handler 返回 Promise 可暂停动画链 */
    readonly events = new BoardEvents();

    private current: IAnim | null = null;
    private playing = false;

    constructor(
        private boardView: BoardView,
        private getDoc: () => EditorDoc | null,
    ) {}

    private emit(type: Parameters<BoardEvents['emit']>[0]['type'], frameIndex: number): Promise<void> {
        const doc = this.getDoc();
        const kind = doc ? readFrameExt(doc.states[frameIndex])?.frameKind ?? null : null;
        return this.events.emit({ type, frameIndex, frameKind: kind });
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    stop(): void {
        if (this.current?.isPlaying) this.current.cancel();
        this.current = null;
        this.playing = false;
    }

    /**
     * 播放 [fromIndex, toIndex] 区间；每步完成后回调 onStep（同步时间轴选中）。
     * 帧 ext.playWithPrev = true 时，其转移与上一帧转移合成 par 同时播放
     * （连续标记可组成更长的并行批）。返回实际停在的帧 index。
     */
    async playRange(fromIndex: number, toIndex: number, onStep?: (index: number) => void): Promise<number> {
        const doc = this.getDoc();
        if (!doc || this.playing) return fromIndex;
        const start = Math.max(0, fromIndex);
        const end = Math.min(toIndex, doc.states.length - 1);
        if (end <= start) return start;

        this.playing = true;
        this.boardView.render(doc.states[start]);
        let landed = start;
        try {
            await this.emit('play-start', start);
            let i = start + 1;
            while (i <= end) {
                // 收集并行批：[i, batchEnd]，后续帧只要标了 playWithPrev 就并进来
                let batchEnd = i;
                while (batchEnd + 1 <= end && readFrameExt(doc.states[batchEnd + 1])?.playWithPrev) {
                    batchEnd++;
                }
                const anims: IAnim[] = [];
                for (let k = i; k <= batchEnd; k++) {
                    await this.emit('transition-start', k);
                    const { template, params } = resolveTemplateForState(doc.states[k]);
                    anims.push(
                        template.build({
                            boardView: this.boardView,
                            prev: doc.states[k - 1],
                            curr: doc.states[k],
                            next: doc.states[k + 1],
                            params,
                            events: this.events,
                            frameIndex: k,
                        }),
                    );
                }
                const anim = anims.length === 1 ? anims[0] : par(...anims);
                this.current = anim;
                await anim.play();
                // 动画只演过程；结束后以批末帧的 resolved 为准全量落帧
                this.boardView.render(doc.states[batchEnd]);
                landed = batchEnd;
                for (let k = i; k <= batchEnd; k++) {
                    await this.emit('transition-end', k);
                }
                onStep?.(batchEnd);
                i = batchEnd + 1;
            }
        } catch (e) {
            if (!(e instanceof CancelledError)) {
                console.error('[BoardDirector] play failed', e);
            }
        } finally {
            this.current = null;
            this.playing = false;
            void this.emit('play-end', landed);
        }
        return landed;
    }
}
