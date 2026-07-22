# lvbu pack (spine-4.2)

```
asset-library.prefab   # 9 spine + 17 静态符号 + clear 音效
symbol-library.prefab  # 17 个逻辑符号；静态图与 spine 可同时引用
spines/                # Unity 导出 json+atlas+png
static/                # 单真源静态图、九宫格框、消除纹理、manifest
```

## 符号 id（与服务端 roles 对齐）

| id | 名 | 素材 id | idle / win |
|----|----|---------|------------|
| 1 | Bonus | spine_bonus (superwild1) | spirit / spirit |
| 2 | Wild | spine_wild | spirit_1 |
| 3 | Scatter | spine_scatter | Idle1 / spirit1 |
| 4 | H1 | spine_h1 | spirit_1 / spirit_k_1 |
| 5 | H2 | spine_h2 | 1 / spirit_1 |
| 6 | H3 | spine_h3 | 1 / spirit_1 |
| 7 | H4 | spine_h4 | 1 / spirit_1 |

另有素材（未绑符号）：`spine_superwild2`、`spine_baseflag`。

## 静态资源与尺寸档

- `static/symbols/` 每个逻辑符号保留一张最高档基础源（`icon_N_6`；低符号 8..13 = A/K/Q/J/10/9）。
- `static/tiers/<id-name>/tier-1..6.png` 保存同一逻辑 id 的 6 个预合成视觉档：
  `tier-1..6` 分别对应列内 `7..2` 个符号（设计高 112/130/156/196/262/392）。
  它们在 `SymbolEntry.visualVariants` 中登记，**不是 6 个 SymbolEntry**。
- Bonus（方天画戟）另有朝向变体：
  - 竖版：`01-bonus.png` ← `icon_1_1`（主盘 column-fill）
  - 横版：`01-bonus-horizontal.png` ← `icon_1`
  - 横版加宽：`01-bonus-horizontal-wide.png` ← `icon_1_2`（顶条 top-row-span×2）
- 落盘不 hardcode id：符号挂 `placementMainId` / `placementTopStripId`，逻辑在
  `scripts/editor-app/placement/` 的 `PLACEMENT_INDEX`（`column-fill` / `top-row-span`）。
  新符号复用：挂同一 recipeId + 自己的 visualVariant 即可。
- Unity 的 6 档是**独立预合成 PNG**（112/130/156/196/262/392），不是同图裁剪。
- **小符号显示**：不新建 SymbolEntry。盘面按「该列符号个数」切换同 id 的 tier SpriteFrame；临时兜底可等比缩放最高档。
- `A_/K_/…` 无边框字母层放在 `static/letter/`，给溶解/发光叠层用。
- `static/frame/` 与 `static/background/` 由渲染层九宫格伸缩。

重新从 `res/_lvbu_extract` 导出并生成库：

```text
node tools/export-lvbu-static-assets.cjs
# Creator refresh static/，生成图片 meta 后
node tools/build-lvbu-static-libraries.cjs
```

## 消除

`assets/resources/effects/lvbu-dissolve-sprite.effect` 是共享 Sprite shader。LvBu 包加载时，
`SymbolCatalog` 自动载入 `static/dissolve/dissolve-cloud.png`；没有专属 Spine
`vanishAnim` 的静态符号会走橙红灼边溶解，音效使用 `static/audio/lvbu-clear.mp3`。

### 中奖高亮 / 通用消除 —— 特效提取已放弃，改用占位符

**结论（2026-07）**：Unity 的普通符号高亮与通用消除逐像素还原**不可行**，已放弃。
原因：Unity 原效果 = 多层发光 + 自定义湍流/溶解 shader + ParticleSystem，
而 unitypackage 里只有静态贴图、关键 shader 源码根本没打进包（按 guid 查证缺失）。
靠 Sprite + tween 拼出来的版本颜色/流动始终不像，投入产出比太低。

现状：
- `static/fx/**`（letter-glow、soft-glow、gold-shimmer、clear-burst 等）**已 purge**，
  export 脚本也移除了对应条目；`res/_lvbu_extract` 仍在，需要时可重新分析。
- 运行时演出改用零贴图占位：`assets/scripts/editor-app/PlaceholderFx.ts`
  - 中奖 `playWinPlaceholder`：整体缩放脉冲 + 子 Sprite 颜色提亮脉冲；
  - 消除 `playVanishPlaceholder`：淡出 + 略缩小。
- 接缝：低符号渲染器 `lvbu-low-symbol.view.ts` 的 `buildWinAnim` / `buildVanishAnim`
  只调这两个入口。**真美术就绪后替换 `PlaceholderFx` 即可，调用方不用动。**

> 曾用的分析工具仍保留：`tools/dump-pay-anim.py`（导出 Unity 动画曲线）、
> `tools/dump-item-nodes.py`（列 prefab 节点用的贴图/材质）。要重启还原时可复用。

盘面拓扑用 `ways-6x7-top-mid4`。
