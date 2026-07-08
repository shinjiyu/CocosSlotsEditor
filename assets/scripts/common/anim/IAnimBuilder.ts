import type { AnimId } from "./AnimId";
import type { IAnim } from "./IAnim";
import type { IAnimBuildContext } from "./IAnimBuildContext";

/**
 * 可按 animId 构建 IAnim 的实现体（wheelboard、Reel、UI View 等）。
 * 每次 buildAnim 应返回新实例，供 compose 拥有。
 */
export interface IAnimBuilder {
    buildAnim(animId: AnimId, ctx: IAnimBuildContext): IAnim | null;
}
