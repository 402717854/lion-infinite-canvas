import i18n from "@/i18n";
import type { ModelCapability } from "@/stores/use-config-store";

export type PluginTemplate = { id: string; label: string; script: string };

/** Template bodies live in `<capability>.<provider>.js` and are inlined as raw strings at build time. */
const files = import.meta.glob("./*.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Display order of providers within each capability. Add a provider here and its `modelPlugin.templates.*` key. */
const providerOrder = ["openai", "chat", "gemini"];

/** Built-in call templates grouped by capability. */
export function getPluginTemplates(): Record<ModelCapability, PluginTemplate[]> {
    const result: Record<ModelCapability, PluginTemplate[]> = { image: [], video: [], audio: [], text: [] };
    for (const [path, script] of Object.entries(files)) {
        const [capability, provider] = path.split("/").pop()!.replace(/\.js$/, "").split(".");
        if (!result[capability as ModelCapability]) continue;
        result[capability as ModelCapability].push({
            id: `${capability}.${provider}`,
            label: i18n.t(`modelPlugin.templates.${provider}`, { defaultValue: provider }),
            script,
        });
    }
    for (const list of Object.values(result)) {
        list.sort((a, b) => providerOrder.indexOf(a.id.split(".")[1]) - providerOrder.indexOf(b.id.split(".")[1]));
    }
    return result;
}
