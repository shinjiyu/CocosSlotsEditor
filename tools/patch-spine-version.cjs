#!/usr/bin/env node
'use strict';

/**
 * 把 lvbu spine JSON 的 skeleton.spine 版本号从 4.1.x 补丁为 4.2.11，
 * 让 Creator 3.8.8 的 spine-4.2 运行时接受（4.1↔4.2 JSON 结构差异极小）。
 * 幂等：已是 4.2 的跳过。改完需在 Creator refresh 对应资源。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'assets/resources/spine-4.2/packs/lvbu/spines');
const TARGET = '4.2.11';

const results = [];

function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).isDirectory()) {
            walk(fp);
        } else if (f.endsWith('.json')) {
            const txt = fs.readFileSync(fp, 'utf8');
            const m = txt.match(/"spine"\s*:\s*"([^"]+)"/);
            if (!m) {
                results.push(`${f}: no version field, skip`);
                continue;
            }
            if (m[1].startsWith('4.2')) {
                results.push(`${f}: already ${m[1]}, skip`);
                continue;
            }
            const out = txt.replace(/"spine"\s*:\s*"[^"]+"/, `"spine": "${TARGET}"`);
            fs.writeFileSync(fp, out, 'utf8');
            results.push(`${f}: ${m[1]} -> ${TARGET}`);
        }
    }
}

walk(ROOT);
console.log(results.join('\n'));
