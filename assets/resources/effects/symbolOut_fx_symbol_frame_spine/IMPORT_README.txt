Cocos Inspector — Spine 导出包

目录结构（解压到 Creator 工程 assets 下任意文件夹）：
  fx_symbol_frame/fx_symbol_frame.json
  fx_symbol_frame/fx_symbol_frame.atlas
  fx_symbol_frame/fx_symbol_frame.png
  fx_symbol_frame/xy: 839, 5
  fx_symbol_frame/xy: 852, 146
  fx_symbol_frame/xy: 946, 5
  fx_symbol_frame/xy: 993, 146
  fx_symbol_frame/xy: 1053, 5
  fx_symbol_frame/xy: 1134, 146
  fx_symbol_frame/xy: 2259, 147
  fx_symbol_frame/xy: 278, 1
  fx_symbol_frame/xy: 1160, 5
  fx_symbol_frame/xy: 710, 146
  fx_symbol_frame/xy: 1267, 5
  fx_symbol_frame/xy: 1275, 146
  fx_symbol_frame/xy: 1374, 5
  fx_symbol_frame/xy: 1416, 146
  fx_symbol_frame/xy: 1481, 5
  fx_symbol_frame/xy: 1557, 146
  fx_symbol_frame/xy: 1588, 5
  fx_symbol_frame/xy: 1695, 5
  fx_symbol_frame/xy: 1698, 146
  fx_symbol_frame/xy: 1802, 5
  fx_symbol_frame/xy: 1839, 146
  fx_symbol_frame/xy: 1909, 6
  fx_symbol_frame/xy: 1979, 146
  fx_symbol_frame/xy: 2016, 6
  fx_symbol_frame/xy: 2337, 7
  fx_symbol_frame/xy: 2119, 146
  fx_symbol_frame/xy: 2123, 6
  fx_symbol_frame/xy: 2230, 6
  fx_symbol_frame/xy: 2443, 16
  fx_symbol_frame/xy: 2670, 136
  fx_symbol_frame/xy: 2553, 16
  fx_symbol_frame/xy: 2560, 135
  fx_symbol_frame/xy: 2663, 17
  fx_symbol_frame/xy: 2443, 134
  fx_symbol_frame/xy: 567, 136
  fx_symbol_frame/xy: 420, 15
  fx_symbol_frame/xy: 412, 133
  fx_symbol_frame/xy: 574, 14
  fx_symbol_frame/xy: 714, 13
  fx_symbol_frame/xy: 278, 108
  fx_symbol_frame/xy: 1, 99
  fx_symbol_frame/xy: 142, 103

Creator 导入：
  1. 保持纹理文件名与 .atlas 各页第一行一致（多页如 intro.webp + intro.jpg）
  2. 在资源管理器中 reimport .json
  3. 检查 SkeletonData.textureNames 页数与 atlas 一致

本资源为多页图集（43 页），缺页会导致部分 attachment 不显示。