import { create } from "zustand";

import { apiErrorMessage } from "@/services/api/client";
import { authApi, type RegisterResult } from "@/services/api/team";
import type { Me, WorkspaceSummary } from "@/types/team";

type AuthStatus = "idle" | "loading" | "authed" | "guest";

type AuthStore = {
    status: AuthStatus;
    me: Me | null;
    expired: boolean;
    loadSession: () => Promise<void>;
    setSession: (me: Me) => void;
    login: (email: string, password: string, remember: boolean) => Promise<Me>;
    register: (payload: { email: string; password: string; displayName?: string; inviteToken?: string }) => Promise<RegisterResult>;
    logout: () => Promise<void>;
    refreshSession: () => Promise<void>;
    findWorkspace: (workspaceId: string) => WorkspaceSummary | undefined;
};

let sessionRequest: Promise<void> | null = null;

export const useAuthStore = create<AuthStore>()((set, get) => ({
    status: "idle",
    me: null,
    expired: false,
    loadSession: async () => {
        if (sessionRequest) return sessionRequest;
        set((state) => ({ status: state.status === "authed" ? "authed" : "loading" }));
        sessionRequest = authApi
            .me()
            .then((me) => set({ me, status: "authed", expired: false }))
            .catch(() => set({ me: null, status: "guest" }))
            .finally(() => {
                sessionRequest = null;
            });
        return sessionRequest;
    },
    setSession: (me) => set({ me, status: "authed", expired: false }),
    login: async (email, password, remember) => {
        const me = await authApi.login({ email, password, remember });
        set({ me, status: "authed", expired: false });
        return me;
    },
    register: async (payload) => {
        const result = await authApi.register(payload);
        if (result.user) set({ me: result, status: "authed", expired: false });
        return result;
    },
    logout: async () => {
        try {
            await authApi.logout();
        } catch (error) {
            if (apiErrorMessage(error) !== "请先登录") throw error;
        }
        // 退出后清掉本地缓存的云端项目，避免共用设备时把上一个账号的空间数据留在本机。
        const [{ useCanvasStore }, { resetWorkspaceProjectCache }] = await Promise.all([import("@/stores/canvas/use-canvas-store"), import("@/hooks/use-workspace-projects")]);
        useCanvasStore.setState((state) => ({ projects: state.projects.filter((project) => !project.workspaceId) }));
        resetWorkspaceProjectCache();
        set({ me: null, status: "guest" });
    },
    refreshSession: async () => {
        if (get().status !== "authed") return get().loadSession();
        const me = await authApi.me();
        set({ me, status: "authed", expired: false });
    },
    findWorkspace: (workspaceId) => get().me?.workspaces.find((workspace) => workspace.id === workspaceId),
}));

if (typeof window !== "undefined") {
    window.addEventListener("auth:unauthorized", () => {
        if (useAuthStore.getState().status !== "authed") return;
        useAuthStore.setState({ me: null, status: "guest", expired: true });
    });
}
