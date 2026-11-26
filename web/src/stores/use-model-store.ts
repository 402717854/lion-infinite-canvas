import { useEffect } from "react";
import { create } from "zustand";

import { modelApi } from "@/services/api/team";
import type { AvailableModelsPayload, ModelEntryValue } from "@/types/team";

type ModelStore = {
    workspaceId: string | null;
    entry: ModelEntryValue;
    data: AvailableModelsPayload | null;
    loading: boolean;
    error: string;
    setWorkspace: (workspaceId: string | null) => void;
    setEntry: (entry: ModelEntryValue) => void;
    reload: (workspaceId?: string | null) => Promise<void>;
};

let inflight: Promise<void> | null = null;

/** 团队模式下空间可用的渠道与模型，由 /models/available 提供。 */
export const useModelStore = create<ModelStore>((set, get) => ({
    workspaceId: null,
    entry: "canvas",
    data: null,
    loading: false,
    error: "",
    setWorkspace: (workspaceId) => {
        if (get().workspaceId === workspaceId) return;
        set({ workspaceId, data: null, error: "" });
        if (workspaceId) void get().reload(workspaceId);
    },
    setEntry: (entry) => {
        if (get().entry !== entry) set({ entry });
    },
    reload: async (workspaceId) => {
        const target = workspaceId ?? get().workspaceId;
        if (!target) return;
        if (inflight) return inflight;
        set({ loading: true });
        inflight = (async () => {
            try {
                const data = await modelApi.available(target);
                set({ data, error: "", loading: false });
            } catch (error) {
                set({ error: error instanceof Error ? error.message : "模型列表加载失败", loading: false });
            } finally {
                inflight = null;
            }
        })();
        return inflight;
    },
}));

export function currentModelData() {
    return useModelStore.getState().data;
}

/** 页面声明自己属于哪个调用入口，网关据此校验入口白名单。 */
export function useModelEntry(entry: ModelEntryValue) {
    const setEntry = useModelStore((state) => state.setEntry);
    useEffect(() => {
        setEntry(entry);
    }, [entry, setEntry]);
}
