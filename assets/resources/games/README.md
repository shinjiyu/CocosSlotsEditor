# games/<gameId>/

每个游戏包目录自洽，可在同一 symbolEditor 工程并存：

```
games/<gameId>/
  symbol-library.prefab   # SymbolLibrary 配置（必选）
  symbols/                # 静态贴图（可选）
  oriSymbols/             # Spine 符号（可选）
  font/                   # 位图字等（可选）
  effects/                # 格子特效等（可选）
```

登记：编辑 `assets/scripts/editor-app/GamePack.ts` 的 `GAME_PACKS`。
编辑器 Inspector「游戏包」◀▶ 切换；选择会写入 localStorage。

当前包：`golden-seth`
