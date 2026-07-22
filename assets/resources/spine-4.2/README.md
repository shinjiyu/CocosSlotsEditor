# spine-4.2 / packs

本区只放 **Spine 4.x** 资源（如吕布 4.1.20）。

包结构：

```
packs/<packId>/
  asset-library.prefab   # ① 纹理 / spine / 音频 / 特效…
  symbol-library.prefab  # ② 符号引用素材 id
  …原始资源目录…
```

盘面逻辑见 `configs/board-layouts/` 与 `board-layout/` 脚本（与包资源分离）。

## 导入步骤

1. `node tools/switch-spine-zone.cjs 4.2` 并重启 Creator / 预览
2. 建 `asset-library` → 再组 `symbol-library`
3. 在 `SYMBOL_PACKS` 登记 `zone: 'spine-4.2'`
