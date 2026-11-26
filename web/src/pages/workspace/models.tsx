import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { App, Button, Checkbox, Empty, Input, InputNumber, Modal, Spin, Switch, Tooltip } from "antd";
import { ArrowDownToLine, FlaskConical, KeyRound, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

import { CAPABILITY_OPTIONS, capabilityText } from "@/constant/model";
import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { relativeTime } from "@/lib/time";
import { apiErrorMessage } from "@/services/api/client";
import { modelApi } from "@/services/api/team";
import { useModelStore } from "@/stores/use-model-store";
import type { ChannelRecord, ModelCapabilityValue, ModelGrantItem, ModelParamDefinition, ModelRecord } from "@/types/team";

const CARD = "rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]";
const MUTED = "text-[#78716C] dark:text-[#A8A29E]";

type ParamRow = { capability: ModelCapabilityValue; key: string; options: string; value: string };

function paramsToRows(params: Record<string, Record<string, ModelParamDefinition>> | undefined): ParamRow[] {
    return Object.entries(params ?? {}).flatMap(([capability, definitions]) =>
        Object.entries(definitions ?? {}).map(([key, definition]) => ({
            capability: capability as ModelCapabilityValue,
            key,
            options: (definition.options ?? []).join("，"),
            value: definition.default ?? "",
        })),
    );
}

function rowsToParams(rows: ParamRow[], capabilities: ModelCapabilityValue[]) {
    const params: Record<string, Record<string, ModelParamDefinition>> = {};
    rows.forEach((row) => {
        const key = row.key.trim();
        if (!key || !capabilities.includes(row.capability)) return;
        const options = row.options.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
        const target = (params[row.capability] ??= {});
        target[key] = { options, default: row.value.trim() };
    });
    return params;
}

function grantSummary(grants: ModelGrantItem[]) {
    const visible = grants.filter((grant) => grant.visible);
    if (!visible.length) return "未授权";
    if (visible.some((grant) => grant.subjectType === "workspace")) return "全员";
    const roles = visible.filter((grant) => grant.subjectType === "role").map((grant) => roleLabel(grant.subjectId));
    const members = visible.filter((grant) => grant.subjectType === "member").length;
    return [...roles, ...(members ? [`${members} 位成员`] : [])].join("、") || "未授权";
}

export default function WorkspaceModelsPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const { message, modal } = App.useApp();
    const { can } = useWorkspaceAccess(wsId);
    const reloadModels = useModelStore((state) => state.reload);
    const canRead = can("model.read");
    const canManageChannel = can("model.channel.manage");
    const canManageEntry = can("model.entry.manage");

    const [channels, setChannels] = useState<ChannelRecord[]>([]);
    const [models, setModels] = useState<ModelRecord[]>([]);
    const [activeId, setActiveId] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
    const [draft, setDraft] = useState({ name: "", baseUrl: "", apiKey: "", timeoutSeconds: 60, retry: 1, enabled: true });

    const [createOpen, setCreateOpen] = useState(false);
    const [createDraft, setCreateDraft] = useState({ name: "", baseUrl: "", apiKey: "" });
    const [importOpen, setImportOpen] = useState(false);
    const [importItems, setImportItems] = useState<Array<{ id: string; imported: boolean }>>([]);
    const [importChecked, setImportChecked] = useState<string[]>([]);
    const [modelOpen, setModelOpen] = useState(false);
    const [editingModel, setEditingModel] = useState<ModelRecord | null>(null);
    const [modelDraft, setModelDraft] = useState({ modelId: "", displayName: "", capabilities: ["image"] as ModelCapabilityValue[], enabled: true, note: "" });
    const [paramRows, setParamRows] = useState<ParamRow[]>([]);

    const load = useCallback(
        async (preferred?: string) => {
            setLoading(true);
            try {
                const [nextChannels, nextModels] = await Promise.all([modelApi.channels(wsId), modelApi.models(wsId)]);
                setChannels(nextChannels);
                setModels(nextModels);
                setActiveId((current) => preferred || (nextChannels.some((item) => item.id === current) ? current : (nextChannels[0]?.id ?? "")));
            } catch (error) {
                message.error(apiErrorMessage(error));
            } finally {
                setLoading(false);
            }
        },
        [message, wsId],
    );

    useEffect(() => {
        if (canRead) void load();
    }, [canRead, load]);

    const active = useMemo(() => channels.find((item) => item.id === activeId) ?? null, [channels, activeId]);
    const channelModels = useMemo(() => models.filter((item) => item.channelId === activeId), [models, activeId]);

    useEffect(() => {
        if (!active) return;
        setDraft({ name: active.name, baseUrl: active.baseUrl, apiKey: "", timeoutSeconds: Math.round(active.timeoutMs / 1000), retry: active.retry, enabled: active.enabled });
        setTestResult(null);
    }, [active]);

    const saveChannel = async () => {
        if (!active) return;
        setSaving(true);
        try {
            await modelApi.updateChannel(wsId, active.id, {
                name: draft.name.trim(),
                baseUrl: draft.baseUrl.trim(),
                timeoutMs: Math.min(300, Math.max(5, draft.timeoutSeconds)) * 1000,
                retry: draft.retry,
                enabled: draft.enabled,
                ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
            });
            message.success("渠道已保存");
            await load(active.id);
            void reloadModels();
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const createChannel = async () => {
        if (!createDraft.name.trim() || !createDraft.baseUrl.trim() || createDraft.apiKey.trim().length < 8) {
            message.warning("请填写渠道名称、Base URL 和至少 8 位的 API Key");
            return;
        }
        setSaving(true);
        try {
            const created = await modelApi.createChannel(wsId, { name: createDraft.name.trim(), baseUrl: createDraft.baseUrl.trim(), apiKey: createDraft.apiKey.trim() });
            setCreateOpen(false);
            setCreateDraft({ name: "", baseUrl: "", apiKey: "" });
            message.success("渠道已创建");
            await load(created.id);
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const removeChannel = () => {
        if (!active) return;
        modal.confirm({
            title: `删除渠道「${active.name}」`,
            content: "渠道下的模型会先被停用，画布节点保留配置但无法生成。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await modelApi.removeChannel(wsId, active.id);
                    message.success("渠道已删除");
                    await load();
                    void reloadModels();
                } catch (error) {
                    message.error(apiErrorMessage(error));
                }
            },
        });
    };

    const runTest = async () => {
        if (!active) return;
        setTesting(true);
        try {
            const result = await modelApi.testChannel(wsId, active.id, {
                baseUrl: draft.baseUrl.trim(),
                ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
            });
            setTestResult({
                ok: result.ok,
                text: result.ok ? `GET /v1/models → ${result.status} · 返回 ${result.modelCount} 个模型 · ${result.latencyMs}ms` : `连通失败：${result.summary || `状态 ${result.status}`}`,
            });
        } catch (error) {
            setTestResult({ ok: false, text: apiErrorMessage(error) });
        } finally {
            setTesting(false);
        }
    };

    const openImport = async () => {
        if (!active) return;
        try {
            const result = await modelApi.upstreamModels(wsId, active.id);
            setImportItems(result.items);
            setImportChecked(result.items.filter((item) => !item.imported).map((item) => item.id));
            setImportOpen(true);
        } catch (error) {
            message.error(apiErrorMessage(error));
        }
    };

    const submitImport = async () => {
        if (!active || !importChecked.length) return;
        setSaving(true);
        try {
            const result = await modelApi.importModels(wsId, active.id, importChecked.map((modelId) => ({ modelId })));
            setImportOpen(false);
            message.success(`已导入 ${result.created} 个模型`);
            await load(active.id);
            void reloadModels();
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const openCreateModel = () => {
        setEditingModel(null);
        setModelDraft({ modelId: "", displayName: "", capabilities: ["image"], enabled: true, note: "" });
        setParamRows([]);
        setModelOpen(true);
    };

    const openEditModel = (record: ModelRecord) => {
        setEditingModel(record);
        setModelDraft({ modelId: record.modelId, displayName: record.displayName, capabilities: record.capabilities, enabled: record.enabled, note: record.note ?? "" });
        setParamRows(paramsToRows(record.params));
        setModelOpen(true);
    };

    const submitModel = async () => {
        if (!modelDraft.modelId.trim() || !modelDraft.capabilities.length) {
            message.warning("请填写模型 ID 并至少选择一个能力");
            return;
        }
        setSaving(true);
        try {
            const payload = {
                displayName: modelDraft.displayName.trim(),
                capabilities: modelDraft.capabilities,
                params: rowsToParams(paramRows, modelDraft.capabilities),
                enabled: modelDraft.enabled,
                note: modelDraft.note.trim() || null,
            };
            if (editingModel) await modelApi.updateModel(wsId, editingModel.id, payload);
            else await modelApi.createModel(wsId, { ...payload, channelId: activeId, modelId: modelDraft.modelId.trim() });
            setModelOpen(false);
            message.success("模型已保存");
            await load(activeId);
            void reloadModels();
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const removeModel = (record: ModelRecord) => {
        modal.confirm({
            title: `删除模型「${record.displayName || record.modelId}」`,
            content: "该模型的授权与默认绑定会一并删除。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await modelApi.removeModel(wsId, record.id);
                    message.success("模型已删除");
                    await load(activeId);
                    void reloadModels();
                } catch (error) {
                    message.error(apiErrorMessage(error));
                }
            },
        });
    };

    if (!canRead) {
        return (
            <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
                <div className={`${CARD} p-10 text-center`}>
                    <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                    <div className="mt-3 text-sm font-semibold">没有查看模型的权限</div>
                    <p className={`mt-1 text-xs ${MUTED}`}>
                        需要空间权限 <code className="font-mono text-[11px]">model.read</code>，请联系空间所有者或管理员。
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1400px] px-6 pb-10 pt-2">
            <div className="mb-3 flex items-center gap-2">
                <div className="text-sm font-semibold">渠道与模型</div>
                <span className={`text-xs ${MUTED}`}>{channels.length} 个渠道 · {models.length} 个模型</span>
                <div className="flex-1" />
                <Link to={`/w/${wsId}/models/grants`} className="text-xs text-[#C2410C] hover:underline">
                    授权与配额
                </Link>
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void load(activeId)} loading={loading}>
                    刷新
                </Button>
                {canManageChannel ? (
                    <Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                        新建渠道
                    </Button>
                ) : null}
            </div>

            {loading && !channels.length ? (
                <div className={`${CARD} grid h-64 place-items-center`}>
                    <Spin />
                </div>
            ) : channels.length === 0 ? (
                <div className={`${CARD} grid h-64 place-items-center`}>
                    <Empty description="还没有渠道，先添加一个 OpenAI 兼容渠道">
                        {canManageChannel ? (
                            <Button type="primary" size="small" onClick={() => setCreateOpen(true)}>
                                新建渠道
                            </Button>
                        ) : null}
                    </Empty>
                </div>
            ) : (
                <div className="grid gap-4 xl:grid-cols-[212px_minmax(0,1fr)_300px]">
                    <aside className="flex flex-col gap-2">
                        {channels.map((channel) => (
                            <button
                                key={channel.id}
                                type="button"
                                onClick={() => setActiveId(channel.id)}
                                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                                    channel.id === activeId
                                        ? "border-[#1C1917] bg-[#F3F1EC] dark:border-[#FAF9F7] dark:bg-[#292524]"
                                        : "border-[#E7E5DF] bg-white hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:bg-[#1F1C19] dark:hover:bg-[#1C1917]"
                                }`}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{channel.name}</span>
                                    <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${channel.enabled ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#E7E5DF] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"}`}>
                                        {channel.enabled ? "启用" : "停用"}
                                    </span>
                                </div>
                                <div className={`mt-1 text-[11px] ${MUTED}`}>
                                    {channel.apiFormat} · {channel.modelCount} 个模型
                                </div>
                                <div className={`mt-1 flex items-center justify-between text-[11px] ${MUTED}`}>
                                    <span>今日 {channel.todayCalls}</span>
                                    <span>{channel.lastOkAt ? relativeTime(channel.lastOkAt) : "尚未调用"}</span>
                                </div>
                            </button>
                        ))}
                        <div className={`rounded-xl border border-dashed border-[#E7E5DF] px-3 py-2 text-[11px] leading-relaxed ${MUTED} dark:border-[#3A3631]`}>
                            删除渠道前，引用它的模型会先被停用，画布节点保留配置但无法生成。
                        </div>
                    </aside>

                    <section className={`${CARD} min-w-0 overflow-hidden`}>
                        <div className="flex items-center gap-2 border-b border-[#E7E5DF] px-4 py-2.5 dark:border-[#2A2724]">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{active ? `${active.name} · ${channelModels.length} 个模型` : "未选择渠道"}</div>
                                {active ? <div className={`mt-0.5 flex items-center gap-1 font-mono text-[11px] ${MUTED}`}><KeyRound className="size-3" />{active.apiKeyMask}</div> : null}
                            </div>
                            <div className="flex-1" />
                            {canManageEntry && active ? (
                                <>
                                    <Button size="small" icon={<ArrowDownToLine className="size-3.5" />} onClick={() => void openImport()}>
                                        从上游拉取
                                    </Button>
                                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={openCreateModel}>
                                        模型
                                    </Button>
                                </>
                            ) : null}
                        </div>
                        {channelModels.length ? (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[620px] border-collapse text-xs">
                                    <thead>
                                        <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                            <th className="px-4 py-2.5 font-medium">模型</th>
                                            <th className="w-20 px-3 py-2.5 font-medium whitespace-nowrap">能力</th>
                                            <th className="px-3 py-2.5 font-medium whitespace-nowrap">参数模板</th>
                                            <th className="w-24 px-3 py-2.5 font-medium whitespace-nowrap">授权</th>
                                            <th className="w-14 px-3 py-2.5 font-medium whitespace-nowrap">今日</th>
                                            <th className="w-16 px-3 py-2.5 font-medium whitespace-nowrap">状态</th>
                                            <th className="w-24 px-3 py-2.5" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {channelModels.map((record) => {
                                            const template = paramsToRows(record.params).map((row) => `${row.key}${row.options ? ` ${row.options.split(/[,，\s]+/).filter(Boolean).length}` : ""}`).join(" · ");
                                            return (
                                                <tr key={record.id} className="border-t border-[#E7E5DF] transition hover:bg-[#FAF9F7] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                                                    <td className="px-4 py-2.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[13px] font-medium">{record.displayName || record.modelId}</span>
                                                            {record.displayName && record.displayName !== record.modelId ? <span className={`font-mono text-[11px] ${MUTED}`}>{record.modelId}</span> : null}
                                                        </div>
                                                    </td>
                                                    <td className={`px-3 py-2.5 ${MUTED}`}>{capabilityText(record.capabilities)}</td>
                                                    <td className={`px-3 py-2.5 ${MUTED}`}>
                                                        <div className="max-w-[180px] truncate" title={template}>
                                                            {template || "—"}
                                                        </div>
                                                    </td>
                                                    <td className={`px-3 py-2.5 ${MUTED}`}>
                                                        <Link to={`/w/${wsId}/models/grants?model=${record.id}`} className="hover:underline">
                                                            {grantSummary(record.grants)}
                                                        </Link>
                                                    </td>
                                                    <td className={`px-3 py-2.5 ${MUTED}`}>{record.todayCalls}</td>
                                                    <td className="px-3 py-2.5">
                                                        <span className={`rounded-full px-1.5 text-[10px] ${record.enabled ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#E7E5DF] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"}`}>
                                                            {record.enabled ? "启用" : "停用"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5">
                                                        {canManageEntry ? (
                                                            <div className="flex items-center justify-end gap-1">
                                                                <button type="button" className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-[#57534E] hover:bg-black/5 dark:text-[#D6D3D1] dark:hover:bg-white/10" onClick={() => openEditModel(record)}>
                                                                    编辑
                                                                </button>
                                                                <Tooltip title="删除模型">
                                                                    <button type="button" className="rounded p-1 text-[#A8A29E] hover:bg-black/5 hover:text-[#B91C1C] dark:hover:bg-white/10" onClick={() => removeModel(record)}>
                                                                        <Trash2 className="size-3.5" />
                                                                    </button>
                                                                </Tooltip>
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="grid h-56 place-items-center">
                                <Empty description="该渠道还没有模型，可从上游拉取或手动添加" />
                            </div>
                        )}
                        <div className={`border-t border-[#E7E5DF] px-4 py-2 text-[11px] dark:border-[#2A2724] ${MUTED}`}>
                            共 {channelModels.length} 个模型 · {channelModels.filter((record) => grantSummary(record.grants) === "未授权").length} 个未授权给任何角色
                            {active?.lastOkAt ? ` · 最近一次成功调用 ${relativeTime(active.lastOkAt)}` : ""}
                        </div>
                    </section>

                    <aside className="flex flex-col gap-3">
                        {active ? (
                            <div className={`${CARD} p-4`}>
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold">渠道设置</div>
                                    <Switch size="small" checked={draft.enabled} disabled={!canManageChannel} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                                </div>
                                <label className="mt-3 block text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                    显示名称
                                    <Input size="small" className="mt-1" value={draft.name} disabled={!canManageChannel} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                                </label>
                                <label className="mt-3 block text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                    Base URL
                                    <Input size="small" className="mt-1 font-mono text-[11px]" value={draft.baseUrl} disabled={!canManageChannel} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} />
                                </label>
                                <label className="mt-3 block text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                    API Key（{active.apiKeyMask}）
                                    <Input.Password
                                        size="small"
                                        className="mt-1 font-mono text-[11px]"
                                        placeholder="留空表示不轮换"
                                        value={draft.apiKey}
                                        disabled={!canManageChannel}
                                        onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                                    />
                                </label>
                                <p className={`mt-1 text-[10px] ${MUTED}`}>轮换后立即生效，旧 Key 不再使用。</p>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <label className="block text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        超时（秒）
                                        <InputNumber size="small" className="mt-1 w-full" min={5} max={300} value={draft.timeoutSeconds} disabled={!canManageChannel} onChange={(value) => setDraft((current) => ({ ...current, timeoutSeconds: Number(value ?? 60) }))} />
                                    </label>
                                    <label className="block text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        重试次数
                                        <InputNumber size="small" className="mt-1 w-full" min={0} max={2} value={draft.retry} disabled={!canManageChannel} onChange={(value) => setDraft((current) => ({ ...current, retry: Number(value ?? 0) }))} />
                                    </label>
                                </div>

                                <div className="mt-3 rounded-lg border border-[#E7E5DF] px-3 py-2 dark:border-[#3A3631]">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[11px] ${MUTED}`}>连通性测试</span>
                                        <Button size="small" type="text" loading={testing} icon={<FlaskConical className="size-3.5" />} onClick={() => void runTest()}>
                                            测试
                                        </Button>
                                    </div>
                                    {testResult ? <div className={`mt-1 text-[11px] ${testResult.ok ? "text-[#15803D]" : "text-[#B91C1C]"}`}>{testResult.text}</div> : <div className={`mt-1 text-[11px] ${MUTED}`}>尚未测试</div>}
                                </div>

                                {canManageChannel ? (
                                    <div className="mt-3 flex items-center gap-2">
                                        <Button size="small" type="primary" loading={saving} onClick={() => void saveChannel()}>
                                            保存
                                        </Button>
                                        <Button size="small" onClick={() => setDraft({ name: active.name, baseUrl: active.baseUrl, apiKey: "", timeoutSeconds: Math.round(active.timeoutMs / 1000), retry: active.retry, enabled: active.enabled })}>
                                            取消
                                        </Button>
                                        <div className="flex-1" />
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={removeChannel}>
                                            删除
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </aside>
                </div>
            )}

            <Modal title="新建渠道" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void createChannel()} confirmLoading={saving} okText="创建" width={460}>
                <label className="mt-2 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    显示名称
                    <Input className="mt-1" value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="公司主渠道" />
                </label>
                <label className="mt-3 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    Base URL
                    <Input className="mt-1 font-mono text-xs" value={createDraft.baseUrl} onChange={(event) => setCreateDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" />
                </label>
                <label className="mt-3 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    API Key
                    <Input.Password className="mt-1 font-mono text-xs" value={createDraft.apiKey} onChange={(event) => setCreateDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder="sk-..." />
                </label>
                <p className={`mt-2 text-[11px] ${MUTED}`}>密钥使用 AES-256-GCM 加密存储，接口只返回掩码。</p>
            </Modal>

            <Modal
                title="从上游拉取模型"
                open={importOpen}
                onCancel={() => setImportOpen(false)}
                onOk={() => void submitImport()}
                confirmLoading={saving}
                okText={importChecked.length ? `导入 ${importChecked.length} 个` : "导入"}
                width={520}
            >
                {importItems.length ? (
                    <Checkbox.Group className="flex w-full flex-col gap-1" value={importChecked} onChange={(values) => setImportChecked(values as string[])}>
                        {importItems.map((item) => (
                            <Checkbox key={item.id} value={item.id} disabled={item.imported}>
                                <span className="font-mono text-xs">{item.id}</span>
                                {item.imported ? <span className={`ml-2 text-[11px] ${MUTED}`}>已导入</span> : null}
                            </Checkbox>
                        ))}
                    </Checkbox.Group>
                ) : (
                    <Empty description="上游没有返回模型" />
                )}
            </Modal>

            <Modal title={editingModel ? "编辑模型" : "添加模型"} open={modelOpen} onCancel={() => setModelOpen(false)} onOk={() => void submitModel()} confirmLoading={saving} okText="保存" width={560}>
                <label className="mt-2 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    模型 ID
                    <Input className="mt-1 font-mono text-xs" value={modelDraft.modelId} disabled={Boolean(editingModel)} onChange={(event) => setModelDraft((current) => ({ ...current, modelId: event.target.value }))} placeholder="gpt-image-2" />
                </label>
                <label className="mt-3 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    显示名称
                    <Input className="mt-1" value={modelDraft.displayName} onChange={(event) => setModelDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="留空则显示模型 ID" />
                </label>
                <div className="mt-3 text-xs text-[#78716C] dark:text-[#A8A29E]">能力</div>
                <Checkbox.Group
                    className="mt-1"
                    options={CAPABILITY_OPTIONS}
                    value={modelDraft.capabilities}
                    onChange={(values) => setModelDraft((current) => ({ ...current, capabilities: values as ModelCapabilityValue[] }))}
                />
                <div className="mt-3 flex items-center justify-between text-xs text-[#78716C] dark:text-[#A8A29E]">
                    <span>参数模板</span>
                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => setParamRows((current) => [...current, { capability: modelDraft.capabilities[0] ?? "image", key: "", options: "", value: "" }])}>
                        添加参数
                    </Button>
                </div>
                <div className="mt-1 flex flex-col gap-2">
                    {paramRows.map((row, index) => (
                        <div key={index} className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1.4fr)_72px_24px] items-center gap-1.5">
                            <select
                                className="h-7 rounded-md border border-[#E7E5DF] bg-white px-1 text-[11px] dark:border-[#3A3631] dark:bg-[#1F1C19]"
                                value={row.capability}
                                onChange={(event) => setParamRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, capability: event.target.value as ModelCapabilityValue } : item)))}
                            >
                                {CAPABILITY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <Input size="small" placeholder="size" value={row.key} onChange={(event) => setParamRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item)))} />
                            <Input size="small" placeholder="选项，逗号分隔" value={row.options} onChange={(event) => setParamRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, options: event.target.value } : item)))} />
                            <Input size="small" placeholder="默认" value={row.value} onChange={(event) => setParamRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))} />
                            <button type="button" className="text-[#A8A29E] hover:text-[#B91C1C]" onClick={() => setParamRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    ))}
                    {paramRows.length === 0 ? <div className={`text-[11px] ${MUTED}`}>例如 size: 1024x1024 / 1536x1024，quality: low / medium / high。</div> : null}
                </div>
                <label className="mt-3 block text-xs text-[#78716C] dark:text-[#A8A29E]">
                    备注
                    <Input className="mt-1" value={modelDraft.note} onChange={(event) => setModelDraft((current) => ({ ...current, note: event.target.value }))} placeholder="可选" />
                </label>
                <div className="mt-3 flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
                    <Switch size="small" checked={modelDraft.enabled} onChange={(enabled) => setModelDraft((current) => ({ ...current, enabled }))} />
                    启用该模型
                </div>
            </Modal>
        </div>
    );
}
