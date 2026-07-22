#!/usr/bin/env node
/**
 * generality-audit — 通用性/专用性泄漏审计。
 *
 * 回答「什么是通用的、什么是专用的」不能靠"产物是否 SPIR 兼容"（SPIR 只保证
 * 互通不保证通用），要看逻辑依赖方向与具名游戏假设。本工具做两件机器能做的事：
 *
 *   A. 依赖越界扫描 —— core 层不许 import profile/pack 层；
 *   B. 专用字面量扫描 —— core/app 层出现"游戏味"字面量（pack id、盘面 id、
 *      具体符号资源名…）即标记泄漏。
 *
 * 分层（越靠上越通用）：
 *   core     common/** debug/** editor-core/** vendor/** views/*.ts(根层契约)
 *   profile  editor-app/board-layout/**            —— 每种盘面一份，允许盘面专有
 *   pack     views/<pack>/**                       —— 每个游戏一份，允许游戏专有
 *   app      editor-app/**(其余)                   —— 编辑器胶水/UI，应保持游戏中性
 *
 * 允许的依赖方向：
 *   core    → core
 *   profile → core, profile
 *   pack    → core, app（pack 渲染器可用通用 fx/工具）
 *   app     → core, profile, app；import pack 仅限白名单注册点
 *
 * 判定：
 *   VIOLATION  core 依赖越界 / core 出现游戏字面量      —— 必须修
 *   LEAK       app 出现游戏字面量或未白名单的 pack 依赖 —— 应下沉到 profile/pack
 *   OK         其余
 *
 * 用法：node tools/generality-audit.cjs [--verbose]
 * 退出码：有 VIOLATION 时为 1（可挂 CI）。
 *
 * 注意：字面量扫描只是「换游戏存活测试」的代理指标；语义归属（某段逻辑换个
 * 游戏要不要改）仍需人工判断，见文件尾 CHECKLIST。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'scripts');
const VERBOSE = process.argv.includes('--verbose');

// ---------------------------------------------------------------------------
// 分层
// ---------------------------------------------------------------------------

/** 顺序敏感：先匹配的先生效（profile 在 app 前，pack 在 core 的 views 根层后） */
const LAYER_RULES = [
    { layer: 'profile', test: (p) => p.startsWith('editor-app/board-layout/') },
    { layer: 'pack', test: (p) => /^views\/[^/]+\//.test(p) },
    { layer: 'core', test: (p) => /^views\/[^/]+\.ts$/.test(p) },
    {
        layer: 'core',
        test: (p) =>
            p.startsWith('common/') ||
            p.startsWith('debug/') ||
            p.startsWith('editor-core/') ||
            p.startsWith('vendor/'),
    },
    { layer: 'app', test: (p) => p.startsWith('editor-app/') },
];

const ALLOWED_DEPS = {
    core: ['core'],
    profile: ['core', 'profile'],
    pack: ['core', 'app', 'pack'],
    app: ['core', 'profile', 'app'],
};

/**
 * app → pack 的白名单注册点：pack 渲染器需要有人 import 触发自注册，
 * 这个"知道所有 pack"的胶水位置必须唯一且显式。
 */
const APP_TO_PACK_WHITELIST = new Set(['editor-app/GamePack.ts', 'editor-app/SymbolCatalog.ts']);

// ---------------------------------------------------------------------------
// 专用字面量信号（"游戏味"）。命中 = core:VIOLATION / app:LEAK。
// profile/pack 层不扫——它们本来就是放专用内容的地方。
// ---------------------------------------------------------------------------

const GAME_SIGNALS = [
    { name: 'pack-id:lvbu', re: /lvbu/i },
    { name: 'board-id:ways-6x7', re: /ways-6x7/ },
    { name: 'unity-src:icon_N', re: /['"`]icon_\d/ },
    { name: 'unity-src:eff_', re: /['"`]eff_/ },
    { name: 'letter-map:A..9', re: /['"]A['"]\s*,\s*['"]K['"]\s*,\s*['"]Q['"]/ },
    // 具体资源路径直接写进代码（应经 AssetLibrary / pack manifest 间接引用）
    { name: 'res-path:packs/', re: /['"`][^'"`]*packs\/[a-z]/ },
];

/** 文件级豁免：<file路径, 允许的信号名集合>。GamePack 是 pack 清单本身。 */
const SIGNAL_WHITELIST = new Map([
    ['editor-app/GamePack.ts', new Set(['pack-id:lvbu', 'board-id:ways-6x7'])],
]);

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, out);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

function rel(file) {
    return path.relative(SRC, file).replace(/\\/g, '/');
}

function layerOf(relPath) {
    for (const rule of LAYER_RULES) if (rule.test(relPath)) return rule.layer;
    return 'unknown';
}

function stripComments(src) {
    // 粗粒度即可：块注释与行注释都不算命中（避免文档提及游戏名被误报）
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function parseImports(src) {
    const specs = [];
    const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) specs.push(m[1] ?? m[2] ?? m[3]);
    return specs;
}

function resolveImport(fromFile, spec) {
    if (!spec.startsWith('.')) return null; // cc / npm / builtin：不参与分层
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const cand of [base + '.ts', path.join(base, 'index.ts'), base]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
}

function findLineNumbers(src, re) {
    const lines = src.split(/\r?\n/);
    const hits = [];
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (let i = 0; i < lines.length; i++) {
        g.lastIndex = 0;
        if (g.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 100) });
    }
    return hits;
}

function main() {
    const files = walk(SRC);
    const results = [];

    for (const file of files) {
        const relPath = rel(file);
        const layer = layerOf(relPath);
        const raw = fs.readFileSync(file, 'utf8');
        const code = stripComments(raw);
        const problems = [];

        // A. 依赖越界
        for (const spec of parseImports(code)) {
            const target = resolveImport(file, spec);
            if (!target) continue;
            const targetLayer = layerOf(rel(target));
            const allowed = ALLOWED_DEPS[layer] ?? [];
            if (allowed.includes(targetLayer)) continue;
            if (layer === 'app' && targetLayer === 'pack' && APP_TO_PACK_WHITELIST.has(relPath)) continue;
            problems.push({
                severity: layer === 'core' ? 'VIOLATION' : 'LEAK',
                kind: 'dep',
                detail: `${layer} → ${targetLayer}: import '${spec}'`,
            });
        }

        // B. 专用字面量（只扫 core / app）
        if (layer === 'core' || layer === 'app') {
            const exempt = SIGNAL_WHITELIST.get(relPath) ?? new Set();
            for (const sig of GAME_SIGNALS) {
                if (exempt.has(sig.name)) continue;
                const hits = findLineNumbers(code, sig.re);
                for (const hit of hits) {
                    problems.push({
                        severity: layer === 'core' ? 'VIOLATION' : 'LEAK',
                        kind: 'literal',
                        detail: `${sig.name} @L${hit.line}: ${hit.text}`,
                    });
                }
            }
        }

        results.push({ relPath, layer, problems });
    }

    // ------------------------------------------------------------------
    // 报告
    // ------------------------------------------------------------------
    const violations = results.filter((r) => r.problems.some((p) => p.severity === 'VIOLATION'));
    const leaks = results.filter(
        (r) => !violations.includes(r) && r.problems.some((p) => p.severity === 'LEAK'),
    );
    const clean = results.filter((r) => r.problems.length === 0);

    const byLayer = {};
    for (const r of results) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;

    console.log('generality-audit');
    console.log('================');
    console.log(
        `files: ${results.length}  ` +
            Object.entries(byLayer)
                .map(([l, n]) => `${l}:${n}`)
                .join('  '),
    );
    console.log(`clean: ${clean.length}   leak: ${leaks.length}   violation: ${violations.length}`);
    console.log('');

    const show = (r) => {
        console.log(`[${r.layer}] ${r.relPath}`);
        for (const p of r.problems) console.log(`    ${p.severity} (${p.kind}) ${p.detail}`);
    };

    if (violations.length) {
        console.log('--- VIOLATIONS（core 被专用逻辑污染，必须修）---');
        violations.forEach(show);
        console.log('');
    }
    if (leaks.length) {
        console.log('--- LEAKS（app 层游戏味，应下沉到 profile/pack 或进白名单）---');
        leaks.forEach(show);
        console.log('');
    }
    if (VERBOSE) {
        console.log('--- CLEAN ---');
        clean.forEach((r) => console.log(`[${r.layer}] ${r.relPath}`));
        console.log('');
    }

    console.log('提醒：字面量/依赖扫描只是代理指标。语义归属仍需人工过 CHECKLIST：');
    console.log('  1. 换一个游戏（定高盘/tall-symbol/无档位），这段代码要不要改？');
    console.log('  2. 规则能否表达成 profile 参数？能 → 下沉 profile；');
    console.log('  3. 只是素材形状不同？→ 下沉 pack（prefab + view 渲染器）；');
    console.log('  4. SPIR 兼容 ≠ 通用：产物合法不代表逻辑无游戏假设。');

    process.exitCode = violations.length ? 1 : 0;
}

main();
