import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";

import { ApiError, apiErrorMessage } from "@/services/api/client";
import { projectApi } from "@/services/api/team";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { ProjectDetail, ProjectDoc } from "@/types/team";

const loadedWorkspaces = new Set<string>();
const lastSavedAt = new Map<string, string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savingProjects = new Set<string>();

export function projectDoc(project: CanvasProject): ProjectDoc {
    return {
        nodes: project.nodes,
        connections: project.connections,
        chatSessions: project.chatSessions,
        activeChatId: project.activeChatId,
        backgroundMode: project.backgroundMode,
        showImageInfo: project.showImageInfo,
        viewport: project.viewport,
    };
}

function toCanvasProject(detail: ProjectDetail, workspaceId: string): CanvasProject {
    return {
        id: detail.id,
        title: detail.title,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        workspaceId,
        version: detail.version,
        ownerId: detail.ownerId,
        ownerName: detail.ownerName,
        visibility: detail.visibility,
        thumbnailUrl: detail.thumbnailUrl,
        collaboratorCount: detail.collaboratorCount,
        nodes: (detail.doc?.nodes || []) as CanvasProject["nodes"],
        connections: (detail.doc?.connections || []) as CanvasProject["connections"],
        chatSessions: (detail.doc?.chatSessions || []) as CanvasProject["chatSessions"],
        activeChatId: detail.doc?.activeChatId || null,
        backgroundMode: (detail.doc?.backgroundMode || "lines") as CanvasProject["backgroundMode"],
        showImageInfo: detail.doc?.showImageInfo || false,
        viewport: detail.doc?.viewport || { x: 0, y: 0, k: 1 },
    };
}

export function addCloudProject(detail: ProjectDetail, workspaceId: string) {
    const project = toCanvasProject(detail, workspaceId);
    lastSavedAt.set(project.id, project.updatedAt);
    useCanvasStore.setState((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)] }));
    return project;
}

export async function loadWorkspaceProjects(workspaceId: string) {
    if (loadedWorkspaces.has(workspaceId)) return false;
    const { items } = await projectApi.list(workspaceId);
    const details = await Promise.all(items.map((item) => projectApi.detail(item.id).then((result) => result.project)));
    const projects = details.map((detail) => toCanvasProject(detail, workspaceId));
    projects.forEach((project) => lastSavedAt.set(project.id, project.updatedAt));
    useCanvasStore.getState().replaceWorkspaceProjects(workspaceId, projects);
    loadedWorkspaces.add(workspaceId);
    return true;
}

export function forgetWorkspaceProjects(workspaceId: string) {
    loadedWorkspaces.delete(workspaceId);
}

export function resetWorkspaceProjectCache() {
    loadedWorkspaces.clear();
    lastSavedAt.clear();
}

async function saveProject(projectId: string, onConflict: () => void) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    if (!project || !project.workspaceId || savingProjects.has(projectId)) return;
    savingProjects.add(projectId);
    try {
        const result = await projectApi.save(projectId, { title: project.title, doc: projectDoc(project), version: project.version || 0 });
        useCanvasStore.getState().setProjectVersion(projectId, result.version);
        lastSavedAt.set(projectId, project.updatedAt);
    } catch (error) {
        if (error instanceof ApiError && error.code === "VERSION_CONFLICT") onConflict();
        else throw error;
    } finally {
        savingProjects.delete(projectId);
    }
}

export function useWorkspaceProjects(workspaceId: string, enableSync = false) {
    const { message } = App.useApp();
    const [loading, setLoading] = useState(() => Boolean(workspaceId) && !loadedWorkspaces.has(workspaceId));
    const [error, setError] = useState<string | null>(null);
    const allProjects = useCanvasStore((state) => state.projects);
    const projects = useMemo(() => allProjects.filter((project) => project.workspaceId === workspaceId), [allProjects, workspaceId]);

    const reload = useCallback(async () => {
        loadedWorkspaces.delete(workspaceId);
        setLoading(true);
        setError(null);
        try {
            await loadWorkspaceProjects(workspaceId);
        } catch (loadError) {
            setError(apiErrorMessage(loadError));
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        if (!workspaceId) return;
        let active = true;
        setLoading(!loadedWorkspaces.has(workspaceId));
        loadWorkspaceProjects(workspaceId)
            .catch((loadError) => active && setError(apiErrorMessage(loadError)))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [workspaceId]);

    useEffect(() => {
        if (!enableSync) return;
        const onConflict = () => message.warning("项目已在其他位置更新，本次保存被拒绝，请刷新后重试");
        const unsubscribe = useCanvasStore.subscribe((state, previous) => {
            if (state.projects === previous.projects) return;
            for (const project of state.projects) {
                if (project.workspaceId !== workspaceId) continue;
                const saved = lastSavedAt.get(project.id);
                if (saved === undefined) {
                    lastSavedAt.set(project.id, project.updatedAt);
                    continue;
                }
                if (saved === project.updatedAt) continue;
                lastSavedAt.set(project.id, project.updatedAt);
                const timer = saveTimers.get(project.id);
                if (timer) clearTimeout(timer);
                saveTimers.set(
                    project.id,
                    setTimeout(() => {
                        saveTimers.delete(project.id);
                        void saveProject(project.id, onConflict).catch((saveError) => message.error(apiErrorMessage(saveError)));
                    }, 800),
                );
            }
        });
        return () => {
            unsubscribe();
            saveTimers.forEach((timer) => clearTimeout(timer));
            saveTimers.clear();
        };
    }, [enableSync, message, workspaceId]);

    return { projects, loading, error, reload };
}
