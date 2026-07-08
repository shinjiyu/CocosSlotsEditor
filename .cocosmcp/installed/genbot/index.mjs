import path from "node:path";
import fs from "node:fs";

export function register(server, ctx) {
    const { z, pluginManifest: manifest, PROJECT_ROOT, runGenbotGenerate, genbotRunner } = ctx;
    const t = (name) => (ctx.versionedToolName ? ctx.versionedToolName(name) : name);
    const ver = ctx.cocosCreatorVersion ?? "unknown";
    const handles = [];

    handles.push(
        server.tool(
            t("cocosmcp_genbot_generate"),
            `[Creator ${ver}] 对指定 prefab 运行 genbot：生成/更新 bind.json、*.gen.ts，首次生成 *.view.ts。`,
            {
                prefab: z.string().describe("prefab 路径"),
                regenBind: z.boolean().optional(),
                dryRun: z.boolean().optional(),
                preferEditor: z.boolean().optional(),
            },
            async ({ prefab, regenBind, dryRun, preferEditor }) => {
                const result = await runGenbotGenerate({
                    prefab,
                    regenBind: !!regenBind,
                    dryRun: !!dryRun,
                    preferEditor: !!preferEditor,
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    isError: !result.ok,
                };
            },
        ),
    );

    handles.push(
        server.tool(
            t("cocosmcp_genbot_status"),
            `[Creator ${ver}] 查看 prefab 在 _genbot/__registry.json 中的登记与预期输出路径`,
            {
                prefab: z.string().describe("prefab 路径或名称（如 candystorm_shell）"),
            },
            async ({ prefab }) => {
                if (!genbotRunner) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({ ok: false, error: "genbot-runner not available in MCP package" }, null, 2),
                            },
                        ],
                        isError: true,
                    };
                }
                const { expectedGenbotOutputs, readRegistryEntry, resolveGenbotRoot, resolvePrefabPath } = genbotRunner;
                let prefabAbs;
                let prefabName;
                if (prefab.includes("/") || prefab.includes("\\") || prefab.startsWith("db://")) {
                    prefabAbs = resolvePrefabPath(prefab, PROJECT_ROOT);
                    prefabName = path.basename(prefabAbs, path.extname(prefabAbs));
                } else {
                    prefabName = prefab.replace(/\.prefab$/i, "");
                    prefabAbs = null;
                }
                const outputs = prefabAbs
                    ? expectedGenbotOutputs(PROJECT_ROOT, prefabAbs)
                    : expectedGenbotOutputs(
                          PROJECT_ROOT,
                          path.join(PROJECT_ROOT, `_placeholder/${prefabName}.prefab`),
                      );
                const payload = {
                    prefabName,
                    prefabExists: prefabAbs ? fs.existsSync(prefabAbs) : undefined,
                    prefabAbs,
                    outputs,
                    filesPresent: {
                        bindJson: fs.existsSync(outputs.bindJson),
                        genTs: fs.existsSync(outputs.genTs),
                        viewTs: fs.existsSync(outputs.viewTs),
                    },
                    registry: readRegistryEntry(PROJECT_ROOT, prefabName),
                    genbotRoot: resolveGenbotRoot(PROJECT_ROOT),
                };
                return {
                    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
                };
            },
        ),
    );

    return { pluginId: manifest.id, toolNames: manifest.tools.map((n) => t(n)), handles };
}
