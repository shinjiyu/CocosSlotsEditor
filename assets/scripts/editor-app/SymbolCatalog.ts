/**
 * SymbolCatalog — 运行时符号配置入口。
 *
 * 加载顺序：
 *   1) asset-library.prefab（素材库，可缺省 → 旧包直引模式）
 *   2) symbol-library.prefab（符号表，可引用素材 id）
 * 对外 getEntry 返回已解析副本，盘面编辑器只消费符号，不直接碰素材。
 */

import { Color, EffectAsset, Material, Prefab, SpriteFrame, Texture2D, resources } from 'cc';
import { DESIGN_CELL_H, DESIGN_CELL_W, isMultiEntry } from './SymbolDefs';
import type { CellFxDef, DissolveFxConfig, SymbolEntry, SymbolProvider } from './SymbolDefs';
import { SymbolLibrary } from './SymbolLibrary';
import { AssetLibrary } from './AssetLibrary';
import type { AssetProvider } from './AssetDefs';
import { resolveSymbolEntryCopy } from './SymbolResolve';
import {
    DEFAULT_GAME_ID,
    assertPackLibraryPath,
    assetLibraryPathFor,
    getGamePack,
    libraryPathFor,
    type SymbolPackDef,
} from './GamePack';
import { packResourcePath } from './SpineZone';

export class SymbolCatalog implements SymbolProvider {
    private lib: SymbolLibrary | null = null;
    private assets: AssetLibrary | null = null;
    private resolved = new Map<number, SymbolEntry>();
    private vanishDissolve: DissolveFxConfig | null = null;

    /** 编辑期直接用现成组件构建（预览墙用） */
    static fromLibrary(lib: SymbolLibrary, assets: AssetLibrary | null = null): SymbolCatalog {
        const c = new SymbolCatalog();
        c.lib = lib;
        c.assets = assets;
        c.rebuildResolved();
        return c;
    }

    get assetLibrary(): AssetProvider | null {
        return this.assets;
    }

    /** 未解析的源符号表（prefab 上的 SymbolEntry，含 *AssetId） */
    getSourceEntries(): SymbolEntry[] {
        return this.lib?.symbols ?? [];
    }

    get all(): SymbolEntry[] {
        return [...this.resolved.values()];
    }

    getEntry(id: number): SymbolEntry | null {
        return this.resolved.get(id) ?? null;
    }

    get designW(): number {
        return this.lib?.designW ?? DESIGN_CELL_W;
    }

    get designH(): number {
        return this.lib?.designH ?? DESIGN_CELL_H;
    }

    getFrame(id: number): SpriteFrame | null {
        return this.getEntry(id)?.texture ?? null;
    }

    winCellFxFor(id: number): CellFxDef | null {
        const e = this.getEntry(id);
        if (isMultiEntry(e)) return null;
        if (e?.winCellFx?.valid) return e.winCellFx;
        return this.lib?.winCellFx.valid ? this.lib.winCellFx : null;
    }

    vanishCellFxFor(id: number): CellFxDef | null {
        const e = this.getEntry(id);
        if (e?.vanishCellFx?.valid) return e.vanishCellFx;
        return this.lib?.vanishCellFx.valid ? this.lib.vanishCellFx : null;
    }

    vanishDissolveFor(id: number): DissolveFxConfig | null {
        const entry = this.getEntry(id);
        if (!entry?.texture || entry.vanishAnim) return null;
        return this.vanishDissolve;
    }

    digitFontFor(id: number) {
        const e = this.getEntry(id);
        if (!isMultiEntry(e)) return null;
        return e!.digitFont ?? this.lib?.multiDigitFont ?? null;
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
     * 按包加载：先素材库（可选），再符号库并解析。
     * @param libPath 符号库 resources 路径；缺省当前默认包
     * @param assetPath 素材库路径；缺省同包 asset-library
     */
    async load(
        libPath = getGamePack(DEFAULT_GAME_ID).libraryPath,
        assetPath?: string | null,
    ): Promise<void> {
        assertPackLibraryPath(libPath);

        this.assets = null;
        const tryAsset = assetPath === null ? null : (assetPath ?? guessAssetPath(libPath));
        if (tryAsset) {
            try {
                assertPackLibraryPath(tryAsset);
                const assetPrefab = await loadRes<Prefab>(tryAsset, Prefab);
                this.assets =
                    assetPrefab.data?.getComponent(AssetLibrary) ?? null;
                if (this.assets) {
                    console.log(`[SymbolCatalog] asset-library ← ${tryAsset} (${this.assets.assets.length} assets)`);
                }
            } catch (e) {
                console.warn(
                    `[SymbolCatalog] 无素材库 ${tryAsset}，符号将使用直接引用（旧包模式）`,
                    (e as Error)?.message ?? e,
                );
            }
        }

        const prefab = await loadRes<Prefab>(libPath, Prefab);
        const lib = prefab.data?.getComponent(SymbolLibrary) ?? null;
        if (!lib) throw new Error(`${libPath} 根节点缺少 SymbolLibrary 组件`);
        this.lib = lib;
        this.rebuildResolved();
        const seen = new Set<number>();
        for (const e of this.resolved.values()) {
            if (seen.has(e.id)) console.warn(`[SymbolCatalog] 重复的 symbol id: ${e.id} (${e.name})`);
            seen.add(e.id);
        }
        console.log(
            `[SymbolCatalog] symbols ← ${libPath} (${this.resolved.size} resolved, assets=${this.assets ? 'yes' : 'no'})`,
        );
    }

    /** 按 SymbolPackDef 加载（推荐） */
    async loadPack(pack: SymbolPackDef): Promise<void> {
        await this.load(libraryPathFor(pack), assetLibraryPathFor(pack));
        await this.loadOptionalDissolve(pack);
    }

    private async loadOptionalDissolve(pack: SymbolPackDef): Promise<void> {
        this.vanishDissolve = null;
        const maskPath = `${packResourcePath(pack.zone, pack.id, 'static/dissolve/dissolve-cloud')}/spriteFrame`;
        try {
            const [effect, maskFrame] = await Promise.all([
                loadRes<EffectAsset>('effects/lvbu-dissolve-sprite', EffectAsset),
                loadRes<SpriteFrame>(maskPath, SpriteFrame),
            ]);
            const material = new Material();
            material.initialize({ effectAsset: effect });
            this.vanishDissolve = {
                material,
                maskTexture: maskFrame.texture as Texture2D,
                duration: 0.33,
                softness: 0.045,
                edgeWidth: 0.13,
                edgeGlow: 2.2,
                edgeColor: new Color(255, 62, 8, 255),
            };
        } catch (e) {
            console.warn(`[SymbolCatalog] optional dissolve unavailable for ${pack.id}`, (e as Error)?.message ?? e);
        }
    }

    private rebuildResolved(): void {
        this.resolved.clear();
        if (!this.lib) return;
        for (const e of this.lib.symbols) {
            this.resolved.set(e.id, resolveSymbolEntryCopy(e, this.assets));
        }
    }
}

/** symbol-library → 同目录 asset-library */
function guessAssetPath(symbolLibPath: string): string {
    return symbolLibPath.replace(/symbol-library\/?$/, 'asset-library').replace(/symbol-library$/, 'asset-library');
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
