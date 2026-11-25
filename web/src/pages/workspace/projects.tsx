import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Empty, Modal, Spin, Tabs, Tooltip } from "antd";
import { FolderKanban, HardDriveUpload, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";

import { MigrateLocalDialog } from "@/components/workspace/migrate-local-dialog";
import { roleLabel } from "@/constant/permissions";
import { addCloudProject, useWorkspaceProjects } from "@/hooks/use-workspace-projects";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { apiErrorMessage } from "@/services/api/client";
import { projectApi } from "@/services/api/team";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { relativeTime } from "@/lib/time";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const THUMBNAILS = [
    "linear-gradient(135deg, #f5e6d3 0%, #d6b28f 100%)",
    "linear-gradient(135deg, #e4e9e3 0%, #a9b8aa 100%)",
    "linear-gradient(135deg, #f2e3e6 0%, #c9a7b0 100%)",
    "linear-gradient(135deg, #e3e7f2 0%, #a5adc9 100%)",
    "linear-gradient(135deg, #f4ecd6 0%, #cfbd8d 100%)",
    "linear-gradient(135deg, #e9e2f2 0%, #b3a5c9 100%)",
];

function thumbnailFor(id: string) {
    const index = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % THUMBNAILS.length;
    return THUMBNAILS[index];
}

function visibilityLabel(project: CanvasProject) {
    if (project.visibility === "private") return "私有";
    if (project.visibility === "link") return "链接分享";
    return "空间可见";
}

function ProjectCard({ project, canDelete, onOpen, onDelete }: { project: CanvasProject; canDelete: boolean; onOpen: () => void; onDelete: () => void }) {
    const nodeCount = project.nodes.length;
    return (
        <div className="group overflow-hidden rounded-xl border border-[#E7E5DF] bg-white transition hover:border-[#D6D1C7] dark:border-[#2A2724] dark:bg-[#1F1C19] dark:hover:border-[#3A3631]">
            <button type="button" className="relative block h-28 w-full text-left" style={{ background: thumbnailFor(project.id) }} onClick={onOpen}>
                <span className="absolute left-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] text-white backdrop-blur">{visibilityLabel(project)}</span>
                {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
            </button>
            <div className="flex items-start gap-2 px-3 pb-3 pt-2.5">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
                    <div className="truncate text-[13px] font-medium text-[#1C1917] dark:text-[#F5F5F4]">{project.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#A8A29E]">
                        <span>{relativeTime(project.updatedAt)}</span>
                        <span>·</span>
                        <span>{nodeCount} 个节点</span>
                    </div>
                </button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [{ key: "delete", label: "删除项目", icon: <Trash2 className="size-3.5" />, danger: true, disabled: !canDelete }],
                        onClick: ({ key }) => key === "delete" && onDelete(),
                    }}
                >
                    <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-[#A8A29E] opacity-0 transition hover:bg-black/5 group-hover:opacity-100 dark:hover:bg-white/10">
                        <MoreHorizontal className="size-4" />
                    </button>
                </Dropdown>
            </div>
        </div>
    );
}

export default function WorkspaceProjectsPage() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { message, modal } = App.useApp();
    const { workspace, can } = useWorkspaceAccess(wsId);
    const me = useAuthStore((state) => state.me);
    const { projects, loading, error, reload } = useWorkspaceProjects(wsId);
    const allProjects = useCanvasStore((state) => state.projects);
    const localProjects = useMemo(() => allProjects.filter((project) => !project.workspaceId), [allProjects]);
    const localAssets = useAssetStore((state) => state.assets);
    const [creating, setCreating] = useState(false);
    const [migrateOpen, setMigrateOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [tab, setTab] = useState("all");
    const canCreate = can("project.create");

    useEffect(() => {
        if (searchParams.get("migrate") === "1") {
            setMigrateOpen(true);
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const filtered = useMemo(() => {
        const matched = projects.filter((project) => project.title.toLowerCase().includes(keyword.trim().toLowerCase()));
        if (tab === "mine") return matched.filter((project) => project.ownerId === me?.user.id);
        if (tab === "shared") return matched.filter((project) => project.ownerId !== me?.user.id);
        return matched;
    }, [keyword, me?.user.id, projects, tab]);

    const createProject = async () => {
        if (!canCreate || creating) return;
        setCreating(true);
        try {
            const created = (await projectApi.create(wsId, { title: "未命名项目", visibility: "workspace" })) as { project?: { id: string } } | { id: string };
            const summary = "project" in created && created.project ? created.project : (created as { id: string });
            const detail = await projectApi.detail(summary.id);
            addCloudProject(detail.project, wsId);
            navigate(`/w/${wsId}/canvas/${summary.id}`);
        } catch (createError) {
            message.error(apiErrorMessage(createError));
        } finally {
            setCreating(false);
        }
    };

    const removeProject = (project: CanvasProject) => {
        modal.confirm({
            title: `删除「${project.title}」？`,
            content: "删除后空间内成员将无法再打开该项目。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await projectApi.remove(project.id);
                useCanvasStore.getState().deleteProjects([project.id]);
                message.success("项目已删除");
            },
        });
    };

    const hasLocalData = localProjects.length > 0 || localAssets.length > 0;

    return (
        <div className="mx-auto max-w-6xl px-6 pb-10 pt-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">项目</h1>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                        {workspace?.name} · {workspace?.memberCount} 位成员 · 你的角色：{roleLabel(workspace?.roleKey || "")}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <label className="flex h-8 items-center gap-1.5 rounded-lg border border-[#E7E5DF] bg-white px-2 text-xs focus-within:border-[#C2410C] dark:border-[#2A2724] dark:bg-[#1F1C19]">
                        <Search className="size-3.5 text-[#A8A29E]" />
                        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目名称" className="w-36 bg-transparent outline-none placeholder:text-[#A8A29E]" />
                    </label>
                    <Button icon={<Plus className="size-4" />} onClick={() => void createProject()} loading={creating} disabled={!canCreate} type="primary">
                        新建项目
                    </Button>
                </div>
            </div>

            <div className="mt-4">
                <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    items={[
                        { key: "all", label: `全部 ${projects.length}` },
                        { key: "mine", label: "我创建的" },
                        { key: "shared", label: "共享给我" },
                    ]}
                />
            </div>

            {hasLocalData ? (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#E7E5DF] bg-white px-3 py-2 text-xs dark:border-[#2A2724] dark:bg-[#1F1C19]">
                    <HardDriveUpload className="size-4 text-[#A8A29E]" />
                    <span className="flex-1 text-[#57534E] dark:text-[#A8A29E]">
                        本机还有 <b>{localProjects.length}</b> 个项目、<b>{localAssets.length}</b> 个素材未上传。迁移会复制而非移动，本地副本保留。
                    </span>
                    <Button size="small" onClick={() => setMigrateOpen(true)}>
                        开始迁移
                    </Button>
                </div>
            ) : null}

            {error ? (
                <div className="rounded-lg border border-[#FCEDED] bg-[#FCEDED] px-3 py-2 text-xs text-[#B91C1C]">
                    {error}
                    <button type="button" className="ml-2 underline" onClick={() => void reload()}>
                        重试
                    </button>
                </div>
            ) : null}

            {loading ? (
                <div className="grid place-items-center py-20">
                    <Spin />
                </div>
            ) : filtered.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                    {filtered.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            canDelete={can("project.delete")}
                            onOpen={() => navigate(`/w/${wsId}/canvas/${project.id}`)}
                            onDelete={() => removeProject(project)}
                        />
                    ))}
                </div>
            ) : (
                <div className="grid place-items-center rounded-xl border border-dashed border-[#E7E5DF] py-20 dark:border-[#2A2724]">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? "没有匹配的项目" : "还没有项目"}>
                        {canCreate && !keyword ? (
                            <Tooltip title="新建后即可在画布里生成内容">
                                <Button type="primary" icon={<FolderKanban className="size-4" />} onClick={() => void createProject()} loading={creating}>
                                    新建项目
                                </Button>
                            </Tooltip>
                        ) : null}
                    </Empty>
                </div>
            )}

            <MigrateLocalDialog open={migrateOpen} workspaceId={wsId} onClose={() => setMigrateOpen(false)} onImported={() => void reload()} />
        </div>
    );
}
