export { ANIM_CONTRACT_VERSION } from "./version";

export type { IAnim, IRepeatableAnim, AnimState } from "./IAnim";
export { CancelledError } from "./IAnim";

export type { AnimId } from "./AnimId";
export type { IAnimBuildContext } from "./IAnimBuildContext";
export type { IAnimBuilder } from "./IAnimBuilder";

export type { AnimEventId } from "./AnimEventId";
export { animEventId } from "./AnimEventId";
export type {
    AnimEventDef,
    AnimEventMapFromDefs,
    AnimEventPayload,
} from "./AnimEventDef";
export { defineAnimEvent } from "./AnimEventDef";
export type { AnimEventHandlerMap, AnimEventHandlerMapFromDefs } from "./AnimEventScope";
export { AnimEventScope, bindAnimEventHandlers, bindAnimEventHandlersFromDefs } from "./AnimEventScope";
export type { AnimEventSpec } from "./AnimEventSpec";
export { animEventSpec, eventsForAnim, warnIfUndeclaredAnimEvent } from "./AnimEventSpec";
export { emitAnimEvent } from "./emitAnimEvent";
export { resolveAnimEvents } from "./resolveAnimEvents";

export type { AnimOptions } from "./Anim";
export { Anim } from "./Anim";

export {
    seq,
    par,
    race,
    loop,
    forever,
    delay,
    call,
    starterAnim,
    playSpine,
    playClip,
    playParticleBurst,
} from "./compose";
export type { PlaySpineOptions, PlayClipOptions, PlayParticleBurstOptions } from "./compose";

export { SerialAnimQueue } from "./SerialAnimQueue";
export type { AnimQueueTask } from "./SerialAnimQueue";
