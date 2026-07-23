# golden-seth pack (spine-3.8)

```
asset-library.prefab   # 纹理 / spine / 字体 / 扩散粒子素材
symbol-library.prefab  # 逻辑符号；*AssetId 引用素材库
symbols/               # 静态符号图
oriSymbols/            # spine 源
font/ effects/         # 倍率字、扩散 FX
```

## 符号配置

- **配置入口**：H5 `SymbolEditor` 场景（BoardEditor 工具栏「→符号」）
- **不要**再靠 Creator 里双击 `symbol-library.prefab` 画预览墙改符号（已移除编辑期预览）
- 符号条目优先填 `textureAssetId` / `spineAssetId` / `digitFontAssetId`；运行时由 `SymbolCatalog` 解析

## 重建素材库

若从旧「直引 UUID」包重新生成：

```text
node tools/migrate-golden-seth-asset-library.cjs
# Creator refresh assets/resources/spine-3.8/packs/golden-seth
```

## 与 LvBu 的差异

- 固定盘面，无 `placementMainId` / `visualVariants`（倍率球用 `kind=multi`）
- 扩散 FX 挂在 `SymbolLibrary.expandSplitParticle` / `expandSplitB`（不再硬编码路径）
