# power-of-thor2 (spine-3.8)

雷神2 符号包。静帧来自 `PowerOfThor2Recovered`，Spine 来自 harExplore `power-of-thor2`。

包级特效：`effects/symbol_win`（通用高亮）、`effects/symbol_eliminate`（通用消除），动画名均为 `play`。

## 重建

```bash
node tools/import-power-of-thor2-pack.cjs
# Creator refresh db://assets/resources/spine-3.8/packs/power-of-thor2
node tools/build-power-of-thor2-libraries.cjs
# 再 refresh asset-library / symbol-library
```

## 盘面布局（还原自 PowerOfThor2Recovered）

| 项 | 值 |
|----|----|
| 设计格 | 116×96（reel 中心 pitch） |
| 列距/行距 | 0 / 0 |
| 盘面 | 6×5 |
| 格子 FX scale | 0.75（高亮/消除贴合格） |

**配置入口（唯一）**：预览打开 `SymbolEditor` → 右侧「包布局」页，改设计格 / 间距 / 锁定 / FX scale。数据写入 `SymbolSheetDoc.packLayout`（localStorage + 导出 JSON）。不要在 Creator Inspector 改 `symbol-library`。

BoardEditor 切到本包时会叠加同一份 sheet；未锁定时调列距/行距也会写回 `packLayout`。业务盘面 `BoardStage` 默认 `跟随符号库布局`。

对照盘面：`configs/presentation/doc_thor2_recovered.json`（从还原工程 scene 抽出的一帧 6×5，符号 id 已换算为本包）。BoardEditor 切到本包时自动加载。

重建对照盘：

```bash
node tools/extract-thor2-board-from-recovered.cjs
```

## 符号 id

| id | name | spine | winAnim |
|----|------|-------|---------|
| 1 | B1 | symbolB1 | play |
| 2 | B2 | symbolB2 | play |
| 3 | F1 | symbolF12345 | play |
| 4 | F2 | symbolF12345 | play |
| 5 | F3 | symbolF12345 | play |
| 6 | F4 | symbolF12345 | play |
| 7 | F5 | symbolF12345 | play |
| 8 | M1 | symbolM1 | play |
| 9 | M2 | symbolM2 | play |
| 10 | M3 | symbolM3 | play |
| 11 | M4 | symbolM4 | play |
| 12 | A | symbolAKQJTE | play_A |
| 13 | K | symbolAKQJTE | play_K |
| 14 | Q | symbolAKQJTE | play_Q |
| 15 | J | symbolAKQJTE | play_J |
| 16 | TE | symbolAKQJTE | play_TE |
