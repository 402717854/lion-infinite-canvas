import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { App, Button, Empty, Select, Spin } from "antd";
import { Download, History, ShieldAlert } from "lucide-react";
import { saveAs } from "file-saver";

import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { formatDateTime } from "@/lib/time";
import { apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import type { AuditRecord } from "@/types/team";

const ACTION_LABELS: Record<string, string> = {
    "auth.login": "登录成功 / 失败",
    "auth.register": "注册账号",
    "auth.email.verify": "验证邮箱",
    "auth.email.resend": "重发验证邮件",
    "auth.password.forgot": "申请找回密码",
    "auth.password.reset": "重置密码",
    "invitation.create": "邀请成员",
    "invitation.revoke": "撤销邀请",
    "invitation.accept": "接受邀请",
    "member.update": "修改成员角色",
    "member.remove": "移除成员",
    "role.update": "更新角色权限",
    "project.create": "创建项目",
    "project.save": "保存项目",
    "project.delete": "删除项目",
    "project.share": "创建分享",
    "project.unshare": "撤销分享",
    "workspace.create": "创建空间",
    "workspace.rename": "更新空间",
    "workspace.delete": "解散空间",
    "workspace.transfer": "转让所有者",
    "workspace.import": "迁移导入",
    "asset.create": "创建素材",
    "asset.update": "更新素材",
    "asset.delete": "删除素材",
    "file.upload": "上传文件",
};

const ACTION_OPTIONS = [
    { value: "all", label: "全部动作" },
    ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
];

function actionLabel(action: string) {
    return ACTION_LABELS[action] || action || "未知动作";
}

function resultLabel(result: string) {
    if (result === "success") return "成功";
    if (result === "failure" || result === "denied") return "拒绝";
    return result || "未知";
}

function resultClass(result: string) {
    if (result === "success") return "inline-flex rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[10px] text-[#15803D] dark:bg-[#14291B] dark:text-[#4ADE80]";
    if (result === "failure" || result === "denied") return "inline-flex rounded-full bg-[#FCEDED] px-2 py-0.5 text-[10px] text-[#B91C1C] dark:bg-[#2A1A1A] dark:text-[#F87171]";
    return "inline-flex rounded-full bg-[#F3F1EC] px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]";
}

function targetText(item: AuditRecord) {
    if (!item.targetType && !item.targetId) return "—";
    if (!item.targetId) return item.targetType;
    return `${item.targetType || "object"} / ${item.targetId}`;
}

function PermissionNotice() {
    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="rounded-xl border border-[#E7E5DF] bg-white p-10 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                <div className="mt-3 text-sm font-semibold">没有查看审计日志的权限</div>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    需要空间权限 <code className="font-mono text-[11px]">audit.read</code>，请联系空间所有者或管理员。
                </p>
            </div>
        </div>
    );
}

export default function WorkspaceAuditPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const { message } = App.useApp();
    const { workspace, can } = useWorkspaceAccess(wsId);
    const canRead = can("audit.read");

    const [items, setItems] = useState<AuditRecord[]>([]);
    const [action, setAction] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        setError(null);
        try {
            const result = await workspaceApi.audit(wsId, { action: action || undefined, limit: 100 });
            setItems(result.items);
        } catch (loadError) {
            setError(apiErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [action, canRead, wsId]);

    useEffect(() => {
        void load();
    }, [load]);

    const exportCsv = () => {
        if (!items.length) {
            message.warning("当前没有可导出的日志");
            return;
        }
        const header = ["时间", "操作者", "动作", "对象", "结果", "IP"];
        const lines = items.map((item) => [formatDateTime(item.createdAt), item.actorName || "—", actionLabel(item.action), targetText(item), resultLabel(item.result), item.ip || "—"]);
        const csv = [header, ...lines].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
        saveAs(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), `audit-${wsId}-${new Date().toISOString().slice(0, 10)}.csv`);
        message.success("已导出当前列表");
    };

    if (!canRead) return <PermissionNotice />;

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">审计日志</h1>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                        {workspace?.name} · 最近 100 条 · 只追加不可修改
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={action || "all"} options={ACTION_OPTIONS} onChange={(value: string) => setAction(value === "all" ? "" : value)} style={{ width: 148 }} />
                    <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!items.length}>
                        导出 CSV
                    </Button>
                </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#E7E5DF] bg-white px-3 py-2 text-[11px] text-[#78716C] dark:border-[#2A2724] dark:bg-[#1F1C19] dark:text-[#A8A29E]">
                <History className="size-3.5 shrink-0 text-[#A8A29E]" />
                日志只追加，任何角色都不可编辑或删除；导出的 CSV 对应当前列表。
            </div>

            {error ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#FCEDED] bg-[#FCEDED] px-3 py-2 text-xs text-[#B91C1C] dark:border-[#3A1F1F] dark:bg-[#2A1A1A] dark:text-[#F87171]">
                    <span className="flex-1">{error}</span>
                    <button type="button" className="underline" onClick={() => void load()}>
                        重试
                    </button>
                </div>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]">
                {loading ? (
                    <div className="grid place-items-center py-20">
                        <Spin />
                    </div>
                ) : items.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] border-collapse text-xs">
                            <thead>
                                <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                    <th className="w-36 px-3 py-2.5 font-medium">时间</th>
                                    <th className="w-32 px-3 py-2.5 font-medium">操作者</th>
                                    <th className="w-44 px-3 py-2.5 font-medium">动作</th>
                                    <th className="px-3 py-2.5 font-medium">对象</th>
                                    <th className="w-20 px-3 py-2.5 font-medium">结果</th>
                                    <th className="w-32 px-3 py-2.5 font-medium">IP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr key={item.id} className="border-t border-[#E7E5DF] transition hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                                        <td className="px-3 py-2.5 font-mono text-[11px] text-[#78716C] dark:text-[#A8A29E]">{formatDateTime(item.createdAt)}</td>
                                        <td className="px-3 py-2.5">
                                            {item.actorName ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#E7E5DF] text-[9px] font-semibold text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
                                                        {item.actorName.slice(0, 1)}
                                                    </span>
                                                    <span className="truncate text-[11.5px] text-[#1C1917] dark:text-[#F5F5F4]">{item.actorName}</span>
                                                </div>
                                            ) : (
                                                <span className="text-[11px] text-[#A8A29E]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="text-[11.5px] text-[#1C1917] dark:text-[#F5F5F4]">{actionLabel(item.action)}</div>
                                            <div className="truncate font-mono text-[10px] text-[#A8A29E]">{item.action}</div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {item.targetType || item.targetId ? (
                                                <div className="min-w-0">
                                                    <div className="text-[11.5px] text-[#57534E] dark:text-[#A8A29E]">{item.targetType || "object"}</div>
                                                    <div className="truncate font-mono text-[10px] text-[#A8A29E]">{item.targetId || "—"}</div>
                                                </div>
                                            ) : (
                                                <span className="text-[11px] text-[#A8A29E]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <span className={resultClass(item.result)}>{resultLabel(item.result)}</span>
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-[11px] text-[#78716C] dark:text-[#A8A29E]">{item.ip || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="py-16">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={action ? "该动作暂无日志" : "还没有审计日志"} />
                    </div>
                )}
            </div>
        </div>
    );
}
