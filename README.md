# CocosSlotsEditor

基于 Cocos Creator 3.8 的 Slot 盘面 / 演出编辑器。工程构建为 H5 后即是一个可在浏览器中运行的盘面编辑器；符号资源与动效则直接在 Creator IDE 中配置，所见即所得。

底层数据模型是 **SPIR（Slot Presentation IR）**：一份文档就是一串 `PresentationState`（帧），帧与帧之间由动画模板描述转移演出。编辑器 UI 与该数据结构直接对应。

## 功能总览

### H5 盘面编辑器（构建/预览后在浏览器中使用）

- **刷子式盘面编辑**：右侧 Inspector 选中 symbol 作为刷子，在盘面上点/拖绘制；一笔 = 一次撤销单位
- **帧管理**：+帧 / −帧 / 上一帧 / 下一帧 / 基于当前帧自动生成 compact（重力压缩）帧
- **动画编辑**：每帧可配 `frameKind`（enter-table / reveal / highlight / postClear / compact / spinEnd / expandPre / expandPost …）、动画模板（下落进场、重力落出、压缩下落、符号中奖、消除、脉冲、倍率扩散飞弹、无动画）及其参数；支持「与上帧同播」并行转移（**不限 frameKind**：第 2 帧起任意类型均可开关；连续标记会并成一批 `par` 同播）
- **播放预览**：整段播放或单帧转移试播
- **盘面布局**：行距 / 列距实时可调（支持负数重叠排布），配置持久化
- **现场保护**：每次编辑后全文档自动写入 localStorage，刷新 / 崩溃后自动恢复；支持导出 JSON 下载与本地文件导入
- **撤销 / 重做**：命令模式全量覆盖

### 符号库（Creator IDE 内配置）

- `assets/resources/games/<gameId>/symbol-library.prefab` 根节点挂 `SymbolLibrary` 组件；多游戏包并存，编辑器 Inspector「游戏包」◀▶ 切换（登记见 `GamePack.ts`）
- 符号内容形态优先级：prefab > spine > 纹理；纹理走 `Sprite.SizeMode.RAW`，按全局符号设计尺寸（默认 152×128）等比缩放进格子
- 动效钩子：`idleAnim` 常驻循环、`enterAnim` 入场、`winAnim` 中奖、`vanishAnim` 消除；spine 动画切换自带 crossfade 混合；无 spine 入场时可选内置 tween 动效（squashLand / popIn / spinIn）
- **格子级通用特效** `CellFxDef`：中奖 / 消除时在格子上叠加 spine 特效，全局配置 + 条目级覆盖，与符号自身动画并行播放
- **编辑期预览墙**：双击 prefab 进入编辑舞台即可看到全部符号网格排布、idle 动画实时播放；Inspector 上的触发钮可即时试播入场 / 中奖 / 消除
- **Symbol 包导出**：菜单「扩展 → 盘面编辑器 → 导出 Symbol 包」，从当前/默认 game 的 symbol-library.prefab 出发收集依赖闭包（纹理、spine 全套、递归 prefab、运行时脚本、.meta），导出到 `temp/symbol-pack/`，整体合并进其它 Cocos 工程即可复用

### IAnim 动画框架

`assets/scripts/common/anim/` 是一套可组合的动画原语：

- 统一接口 `IAnim`：`play() / cancel() / reset()`，Promise 化
- 组合算子：`seq / par / race / loop / forever / delay / call / starterAnim`
- 载荷桥接：`playSpine`（支持 mixIn crossfade 与 followUp 平滑接续 idle）、`playClip`、`playParticleBurst`
- cancel 语义统一：父树 cancel 连锁取消所有 in-flight 子动画

## 目录结构

```
assets/
  scripts/
    common/anim/        # IAnim 动画框架
    editor-core/        # SPIR 文档模型、命令系统、校验、序列化（与渲染无关）
    editor-app/         # 编辑器场景：BoardEditorMain / BoardView / EditorHud /
                        # SymbolLibrary / SymbolView / GamePack / BoardDirector ...
    vendor/slot-presentation-ir/   # SPIR schema
  resources/
    games/<gameId>/                # 每游戏自洽符号包
      symbol-library.prefab
      symbols/ oriSymbols/ font/ effects/
    configs/presentation/          # 示例 SPIR 文档
extensions/
  symbol-tools/         # Creator 扩展：Symbol 包导出
  cocos-meta-mcp/       # Agent 开发桥（cocosmcp）
.cocosmcp/              # cocosmcp 工程配置与 recipes
```

## 使用流程

1. **配符号**：Creator 打开工程 → 双击 `assets/resources/games/<gameId>/symbol-library.prefab` → Inspector 中增删条目、拖资源、填动画名 → 预览墙实时查看效果；新游戏：拷一份目录 + 在 `GamePack.ts` 登记
2. **编盘面**：预览运行编辑器场景（浏览器）→ Inspector「游戏包」切换符号表 → 刷子绘制各帧 → 配 frameKind / 模板 / 参数 → 播放验证
3. **出数据**：编辑器「导出」下载 SPIR JSON，交给运行时按同一套模板语义播放
4. **迁移**：「导出 Symbol 包」把符号资源 + 配置 + 运行时脚本整包带去其它工程

## Remote Console（预览调试）

预览页可接入 Remote Console，便于 Agent 拉控制台日志。`sdkUrl` / `serverUrl` / `token` **不要写进仓库**：

1. 复制 `config/remote-console.example.json` → `assets/resources/configs/remote-console.local.json`
2. 填入真实地址与 token（该文件已在 `.gitignore`）
3. Creator 刷新资源后重新预览；可用 `?remoteConsole=0` 关闭，或 `?rcSdk=` / `?rcServer=` 临时覆盖

浏览器 SDK 通常不需要 token；token 主要给 Cursor MCP（`RC_API_TOKEN`）使用，本地配置里一并保存方便对照。

## 环境

- Cocos Creator 3.8.x（开发于 3.8.8）
- spine 资源版本需与引擎 spine 运行时匹配（3.8.x）
