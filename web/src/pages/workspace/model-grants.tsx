import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { App, Button, Checkbox, Empty, InputNumber, Select, Spin } from "antd";
import { ArrowLeft, Save, ShieldAlert, TriangleAlert } from "lucide-react";

import { CAPABILITY_OPTIONS, CAPABILITY_LABELS, ENTRY_OPTIONS, MODEL_CAPABILITIES } from "@/constant/model";
import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { apiErrorMessage } from "@/services/api/client";
import { modelApi } from "@/services/api/team";
import { useModelStore } from "@/stores/use-model-store";
import type { ModelBindingsPayload, ModelCapabilityValue, ModelEntryValue, ModelGrantsPayload, ModelRecord } from "@/types/team";

const CARD = "rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]";
const MUTED = "text-[#78716C] dark:text-[#A8A29E]";
const LOCKED_ROLES = new Set(["owner", "admin"]);
const ALL_ENTRIES = ENTRY_OPTIONS.map((option) => option.value);

type GrantRow = {
    subjectType: "workspace" | "role" | "member";
    subjectId: string;
    name: string;
    hint: string;
    locked: boolean;
    visible: boolean;
    entries: ModelEntryValue[];
    dailyLimit: number | null;
    monthlyLimit: number | null;
    usedToday: number;
};

function buildRows(payload: ModelGrantsPayload): GrantRow[] {
    const find = (subjectType: GrantRow["subjectType"], subjectId: string) => payload.items.find((item) => item.subjectType === subjectType && item.subjectId === subjectId);
    const workspaceGrant = find("workspace", "");
    const rows: GrantRow[] = [
        {
            subjectType: "workspace",
            subjectId: "",
            name: "空间全员",
            hint: "所有成员",
            locked: false,
            visible: workspaceGrant?.visible ?? false,
            entries: workspaceGrant?.entries ?? ALL_ENTRIES,
            dailyLimit: workspaceGrant?.dailyLimit ?? null,
            monthlyLimit: workspaceGrant?.monthlyLimit ?? null,
            usedToday: workspaceGrant?.todayUsed ?? 0,
        },
    ];
    payload.roles.forEach((role) => {
        const grant = find("role", role.key);
        const locked = LOCKED_ROLES.has(role.key);
        rows.push({
            subjectType: "role",
            subjectId: role.key,
            name: roleLabel(role.key) || role.name,
            hint: "角色",
            locked,
            visible: locked || (grant?.visible ?? false),
            entries: grant?.entries ?? ALL_ENTRIES,
            dailyLimit: grant?.dailyLimit ?? null,
            monthlyLimit: grant?.monthlyLimit ?? null,
            usedToday: grant?.todayUsed ?? 0,
        });
    });
    payload.members.forEach((member) => {
        const grant = find("member", member.id);
        rows.push({
            subjectType: "member",
            subjectId: member.id,
            name: member.displayName,
            hint: roleLabel(member.roleKey) || member.roleName,
            locked: false,
            visible: grant?.visible ?? false,
            entries: grant?.entries ?? ALL_ENTRIES,
            dailyLimit: grant?.dailyLimit ?? null,
            monthlyLimit: grant?.monthlyLimit ?? null,
            usedToday: grant?.todayUsed ?? 0,
        });
    });
    return rows;
}

function usagePercent(used: number, limit: number | null) {
    if (!limit) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
}

export default function WorkspaceModelGrantsPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const { message } = App.useApp();
    const { can } = useWorkspaceAccess(wsId);
    const reloadModels = useModelStore((state) => state.reload);
    const canRead = can("model.read");
    const canManage = can("model.grant.manage");

    const [models, setModels] = useState<ModelRecord[]>([]);
    const [modelId, setModelId] = useState(searchParams.get("model") ?? "");
    const [payload, setPayload] = useState<ModelGrantsPayload | null>(null);
    const [rows, setRows] = useState<GrantRow[]>([]);
    const [bindings, setBindings] = useState<ModelBindingsPayload | null>(null);
    const [bindingDraft, setBindingDraft] = useState<Partial<Record<ModelCapabilityValue, string | null>>>({});
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!canRead) return;
        void (async () => {
            try {
                const [nextModels, nextBindings] = await Promise.all([modelApi.models(wsId), modelApi.bindings(wsId)]);
                setModels(nextModels);
                setBindings(nextBindings);
                setBindingDraft(Object.fromEntries(MODEL_CAPABILITIES.map((capability) => [capability, nextBindings[capability]?.value ?? null])) as Partial<Record<ModelCapabilityValue, string | null>>);
                setModelId((current) => (nextModels.some((item) => item.id === current) ? current : (nextModels[0]?.id ?? "")));
            } catch (error) {
                message.error(apiErrorMessage(error));
            }
        })();
    }, [canRead, message, wsId]);

    const loadGrants = useCallback(
        async (targetId: string) => {
            if (!targetId) {
                setPayload(null);
                setRows([]);
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const next = await modelApi.grants(wsId, targetId);
                setPayload(next);
                setRows(buildRows(next));
                setDirty(false);
            } catch (error) {
                message.error(apiErrorMessage(error));
            } finally {
                setLoading(false);
            }
        },
        [message, wsId],
    );

    useEffect(() => {
        if (modelId) void loadGrants(modelId);
    }, [loadGrants, modelId]);

    const updateRow = (index: number, patch: Partial<GrantRow>) => {
        setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
        setDirty(true);
    };

    const save = async () => {
        if (!modelId) return;
        setSaving(true);
        try {
            await modelApi.saveGrants(
                wsId,
                modelId,
                rows
                    .filter((row) => !row.locked && row.visible)
                    .map((row) => ({
                        subjectType: row.subjectType,
                        subjectId: row.subjectId,
                        visible: row.visible,
                        entries: row.entries.length ? row.entries : ["canvas"],
                        dailyLimit: row.dailyLimit,
                        monthlyLimit: row.monthlyLimit,
                    })),
            );
            message.success("授权与配额已保存");
            await loadGrants(modelId);
            void reloadModels();
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const saveBindings = async () => {
        setSaving(true);
        try {
            await modelApi.saveBindings(wsId, bindingDraft);
            message.success("默认模型已保存");
            const next = await modelApi.bindings(wsId);
            setBindings(next);
            void reloadModels();
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const bindingDirty = useMemo(() => {
        if (!bindings) return false;
        return MODEL_CAPABILITIES.some((capability) => (bindings[capability]?.value ?? null) !== (bindingDraft[capability] ?? null));
    }, [bindings, bindingDraft]);

    const totals = useMemo(() => {
        const todayUsed = rows.reduce((total, row) => total + row.usedToday, 0);
        const dailyLimit = rows.reduce((total, row) => total + (row.dailyLimit ?? 0), 0);
        const alerts = rows.filter((row) => row.dailyLimit && row.usedToday / row.dailyLimit >= 0.75);
        return { todayUsed, dailyLimit, alerts };
    }, [rows]);

    if (!canRead) {
        return (
            <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
                <div className={`${CARD} p-10 text-center`}>
                    <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                    <div className="mt-3 text-sm font-semibold">没有查看授权的权限</div>
                    <p className={`mt-1 text-xs ${MUTED}`}>
                        需要空间权限 <code className="font-mono text-[11px]">model.read</code>。
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1400px] px-6 pb-24 pt-2">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Link to={`/w/${wsId}/models`} className="flex items-center gap-1 text-xs text-[#57534E] hover:underline dark:text-[#A8A29E]">
                    <ArrowLeft className="size-3.5" />
                    渠道与模型
                </Link>
                <div className="flex-1" />
                <Select
                    size="small"
                    style={{ minWidth: 240 }}
                    value={modelId || undefined}
                    placeholder="选择模型"
                    options={models.map((item) => ({ value: item.id, label: `${item.displayName || item.modelId}（${item.channelName}）` }))}
                    onChange={(value: string) => {
                        setModelId(value);
                        setSearchParams({ model: value }, { replace: true });
                    }}
                />
            </div>

            {!models.length ? (
                <div className={`${CARD} grid h-56 place-items-center`}>
                    <Empty description="还没有模型，先到渠道与模型页添加" />
                </div>
            ) : loading && !payload ? (
                <div className={`${CARD} grid h-56 place-items-center`}>
                    <Spin />
                </div>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <section className={`${CARD} min-w-0 overflow-hidden`}>
                        <div className="flex items-center gap-2 border-b border-[#E7E5DF] px-4 py-2.5 dark:border-[#2A2724]">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">授权与配额</div>
                                <div className={`mt-0.5 truncate text-[11px] ${MUTED}`}>{payload ? `${payload.model.displayName || payload.model.modelId} · ${payload.model.value}` : ""}</div>
                            </div>
                            <div className="flex-1" />
                            <span className={`text-[11px] ${MUTED}`}>今日已用 {totals.todayUsed}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[880px] border-collapse text-xs">
                                <thead>
                                    <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        <th className="px-4 py-2.5 font-medium whitespace-nowrap">角色 / 成员</th>
                                        <th className="w-16 px-3 py-2.5 font-medium whitespace-nowrap">可见</th>
                                        <th className="w-60 px-3 py-2.5 font-medium whitespace-nowrap">可用入口</th>
                                        <th className="w-24 px-3 py-2.5 font-medium whitespace-nowrap">日上限</th>
                                        <th className="w-24 px-3 py-2.5 font-medium whitespace-nowrap">月上限</th>
                                        <th className="w-28 px-3 py-2.5 font-medium whitespace-nowrap">今日</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, index) => (
                                        <tr key={`${row.subjectType}:${row.subjectId}`} className="border-t border-[#E7E5DF] dark:border-[#2A2724]">
                                            <td className="px-4 py-2.5">
                                                <div className="text-[13px] font-medium">{row.name}</div>
                                                <div className={`text-[11px] ${MUTED}`}>{row.hint}</div>
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <Checkbox
                                                    checked={row.visible}
                                                    disabled={!canManage || row.locked}
                                                    onChange={(event) =>
                                                        updateRow(index, event.target.checked ? { visible: true, entries: row.entries.length ? row.entries : ALL_ENTRIES } : { visible: false, dailyLimit: null, monthlyLimit: null })
                                                    }
                                                />
                                            </td>
                                            <td className="px-3 py-2.5">
                                                {row.locked ? (
                                                    <span className={MUTED}>全部入口 · 不限</span>
                                                ) : row.visible ? (
                                                    <Checkbox.Group
                                                        className="flex flex-wrap gap-x-3 gap-y-1 [&_.ant-checkbox-wrapper]:mr-0"
                                                        value={row.entries}
                                                        disabled={!canManage}
                                                        onChange={(values) => updateRow(index, { entries: values as ModelEntryValue[] })}
                                                        options={ENTRY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                                                    />
                                                ) : (
                                                    <span className={MUTED}>不可见</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                {row.locked ? (
                                                    <span className={MUTED}>不限</span>
                                                ) : (
                                                    <InputNumber
                                                        size="small"
                                                        className="w-20"
                                                        min={1}
                                                        max={100000}
                                                        placeholder="不限"
                                                        value={row.dailyLimit ?? undefined}
                                                        disabled={!canManage || !row.visible}
                                                        onChange={(value) => updateRow(index, { dailyLimit: value ? Number(value) : null })}
                                                    />
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                {row.locked ? (
                                                    <span className={MUTED}>不限</span>
                                                ) : (
                                                    <InputNumber
                                                        size="small"
                                                        className="w-20"
                                                        min={1}
                                                        max={1000000}
                                                        placeholder="不限"
                                                        value={row.monthlyLimit ?? undefined}
                                                        disabled={!canManage || !row.visible}
                                                        onChange={(value) => updateRow(index, { monthlyLimit: value ? Number(value) : null })}
                                                    />
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={MUTED}>{row.usedToday}</span>
                                                    {row.dailyLimit ? (
                                                        <div className="h-1 w-14 overflow-hidden rounded-full bg-[#E7E5DF] dark:bg-[#292524]">
                                                            <div className="h-full rounded-full bg-[#C2410C]" style={{ width: `${usagePercent(row.usedToday, row.dailyLimit)}%` }} />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className={`border-t border-[#E7E5DF] px-4 py-2 text-[11px] dark:border-[#2A2724] ${MUTED}`}>
                            成员级设置会覆盖角色级；「可见但不可用」用于展示模型存在但不能调用。所有者与管理员不受配额限制，用量照常记录。
                        </div>
                    </section>

                    <aside className="flex flex-col gap-3">
                        <div className={`${CARD} p-4`}>
                            <div className="text-sm font-semibold">配额总览</div>
                            <div className={`mt-2 text-[11px] ${MUTED}`}>今日已用</div>
                            <div className="text-xl font-semibold">
                                {totals.todayUsed}
                                <span className={`ml-1 text-xs font-normal ${MUTED}`}>/ {totals.dailyLimit || "不限"}</span>
                            </div>
                            <p className={`mt-1 text-[11px] ${MUTED}`}>额度按空间时区每日 00:00 重置。</p>
                            {totals.alerts.length ? (
                                <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-[#FDF3E3] px-2.5 py-2 text-[11px] text-[#B45309]">
                                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                                    <span>{totals.alerts.map((row) => row.name).join("、")} 今日额度已用超过 75%。</span>
                                </div>
                            ) : null}
                        </div>

                        <div className={`${CARD} p-4`}>
                            <div className="text-sm font-semibold">空间默认模型</div>
                            <p className={`mt-1 text-[11px] ${MUTED}`}>未单独指定模型时的默认选择。</p>
                            <div className="mt-2 flex flex-col gap-2">
                                {CAPABILITY_OPTIONS.map((option) => (
                                    <label key={option.value} className="flex items-center gap-2 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        <span className="w-10 shrink-0">{CAPABILITY_LABELS[option.value]}</span>
                                        <Select
                                            size="small"
                                            className="min-w-0 flex-1"
                                            allowClear
                                            disabled={!canManage}
                                            placeholder="未设置"
                                            value={bindingDraft[option.value] ?? undefined}
                                            onChange={(value?: string) => setBindingDraft((current) => ({ ...current, [option.value]: value ?? null }))}
                                            options={models
                                                .filter((item) => item.enabled && item.capabilities.includes(option.value))
                                                .map((item) => ({ value: item.value, label: item.displayName || item.modelId }))}
                                        />
                                    </label>
                                ))}
                            </div>
                            {canManage ? (
                                <Button size="small" className="mt-3" loading={saving} disabled={!bindingDirty} onClick={() => void saveBindings()}>
                                    保存默认模型
                                </Button>
                            ) : null}
                        </div>
                    </aside>
                </div>
            )}

            {dirty && canManage ? (
                <div className="sticky bottom-3 mt-3 flex items-center gap-3 rounded-xl border border-[#E7E5DF] bg-white px-4 py-2.5 shadow-sm dark:border-[#3A3631] dark:bg-[#1F1C19]">
                    <span className="text-xs text-[#B45309]">有未保存的授权改动</span>
                    <div className="flex-1" />
                    <Button size="small" onClick={() => modelId && void loadGrants(modelId)}>
                        放弃
                    </Button>
                    <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void save()}>
                        保存并生效
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
