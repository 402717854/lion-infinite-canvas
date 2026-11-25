import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { App, Button, Checkbox, Spin, Tooltip } from "antd";
import { RefreshCw, ShieldAlert } from "lucide-react";

import { PERMISSION_GROUPS, PERMISSIONS } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import type { RoleRecord } from "@/types/team";

const GROUPED_PERMISSIONS = PERMISSION_GROUPS.map((group) => ({ group, items: PERMISSIONS.filter((permission) => permission.group === group) }));
const FIXED_ROLE_KEYS = new Set(["owner", "admin"]);

function samePermissions(left: string[], right: string[]) {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every((key) => rightSet.has(key));
}

function previewStatus(visible: boolean, editable: boolean) {
    if (!visible) return { text: "不可见", className: "text-[#A8A29E]" };
    if (editable) return { text: "可编辑", className: "font-medium text-[#1C1917] dark:text-[#F5F5F4]" };
    return { text: "只读", className: "text-[#78716C] dark:text-[#A8A29E]" };
}

function PermissionNotice() {
    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-10 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                <div className="mt-3 text-sm font-semibold">没有查看角色的权限</div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    需要空间权限 <code className="font-mono text-[11px]">role.read</code>，请联系空间所有者或管理员。
                </p>
            </div>
        </div>
    );
}

export default function WorkspaceRolesPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const { message } = App.useApp();
    const { workspace, can } = useWorkspaceAccess(wsId);
    const canRead = can("role.read");
    const canManage = can("role.manage");

    const [roles, setRoles] = useState<RoleRecord[]>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        setError(null);
        try {
            const result = await workspaceApi.roles(wsId);
            setRoles(result.items);
            setSelectedKey((current) => (result.items.some((role) => role.key === current) ? current : result.items[0]?.key || ""));
        } catch (loadError) {
            setError(apiErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [canRead, wsId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const role = roles.find((item) => item.key === selectedKey);
        setSelectedPermissions(role ? [...role.permissions] : []);
    }, [roles, selectedKey]);

    const selectedRole = roles.find((role) => role.key === selectedKey) || null;
    const editable = Boolean(selectedRole && canManage && !FIXED_ROLE_KEYS.has(selectedRole.key));
    const baseline = selectedRole?.permissions || [];
    const dirty = Boolean(selectedRole) && !samePermissions(baseline, selectedPermissions);
    const changedCount = selectedRole
        ? selectedPermissions.filter((key) => !baseline.includes(key)).length + baseline.filter((key) => !selectedPermissions.includes(key)).length
        : 0;
    const blockedCount = PERMISSIONS.filter((permission) => !can(permission.key)).length;
    const has = (key: string) => selectedPermissions.includes(key);

    const previewRows = [
        { label: "项目", ...previewStatus(has("project.read"), has("project.update") || has("project.create")) },
        { label: "成员", ...previewStatus(has("member.read"), has("member.update") || has("member.invite") || has("member.remove")) },
        { label: "角色", ...previewStatus(has("role.read"), has("role.manage")) },
        { label: "审计", ...previewStatus(has("audit.read"), false) },
        { label: "设置", ...previewStatus(has("workspace.settings.manage"), has("workspace.settings.manage")) },
    ];
    const canvasHint =
        has("project.update") || has("project.create")
            ? "可以在画布内创建、编辑项目并生成内容。"
            : has("project.read")
              ? "只能浏览项目，画布编辑与生成会被禁用。"
              : "无法访问空间内的项目与素材。";

    const togglePermission = (key: string, checked: boolean) => {
        if (!editable) return;
        setSelectedPermissions((current) => (checked ? (current.includes(key) ? current : [...current, key]) : current.filter((item) => item !== key)));
    };

    const save = async () => {
        if (!selectedRole || !editable || !dirty || saving) return;
        setSaving(true);
        try {
            await workspaceApi.updateRole(wsId, selectedRole.key, selectedPermissions);
            message.success(`「${selectedRole.name}」的权限已保存`);
            await load();
        } catch (saveError) {
            message.error(apiErrorMessage(saveError));
        } finally {
            setSaving(false);
        }
    };

    if (!canRead) return <PermissionNotice />;

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">角色与权限</h1>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                        {workspace?.name} · {roles.length} 个内置角色 · 共 {PERMISSIONS.length} 个权限点
                    </p>
                </div>
                <Tooltip title="刷新">
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading} />
                </Tooltip>
            </div>

            {error ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FCEDED] bg-[#FCEDED] px-3 py-2 text-xs text-[#B91C1C] dark:border-[#3A1F1F] dark:bg-[#2A1A1A] dark:text-[#F87171]">
                    <span className="flex-1">{error}</span>
                    <button type="button" className="underline" onClick={() => void load()}>
                        重试
                    </button>
                </div>
            ) : null}

            {loading && !roles.length ? (
                <div className="grid place-items-center py-20">
                    <Spin />
                </div>
            ) : (
                <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-start">
                    <div className="flex flex-col gap-1.5 xl:w-[196px] xl:shrink-0">
                        {roles.map((role) => {
                            const active = role.key === selectedKey;
                            return (
                                <button
                                    key={role.key}
                                    type="button"
                                    onClick={() => setSelectedKey(role.key)}
                                    className={
                                        active
                                            ? "rounded-lg border border-[#E7E5DF] bg-[#E7E5DF] px-3 py-2 text-left dark:border-[#3A3631] dark:bg-[#292524]"
                                            : "rounded-lg border border-transparent px-3 py-2 text-left transition hover:bg-[#F3F1EC] dark:hover:bg-[#1C1917]"
                                    }
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-semibold text-[#1C1917] dark:text-[#F5F5F4]">{role.name}</span>
                                        <span className="ml-auto rounded-full border border-[#D6D1C7] px-1.5 text-[10px] font-normal text-[#78716C] dark:border-[#3A3631] dark:text-[#A8A29E]">{role.memberCount} 人</span>
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-[#A8A29E]">{role.key === "owner" ? "内置 · 不可编辑" : role.key === "admin" ? "内置 · 固定权限" : "内置角色"}</div>
                                </button>
                            );
                        })}
                        <p className="mt-1 px-1 text-[11px] leading-5 text-[#A8A29E]">所有者与管理员权限固定；编辑者、查看者、访客可按需调整。</p>
                    </div>

                    <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <div className="flex flex-wrap items-center gap-2 border-b border-[#E7E5DF] px-3.5 py-3 dark:border-[#2A2724]">
                            <span className="text-[13px] font-semibold text-[#1C1917] dark:text-[#F5F5F4]">{selectedRole?.name || "选择角色"}</span>
                            {selectedRole ? (
                                <span className="rounded-full border border-[#E7E5DF] px-2 py-0.5 text-[10px] text-[#78716C] dark:border-[#3A3631] dark:text-[#A8A29E]">{selectedRole.memberCount} 名成员</span>
                            ) : null}
                            <span className="min-w-2 flex-1" />
                            {editable ? (
                                <>
                                    <span className={dirty ? "text-[11px] text-[#B45309] dark:text-[#FBBF24]" : "text-[11px] text-[#A8A29E]"}>{dirty ? `已改动 ${changedCount} 项，未保存` : "未改动"}</span>
                                    <Button size="small" type="primary" disabled={!dirty} loading={saving} style={{ background: "#C2410C", borderColor: "#C2410C", color: "#FFFFFF" }} onClick={() => void save()}>
                                        保存
                                    </Button>
                                </>
                            ) : (
                                <span className="text-[11px] text-[#A8A29E]">
                                    {!selectedRole
                                        ? ""
                                        : !canManage
                                          ? "只读：你没有 role.manage 权限"
                                          : selectedRole.key === "owner"
                                            ? "所有者拥有全部权限，不可编辑"
                                            : "管理员权限由系统固定，不可编辑"}
                                </span>
                            )}
                        </div>

                        {selectedRole ? (
                            <div className="space-y-5 px-3.5 py-3.5">
                                {GROUPED_PERMISSIONS.map(({ group, items }) => (
                                    <section key={group}>
                                        <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-[#A8A29E]">{group}</div>
                                        <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                                            {items.map((permission) => {
                                                const checked = selectedPermissions.includes(permission.key);
                                                const selfMissing = !can(permission.key);
                                                const disabled = !editable || selfMissing;
                                                const checkbox = <Checkbox checked={checked} disabled={disabled} onChange={(event) => togglePermission(permission.key, event.target.checked)} />;
                                                return (
                                                    <label
                                                        key={permission.key}
                                                        className={
                                                            disabled
                                                                ? "flex cursor-not-allowed items-start gap-2 rounded-md px-2 py-1.5 opacity-70"
                                                                : "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#FAF9F7] dark:hover:bg-[#1C1917]"
                                                        }
                                                    >
                                                        {selfMissing && editable ? (
                                                            <Tooltip title="不能授予自己没有的权限">
                                                                <span className="inline-flex cursor-not-allowed">{checkbox}</span>
                                                            </Tooltip>
                                                        ) : (
                                                            checkbox
                                                        )}
                                                        <span className="min-w-0">
                                                            <span className="block text-[11.5px] text-[#1C1917] dark:text-[#F5F5F4]">{permission.label}</span>
                                                            <span className="block truncate font-mono text-[10px] text-[#A8A29E]">{permission.key}</span>
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </section>
                                ))}
                            </div>
                        ) : (
                            <div className="px-3.5 py-12 text-center text-xs text-[#A8A29E]">选择左侧角色查看权限点</div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 border-t border-[#E7E5DF] px-3.5 py-2 text-[11px] text-[#78716C] dark:border-[#2A2724] dark:text-[#A8A29E]">
                            <span>勾选表示允许，未勾选表示不允许</span>
                            <span className="min-w-2 flex-1" />
                            {editable && blockedCount ? <span className="text-[#B45309] dark:text-[#FBBF24]">有 {blockedCount} 个权限点你自身没有，已置灰不可授予</span> : null}
                        </div>
                    </div>

                    <div className="w-full shrink-0 overflow-hidden rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19] xl:w-[186px]">
                        <div className="border-b border-[#E7E5DF] px-3.5 py-2.5 text-[13px] font-semibold dark:border-[#2A2724]">角色预览</div>
                        <div className="space-y-1.5 px-3.5 py-3 text-[11px]">
                            <div className="text-[10px] text-[#A8A29E]">该角色能看到什么</div>
                            {previewRows.map((row) => (
                                <div key={row.label} className="flex items-center justify-between gap-2">
                                    <span className="text-[#57534E] dark:text-[#A8A29E]">{row.label}</span>
                                    <span className={row.className}>{row.text}</span>
                                </div>
                            ))}
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[#57534E] dark:text-[#A8A29E]">本地空间</span>
                                <span className="text-[#78716C] dark:text-[#A8A29E]">可访问</span>
                            </div>
                            <div className="my-2 h-px bg-[#E7E5DF] dark:bg-[#2A2724]" />
                            <div className="text-[10px] text-[#A8A29E]">画布内的能力</div>
                            <p className="leading-5 text-[#57534E] dark:text-[#A8A29E]">{canvasHint}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
