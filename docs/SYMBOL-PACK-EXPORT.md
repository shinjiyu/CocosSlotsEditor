# Symbol 包导出（按盘面 / AI）

AI 经 **cocos-meta-mcp** 静默导出「盘面用到的」符号资源，再合并进 playable（PA）。人工菜单与 AI 共用同一实现。

## 通道

```text
AI / Cursor / AIWS
  → cocosmcp（message / recipe）
    → SE 工程 cocos-meta-mcp 桥
      → Editor.Message.request("symbol-tools", "export-pack-for-ai", opts)
        → temp/symbol-pack/ (+ manifest.json)
  → merge assets/ → PA（CLI / AIWS WS）
  →（可选）seRuntimeSync 拷 TS；refresh-asset PA
```

**不要**用人点 Dialog 作为 AI 主路径。菜单「按盘面」只是同一 message 的薄封装。

## SE Message

| Message | 用途 |
|---------|------|
| `export-pack-for-ai` | **AI 默认**：`usedOnly=true`，按盘面裁剪，默认不含 runtime TS |
| `export-pack` | 人工全量（可带 opts）；旧兼容 |

### opts

```js
{
  gameId: "golden-seth",          // 可选；packId，默认扫 spine-*/packs/*/
  docRel: "assets/resources/configs/presentation/doc_example.json",
  usedSymbolIds: [1, 2, 3],       // 可选；有则优先于 docRel
  usedOnly: true,                 // export-pack-for-ai 默认 true
  includeRuntimeScripts: false,   // AI 默认 false（脚本走 seRuntimeSync）
  outRel: "temp/symbol-pack"
}
```

### 返回

```json
{
  "ok": true,
  "outRel": "temp/symbol-pack",
  "libraryRel": "assets/resources/spine-3.8/packs/golden-seth/symbol-library.prefab",
  "usedSymbolIds": [1, 2, 3],
  "droppedSymbolIds": [10, 11],
  "assetRels": ["assets/resources/..."],
  "files": 128,
  "warnings": []
}
```

包内另有 `manifest.json`（同上字段）。

## meta-mcp 调用示例

```js
// cocosmcp_exec mode=message
{
  mode: "message",
  module: "symbol-tools",
  method: "export-pack-for-ai",
  messageType: "request",
  args: [{
    gameId: "golden-seth",
    docRel: "assets/resources/configs/presentation/doc_example.json"
  }],
  projectRoot: "D:/workspace/symbolEditor"
}
```

或 eval：

```js
return await Editor.Message.request("symbol-tools", "export-pack-for-ai", {
  gameId: "golden-seth",
  docRel: "assets/resources/configs/presentation/doc_example.json",
});
```

## 已知坑：BitmapFont 贴图

`multiDigitFont`（如 `countup_02.fnt`）与 atlas **不同 uuid**。闭包必须跟 `.fnt.meta` 的 `textureUuid` / `atlasName`，否则 PA 只有 `.fnt`、**倍率数字整页不显示**。`export-pack.js` 已对 `cc.BitmapFont` 单独补拷 atlas。

## 合并进 PA

```bash
node ai-game-workspace/scripts/merge-symbol-pack.mjs \
  --pack <seRoot>/temp/symbol-pack \
  --pa <paRoot>
```

若 profile `symbolLibraryRel` 为扁平 `assets/resources/symbol-library.prefab`，而包内库在 `spine-*/packs/<id>/`，合并脚本会再镜像一份到 profile 路径（uuid 美术仍落在 packs 目录下）。

AIWS WebSocket：`symbol_pack_merge`（pack 默认 `<boardEditorRoot>/temp/symbol-pack`）。

脚本同步仍用：

```bash
node ai-game-workspace/scripts/sync-se-runtime.mjs --se <se> --pa <pa>
```

## Agent checklist

1. Creator 打开 **symbolEditor**，启用 `symbol-tools` + `cocos-meta-mcp`
2. `export-pack-for-ai`（传 `docRel` / `usedSymbolIds` / `gameId`）
3. `merge-symbol-pack.mjs` → PA
4. （可选）`sync-se-runtime.mjs`
5. PA 桥 `refresh-asset` / 预览热更
6. 确认 `BoardStage` 库引用与盘面 doc 一致

详见 Cursor skill：`se-symbol-pack-export`。
