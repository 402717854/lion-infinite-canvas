import { createBrowserRouter, Outlet } from "react-router-dom";

import { RequireAuth } from "@/components/auth/require-auth";
import { RequireWorkspacePermission } from "@/components/auth/require-workspace-permission";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import WorkspaceLayout from "@/layouts/workspace-layout";
import AssetsPage from "@/pages/assets";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import InvitePage from "@/pages/auth/invite";
import LoginPage from "@/pages/auth/login";
import OnboardingPage from "@/pages/auth/onboarding";
import RegisterPage from "@/pages/auth/register";
import ResetPasswordPage from "@/pages/auth/reset-password";
import VerifyEmailPage from "@/pages/auth/verify-email";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import ForbiddenPage from "@/pages/forbidden";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import WorkspaceAuditPage from "@/pages/workspace/audit";
import WorkspaceMembersPage from "@/pages/workspace/members";
import WorkspaceModelGrantsPage from "@/pages/workspace/model-grants";
import WorkspaceModelsPage from "@/pages/workspace/models";
import WorkspaceProfilePage from "@/pages/workspace/profile";
import WorkspaceProjectsPage from "@/pages/workspace/projects";
import WorkspaceRolesPage from "@/pages/workspace/roles";
import WorkspaceSettingsPage from "@/pages/workspace/settings";
import WorkspaceUsagePage from "@/pages/workspace/usage";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "/forgot-password", element: <ForgotPasswordPage /> },
    { path: "/reset-password", element: <ResetPasswordPage /> },
    { path: "/verify-email", element: <VerifyEmailPage /> },
    { path: "/invite/:token", element: <InvitePage /> },
    {
        path: "/onboarding",
        element: (
            <RequireAuth>
                <OnboardingPage />
            </RequireAuth>
        ),
    },
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/403", element: <ForbiddenPage /> },
        ],
    },
    {
        path: "/w/:wsId",
        element: <WorkspaceLayout />,
        children: [
            { index: true, element: <WorkspaceProjectsPage /> },
            {
                path: "members",
                element: (
                    <RequireWorkspacePermission permission="member.read">
                        <WorkspaceMembersPage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "roles",
                element: (
                    <RequireWorkspacePermission permission="role.read">
                        <WorkspaceRolesPage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "audit",
                element: (
                    <RequireWorkspacePermission permission="audit.read">
                        <WorkspaceAuditPage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "models",
                element: (
                    <RequireWorkspacePermission permission="model.read">
                        <WorkspaceModelsPage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "models/grants",
                element: (
                    <RequireWorkspacePermission permission="model.read">
                        <WorkspaceModelGrantsPage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "usage",
                element: (
                    <RequireWorkspacePermission permission="usage.read">
                        <WorkspaceUsagePage />
                    </RequireWorkspacePermission>
                ),
            },
            {
                path: "settings",
                element: (
                    <RequireWorkspacePermission permission="workspace.settings.manage">
                        <WorkspaceSettingsPage />
                    </RequireWorkspacePermission>
                ),
            },
            { path: "settings/profile", element: <WorkspaceProfilePage /> },
            { path: "canvas/:id", element: <CanvasProjectPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
