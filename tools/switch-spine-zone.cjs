#!/usr/bin/env node
'use strict';

/**
 * 切换 Symbol Editor 的 Spine 资源区 + 引擎模块。
 * 用法: node tools/switch-spine-zone.cjs 3.8|4.2
 * 改完后必须重启 Cocos Creator 预览 / 场景进程。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_JSON = path.join(ROOT, 'settings/v2/packages/engine.json');
const ACTIVE_JSON = path.join(ROOT, 'assets/resources/configs/spine-zone.active.json');

const arg = String(process.argv[2] || '').trim();
const zone =
    arg === '4.2' || arg === 'spine-4.2'
        ? 'spine-4.2'
        : arg === '3.8' || arg === 'spine-3.8'
          ? 'spine-3.8'
          : null;

if (!zone) {
    console.error('用法: node tools/switch-spine-zone.cjs 3.8|4.2');
    process.exit(1);
}

function patchEngine(zoneId) {
    const data = JSON.parse(fs.readFileSync(ENGINE_JSON, 'utf8'));
    const cfg = data?.modules?.configs?.defaultConfig;
    if (!cfg?.cache || !Array.isArray(cfg.includeModules)) {
        throw new Error('engine.json 结构异常：找不到 modules.configs.defaultConfig.cache / includeModules');
    }

    cfg.cache.spine = cfg.cache.spine || { _value: true };
    cfg.cache.spine._value = true;
    cfg.cache.spine._option = zoneId;

    if (cfg.cache['spine-3.8']) cfg.cache['spine-3.8']._value = zoneId === 'spine-3.8';
    if (cfg.cache['spine-4.2']) cfg.cache['spine-4.2']._value = zoneId === 'spine-4.2';

    const modules = cfg.includeModules.filter((m) => m !== 'spine-3.8' && m !== 'spine-4.2');
    const richIdx = modules.indexOf('rich-text');
    if (richIdx >= 0) modules.splice(richIdx + 1, 0, zoneId);
    else modules.push(zoneId);
    cfg.includeModules = modules;

    fs.writeFileSync(ENGINE_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function writeActive(zoneId) {
    const body = {
        zone: zoneId,
        engineOption: zoneId,
        updatedAt: new Date().toISOString().slice(0, 10),
        note: '由 tools/switch-spine-zone.cjs 写入；须与 engine.json 一致。改完后请重启 Creator / 预览。',
    };
    fs.writeFileSync(ACTIVE_JSON, JSON.stringify(body, null, 2) + '\n', 'utf8');
}

patchEngine(zone);
writeActive(zone);
console.log(`[switch-spine-zone] → ${zone}`);
console.log('已更新 engine.json + spine-zone.active.json');
console.log('请重启 Cocos Creator 预览（或场景进程）后再打开对应区资源。');
