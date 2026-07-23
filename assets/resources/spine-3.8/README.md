# Spine 资源区

符号 / Spine 资源按**运行时版本**分区。包内两层配置：

```
assets/resources/
  spine-3.8/packs/<packId>/
    asset-library.prefab    # ① 素材库（最小单位；Creator 登记）
    symbol-library.prefab   # ② 符号表运行时容器（布局请用 H5 编）
  spine-4.2/packs/<packId>/
  configs/spine-zone.active.json
```

编辑顺序：**素材（Creator）→ 符号（H5 SymbolEditor，含包布局）→ 盘面（H5 BoardEditor）**。
盘面编辑器只使用符号；布局来自 `SymbolSheetDoc.packLayout` 叠加到库内存。

## 切换（重启预览）

```bash
node tools/switch-spine-zone.cjs 3.8
node tools/switch-spine-zone.cjs 4.2
```

## 登记包

在 `GamePack.ts` 的 `SYMBOL_PACKS` 追加一行，并指定 `zone`；可选填 `seedDocId` / `seedDocPath` / `seedRev`（BoardEditor 切包自动绑种子盘面）。

当前 3.8 区：`golden-seth`、`power-of-thor2`、`bounty-hunter`。
