import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { App, Button, Empty, Select, Spin } from "antd";
import { ArrowLeft, Download, ShieldAlert } from "lucide-react";

import { CAPABILITY_LABELS } from "@/constant/model";
import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { apiErrorMessage } from "@/services/api/client";
import { modelApi } from "@/services/api/team";
import type { ModelCapabilityValue, ModelRecord, UsagePayload } from "@/types/team";

const CARD = "rounded-xl border border-[#E7E5DF] bg-white dark:border-[#2A2724] dark:bg-[#1F1C19]";
const MUTED = "text-[#78716C] dark:text-[#A8A29E]";

type RangeKey = "7d" | "30d" | "month";

function dayString(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rangeOf(key: RangeKey) {
    const now = new Date();
    if (key === "month") return { from: dayString(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayString(now) };
    const days = key === "7d" ? 7 : 30;
    return { from: dayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)), to: dayString(now) };
}

function money(micros: number) {
    return `¥${(micros / 1_000_000).toFixed(2)}`;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className={`${CARD} px-4 py-3`}>
            <div className={`text-[11px] ${MUTED}`}>{label}</div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
            {hint ? <div className={`mt-0.5 text-[11px] ${MUTED}`}>{hint}</div> : null}
        </div>
    );
}

export default function WorkspaceUsagePage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const { message } = App.useApp();
    const { can } = useWorkspaceAccess(wsId);
    const canRead = can("usage.read");
    const canExport = can("usage.export");

    const [range, setRange] = useState<RangeKey>("7d");
    const [capability, setCapability] = useState<ModelCapabilityValue | "">("");
    const [models, setModels] = useState<ModelRecord[]>([]);
    const [dayData, setDayData] = useState<UsagePayload | null>(null);
    const [userData, setUserData] = useState<UsagePayload | null>(null);
    const [modelData, setModelData] = useState<UsagePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    const load = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        const params = { ...rangeOf(range), ...(capability ? { capability } : {}) };
        try {
            const [byDay, byUser, byModel, nextModels] = await Promise.all([
                modelApi.usage(wsId, { ...params, groupBy: "day" }),
                modelApi.usage(wsId, { ...params, groupBy: "user" }),
                modelApi.usage(wsId, { ...params, groupBy: "model" }),
                modelApi.models(wsId),
            ]);
            setDayData(byDay);
            setUserData(byUser);
            setModelData(byModel);
            setModels(nextModels);
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [canRead, capability, message, range, wsId]);

    useEffect(() => {
        void load();
    }, [load]);

    const totals = dayData?.totals;
    const successRate = totals && totals.calls ? ((totals.succeeded / totals.calls) * 100).toFixed(1) : "0.0";
    const maxCalls = useMemo(() => Math.max(1, ...(dayData?.series ?? []).map((item) => item.calls)), [dayData]);
    const costTotal = (modelData?.rows ?? []).reduce((sum, item) => sum + item.costMicros, 0);

    const exportCsv = async () => {
        setExporting(true);
        try {
            const blob = await modelApi.exportUsage(wsId, rangeOf(range));
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `usage-${rangeOf(range).from}_${rangeOf(range).to}.csv`;
            anchor.click();
            URL.revokeObjectURL(url);
            message.success("已导出用量明细");
        } catch (error) {
            message.error(apiErrorMessage(error));
        } finally {
            setExporting(false);
        }
    };

    if (!canRead) {
        return (
            <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
                <div className={`${CARD} p-10 text-center`}>
                    <ShieldAlert className="mx-auto size-6 text-[#A8A29E]" />
                    <div className="mt-3 text-sm font-semibold">没有查看用量的权限</div>
                    <p className={`mt-1 text-xs ${MUTED}`}>
                        需要空间权限 <code className="font-mono text-[11px]">usage.read</code>。
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Link to={`/w/${wsId}/models`} className="flex items-center gap-1 text-xs text-[#57534E] hover:underline dark:text-[#A8A29E]">
                    <ArrowLeft className="size-3.5" />
                    模型
                </Link>
                <div className="flex-1" />
                <Select
                    size="small"
                    value={range}
                    style={{ width: 104 }}
                    options={[
                        { value: "7d", label: "近 7 天" },
                        { value: "30d", label: "近 30 天" },
                        { value: "month", label: "本月" },
                    ]}
                    onChange={(value: RangeKey) => setRange(value)}
                />
                <Select
                    size="small"
                    value={capability}
                    style={{ width: 120 }}
                    options={[{ value: "", label: "全部能力" }, ...Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }))]}
                    onChange={(value: ModelCapabilityValue | "") => setCapability(value)}
                />
                {canExport ? (
                    <Button size="small" icon={<Download className="size-3.5" />} loading={exporting} onClick={() => void exportCsv()}>
                        导出 CSV
                    </Button>
                ) : null}
            </div>

            {loading && !dayData ? (
                <div className={`${CARD} grid h-64 place-items-center`}>
                    <Spin />
                </div>
            ) : !totals?.calls ? (
                <div className={`${CARD} grid h-64 place-items-center`}>
                    <Empty description="该时间范围内还没有调用记录" />
                </div>
            ) : (
                <>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <Kpi label="调用次数" value={totals.calls.toLocaleString()} hint={dayData ? `${dayData.range.from} ~ ${dayData.range.to}` : undefined} />
                        <Kpi label="成功率" value={`${successRate}%`} hint={`失败 ${totals.failed}`} />
                        <Kpi label="平均耗时" value={`${(totals.avgLatencyMs / 1000).toFixed(1)}s`} hint="仅统计成功调用" />
                        <Kpi label="估算费用" value={money(totals.costMicros)} hint="按模型单价估算" />
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                        <section className={`${CARD} p-4`}>
                            <div className="text-sm font-semibold">每日调用</div>
                            <div className="mt-4 flex h-40 items-end gap-1.5">
                                {(dayData?.series ?? []).map((item) => (
                                    <div key={item.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                                        <div className="text-[10px] text-transparent transition group-hover:text-[#1C1917] dark:group-hover:text-[#F5F5F4]">{item.calls}</div>
                                        <div className="w-full max-w-10 rounded-t bg-[#1C1917] transition group-hover:bg-[#C2410C] dark:bg-[#FAF9F7]" style={{ height: `${Math.max(2, (item.calls / maxCalls) * 100)}%` }} title={`${item.key} · ${item.calls} 次 · ${money(item.costMicros)}`} />
                                        <div className={`text-[10px] ${MUTED}`}>{item.key.slice(5)}</div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className={`${CARD} p-4`}>
                            <div className="text-sm font-semibold">成本构成</div>
                            <div className="mt-3 flex flex-col gap-2">
                                {(modelData?.rows ?? [])
                                    .filter((item) => item.calls > 0)
                                    .sort((a, b) => b.costMicros - a.costMicros)
                                    .slice(0, 6)
                                    .map((item) => {
                                        const record = models.find((model) => model.modelId === item.key);
                                        const percent = costTotal ? Math.round((item.costMicros / costTotal) * 100) : 0;
                                        return (
                                            <div key={item.key}>
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="min-w-0 truncate">{record?.displayName || item.name || item.key}</span>
                                                    <span className={MUTED}>
                                                        {money(item.costMicros)} · {percent}%
                                                    </span>
                                                </div>
                                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#E7E5DF] dark:bg-[#292524]">
                                                    <div className="h-full rounded-full bg-[#C2410C]" style={{ width: `${Math.max(2, percent)}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                {!costTotal ? <div className={`text-[11px] ${MUTED}`}>模型未配置单价，暂不估算费用。</div> : null}
                            </div>
                        </section>
                    </div>

                    <section className={`${CARD} mt-4 overflow-hidden`}>
                        <div className="border-b border-[#E7E5DF] px-4 py-2.5 text-sm font-semibold dark:border-[#2A2724]">按成员</div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] border-collapse text-xs">
                                <thead>
                                    <tr className="text-left text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                                        <th className="px-4 py-2.5 font-medium">成员</th>
                                        <th className="w-24 px-3 py-2.5 font-medium">角色</th>
                                        <th className="w-20 px-3 py-2.5 font-medium">调用</th>
                                        <th className="w-16 px-3 py-2.5 font-medium">失败</th>
                                        <th className="w-24 px-3 py-2.5 font-medium">平均耗时</th>
                                        <th className="w-24 px-3 py-2.5 font-medium">费用</th>
                                        <th className="w-40 px-3 py-2.5 font-medium">今日额度</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(userData?.rows ?? []).map((row) => {
                                        const percent = row.dailyLimit ? Math.min(100, Math.round(((row.usedToday ?? 0) / row.dailyLimit) * 100)) : 0;
                                        return (
                                            <tr key={row.key} className="border-t border-[#E7E5DF] dark:border-[#2A2724]">
                                                <td className="px-4 py-2.5 text-[13px] font-medium">{row.name || "未命名成员"}</td>
                                                <td className={`px-3 py-2.5 ${MUTED}`}>{row.roleKey ? roleLabel(row.roleKey) : "—"}</td>
                                                <td className="px-3 py-2.5">{row.calls}</td>
                                                <td className={`px-3 py-2.5 ${row.failed ? "text-[#B91C1C]" : MUTED}`}>{row.failed}</td>
                                                <td className={`px-3 py-2.5 ${MUTED}`}>{row.avgLatencyMs ? `${(row.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                                                <td className={`px-3 py-2.5 ${MUTED}`}>{money(row.costMicros)}</td>
                                                <td className="px-3 py-2.5">
                                                    {row.dailyLimit && row.roleKey !== "owner" && row.roleKey !== "admin" ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className={MUTED}>
                                                                {row.usedToday ?? 0}/{row.dailyLimit}
                                                            </span>
                                                            <div className="h-1 w-16 overflow-hidden rounded-full bg-[#E7E5DF] dark:bg-[#292524]">
                                                                <div className={`h-full rounded-full ${percent >= 80 ? "bg-[#B91C1C]" : "bg-[#C2410C]"}`} style={{ width: `${Math.max(2, percent)}%` }} />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className={MUTED}>不限</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
