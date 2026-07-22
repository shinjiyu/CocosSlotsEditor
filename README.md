# CocosSlotsEditor

基于 Cocos Creator 3.8 的 Slot **素材 / 符号 / 盘面** 编辑器。

数据分层（由底向上）：

```
素材库 AssetLibrary     ← 最小单位：纹理 / Spine / 音频 / 特效 / 字体 / Prefab
    ↓ 引用 id
符号表 SymbolLibrary    ← 符号 = 素材组合 + 动画名 + 业务 kind
    ↓ symbolId
盘面 BoardEditor (SPIR) ← 用符号刷格子、配帧与演出
```

底层盘面文档是 **SPIR（Slot Presentation IR）**：一串 `PresentationState`（帧）。符号可运行时配置（改符号表 / 换素材引用），不必重导美术 UUID 进每一处符号。

## 两段编辑器（均可 H5）

| 阶段 | 入口 | 说明 |
|------|------|------|
| **① 素材** | Creator：`asset-library.prefab` | 登记纹理/Spine/音频（仍以 IDE 为主） |
| **② 符号** | **预览 `SymbolEditor` 场景**，或盘面顶栏「→符号」 | 选素材 id、动画名、试播；导出 `symbol-sheet-*.json` |
| **③ 盘面** | 预览 `BoardEditor`，或符号顶栏「→盘面」 | 用符号刷盘面 |

Creator 里仍可双击 `symbol-library.prefab` 做 IDE 侧编辑；H5 改动默认存 `localStorage`，导出 JSON 可备份。

## 功能总览

### H5 盘面编辑器（③）

- **刷子式盘面编辑**：右侧 Inspector 选中 symbol 作为刷子，在盘面上点/拖绘制
- **帧管理 / 动画编辑 / 播放预览 / 行距列距 / 自动存档 / 撤销重做**（同前）

### 素材库 + 符号表（①②，Creator IDE）

- 包路径：`assets/resources/spine-*/packs/<packId>/`
  - `asset-library.prefab` — `AssetLibrary`（可缺省；缺省则符号用直接引用，兼容 golden-seth）
  - `symbol-library.prefab` — `SymbolLibrary`
- 登记：`GamePack.ts` → `SYMBOL_PACKS`（含 `zone`）
- Spine 区切换：菜单或 `node tools/switch-spine-zone.cjs 3.8|4.2`，**重启预览**
- 运行时：`SymbolCatalog` 先载素材库，再按 `*AssetId` 解析符号

### IAnim / 导出

同前：`common/anim/`；菜单「扩展 → 盘面编辑器 → 导出 Symbol 包」。

## 目录结构

```
assets/
  scripts/editor-app/
    AssetDefs.ts / AssetLibrary.ts   # 素材库
    SymbolDefs.ts / SymbolLibrary.ts # 符号表
    SymbolResolve.ts / SymbolCatalog.ts
    BoardEditorMain.ts               # 盘面编辑器
    board-layout/                    # 盘面拓扑抽象（如 ways-6x7-top-mid4）
  resources/
    spine-3.8/packs/<packId>/
      asset-library.prefab           # 可选
      symbol-library.prefab
    spine-4.2/packs/<packId>/
    configs/spine-zone.active.json
    configs/board-layouts/
    configs/presentation/
```

## 使用流程

1. **建素材**：`asset-library.prefab` 登记 tex_ / spine_ / sfx_ / fx_ …
2. **组符号**：`symbol-library.prefab` 填符号 id，引用素材 id，配 idle/enter/win/vanish
3. **切区**（如需）：`node tools/switch-spine-zone.cjs 3.8|4.2` → 重启预览
4. **编盘面**：预览 BoardEditor → 刷子绘制 / 配动画 → 导出 SPIR
5. **迁库**：导出 Symbol 包到其它工程

## Remote Console（预览调试）

1. 复制 `config/remote-console.example.json` → `assets/resources/configs/remote-console.local.json`
2. 填入真实地址与 token（该文件已在 `.gitignore`）
3. Creator 刷新资源后重新预览；可用 `?remoteConsole=0` 关闭

## 环境

- Cocos Creator 3.8.x（开发于 3.8.8）
