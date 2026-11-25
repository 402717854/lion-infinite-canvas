import type { ReactNode } from "react";
import { useEffect } from "react";
import { Spin } from "antd";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

function CenteredLoading() {
    return (
        <div className="flex h-dvh items-center justify-center bg-[#FAF9F7] dark:bg-[#14120F]">
            <Spin />
        </div>
    );
}

function useEnsureSession() {
    const status = useAuthStore((state) => state.status);
    const loadSession = useAuthStore((state) => state.loadSession);

    useEffect(() => {
        if (status === "idle") void loadSession();
    }, [status, loadSession]);

    return status;
}

export function RequireAuth({ children }: { children: ReactNode }) {
    const status = useEnsureSession();
    const me = useAuthStore((state) => state.me);
    const { pathname, search } = useLocation();

    if (status === "idle" || status === "loading") return <CenteredLoading />;
    if (status !== "authed" || !me) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
    return <>{children}</>;
}

export function RequireGuest({ children }: { children: ReactNode }) {
    const status = useEnsureSession();
    const me = useAuthStore((state) => state.me);
    const { search } = useLocation();

    if (status === "idle" || status === "loading") return <CenteredLoading />;
    if (status === "authed" && me) {
        const next = new URLSearchParams(search).get("next");
        const workspaceId = me.workspaces[0]?.id;
        const target = next && next.startsWith("/") ? next : workspaceId ? `/w/${workspaceId}` : "/";
        return <Navigate to={target} replace />;
    }
    return <>{children}</>;
}
