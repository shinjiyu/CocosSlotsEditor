'use strict';

const path = require('path');

function loadPack() {
    const file = path.join(__dirname, 'export-pack.js');
    // 热重载：每次执行都取最新代码
    delete require.cache[require.resolve(file)];
    return require(file);
}

exports.methods = {
    /** 人工菜单：兼容旧行为；支持 opts（若经 message 传入） */
    async exportPack(opts) {
        const { exportPack } = loadPack();
        try {
            const result = await exportPack(
                opts && typeof opts === 'object'
                    ? opts
                    : { usedOnly: false, includeRuntimeScripts: true },
            );
            console.log(`[symbol-tools] Symbol 包已导出: ${result.out}（${result.files} 个文件）`);
            if (result.warnings?.length) {
                console.warn('[symbol-tools] 警告:', JSON.stringify(result.warnings));
            }
            return result;
        } catch (e) {
            console.error('[symbol-tools] 导出失败:', e);
            return { ok: false, error: String(e && e.message ? e.message : e) };
        }
    },

    /**
     * AI / meta-mcp 静默入口（无 Dialog）。
     * opts: { gameId?, docRel?, usedSymbolIds?, usedOnly?, includeRuntimeScripts?, outRel? }
     */
    async exportPackForAi(opts) {
        const { exportPackForAi } = loadPack();
        try {
            const result = await exportPackForAi(opts && typeof opts === 'object' ? opts : {});
            console.log(
                `[symbol-tools] export-pack-for-ai ok out=${result.outRel} files=${result.files} kept=${(result.usedSymbolIds || []).join(',')}`,
            );
            return result;
        } catch (e) {
            console.error('[symbol-tools] export-pack-for-ai 失败:', e);
            return { ok: false, error: String(e && e.message ? e.message : e) };
        }
    },

    async switchSpine38() {
        return runSpineSwitch('3.8');
    },

    async switchSpine42() {
        return runSpineSwitch('4.2');
    },
};

function runSpineSwitch(ver) {
    const { spawnSync } = require('child_process');
    const script = path.join(__dirname, '../../tools/switch-spine-zone.cjs');
    const r = spawnSync(process.execPath, [script, ver], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status !== 0) {
        console.error(`[symbol-tools] switch spine ${ver} 失败:`, out || r.error);
        Editor.Dialog.warn('切换 Spine 区失败', { detail: out || String(r.error) });
        return { ok: false, error: out || String(r.error) };
    }
    console.log(out);
    Editor.Dialog.info(`已切换到 Spine ${ver}`, {
        detail: '请重启预览或场景进程后再使用对应资源区。',
    });
    return { ok: true, zone: ver === '4.2' ? 'spine-4.2' : 'spine-3.8' };
}

exports.load = function () {};
exports.unload = function () {};
