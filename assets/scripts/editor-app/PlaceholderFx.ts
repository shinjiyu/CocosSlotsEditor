/**
 * PlaceholderFx — 符号演出的临时占位实现。
 *
 * 背景：Unity 特效（多层发光 + 湍流 shader + ParticleSystem）无法用
 * unitypackage 里的静态贴图 1:1 还原，逐像素还原路线已放弃（见 lvbu/README.md）。
 * 这里只用最小 tween 占位，**不依赖任何贴图 / 材质 / 额外节点**：
 *
 *  · 中奖高亮 = 颜色脉冲（子 Sprite 短暂提亮再复原）+ 轻微缩放脉冲；
 *  · 消除     = 淡出（透明度 → 0，略微缩小）。
 *
 * 真特效就绪后，只需替换本模块的两个入口，调用方（ISymbolRenderer 的
 * buildWinAnim / buildVanishAnim）接口不变。
 */

import { Color, Node, Sprite, Tween, UIOpacity, Vec3, tween } from 'cc';

export interface FxHandle {
    /** 演出自然播完（或被 cancel）后 resolve。 */
    done: Promise<void>;
    /** 立刻停止并复原，随后 resolve done。 */
    cancel: () => void;
}

/** 中奖高亮时子 Sprite 提亮到的目标色（加性感的暖金）。 */
const WIN_FLASH = new Color(255, 236, 170, 255);

interface Handle extends FxHandle {
    settle: () => void;
}

function makeHandle(): Handle {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    let settled = false;
    const settle = (): void => {
        if (settled) return;
        settled = true;
        resolve();
    };
    return { done, cancel: settle, settle };
}

/** 收集节点子树里所有带 spriteFrame 的 Sprite。 */
function collectSprites(root: Node): Sprite[] {
    return root.getComponentsInChildren(Sprite).filter((s) => !!s.spriteFrame);
}

/**
 * 中奖占位：整体缩放脉冲 + 子 Sprite 颜色提亮脉冲，约 0.6s，播完复原。
 * @param target 符号根节点
 */
export function playWinPlaceholder(target: Node): FxHandle {
    const h = makeHandle();
    if (!target.isValid) {
        h.settle();
        return h;
    }

    const baseScale = target.scale.clone();
    const sprites = collectSprites(target);
    const baseColors = sprites.map((s) => s.color.clone());

    let cancelled = false;
    const restore = (): void => {
        if (target.isValid) target.setScale(baseScale);
        sprites.forEach((s, i) => {
            if (s.isValid) s.color = baseColors[i]!;
        });
    };

    // 颜色脉冲：base → 提亮 → base（用一个 0..1 进度驱动 lerp）
    const flash = { t: 0 };
    const colorTween = tween(flash)
        .to(0.18, { t: 1 }, {
            onUpdate: () => {
                sprites.forEach((s, i) => {
                    if (s.isValid) s.color = baseColors[i]!.clone().lerp(WIN_FLASH, flash.t);
                });
            },
        })
        .to(0.34, { t: 0 }, {
            onUpdate: () => {
                sprites.forEach((s, i) => {
                    if (s.isValid) s.color = baseColors[i]!.clone().lerp(WIN_FLASH, flash.t);
                });
            },
        });

    const scaleTween = tween(target)
        .to(0.18, { scale: new Vec3(baseScale.x * 1.12, baseScale.y * 1.12, baseScale.z) }, { easing: 'quadOut' })
        .to(0.34, { scale: baseScale.clone() }, { easing: 'quadIn' })
        .call(() => {
            if (cancelled) return;
            restore();
            h.settle();
        });

    const handle = h as Handle;
    handle.cancel = () => {
        cancelled = true;
        (colorTween as Tween<object>).stop();
        (scaleTween as Tween<object>).stop();
        restore();
        h.settle();
    };

    colorTween.start();
    scaleTween.start();
    return handle;
}

/**
 * 消除占位：透明度淡出 + 略微缩小，约 0.24s。
 * 播完格子会被清空，无需复原（cancel 会立刻复原透明度/缩放）。
 * @param target 符号根节点
 */
export function playVanishPlaceholder(target: Node): FxHandle {
    const h = makeHandle();
    if (!target.isValid) {
        h.settle();
        return h;
    }

    const op = target.getComponent(UIOpacity) ?? target.addComponent(UIOpacity);
    const baseOpacity = op.opacity;
    const baseScale = target.scale.clone();

    const restore = (): void => {
        if (op.isValid) op.opacity = baseOpacity;
        if (target.isValid) target.setScale(baseScale);
    };

    const opTween = tween(op).to(0.22, { opacity: 0 }, { easing: 'quadIn' });
    const scaleTween = tween(target)
        .to(0.22, { scale: new Vec3(baseScale.x * 0.82, baseScale.y * 0.82, baseScale.z) }, { easing: 'quadIn' })
        .call(() => h.settle());

    const handle = h as Handle;
    handle.cancel = () => {
        (opTween as Tween<object>).stop();
        (scaleTween as Tween<object>).stop();
        restore();
        h.settle();
    };

    opTween.start();
    scaleTween.start();
    return handle;
}
