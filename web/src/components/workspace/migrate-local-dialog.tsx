import { useMemo, useState } from "react";
import { App, Button, Modal, Progress } from "antd";
import { CheckCircle2, HardDriveUpload } from "lucide-react";

import { projectDoc } from "@/hooks/use-workspace-projects";
import { apiErrorMessage } from "@/services/api/client";
import { assetApi, projectApi } from "@/services/api/team";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

const MIGRATED_KEY = "infinite-canvas:cloud_migrated";

function readMigrated(): Set<string> {
    try {
        return new Set(JSON.parse(localStorage.getItem(MIGRATED_KEY) || "[]") as string[]);
    } catch {
        return new Set();
    }
}

function markMigrated(ids: string[]) {
    const merged = new Set([...readMigrated(), ...ids]);
    localStorage.setItem(MIGRATED_KEY, JSON.stringify([...merged]));
}

function formatSize(bytes: number) {
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function MigrateLocalDialog({ open, workspaceId, onClose, onImported }: { open: boolean; workspaceId: string; onClose: () => void; onImported: () => void }) {
    const { message } = App.useApp();
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [failures, setFailures] = useState<string[]>([]);
    const projects = useCanvasStore((state) => state.projects);
    const assets = useAssetStore((state) => state.assets);

    const localProjects = useMemo(() => {
        const migrated = readMigrated();
        return projects.filter((project) => !project.workspaceId && !migrated.has(project.id));
    }, [projects]);
    const localAssets = useMemo(() => {
        const migrated = readMigrated();
        return assets.filter((asset) => !migrated.has(asset.id));
    }, [assets]);
    const totalBytes = useMemo(
        () => localProjects.reduce((sum, project) => sum + JSON.stringify(projectDoc(project)).length, 0) + localAssets.reduce((sum, asset) => sum + (asset.kind === "text" ? 0 : asset.data.bytes || 0), 0),
        [localAssets, localProjects],
    );

    const start = async () => {
        setRunning(true);
        setDone(false);
        setFailures([]);
        const failures: string[] = [];
        const migratedIds: string[] = [];
        const total = localProjects.length + localAssets.length;
        setProgress({ current: 0, total });
        let current = 0;

        if (localProjects.length) {
            try {
                await projectApi.importBatch(workspaceId, {
                    projects: localProjects.map((project) => ({ id: project.id, title: project.title, doc: projectDoc(project), visibility: "workspace" })),
                });
                localProjects.forEach((project) => migratedIds.push(project.id));
            } catch (error) {
                failures.push(`项目：${apiErrorMessage(error)}`);
            }
            current += localProjects.length;
            setProgress({ current, total });
        }

        for (const asset of localAssets) {
            try {
                const base = { kind: asset.kind, title: asset.title, tags: asset.tags, source: asset.source, note: asset.note };
                if (asset.kind === "text") {
                    await assetApi.create(workspaceId, { ...base, note: asset.data.content });
                } else {
                    const source = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
                    const blob = await fetch(source).then((response) => response.blob());
                    const uploaded = await assetApi.upload(workspaceId, blob, { name: asset.title || asset.id, mimeType: asset.data.mimeType || blob.type, width: asset.data.width, height: asset.data.height });
                    await assetApi.create(workspaceId, {
                        ...base,
                        coverUrl: uploaded.url,
                        storageKey: uploaded.storageKey,
                        bytes: uploaded.bytes,
                        mimeType: uploaded.mimeType,
                        width: asset.data.width,
                        height: asset.data.height,
                    });
                }
                migratedIds.push(asset.id);
            } catch (error) {
                failures.push(`${asset.title}：${apiErrorMessage(error)}`);
            }
            current += 1;
            setProgress({ current, total });
        }

        if (migratedIds.length) markMigrated(migratedIds);
        setFailures(failures);
        setRunning(false);
        setDone(true);
        onImported();
        if (!failures.length) message.success(`已迁移 ${migratedIds.length} 项，本地副本保留`);
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={560}
            title="把本机数据复制到空间"
            destroyOnHidden
        >
            {done ? (
                <div className="py-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#15803D]">
                        <CheckCircle2 className="size-4" />
                        迁移完成
                    </div>
                    <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">已复制的数据不会从本机删除；退出登录后仍可在本地空间继续使用。</p>
                    {failures.length ? (
                        <div className="mt-3 rounded-lg bg-[#FCEDED] p-3 text-xs text-[#B91C1C]">
                            <div className="font-medium">有 {failures.length} 项未完成</div>
                            <ul className="mt-1 list-disc pl-4">
                                {failures.slice(0, 6).map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    <div className="mt-5 flex justify-end">
                        <Button type="primary" onClick={onClose}>
                            完成
                        </Button>
                    </div>
                </div>
            ) : (
                <div>
                    <p className="text-sm text-[#57534E] dark:text-[#A8A29E]">
                        检测到本机有 {localProjects.length} 个项目、{localAssets.length} 个素材，共约 {formatSize(totalBytes)}。迁移是复制，不会删除本地数据。
                    </p>
                    <div className="mt-4 space-y-2 rounded-lg border border-[#E7E5DF] p-3 text-xs dark:border-[#2A2724]">
                        <div className="flex justify-between">
                            <span className="text-[#78716C] dark:text-[#A8A29E]">画布项目</span>
                            <span>{localProjects.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-[#78716C] dark:text-[#A8A29E]">素材（图片 / 视频 / 文本）</span>
                            <span>{localAssets.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-[#78716C] dark:text-[#A8A29E]">渠道 API Key</span>
                            <span className="text-[#B45309]">不上传，只保留在本机</span>
                        </div>
                    </div>
                    {running ? (
                        <div className="mt-4">
                            <Progress percent={progress.total ? Math.round((progress.current / progress.total) * 100) : 0} size="small" />
                            <div className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                                正在迁移 {progress.current} / {progress.total}
                            </div>
                        </div>
                    ) : null}
                    <div className="mt-5 flex justify-end gap-2">
                        <Button onClick={onClose} disabled={running}>
                            稍后再说
                        </Button>
                        <Button type="primary" icon={<HardDriveUpload className="size-4" />} loading={running} disabled={!localProjects.length && !localAssets.length} onClick={() => void start()}>
                            开始迁移
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
