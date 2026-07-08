'use strict';

const path = require('path');

exports.methods = {
    async exportPack() {
        const file = path.join(__dirname, 'export-pack.js');
        // 热重载：每次执行都取最新代码
        delete require.cache[require.resolve(file)];
        const { exportPack } = require(file);
        try {
            const result = await exportPack();
            console.log(`[symbol-tools] Symbol 包已导出: ${result.out}（${result.files} 个文件）`);
            if (result.warnings.length) console.warn('[symbol-tools] 警告:', JSON.stringify(result.warnings));
            return result;
        } catch (e) {
            console.error('[symbol-tools] 导出失败:', e);
            return { error: String(e) };
        }
    },
};

exports.load = function () {};
exports.unload = function () {};
