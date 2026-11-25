import { useEffect, useState } from "react";
import { Alert, App, Button, Result, Spin } from "antd";
import dayjs from "dayjs";
import { useNavigate, useParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { ApiError, apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type InvitationInfo = Awaited<ReturnType<typeof workspaceApi.invitation>> & { status?: string };

function invitationErrorMessage(error: unknown) {
    if (error instanceof ApiError) {
        if (error.code === "NOT_FOUND" || error.code === "INVITATION_INVALID") return "该邀请链接无效或已过期，请联系空间管理员重新发送。";
        if (error.code === "PERMISSION_DENIED") return "该邀请仅限指定邮箱使用，请用被邀请的邮箱登录。";
        if (error.code === "EMAIL_NOT_VERIFIED") return "请先验证邮箱后再接受邀请。";
    }
    return apiErrorMessage(error);
}

export default function InvitePage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { token = "" } = useParams<{ token: string }>();
    const [info, setInfo] = useState<InvitationInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [accepting, setAccepting] = useState(false);
    const [acceptError, setAcceptError] = useState("");
    const status = useAuthStore((state) => state.status);

    useEffect(() => {
        if (status === "idle") void useAuthStore.getState().loadSession();
    }, [status]);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            setError("邀请链接不完整");
            return;
        }
        let cancelled = false;
        workspaceApi
            .invitation(token)
            .then((data) => {
                if (!cancelled) setInfo(data);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(invitationErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const accept = async () => {
        setAccepting(true);
        setAcceptError("");
        try {
            const result = await workspaceApi.acceptInvitation(token);
            const accepted: { workspaceId?: string; id?: string } = result;
            const store = useAuthStore.getState();
            if (store.status === "authed") await store.refreshSession().catch(() => undefined);
            const workspaceId = accepted.workspaceId ?? accepted.id ?? useAuthStore.getState().me?.workspaces[0]?.id;
            message.success("已加入空间");
            navigate(workspaceId ? `/w/${workspaceId}` : "/", { replace: true });
        } catch (err) {
            setAcceptError(invitationErrorMessage(err));
            setAccepting(false);
        }
    };

    const backHome = (
        <Button size="large" onClick={() => navigate("/", { replace: true })}>
            返回首页
        </Button>
    );

    if (loading) {
        return (
            <AuthShell>
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Spin />
                    <div className="text-[12px] text-[#78716C] dark:text-[#A8A29E]">正在读取邀请…</div>
                </div>
            </AuthShell>
        );
    }

    if (error || !info) {
        return (
            <AuthShell>
                <Result status="error" title="邀请无效" subTitle={error || "邀请链接无效或已过期，请联系空间管理员重新发送。"} extra={backHome} />
            </AuthShell>
        );
    }

    const unavailable = (info.status !== undefined && info.status !== "pending") || Date.parse(info.expiresAt) <= Date.now();
    if (unavailable) {
        return (
            <AuthShell>
                <Result status="error" title="邀请已失效" subTitle="该邀请已过期、已被使用或被撤销，请联系空间管理员重新发送。" extra={backHome} />
            </AuthShell>
        );
    }

    const sessionLoading = status === "idle" || status === "loading";

    return (
        <AuthShell>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">空间邀请</h2>
            <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">接受后即可在空间里协作项目与素材。</p>

            <div className="mt-4 rounded-xl border border-[#E7E5DF] bg-[#FAF9F7] p-4 dark:border-[#2A2724] dark:bg-[#14120F]">
                <div className="text-[15px] leading-6 font-medium">
                    {info.inviterName || "空间管理员"} 邀请你加入「{info.workspaceName}」
                </div>
                <dl className="mt-3 space-y-2 text-[12px]">
                    <div className="flex items-start justify-between gap-3">
                        <dt className="text-[#78716C] dark:text-[#A8A29E]">角色</dt>
                        <dd className="text-right font-medium">{info.roleName}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                        <dt className="text-[#78716C] dark:text-[#A8A29E]">有效期至</dt>
                        <dd className="text-right">{dayjs(info.expiresAt).format("YYYY-MM-DD HH:mm")}</dd>
                    </div>
                    {info.email ? (
                        <div className="flex items-start justify-between gap-3">
                            <dt className="text-[#78716C] dark:text-[#A8A29E]">指定邮箱</dt>
                            <dd className="text-right break-all">{info.email}</dd>
                        </div>
                    ) : null}
                </dl>
            </div>

            {acceptError ? <Alert className="mt-4" type="error" showIcon message={acceptError} /> : null}

            <div className="mt-5 flex flex-col gap-2">
                {sessionLoading ? (
                    <div className="flex justify-center py-2">
                        <Spin />
                    </div>
                ) : status === "authed" ? (
                    <Button type="primary" size="large" block loading={accepting} onClick={accept}>
                        接受邀请
                    </Button>
                ) : (
                    <>
                        <Button type="primary" size="large" block onClick={() => navigate(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)}>
                            登录并接受
                        </Button>
                        <Button size="large" block onClick={() => navigate(`/register?invite=${encodeURIComponent(token)}`)}>
                            注册并接受
                        </Button>
                    </>
                )}
            </div>

            <p className="mt-4 text-center text-[11px] leading-5 text-[#A8A29E] dark:text-[#78716C]">登录或注册后会回到本页继续接受邀请。暂时不想加入？也可以继续用本地模式。</p>
        </AuthShell>
    );
}
