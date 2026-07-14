/**
 * symbolEditor 预览页 Remote Console 接入。
 *
 * 远程地址 / token 不写死在仓库里，优先读本地配置：
 *   assets/resources/configs/remote-console.local.json
 * （gitignore；从 config/remote-console.example.json 复制）
 *
 * localhost 默认尝试开启；?remoteConsole=0 关闭；?remoteConsole=name 自定义会话名。
 * URL 可覆盖：?rcSdk=...&rcServer=...
 */

import { JsonAsset, resources } from 'cc';

declare global {
    interface Window {
        RemoteConsole?: {
            init: (opts: {
                autoConnect?: boolean;
                serverUrl?: string;
                name?: string;
                token?: string;
            }) => void;
            connect?: () => void;
            getSessionId?: () => string | null;
            isConnected?: () => boolean;
        };
    }
}

/** 本地/环境配置（勿把真实地址与 token 提交进 git） */
export interface RemoteConsoleConfig {
    /** SDK script URL，如 https://<host>/remote-console/sdk/remote-console.legacy.umd.js */
    sdkUrl?: string;
    /** WebSocket，如 wss://<host>/remote-console/ws */
    serverUrl?: string;
    /**
     * API token（MCP / 非浏览器客户端用）。
     * 浏览器 SDK 通常不需要；若 SDK 支持则会一并传入。
     */
    token?: string;
    /** 显式关闭；默认 localhost 开启 */
    enabled?: boolean;
}

let booted = false;

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isEnabled(cfg: RemoteConsoleConfig | null): boolean {
    if (!isBrowser()) return false;
    if (cfg?.enabled === false) return false;
    const p = new URLSearchParams(window.location.search);
    if (p.get('remoteConsole') === '0') return false;
    if (p.get('remoteConsole') === '1') return true;
    const host = window.location.hostname || '';
    return host === 'localhost' || host === '127.0.0.1';
}

function sessionName(): string {
    const p = new URLSearchParams(window.location.search);
    const fromUrl = p.get('remoteConsole');
    if (fromUrl && fromUrl !== '0' && fromUrl !== '1') return fromUrl;
    const host = window.location.hostname || 'local';
    const port = window.location.port || '7456';
    return `symbolEditor@${host}-${port}`;
}

function redactUrl(url: string): string {
    try {
        const u = new URL(url);
        return `${u.protocol}//<redacted>${u.pathname}`;
    } catch {
        return '<redacted>';
    }
}

function loadLocalConfig(): Promise<RemoteConsoleConfig | null> {
    return new Promise((resolve) => {
        resources.load('configs/remote-console.local', JsonAsset, (err, asset) => {
            if (err || !asset?.json) {
                resolve(null);
                return;
            }
            resolve(asset.json as RemoteConsoleConfig);
        });
    });
}

function resolveEndpoints(cfg: RemoteConsoleConfig | null): {
    sdkUrl: string;
    serverUrl: string;
    token?: string;
} | null {
    if (!isBrowser()) return null;
    const p = new URLSearchParams(window.location.search);
    const sdkUrl = (p.get('rcSdk') || cfg?.sdkUrl || '').trim();
    const serverUrl = (p.get('rcServer') || cfg?.serverUrl || '').trim();
    const token = (p.get('rcToken') || cfg?.token || '').trim() || undefined;
    if (!sdkUrl || !serverUrl) return null;
    return { sdkUrl, serverUrl, token };
}

function loadSdk(sdkUrl: string): Promise<void> {
    if (window.RemoteConsole?.init) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-remote-console-sdk="1"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('RemoteConsole SDK load failed')), {
                once: true,
            });
            return;
        }
        const script = document.createElement('script');
        script.src = sdkUrl;
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.dataset.remoteConsoleSdk = '1';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('RemoteConsole SDK load failed'));
        document.head.appendChild(script);
    });
}

/** 在预览页启动 Remote Console；可重复调用，只会初始化一次。 */
export function bootRemoteConsole(): void {
    if (booted || !isBrowser()) return;
    booted = true;

    void loadLocalConfig().then((cfg) => {
        if (!isEnabled(cfg)) {
            console.info('[RemoteConsole] disabled (add ?remoteConsole=1 if needed)');
            return;
        }
        const endpoints = resolveEndpoints(cfg);
        if (!endpoints) {
            console.warn(
                '[RemoteConsole] missing sdkUrl/serverUrl — copy config/remote-console.example.json → ' +
                    'assets/resources/configs/remote-console.local.json (gitignored) and fill in values',
            );
            return;
        }

        const name = sessionName();
        let attempts = 0;
        const tryInit = (): void => {
            loadSdk(endpoints.sdkUrl)
                .then(() => {
                    const rc = window.RemoteConsole;
                    if (!rc?.init) throw new Error('RemoteConsole.init missing');
                    const initOpts: {
                        autoConnect: boolean;
                        serverUrl: string;
                        name: string;
                        token?: string;
                    } = {
                        autoConnect: true,
                        serverUrl: endpoints.serverUrl,
                        name,
                    };
                    if (endpoints.token) initOpts.token = endpoints.token;
                    rc.init(initOpts);
                    rc.connect?.();
                    console.info(
                        `[RemoteConsole] connected name=${name} sessionId=${rc.getSessionId?.() ?? '?'} ` +
                            `ws=${redactUrl(endpoints.serverUrl)}`,
                    );
                })
                .catch((err: unknown) => {
                    attempts += 1;
                    if (attempts < 20) {
                        window.setTimeout(tryInit, 1000);
                        return;
                    }
                    console.warn('[RemoteConsole] init failed:', err);
                });
        };
        tryInit();
    });
}
