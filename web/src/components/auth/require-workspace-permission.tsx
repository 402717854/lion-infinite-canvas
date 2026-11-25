import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useWorkspaceAccess } from "@/hooks/use-workspace-access";

export function RequireWorkspacePermission({ permission, children }: { permission: string; children: ReactNode }) {
    const { workspace, can } = useWorkspaceAccess();
    if (!workspace) return null;
    if (!can(permission)) return <Navigate to="/403" replace />;
    return <>{children}</>;
}
