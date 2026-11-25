import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { App, Button, Spin, Tooltip } from "antd";
import { KeyRound, Monitor, RefreshCw } from "lucide-react";

import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { formatDateTime, relativeTime } from "@/lib/time";
import { apiErrorMessage } from "@/services/api/client";
import { authApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type SessionItem = Awaited<ReturnType<typeof authApi.sessions>>["items"][number];

function deviceLabel(userAgent: string) {
    if (!userAgent) return "未知设备";
    const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "浏览器";
    const system = /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Linux/.test(userAgent) ? "Linux" : "";
    return system ? `${system} · ${browser}` : browser;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">{label}</span>
            <span className="min-w-0 text-right text-[#1C1917] dark:text-[#F5F5F4]">{children}</span>
        </div>
    );
}

export default function WorkspaceProfilePage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const { workspace } = useWorkspaceAccess(wsId);
    const me = useAuthStore((state) => state.me);
    const logout = useAuthStore((state) => state.logout);
    const [sessions, setSessions] = useState<SessionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSessions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await authApi.sessions();
            setSessions(result.items);
        } catch (loadError) {
            setError(apiErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSessions();
    }, [loadSessions]);

    const revokeSession = (session: SessionItem) => {
        modal.confirm({
            title: session.current ? "退出当前会话？" : "撤销该登录会话？",
            content: session.current ? "撤销后需要重新登录才能继续使用团队空间。" : `撤销后 ${deviceLabel(session.userAgent || "")} 将立即失去登录状态。`,
            okText: "撤销",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await authApi.revokeSession(session.id);
                    message.success("会话已撤销");
                    if (session.current) {
                        await logout();
                        navigate("/login");
                        return;
                    }
                    await loadSessions();
                } catch (revokeError) {
                    message.error(apiErrorMessage(revokeError));
                }
            },
        });
    };

    if (!me) {
        return (
            <div className="grid place-items-center py-20">
                <Spin />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">个人资料与安全</h1>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    {workspace?.name} · 你的角色：{roleLabel(workspace?.roleKey || "")}
                </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
                <div className="rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                    <div className="border-b border-[#E7E5DF] px-4 py-3 text-[13px] font-semibold dark:border-[#2A2724]">个人资料</div>
                    <div className="px-4 py-4">
                        <div className="flex items-center gap-3">
                            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#E7E5DF] text-sm font-semibold text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
                                {me.user.displayName?.slice(0, 1) || me.user.email.slice(0, 1).toUpperCase()}
                            </span>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[#1C1917] dark:text-[#F5F5F4]">{me.user.displayName || "未命名成员"}</div>
                                <div className="truncate text-[11px] text-[#A8A29E]">{me.user.email}</div>
                            </div>
                        </div>

                        <div className="mt-4 space-y-2 text-xs">
                            <InfoRow label="昵称">{me.user.displayName || "—"}</InfoRow>
                            <InfoRow label="邮箱">
                                <span className="break-all">{me.user.email}</span>
                            </InfoRow>
                            <InfoRow label="邮箱验证">
                                {me.user.emailVerified ? (
                                    <span className="inline-flex rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10px] text-[#15803D] dark:bg-[#14291B] dark:text-[#4ADE80]">已验证</span>
                                ) : (
                                    <span className="inline-flex rounded-full bg-[#FDF3E3] px-2 py-0.5 text-[10px] text-[#B45309] dark:bg-[#2A2117] dark:text-[#FBBF24]">未验证</span>
                                )}
                            </InfoRow>
                            <InfoRow label="我的角色">{roleLabel(workspace?.roleKey || "")}</InfoRow>
                        </div>

                        {!me.user.emailVerified ? (
                            <div className="mt-4 rounded-lg bg-[#FDF3E3] px-3 py-2 text-[11px] leading-5 text-[#B45309] dark:bg-[#2A2117] dark:text-[#FBBF24]">
                                邮箱尚未验证，团队功能可能受限。
                                <Link to="/verify-email" className="ml-1 underline">
                                    去验证
                                </Link>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="min-w-0 rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                    <div className="flex items-center gap-2 border-b border-[#E7E5DF] px-4 py-3 dark:border-[#2A2724]">
                        <Monitor className="size-3.5 text-[#A8A29E]" />
                        <span className="text-[13px] font-semibold">登录设备</span>
                        <span className="rounded-full border border-[#E7E5DF] px-1.5 text-[10px] text-[#78716C] dark:border-[#3A3631] dark:text-[#A8A29E]">{sessions.length} 个活跃会话</span>
                        <span className="min-w-2 flex-1" />
                        <Tooltip title="刷新">
                            <Button size="small" type="text" icon={<RefreshCw className="size-3.5" />} onClick={() => void loadSessions()} loading={loading} />
                        </Tooltip>
                    </div>

                    {error ? (
                        <div className="m-3 flex items-center gap-2 rounded-lg border border-[#FCEDED] bg-[#FCEDED] px-3 py-2 text-xs text-[#B91C1C] dark:border-[#3A1F1F] dark:bg-[#2A1A1A] dark:text-[#F87171]">
                            <span className="flex-1">{error}</span>
                            <button type="button" className="underline" onClick={() => void loadSessions()}>
                                重试
                            </button>
                        </div>
                    ) : null}

                    {loading && !sessions.length ? (
                        <div className="grid place-items-center py-16">
                            <Spin />
                        </div>
                    ) : sessions.length ? (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] border-collapse text-xs">
                                <thead>
                                    <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        <th className="px-4 py-2 font-medium">设备</th>
                                        <th className="w-32 px-3 py-2 font-medium">IP</th>
                                        <th className="w-40 px-3 py-2 font-medium">最近活跃</th>
                                        <th className="w-24 px-3 py-2 text-right font-medium">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sessions.map((session) => (
                                        <tr key={session.id} className="border-t border-[#E7E5DF] transition hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                                            <td className="px-4 py-2.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[12px] font-medium text-[#1C1917] dark:text-[#F5F5F4]">{deviceLabel(session.userAgent || "")}</span>
                                                    {session.current ? (
                                                        <span className="shrink-0 rounded-full bg-[#F3F1EC] px-1.5 py-0.5 text-[10px] text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">当前会话</span>
                                                    ) : null}
                                                </div>
                                                <div className="max-w-[280px] truncate text-[10px] text-[#A8A29E]" title={session.userAgent || ""}>
                                                    {session.userAgent || "—"}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5 font-mono text-[11px] text-[#78716C] dark:text-[#A8A29E]">{session.ip || "—"}</td>
                                            <td className="px-3 py-2.5">
                                                <div className="text-[11px] text-[#57534E] dark:text-[#A8A29E]">{relativeTime(session.lastSeenAt)}</div>
                                                <div className="text-[10px] text-[#A8A29E]">登录于 {formatDateTime(session.createdAt)}</div>
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                <Button size="small" danger onClick={() => revokeSession(session)}>
                                                    撤销
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-4 py-12 text-center text-xs text-[#A8A29E]">没有活跃会话</div>
                    )}
                </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#E7E5DF] bg-white px-4 py-3 text-[11px] leading-5 text-[#78716C] dark:border-[#2A2724] dark:bg-[#1F1C19] dark:text-[#A8A29E]">
                <KeyRound className="mt-0.5 size-3.5 shrink-0 text-[#A8A29E]" />
                <span>账号体系当前仅支持邮箱密码登录，暂不支持修改密码与昵称。OAuth、TOTP 两步验证、个人访问令牌（PAT）将在下一迭代开放。</span>
            </div>
        </div>
    );
}
