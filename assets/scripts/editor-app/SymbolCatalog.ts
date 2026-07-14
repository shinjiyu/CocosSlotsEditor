/**
 * SymbolCatalog — 运行时符号配置入口。
 *
 * 数据源是 resources/games/<gameId>/symbol-library.prefab（根节点挂 SymbolLibrary 组件，
 * 全部配置在 Creator Inspector 完成）。本类只负责加载 prefab、
 * 从组件读出条目，向 BoardView/EditorHud 提供查询。
 * 资源都是直接引用（随 prefab 依赖一起加载），无路径、无 JSON。
 */

import { Prefab, SpriteFrame, resources } from 'cc';
import { DESIGN_CELL_H, DESIGN_CELL_W } from './SymbolDefs';
import type { CellFxDef, SymbolEntry, SymbolProvider } from './SymbolDefs';
import { SymbolLibrary } from './SymbolLibrary';
import { DEFAULT_GAME_ID, getGamePack } from './GamePack';

export class SymbolCatalog implements SymbolProvider {
    private lib: SymbolLibrary | null = null;

    /** 编辑期直接用现成组件构建（预览墙用） */
    static fromLibrary(lib: SymbolLibrary): SymbolCatalog {
        const c = new SymbolCatalog();
        c.lib = lib;
        return c;
    }

    get all(): SymbolEntry[] {
        return this.lib?.symbols ?? [];
    }

    getEntry(id: number): SymbolEntry | null {
        return this.lib?.getEntry(id) ?? null;
    }

    get designW(): number {
        return this.lib?.designW ?? DESIGN_CELL_W;
    }

    get designH(): number {
        return this.lib?.designH ?? DESIGN_CELL_H;
    }

    /** 刷子面板图标（纹理；spine-only 条目可能为 null） */
    getFrame(id: number): SpriteFrame | null {
        return this.getEntry(id)?.texture ?? null;
    }

    winCellFxFor(id: number): CellFxDef | null {
        return this.lib?.winCellFxFor(id) ?? null;
    }

    vanishCellFxFor(id: number): CellFxDef | null {
        return this.lib?.vanishCellFxFor(id) ?? null;
    }

    digitFontFor(id: number) {
        return this.lib?.digitFontFor(id) ?? null;
    }

    get expandSplitFx() {
        return (
            this.lib?.expandSplitFx ?? {
                splitParticle: null,
                splitB: null,
                splitBAnim: 'split_B',
            }
        );
    }

    /**
     * 加载符号库 prefab。
     * @param libPath resources 相对路径（无扩展名），默认当前默认游戏包
     */
    async load(libPath = getGamePack(DEFAULT_GAME_ID).libraryPath): Promise<void> {
        const prefab = await loadRes<Prefab>(libPath, Prefab);
        const lib = prefab.data?.getComponent(SymbolLibrary) ?? null;
        if (!lib) throw new Error(`${libPath} 根节点缺少 SymbolLibrary 组件`);
        this.lib = lib;
        const seen = new Set<number>();
        for (const e of lib.symbols) {
            if (seen.has(e.id)) console.warn(`[SymbolCatalog] 重复的 symbol id: ${e.id} (${e.name})`);
            seen.add(e.id);
        }
    }
}

function loadRes<T>(path: string, type: new (...args: never[]) => T): Promise<T> {
    return new Promise((resolve, reject) => {
        (resources.load as (p: string, t: unknown, cb: (err: Error | null, asset: T) => void) => void)(
            path,
            type,
            (err, asset) => {
                if (err) reject(new Error(`resources.load 失败: ${path}: ${err.message}`));
                else resolve(asset);
            },
        );
    });
}

export { loadRes };
