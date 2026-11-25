import { useEffect, useRef, useState } from "react";
import { Button, Result, Spin } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { apiErrorMessage } from "@/services/api/client";
import { authApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type VerifyState = { status: "loading" | "success" | "error" | "missing"; message?: string };

export default function VerifyEmailPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const startedRef = useRef(false);
    const token = searchParams.get("token") || "";
    const workspaceId = useAuthStore((state) => state.me?.workspaces[0]?.id);
    const sessionStatus = useAuthStore((state) => state.status);
    const [state, setState] = useState<VerifyState>({ status: token ? "loading" : "missing" });

    useEffect(() => {
        if (sessionStatus === "idle") void useAuthStore.getState().loadSession();
    }, [sessionStatus]);

    useEffect(() => {
        if (!token || startedRef.current) return;
        startedRef.current = true;
        authApi
            .verifyEmail(token)
            .then(() => {
                const store = useAuthStore.getState();
                void (store.status === "authed" ? store.refreshSession() : store.loadSession()).catch(() => undefined);
                setState({ status: "success" });
            })
            .catch((err: unknown) => setState({ status: "error", message: apiErrorMessage(err) }));
    }, [token]);

    if (state.status === "loading") {
        return (
            <AuthShell>
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                    <Spin />
                    <div>
                        <div className="text-[15px] font-medium">正在验证邮箱…</div>
                        <div className="mt-1 text-[12px] text-[#78716C] dark:text-[#A8A29E]">请稍候，不要关闭当前页面。</div>
                    </div>
                </div>
            </AuthShell>
        );
    }

    if (state.status === "success") {
        return (
            <AuthShell>
                <Result
                    status="success"
                    title="邮箱已验证"
                    subTitle="现在可以使用团队空间、邀请与模型额度等能力。"
                    extra={
                        <Button type="primary" size="large" onClick={() => navigate(workspaceId ? `/w/${workspaceId}` : "/login", { replace: true })}>
                            {workspaceId ? "进入空间" : "去登录"}
                        </Button>
                    }
                />
            </AuthShell>
        );
    }

    if (state.status === "missing") {
        return (
            <AuthShell>
                <Result
                    status="warning"
                    title="验证链接不完整"
                    subTitle="链接缺少令牌，请从邮件里重新打开验证链接。"
                    extra={
                        <Button size="large" onClick={() => navigate("/login", { replace: true })}>
                            返回登录
                        </Button>
                    }
                />
            </AuthShell>
        );
    }

    return (
        <AuthShell>
            <Result
                status="error"
                title="验证失败"
                subTitle={state.message || "验证链接无效或已过期，请重新发送验证邮件。"}
                extra={
                    <Button type="primary" size="large" onClick={() => navigate("/login", { replace: true })}>
                        返回登录
                    </Button>
                }
            />
        </AuthShell>
    );
}
