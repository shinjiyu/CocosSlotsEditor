# bounty-hunter (spine-3.8)

赏金猎人符号包。静帧来自 `BountyHunterRecovered`，Spine 来自 harExplore `bounty-hunter`。

## 重建

```bash
node tools/import-bounty-hunter-pack.cjs
# Creator refresh db://assets/resources/spine-3.8/packs/bounty-hunter
node tools/build-bounty-hunter-libraries.cjs
node tools/extract-bounty-hunter-board-from-recovered.cjs
```

## 盘面布局（还原自 BountyHunterRecovered）

| 项 | 值 |
|----|----|
| 设计格 | 120×100 |
| 列距/行距 | 0 / 20（中心距 120×120） |
| 盘面 | ways 6 列，visibleRows [3,4,5,5,4,3] |
| 格子 FX scale | 0.85 |

**配置入口**：H5 SymbolEditor「包布局」；包↔种子盘面由 `GamePack.seedDoc*` 登记，可自由切换包。

## 符号 id

| id | name | spine | skin | winAnim |
|----|------|-------|------|---------|
| 1 | B1 | symbolB1 |  | play |
| 2 | WX | symbolWX |  | play_win |
| 3 | M1 | symbolM1 |  | play |
| 4 | M2 | symbolM2 |  | play |
| 5 | M3 | symbolM3 |  | play |
| 6 | M4 | symbolM4 |  | play |
| 9 | A | symbolAKQJ | A | play |
| 10 | K | symbolAKQJ | K | play |
| 11 | Q | symbolAKQJ | Q | play |
| 12 | J | symbolAKQJ | J | play |
