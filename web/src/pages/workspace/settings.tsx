import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Button, Input, Modal, Spin } from "antd";
import { Lock, ShieldAlert } from "lucide-react";

import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { formatDateTime } from "@/lib/time";
import { apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

const SECURITY_POLICIES = [
    { title: "强制多因素认证（MFA）", description: "要求所有成员登录时完成 TOTP 或安全密钥二次验证。" },
    { title: "IP 允许列表", description: "仅允许指定网段访问空间，越界请求直接拒绝并记录审计。" },
    { title: "分享默认只读", description: "新建分享链接默认只读，成员需显式申请编辑权限。" },
    { title: "禁止导出", description: "关闭项目 JSON、图片与用量明细的导出入口，密钥类操作不受影响。" },
];

function PermissionNotice() {
    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-10 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                <div className="mt-3 text-sm font-semibold">没有管理空间设置的权限</div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    需要空间权限 <code className="font-mono text-[11px]">workspace.settings.manage</code>，请联系空间所有者或管理员。
                </p>
            </div>
        </div>
    );
}

export default function WorkspaceSettingsPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const { workspace, can } = useWorkspaceAccess(wsId);
    const refreshSession = useAuthStore((state) => state.refreshSession);
    const canManageSettings = can("workspace.settings.manage");
    const canUpdate = can("workspace.update");
    const canDelete = can("workspace.delete");
    const isOwner = workspace?.roleKey === "owner";

    const [name, setName] = useState(workspace?.name || "");
    const [saving, setSaving] = useState(false);
    const [dissolveOpen, setDissolveOpen] = useState(false);
    const [dissolveName, setDissolveName] = useState("");
    const [dissolveSubmitting, setDissolveSubmitting] = useState(false);

    useEffect(() => {
        setName(workspace?.name || "");
    }, [workspace?.name]);

    const saveName = async () => {
        if (!workspace || saving) return;
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning("空间名不能为空");
            return;
        }
        if (trimmed === workspace.name) return;
        setSaving(true);
        try {
            await workspaceApi.update(wsId, { name: trimmed });
            await refreshSession();
            message.success("空间名已更新");
        } catch (saveError) {
            message.error(apiErrorMessage(saveError));
        } finally {
            setSaving(false);
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

    if (!canManageSettings) return <PermissionNotice />;

    if (!workspace) {
        return (
            <div className="grid place-items-center py-20">
                <Spin />
            </div>
        );
    }

    const dirty = name.trim() !== workspace.name;

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div>
                <h1 className="text-xl font-semibold tracking-tight">设置</h1>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{workspace.name} · 空间基础设置与安全策略</p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
                <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <div className="border-b border-[#E7E5DF] px-4 py-3 text-[13px] font-semibold dark:border-[#2A2724]">空间设置</div>
                        <div className="space-y-3 px-4 py-4">
                            <label className="block">
                                <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">空间名</span>
                                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} disabled={!canUpdate || saving} onPressEnter={() => void saveName()} />
                            </label>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button type="primary" loading={saving} disabled={!canUpdate || !dirty || !name.trim()} style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={() => void saveName()}>
                                    保存
                                </Button>
                                {dirty ? (
                                    <Button disabled={saving} onClick={() => setName(workspace.name)}>
                                        重置
                                    </Button>
                                ) : null}
                                {!canUpdate ? <span className="text-[11px] text-[#A8A29E]">你没有 workspace.update 权限，无法改名。</span> : null}
                            </div>
                            <p className="text-[11px] leading-5 text-[#A8A29E]">改名后侧边栏与面包屑会立即刷新，审计日志会记录变更前后的值。</p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <div className="flex items-center gap-2 border-b border-[#E7E5DF] px-4 py-3 dark:border-[#2A2724]">
                            <Lock className="size-3.5 text-[#A8A29E]" />
                            <span className="text-[13px] font-semibold">安全策略</span>
                            <span className="ml-auto rounded-full bg-[#F3F1EC] px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">下一迭代开放</span>
                        </div>
                        <div className="px-4 pb-2">
                            <p className="py-3 text-[11px] leading-5 text-[#78716C] dark:text-[#A8A29E]">以下策略规划中。当前版本不提供开关，避免出现看似可配置、实际不生效的假开关。</p>
                            <div className="divide-y divide-[#E7E5DF] border-t border-[#E7E5DF] dark:divide-[#2A2724] dark:border-[#2A2724]">
                                {SECURITY_POLICIES.map((policy) => (
                                    <div key={policy.title} className="flex items-start justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <div className="text-[12px] font-medium text-[#1C1917] dark:text-[#F5F5F4]">{policy.title}</div>
                                            <p className="mt-0.5 text-[11px] leading-5 text-[#78716C] dark:text-[#A8A29E]">{policy.description}</p>
                                        </div>
                                        <span className="shrink-0 rounded-full border border-[#E7E5DF] px-2 py-0.5 text-[10px] text-[#A8A29E] dark:border-[#3A3631]">未开放</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <div className="border-b border-[#E7E5DF] px-4 py-3 text-[13px] font-semibold dark:border-[#2A2724]">空间信息</div>
                        <div className="space-y-2 px-4 py-3 text-xs">
                            <div className="flex items-start justify-between gap-2">
                                <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">空间 ID</span>
                                <span className="min-w-0 truncate font-mono text-[11px] text-[#1C1917] dark:text-[#F5F5F4]">{workspace.id}</span>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                                <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">创建时间</span>
                                <span className="text-right text-[#1C1917] dark:text-[#F5F5F4]">{formatDateTime(workspace.createdAt)}</span>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                                <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">你的角色</span>
                                <span className="text-[#1C1917] dark:text-[#F5F5F4]">{roleLabel(workspace.roleKey)}</span>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                                <span className="shrink-0 text-[#78716C] dark:text-[#A8A29E]">成员</span>
                                <span className="font-mono text-[#1C1917] dark:text-[#F5F5F4]">{workspace.memberCount} 人</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-[#E7E5DF] bg-white px-4 py-3 dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <div className="text-[13px] font-semibold">危险区</div>
                        <p className="mt-1 text-[11px] leading-5 text-[#78716C] dark:text-[#A8A29E]">解散空间后，所有成员将立即失去访问权限，数据不可恢复。</p>
                        <Button
                            danger
                            className="mt-2"
                            disabled={!canDelete || !isOwner}
                            onClick={() => {
                                setDissolveName("");
                                setDissolveOpen(true);
                            }}
                        >
                            解散空间
                        </Button>
                        {!canDelete || !isOwner ? <p className="mt-1.5 text-[11px] text-[#A8A29E]">仅空间所有者可以解散空间。</p> : null}
                    </div>
                </div>
            </div>

            <Modal open={dissolveOpen} title="解散空间" footer={null} width={420} destroyOnHidden onCancel={() => !dissolveSubmitting && setDissolveOpen(false)}>
                <div className="space-y-3">
                    <p className="text-xs leading-5 text-[#B91C1C] dark:text-[#F87171]">解散后空间内所有成员（包括你）将立即失去访问权限，且无法恢复。</p>
                    <label className="block">
                        <span className="mb-1 block text-xs text-[#57534E] dark:text-[#A8A29E]">
                            输入空间名 <b className="text-[#1C1917] dark:text-[#F5F5F4]">{workspace.name}</b> 确认
                        </span>
                        <Input value={dissolveName} onChange={(event) => setDissolveName(event.target.value)} placeholder="空间名" disabled={dissolveSubmitting} />
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button onClick={() => setDissolveOpen(false)} disabled={dissolveSubmitting}>
                            取消
                        </Button>
                        <Button type="primary" danger loading={dissolveSubmitting} disabled={dissolveName.trim() !== workspace.name} onClick={() => void submitDissolve()}>
                            解散空间
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
