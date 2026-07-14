/**
 * GamePack — 多游戏符号包注册表。
 *
 * 资源约定（每包自洽，可并存于同一 symbolEditor）：
 *   assets/resources/games/<gameId>/
 *     symbol-library.prefab
 *     symbols/  oriSymbols/  font/  effects/ …
 *
 * 盘面文档（cfg）仍可放在 resources/configs；换包只换符号表与美术引用。
 * 编辑器运行时用 localStorage 记住上次选用的 gameId。
 */

export interface GamePackDef {
    /** 稳定 id，对应目录名 games/<id>/ */
    id: string;
    /** HUD 显示名 */
    name: string;
    /**
     * resources.load 路径（无扩展名）。
     * 例：games/golden-seth/symbol-library
     */
    libraryPath: string;
}

/** 已入库的游戏包（新增游戏：拷资源进 games/<id>/，再在此登记一行） */
export const GAME_PACKS: readonly GamePackDef[] = [
    {
        id: 'golden-seth',
        name: 'Golden Seth',
        libraryPath: 'games/golden-seth/symbol-library',
    },
];

export const DEFAULT_GAME_ID = GAME_PACKS[0]?.id ?? 'golden-seth';

export const GAME_ID_STORE_KEY = 'symbolEditor.gameId';

export function getGamePack(id: string | null | undefined): GamePackDef {
    const found = GAME_PACKS.find((p) => p.id === id);
    return found ?? GAME_PACKS[0]!;
}

export function loadStoredGameId(): string {
    try {
        const raw = localStorage.getItem(GAME_ID_STORE_KEY);
        if (raw && GAME_PACKS.some((p) => p.id === raw)) return raw;
    } catch {
        /* 预览容器无 localStorage */
    }
    return DEFAULT_GAME_ID;
}

export function storeGameId(id: string): void {
    try {
        localStorage.setItem(GAME_ID_STORE_KEY, id);
    } catch {
        /* ignore */
    }
}

/** 按当前列表循环切换（dir=±1） */
export function cycleGameId(currentId: string, dir: 1 | -1): GamePackDef {
    const list = GAME_PACKS;
    if (list.length === 0) throw new Error('GAME_PACKS 为空');
    const i = Math.max(0, list.findIndex((p) => p.id === currentId));
    const next = (i + dir + list.length) % list.length;
    return list[next]!;
}
