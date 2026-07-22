# Spine 资源区

符号 / Spine 资源按**运行时版本**分区。包内两层配置：

```
assets/resources/
  spine-3.8/packs/<packId>/
    asset-library.prefab    # ① 素材库（最小单位）
    symbol-library.prefab   # ② 符号表（引用素材 id）
  spine-4.2/packs/<packId>/
  configs/spine-zone.active.json
```

编辑顺序：**素材 → 符号 → 盘面**。盘面编辑器只使用符号。

## 切换（重启预览）

```bash
node tools/switch-spine-zone.cjs 3.8
node tools/switch-spine-zone.cjs 4.2
```

## 登记包

在 `GamePack.ts` 的 `SYMBOL_PACKS` 追加一行，并指定 `zone`。
