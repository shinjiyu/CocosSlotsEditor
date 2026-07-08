'use strict';

/**
 * 导出 Symbol 包：从 symbol-library.prefab 出发收集依赖闭包
 * （纹理、spine 全套、自定义 prefab 递归），连同 .meta 与运行时脚本
 * 按 assets/ 相对路径拷到 temp/symbol-pack/。
 * 目标 Cocos 工程把包内 assets/ 合并进自己的 assets/ 即可使用
 * （meta 保住 uuid，prefab 内引用不断）。
 */

const path = require('path');
const fs = require('fs');

/**
 * 运行时脚本：单文件。
 * 覆盖完整播放闭环：符号库 + 盘面渲染 + 动画模板 + 播放编排 + 事件/音效。
 * 编辑器专属（EditorHud / BoardEditorMain / PersistenceService）不随包。
 */
const RUNTIME_SCRIPTS = [
    'assets/scripts/editor-app/SymbolDefs.ts',
    'assets/scripts/editor-app/SymbolLibrary.ts',
    'assets/scripts/editor-app/SymbolView.ts',
    'assets/scripts/editor-app/SymbolTemplate.ts',
    'assets/scripts/editor-app/SymbolCatalog.ts',
    'assets/scripts/editor-app/symbolFx.ts',
    'assets/scripts/editor-app/sfx.ts',
    'assets/scripts/editor-app/boardEvents.ts',
    'assets/scripts/editor-app/animTemplates.ts',
    'assets/scripts/editor-app/BoardView.ts',
    'assets/scripts/editor-app/BoardDirector.ts',
];
/** 运行时脚本：整目录（IAnim 框架、SPIR 文档模型与 schema） */
const RUNTIME_DIRS = [
    'assets/scripts/common',
    'assets/scripts/editor-core',
    'assets/scripts/vendor/slot-presentation-ir',
];

async function exportPack() {
    const projectRoot = Editor.Project.path;
    const outRoot = path.join(projectRoot, 'temp', 'symbol-pack');
    fs.rmSync(outRoot, { recursive: true, force: true });

    const copied = new Set();
    const warnings = [];

    function copyFileWithMeta(absFile) {
        const rel = path.relative(projectRoot, absFile).replace(/\\/g, '/');
        if (copied.has(rel)) return;
        if (!fs.existsSync(absFile)) {
            warnings.push(`缺失文件: ${rel}`);
            return;
        }
        const dst = path.join(outRoot, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(absFile, dst);
        copied.add(rel);
        const meta = `${absFile}.meta`;
        if (fs.existsSync(meta)) fs.copyFileSync(meta, `${dst}.meta`);
        else warnings.push(`无 meta: ${rel}`);
    }

    function copyDirWithMeta(absDir) {
        for (const f of fs.readdirSync(absDir)) {
            if (f.endsWith('.meta')) continue;
            const p = path.join(absDir, f);
            if (fs.statSync(p).isDirectory()) copyDirWithMeta(p);
            else copyFileWithMeta(p);
        }
    }

    // --- 依赖闭包（从库 prefab 出发扫 __uuid__，递归 prefab） ---
    const rootPrefab = path.join(projectRoot, 'assets/resources/symbol-library.prefab');
    if (!fs.existsSync(rootPrefab)) throw new Error('assets/resources/symbol-library.prefab 不存在，先在 Creator 里配置符号库');

    const visitedUuids = new Set();
    const queue = [rootPrefab];
    while (queue.length) {
        const file = queue.pop();
        copyFileWithMeta(file);
        if (!file.endsWith('.prefab') && !file.endsWith('.scene')) continue;
        const txt = fs.readFileSync(file, 'utf-8');
        const uuids = [...new Set([...txt.matchAll(/"__uuid__":\s*"([^"]+)"/g)].map((m) => m[1]))];
        for (const u of uuids) {
            const base = u.split('@')[0];
            if (visitedUuids.has(base)) continue;
            visitedUuids.add(base);
            const info = await Editor.Message.request('asset-db', 'query-asset-info', base);
            if (!info || !info.file) {
                warnings.push(`uuid 无法解析: ${u}`);
                continue;
            }
            if (info.type === 'sp.SkeletonData') {
                // spine 全套（json/atlas/纹理页在同一专属目录）
                copyDirWithMeta(path.dirname(info.file));
            } else if (info.type === 'cc.Prefab') {
                queue.push(info.file);
            } else {
                copyFileWithMeta(info.file);
            }
        }
    }

    // --- 运行时脚本 ---
    for (const rel of RUNTIME_SCRIPTS) copyFileWithMeta(path.join(projectRoot, rel));
    for (const rel of RUNTIME_DIRS) copyDirWithMeta(path.join(projectRoot, rel));

    fs.writeFileSync(
        path.join(outRoot, 'README.md'),
        [
            '# Symbol 包',
            '',
            `导出自 symbolEditor，时间 ${new Date().toISOString()}`,
            '',
            '## 用法',
            '',
            '1. 把本包内 `assets/` 目录整体合并进目标 Cocos 工程的 `assets/`（保留 .meta）。',
            '2. Creator 打开目标工程等待导入完成。',
            '3. 运行时 `resources.load("symbol-library", Prefab)` 拿到库，',
            '   读根节点 `SymbolLibrary` 组件即得全部符号配置（直接资源引用）。',
            '4. 渲染/动画参考 `SymbolView`（内容形态 prefab > spine > 纹理，',
            '   enter/win/vanish 钩子 + 格子特效 CellFxDef）。',
            '',
            '注意：脚本随 .meta 一起拷入，uuid 与 prefab 引用一致；',
            '若目标工程已有同名脚本请整体替换而不是跳过。',
        ].join('\n'),
    );

    return { out: outRoot, files: copied.size, warnings };
}

module.exports = { exportPack };
