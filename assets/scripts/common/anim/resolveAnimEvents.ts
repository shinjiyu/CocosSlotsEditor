import type { IAnimBuildContext } from "./IAnimBuildContext";
import { AnimEventScope } from "./AnimEventScope";

/** motion / builder 侧：从 ctx 取 event scope，缺省为 no-op empty。 */
export function resolveAnimEvents(ctx: IAnimBuildContext): AnimEventScope {
    return ctx.events ?? AnimEventScope.empty();
}
