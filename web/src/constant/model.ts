import type { ModelCapabilityValue, ModelEntryValue } from "@/types/team";

export const MODEL_CAPABILITIES: ModelCapabilityValue[] = ["image", "video", "text", "audio"];
export const MODEL_ENTRIES: ModelEntryValue[] = ["canvas", "image", "video", "assistant", "agent", "api"];

export const CAPABILITY_LABELS: Record<ModelCapabilityValue, string> = {
    image: "图片",
    video: "视频",
    text: "文本",
    audio: "音频",
};

export const ENTRY_LABELS: Record<ModelEntryValue, string> = {
    canvas: "画布节点",
    image: "图像页",
    video: "视频页",
    assistant: "画布助手",
    agent: "Agent",
    api: "API",
};

export const CAPABILITY_OPTIONS = MODEL_CAPABILITIES.map((value) => ({ value, label: CAPABILITY_LABELS[value] }));
export const ENTRY_OPTIONS = MODEL_ENTRIES.map((value) => ({ value, label: ENTRY_LABELS[value] }));

export function capabilityText(list: ModelCapabilityValue[]) {
    return list.map((value) => CAPABILITY_LABELS[value] ?? value).join(" / ") || "未设置";
}
