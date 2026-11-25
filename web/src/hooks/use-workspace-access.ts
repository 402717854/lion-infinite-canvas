import { useParams } from "react-router-dom";

import { useAuthStore } from "@/stores/use-auth-store";

export function useWorkspaceAccess(workspaceId?: string) {
    const params = useParams<{ wsId?: string }>();
    const id = workspaceId || params.wsId || "";
    const me = useAuthStore((state) => state.me);
    const workspace = me?.workspaces.find((item) => item.id === id) || null;

    return {
        workspaceId: id,
        workspace,
        roleKey: workspace?.roleKey || "",
        can: (permission: string) => Boolean(workspace?.permissions.includes(permission)),
    };
}
