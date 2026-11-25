import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Button, Dropdown, Empty, Input, InputNumber, Modal, Select, Spin, Tooltip } from "antd";
import { Copy, MoreHorizontal, RefreshCw, ShieldAlert, Trash2, UserPlus } from "lucide-react";

import { ROLE_META, roleLabel } from "@/constant/permissions";
import { useCopyText } from "@/hooks/use-copy-text";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { formatDateTime, relativeTime } from "@/lib/time";
import { apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";
import type { InvitationRecord, MemberRecord } from "@/types/team";

const MEMBER_LIMIT = 50;
const AVATAR_COLORS = ["#B45309", "#0F766E", "#7C3AED", "#BE123C", "#1D4ED8", "#4D7C0F"];
const ROLE_OPTIONS: { value: string; label: string }[] = ROLE_META.map((role) => ({ value: role.key, label: role.name }));

function avatarColor(seed: string) {
    const sum = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function statusLabel(status: string) {
    if (status === "active") return "已激活";
    if (status === "invited" || status === "pending") return "待接受";
    if (status === "suspended" || status === "disabled") return "已停用";
    return status || "未知";
}

function expiryLabel(expiresAt: string) {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(remaining)) return "";
    if (remaining <= 0) return "已过期";
    const days = Math.ceil(remaining / 86_400_000);
    return days <= 1 ? "今天过期" : `剩余 ${days} 天`;
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">{label}</span>
            <span className={mono ? "min-w-0 truncate font-mono text-[11px] text-[#1C1917] dark:text-[#F5F5F4]" : "min-w-0 break-all text-right text-[#1C1917] dark:text-[#F5F5F4]"}>{value}</span>
        </div>
    );
}

function PermissionNotice() {
    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-10 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                <div className="mt-3 text-sm font-semibold">没有查看成员的权限</div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    需要空间权限 <code className="font-mono text-[11px]">member.read</code>，请联系空间所有者或管理员。
                </p>
            </div>
        </div>
    );
}

export default function WorkspaceMembersPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const { workspace, can } = useWorkspaceAccess(wsId);
    const me = useAuthStore((state) => state.me);
    const refreshSession = useAuthStore((state) => state.refreshSession);
    const copyText = useCopyText();
    const canRead = can("member.read");
    const canInvite = can("member.invite");
    const canUpdateMember = can("member.update");
    const canRemoveMember = can("member.remove");
    const isOwner = workspace?.roleKey === "owner";

    const [members, setMembers] = useState<MemberRecord[]>([]);
    const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("editor");
    const [inviteExpires, setInviteExpires] = useState(7);
    const [inviteMaxUses, setInviteMaxUses] = useState(1);
    const [inviteSubmitting, setInviteSubmitting] = useState(false);
    const [inviteResult, setInviteResult] = useState<{ url: string; invitation: InvitationRecord } | null>(null);

    const [transferOpen, setTransferOpen] = useState(false);
    const [transferUserId, setTransferUserId] = useState("");
    const [transferName, setTransferName] = useState("");
    const [transferSubmitting, setTransferSubmitting] = useState(false);

    const [dissolveOpen, setDissolveOpen] = useState(false);
    const [dissolveName, setDissolveName] = useState("");
    const [dissolveSubmitting, setDissolveSubmitting] = useState(false);

    const load = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        setError(null);
        try {
            const invitationRequest = canInvite ? workspaceApi.invitations(wsId) : Promise.resolve({ items: [] as InvitationRecord[] });
            const [memberResult, invitationResult] = await Promise.all([workspaceApi.members(wsId), invitationRequest]);
            setMembers(memberResult.items);
            setInvitations(invitationResult.items.filter((item) => item.status === "pending"));
        } catch (loadError) {
            setError(apiErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [canInvite, canRead, wsId]);

    useEffect(() => {
        void load();
    }, [load]);

    const openInvite = () => {
        setInviteEmail("");
        setInviteRole("editor");
        setInviteExpires(7);
        setInviteMaxUses(1);
        setInviteResult(null);
        setInviteOpen(true);
    };

    const closeInvite = () => {
        setInviteOpen(false);
        setInviteResult(null);
    };

    const submitInvite = async () => {
        if (inviteSubmitting) return;
        const email = inviteEmail.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            message.error("请输入正确的邮箱地址");
            return;
        }
        setInviteSubmitting(true);
        try {
            const result = await workspaceApi.createInvitation(wsId, {
                email: email || undefined,
                roleKey: inviteRole,
                expiresInDays: inviteExpires,
                maxUses: inviteMaxUses,
            });
            setInviteResult({ url: `${window.location.origin}${result.inviteUrl}`, invitation: result.invitation });
            await load();
        } catch (inviteError) {
            message.error(apiErrorMessage(inviteError));
        } finally {
            setInviteSubmitting(false);
        }
    };

    const changeRole = async (member: MemberRecord, roleKey: string) => {
        if (roleKey === member.roleKey || updatingUserId) return;
        setUpdatingUserId(member.userId);
        try {
            await workspaceApi.updateMember(wsId, member.userId, roleKey);
            message.success(`已将 ${member.displayName || member.email} 的角色改为 ${roleLabel(roleKey)}`);
            await load();
        } catch (updateError) {
            message.error(apiErrorMessage(updateError));
        } finally {
            setUpdatingUserId(null);
        }
    };

    const confirmRemove = (member: MemberRecord) => {
        modal.confirm({
            title: `移除「${member.displayName || member.email}」？`,
            content: "移除后对方将立即失去空间访问权限；其创建的项目仍保留在空间内。",
            okText: "移除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await workspaceApi.removeMember(wsId, member.userId);
                    message.success("成员已移除");
                    await load();
                } catch (removeError) {
                    message.error(apiErrorMessage(removeError));
                }
            },
        });
    };

    const confirmRevoke = (invitation: InvitationRecord) => {
        modal.confirm({
            title: `撤销发给「${invitation.email || "通用邀请链接"}」的邀请？`,
            content: "撤销后该链接立即失效，对方无法再通过它加入空间。",
            okText: "撤销邀请",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await workspaceApi.revokeInvitation(wsId, invitation.id);
                    message.success("邀请已撤销");
                    await load();
                } catch (revokeError) {
                    message.error(apiErrorMessage(revokeError));
                }
            },
        });
    };

    const openTransfer = () => {
        setTransferUserId("");
        setTransferName("");
        setTransferOpen(true);
    };

    const submitTransfer = async () => {
        if (!workspace || transferSubmitting) return;
        if (!transferUserId) {
            message.warning("请选择接收所有权的成员");
            return;
        }
        if (transferName.trim() !== workspace.name) {
            message.warning("请输入完整的空间名以确认");
            return;
        }
        setTransferSubmitting(true);
        try {
            await workspaceApi.transferOwner(wsId, transferUserId, workspace.name);
            message.success("所有权已转让，你现在的角色是管理员");
            setTransferOpen(false);
            await refreshSession();
            await load();
        } catch (transferError) {
            message.error(apiErrorMessage(transferError));
        } finally {
            setTransferSubmitting(false);
        }
    };

    const submitDissolve = async () => {
        if (!workspace || dissolveSubmitting) return;
        if (dissolveName.trim() !== workspace.name) {
            message.warning("请输入完整的空间名以确认");
            return;
        }
        setDissolveSubmitting(true);
        try {
            await workspaceApi.remove(wsId, workspace.name);
            message.success("空间已解散");
            navigate("/");
        } catch (dissolveError) {
            message.error(apiErrorMessage(dissolveError));
        } finally {
            setDissolveSubmitting(false);
        }
    };

    if (!canRead) return <PermissionNotice />;

    const transferCandidates = members.filter((member) => member.userId !== me?.user.id && member.roleKey !== "owner");
    const description = [workspace?.name, `${members.length} 个成员`, canInvite ? `${invitations.length} 个待接受邀请` : "", `上限 ${MEMBER_LIMIT}`].filter(Boolean).join(" · ");

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">成员</h1>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{description}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title="刷新">
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading} />
                    </Tooltip>
                    {canInvite ? (
                        <Button type="primary" icon={<UserPlus className="size-4" />} style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={openInvite}>
                            邀请成员
                        </Button>
                    ) : null}
                </div>
            </div>

            {error ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FCEDED] bg-[#FCEDED] px-3 py-2 text-xs text-[#B91C1C] dark:border-[#3A1F1F] dark:bg-[#2A1A1A] dark:text-[#F87171]">
                    <span className="flex-1">{error}</span>
                    <button type="button" className="underline" onClick={() => void load()}>
                        重试
                    </button>
                </div>
            ) : null}

            {loading ? (
                <div className="grid place-items-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <div className="overflow-hidden rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                            {members.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[760px] border-collapse text-xs">
                                        <thead>
                                            <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                                <th className="px-3 py-2.5 font-medium">成员</th>
                                                <th className="w-32 px-3 py-2.5 font-medium">角色</th>
                                                <th className="w-24 px-3 py-2.5 font-medium">状态</th>
                                                <th className="w-28 px-3 py-2.5 font-medium">最近活跃</th>
                                                <th className="w-12 px-3 py-2.5" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {members.map((member) => {
                                                const isSelf = member.userId === me?.user.id;
                                                const ownerRowLocked = member.roleKey === "owner" && !isOwner;
                                                const isWorkspaceOwner = member.userId === workspace?.ownerId;
                                                const removeDisabled = !canRemoveMember || isSelf || isWorkspaceOwner || (member.roleKey === "owner" && !isOwner);
                                                const removeHint = removeDisabled
                                                    ? isSelf
                                                        ? "不能移除自己"
                                                        : isWorkspaceOwner
                                                          ? "请先转让所有者再移除"
                                                          : !canRemoveMember
                                                            ? "你没有移除成员的权限"
                                                            : "只有所有者可以移除所有者"
                                                    : "更多";
                                                return (
                                                    <tr key={member.userId} className="border-t border-[#E7E5DF] transition hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                                                        <td className="px-3 py-2.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-semibold text-white" style={{ background: member.avatarUrl ? undefined : avatarColor(member.userId) }}>
                                                                    {member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" /> : (member.displayName || member.email).slice(0, 1).toUpperCase()}
                                                                </span>
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#1C1917] dark:text-[#F5F5F4]">
                                                                        <span className="truncate">{member.displayName || "未命名成员"}</span>
                                                                        {isSelf ? <span className="shrink-0 rounded-full border border-[#E7E5DF] px-1.5 text-[10px] font-normal text-[#78716C] dark:border-[#3A3631] dark:text-[#A8A29E]">你</span> : null}
                                                                    </div>
                                                                    <div className="truncate text-[11px] text-[#A8A29E]">{member.email}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <Select
                                                                size="small"
                                                                value={member.roleKey}
                                                                options={ROLE_OPTIONS.some((option) => option.value === member.roleKey) ? ROLE_OPTIONS : [...ROLE_OPTIONS, { value: member.roleKey, label: member.roleName }]}
                                                                disabled={!canUpdateMember || isSelf || ownerRowLocked || updatingUserId === member.userId}
                                                                loading={updatingUserId === member.userId}
                                                                onChange={(value: string) => void changeRole(member, value)}
                                                                style={{ width: 104 }}
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <span
                                                                className={
                                                                    member.status === "active"
                                                                        ? "inline-flex rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10px] text-[#15803D] dark:bg-[#14291B] dark:text-[#4ADE80]"
                                                                        : "inline-flex rounded-full bg-[#FDF3E3] px-2 py-0.5 text-[10px] text-[#B45309] dark:bg-[#2A2117] dark:text-[#FBBF24]"
                                                                }
                                                            >
                                                                {statusLabel(member.status)}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]">{member.lastActiveAt ? relativeTime(member.lastActiveAt) : "从未活跃"}</td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <Tooltip title={removeHint}>
                                                                <span>
                                                                    <Dropdown
                                                                        trigger={["click"]}
                                                                        menu={{
                                                                            items: [{ key: "remove", label: "移除成员", icon: <Trash2 className="size-3.5" />, danger: true, disabled: removeDisabled }],
                                                                            onClick: ({ key }) => {
                                                                                if (key === "remove") confirmRemove(member);
                                                                            },
                                                                        }}
                                                                    >
                                                                        <button type="button" className="grid size-7 place-items-center rounded-md text-[#A8A29E] transition hover:bg-black/5 hover:text-[#57534E] dark:hover:bg-white/10">
                                                                            <MoreHorizontal className="size-4" />
                                                                        </button>
                                                                    </Dropdown>
                                                                </span>
                                                            </Tooltip>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="py-12">
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有成员" />
                                </div>
                            )}
                            <div className="border-t border-[#E7E5DF] bg-[#FAF9F7] px-3 py-2 text-[11px] text-[#78716C] dark:border-[#2A2724] dark:bg-[#1C1917] dark:text-[#A8A29E]">
                                成员被移除后，其创建的项目仍保留在空间内。
                            </div>
                        </div>

                        {canInvite ? (
                            <div className="overflow-hidden rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                                <div className="flex items-center gap-2 border-b border-[#E7E5DF] px-3 py-2.5 dark:border-[#2A2724]">
                                    <span className="text-[13px] font-semibold">待接受的邀请</span>
                                    <span className="rounded-full border border-[#E7E5DF] px-1.5 text-[10px] text-[#78716C] dark:border-[#3A3631] dark:text-[#A8A29E]">{invitations.length} 个</span>
                                </div>
                                {invitations.length ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[560px] border-collapse text-xs">
                                            <thead>
                                                <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                                    <th className="px-3 py-2 font-medium">邮箱</th>
                                                    <th className="w-24 px-3 py-2 font-medium">角色</th>
                                                    <th className="w-28 px-3 py-2 font-medium">有效期</th>
                                                    <th className="w-24 px-3 py-2 font-medium">使用次数</th>
                                                    <th className="w-20 px-3 py-2 text-right font-medium">操作</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {invitations.map((invitation) => {
                                                    const expiry = expiryLabel(invitation.expiresAt);
                                                    return (
                                                        <tr key={invitation.id} className="border-t border-[#E7E5DF] transition hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                                                            <td className="px-3 py-2.5">
                                                                <div className="text-[12px] text-[#1C1917] dark:text-[#F5F5F4]">{invitation.email || "通用邀请链接"}</div>
                                                                <div className="text-[10px] text-[#A8A29E]">{relativeTime(invitation.createdAt)}创建</div>
                                                            </td>
                                                            <td className="px-3 py-2.5">
                                                                <span className="inline-flex rounded-full border border-[#E7E5DF] px-2 py-0.5 text-[10px] text-[#57534E] dark:border-[#3A3631] dark:text-[#A8A29E]">{roleLabel(invitation.roleKey)}</span>
                                                            </td>
                                                            <td className={expiry === "今天过期" ? "px-3 py-2.5 text-[11px] text-[#B45309] dark:text-[#FBBF24]" : "px-3 py-2.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]"}>{expiry}</td>
                                                            <td className="px-3 py-2.5 font-mono text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                                                {invitation.usedCount} / {invitation.maxUses}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-right">
                                                                <Button size="small" danger onClick={() => confirmRevoke(invitation)}>
                                                                    撤销
                                                                </Button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="px-3 py-6 text-center text-xs text-[#A8A29E]">暂无待接受的邀请</div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    <aside className="w-full shrink-0 lg:w-[244px]">
                        <div className="rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                            <div className="border-b border-[#E7E5DF] px-3.5 py-2.5 text-[13px] font-semibold dark:border-[#2A2724]">空间信息</div>
                            <div className="space-y-2 px-3.5 py-3 text-xs">
                                <InfoRow label="空间名" value={workspace?.name || "—"} />
                                <InfoRow label="空间 ID" value={workspace?.id || "—"} mono />
                                <InfoRow label="你的角色" value={workspace ? roleLabel(workspace.roleKey) : "—"} />
                                <InfoRow label="创建时间" value={workspace ? formatDateTime(workspace.createdAt) : "—"} />
                                <div className="pt-1">
                                    <div className="mb-1 flex items-center justify-between text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        <span>成员</span>
                                        <span className="font-mono">
                                            {members.length} / {MEMBER_LIMIT}
                                        </span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-[#E7E5DF] dark:bg-[#2A2724]">
                                        <div className="h-full rounded-full bg-[#C2410C]" style={{ width: `${Math.min(100, (members.length / MEMBER_LIMIT) * 100)}%` }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {isOwner ? (
                            <div className="mt-3 rounded-xl border border-[#E7E5DF] bg-white px-3.5 py-3 dark:border-[#2A2724] dark:bg-[#1F1C19]">
                                <div className="text-[13px] font-semibold">危险操作</div>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">转让所有者</span>
                                    <Button size="small" onClick={openTransfer}>
                                        转让
                                    </Button>
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">解散空间</span>
                                    <Button size="small" danger onClick={() => setDissolveOpen(true)}>
                                        解散
                                    </Button>
                                </div>
                                <p className="mt-2 text-[11px] leading-5 text-[#A8A29E]">转让后你会变为管理员；解散需输入空间名确认。</p>
                            </div>
                        ) : null}
                    </aside>
                </div>
            )}

            <Modal open={inviteOpen} title="邀请成员" footer={null} width={460} destroyOnHidden onCancel={() => !inviteSubmitting && closeInvite()}>
                {inviteResult ? (
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-[#1C1917] dark:text-[#F5F5F4]">邀请链接已生成</div>
                        <p className="text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">把链接发给对方即可。对方在有效期内打开链接，注册或登录后自动加入空间。</p>
                        <div className="flex items-center gap-2">
                            <Input readOnly value={inviteResult.url} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
                            <Button icon={<Copy className="size-3.5" />} onClick={() => copyText(inviteResult.url, "邀请链接已复制")}>
                                复制
                            </Button>
                        </div>
                        <div className="space-y-1.5 rounded-lg border border-[#E7E5DF] p-3 text-[11px] text-[#57534E] dark:border-[#2A2724] dark:text-[#A8A29E]">
                            <div className="flex justify-between gap-3">
                                <span>邮箱</span>
                                <span className="truncate">{inviteResult.invitation.email || "通用链接"}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span>角色</span>
                                <span>{roleLabel(inviteResult.invitation.roleKey)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span>有效期至</span>
                                <span>{formatDateTime(inviteResult.invitation.expiresAt)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                                <span>最多使用</span>
                                <span>{inviteResult.invitation.maxUses} 次</span>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button type="primary" style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={closeInvite}>
                                完成
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <label className="block">
                            <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">邮箱（可选）</span>
                            <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" allowClear disabled={inviteSubmitting} />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">角色</span>
                                <Select value={inviteRole} onChange={(value: string) => setInviteRole(value)} options={ROLE_OPTIONS} disabled={inviteSubmitting} style={{ width: "100%" }} />
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">有效期</span>
                                <InputNumber value={inviteExpires} min={1} max={30} addonAfter="天" disabled={inviteSubmitting} onChange={(value) => setInviteExpires(value ?? 7)} style={{ width: "100%" }} />
                            </label>
                        </div>
                        <label className="block">
                            <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">最多使用次数</span>
                            <InputNumber value={inviteMaxUses} min={1} max={100} addonAfter="次" disabled={inviteSubmitting} onChange={(value) => setInviteMaxUses(value ?? 1)} style={{ width: "100%" }} />
                        </label>
                        <p className="text-[11px] leading-5 text-[#A8A29E]">留空邮箱会生成通用邀请链接；同一邮箱已注册时，对方登录后即可加入。</p>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button onClick={closeInvite} disabled={inviteSubmitting}>
                                取消
                            </Button>
                            <Button type="primary" loading={inviteSubmitting} style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={() => void submitInvite()}>
                                生成邀请链接
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal open={transferOpen} title="转让所有者" footer={null} width={420} destroyOnHidden onCancel={() => !transferSubmitting && setTransferOpen(false)}>
                <div className="space-y-3">
                    <p className="text-xs leading-5 text-[#78716C] dark:text-[#A8A29E]">转让后对方成为空间所有者，你自动变为管理员。此操作不可撤销。</p>
                    <label className="block">
                        <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">选择接收所有权的成员</span>
                        <Select
                            value={transferUserId || undefined}
                            placeholder="选择成员"
                            options={transferCandidates.map((member) => ({ value: member.userId, label: `${member.displayName || member.email} · ${member.roleName}` }))}
                            disabled={transferSubmitting || !transferCandidates.length}
                            onChange={(value: string) => setTransferUserId(value)}
                            style={{ width: "100%" }}
                        />
                    </label>
                    {!transferCandidates.length ? <p className="text-[11px] text-[#B45309] dark:text-[#FBBF24]">没有可转让的成员，请先邀请或调整成员角色。</p> : null}
                    <label className="block">
                        <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">
                            输入空间名 <b className="text-[#1C1917] dark:text-[#F5F5F4]">{workspace?.name}</b> 确认
                        </span>
                        <Input value={transferName} onChange={(event) => setTransferName(event.target.value)} placeholder="空间名" disabled={transferSubmitting} />
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button onClick={() => setTransferOpen(false)} disabled={transferSubmitting}>
                            取消
                        </Button>
                        <Button type="primary" loading={transferSubmitting} disabled={!transferUserId || transferName.trim() !== workspace?.name} style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={() => void submitTransfer()}>
                            确认转让
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal open={dissolveOpen} title="解散空间" footer={null} width={420} destroyOnHidden onCancel={() => !dissolveSubmitting && setDissolveOpen(false)}>
                <div className="space-y-3">
                    <p className="text-xs leading-5 text-[#B91C1C] dark:text-[#F87171]">解散后空间内所有成员（包括你）将立即失去访问权限，且无法恢复。</p>
                    <label className="block">
                        <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">
                            输入空间名 <b className="text-[#1C1917] dark:text-[#F5F5F4]">{workspace?.name}</b> 确认
                        </span>
                        <Input value={dissolveName} onChange={(event) => setDissolveName(event.target.value)} placeholder="空间名" disabled={dissolveSubmitting} />
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button onClick={() => setDissolveOpen(false)} disabled={dissolveSubmitting}>
                            取消
                        </Button>
                        <Button type="primary" danger loading={dissolveSubmitting} disabled={dissolveName.trim() !== workspace?.name} onClick={() => void submitDissolve()}>
                            解散空间
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
