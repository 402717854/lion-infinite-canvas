import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Dropdown, Spin } from "antd";
import { ChevronDown, FolderKanban, LogOut, Plus, ScrollText, Settings2, ShieldCheck, UserRound, Users } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { roleLabel } from "@/constant/permissions";
import { useWorkspaceAccess } from "@/hooks/use-workspace-access";
import { useWorkspaceProjects } from "@/hooks/use-workspace-projects";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";
import { useThemeStore } from "@/stores/use-theme-store";

const NAV_ITEMS = [
    { key: "projects", label: "项目", to: "", icon: FolderKanban, permission: "project.read" },
    { key: "members", label: "成员", to: "members", icon: Users, permission: "member.read" },
    { key: "roles", label: "角色", to: "roles", icon: ShieldCheck, permission: "role.read" },
    { key: "audit", label: "审计", to: "audit", icon: ScrollText, permission: "audit.read" },
    { key: "settings", label: "设置", to: "settings", icon: Settings2, permission: "workspace.settings.manage" },
];

function workspacePath(workspaceId: string, suffix = "") {
    return `/w/${workspaceId}${suffix ? `/${suffix}` : ""}`;
}

export default function WorkspaceLayout() {
    const { wsId = "" } = useParams<{ wsId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const status = useAuthStore((state) => state.status);
    const me = useAuthStore((state) => state.me);
    const loadSession = useAuthStore((state) => state.loadSession);
    const logout = useAuthStore((state) => state.logout);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const { workspace, can } = useWorkspaceAccess(wsId);
    const [switcherOpen, setSwitcherOpen] = useState(false);
    useWorkspaceProjects(wsId, true);

    useEffect(() => {
        if (status === "idle") void loadSession();
    }, [loadSession, status]);

    const activeKey = useMemo(() => {
        const segment = location.pathname.split("/")[3] || "";
        return segment || "projects";
    }, [location.pathname]);

    if (status === "idle" || status === "loading") {
        return (
            <div className="grid h-dvh place-items-center bg-[#FAF9F7] text-[#57534E] dark:bg-[#14120F] dark:text-[#A8A29E]">
                <Spin />
            </div>
        );
    }

    if (status === "guest") {
        const next = encodeURIComponent(`${location.pathname}${location.search}`);
        return <Navigate to={`/login?next=${next}`} replace />;
    }

    if (!workspace) {
        return (
            <div className="grid h-dvh place-items-center bg-[#FAF9F7] px-6 dark:bg-[#14120F]">
                <div className="w-full max-w-md rounded-2xl border border-[#E7E5DF] bg-white p-8 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                    <div className="text-base font-semibold text-[#1C1917] dark:text-[#F5F5F4]">空间不存在或无权访问</div>
                    <p className="mt-2 text-sm text-[#78716C] dark:text-[#A8A29E]">你可能已不是该空间成员，或邀请尚未生效。</p>
                    <div className="mt-6 flex justify-center gap-2">
                        <Link to="/" className="rounded-lg border border-[#E7E5DF] px-4 py-2 text-sm text-[#1C1917] hover:bg-[#F3F1EC] dark:border-[#3A3631] dark:text-[#F5F5F4] dark:hover:bg-[#292524]">
                            返回本地画布
                        </Link>
                        {me?.workspaces[0] ? (
                            <Link to={workspacePath(me.workspaces[0].id)} className="rounded-lg bg-[#1C1917] px-4 py-2 text-sm text-white hover:bg-black dark:bg-[#FAF9F7] dark:text-[#1C1917]">
                                进入我的空间
                            </Link>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    const visibleNav = NAV_ITEMS.filter((item) => can(item.permission));
    const title = visibleNav.find((item) => item.key === activeKey)?.label || "";

    // 画布占满整屏，沿用画布自己的顶栏；这里仍保留同步与鉴权。
    if (/\/canvas\/[^/]+$/.test(location.pathname)) {
        return (
            <div className="h-dvh overflow-hidden">
                <Outlet />
            </div>
        );
    }
    const spaceDropdown = {
        items: [
            ...(me?.workspaces || []).map((item) => ({
                key: item.id,
                label: (
                    <div className="flex min-w-44 flex-col">
                        <span className="text-sm text-[#1C1917] dark:text-[#F5F5F4]">{item.name}</span>
                        <span className="text-xs text-[#A8A29E]">
                            {roleLabel(item.roleKey)} · {item.memberCount} 人
                        </span>
                    </div>
                ),
            })),
            { type: "divider" as const },
            { key: "local", label: <span className="text-sm">本地空间（无需登录）</span> },
            { key: "create", label: <span className="text-sm">新建空间</span>, icon: <Plus className="size-3.5" /> },
        ],
        onClick: ({ key }: { key: string }) => {
            setSwitcherOpen(false);
            if (key === "local") navigate("/");
            else if (key === "create") navigate("/onboarding");
            else navigate(workspacePath(key));
        },
    };

    const userMenu = {
        items: [
            { key: "profile", label: "个人资料与安全", icon: <UserRound className="size-3.5" /> },
            ...(me?.workspaces || []).length > 1 ? [{ type: "divider" as const }] : [],
            ...(me?.workspaces || []).map((item) => ({ key: item.id, label: `切换到 ${item.name}` })),
            { type: "divider" as const },
            { key: "logout", label: "退出登录", icon: <LogOut className="size-3.5" />, danger: true },
        ],
        onClick: async ({ key }: { key: string }) => {
            if (key === "logout") {
                await logout();
                navigate("/login");
                return;
            }
            if (key === "profile") {
                navigate(workspacePath(workspace.id, "settings/profile"));
                return;
            }
            navigate(workspacePath(key));
        },
    };

    return (
        <div className="flex h-dvh overflow-hidden bg-[#FAF9F7] text-[#1C1917] dark:bg-[#14120F] dark:text-[#F5F5F4]">
            <aside className="flex w-52 shrink-0 flex-col border-r border-[#E7E5DF] bg-[#FAF9F7] dark:border-[#2A2724] dark:bg-[#14120F]">
                <Dropdown menu={spaceDropdown} trigger={["click"]} open={switcherOpen} onOpenChange={setSwitcherOpen} placement="bottomLeft">
                    <button type="button" className="flex items-center gap-2 border-b border-[#E7E5DF] px-3 py-3 text-left transition hover:bg-[#F3F1EC] dark:border-[#2A2724] dark:hover:bg-[#1C1917]">
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#1C1917] text-[11px] font-semibold text-[#FAF9F7] dark:bg-[#FAF9F7] dark:text-[#1C1917]">
                            {workspace.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{workspace.name}</span>
                            <span className="block truncate text-[10px] text-[#A8A29E]">
                                团队空间 · {workspace.memberCount} 人
                            </span>
                        </span>
                        <ChevronDown className="size-3.5 shrink-0 text-[#A8A29E]" />
                    </button>
                </Dropdown>

                <nav className="flex-1 overflow-y-auto p-2">
                    {visibleNav.map((item) => (
                        <NavLink
                            key={item.key}
                            to={workspacePath(workspace.id, item.to)}
                            end={!item.to}
                            className={({ isActive }) =>
                                cn(
                                    "flex h-8 items-center gap-2 rounded-md px-2 text-xs text-[#57534E] transition hover:bg-[#F3F1EC] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#1C1917] dark:hover:text-[#F5F5F4]",
                                    isActive && "bg-[#E7E5DF] font-semibold text-[#1C1917] dark:bg-[#292524] dark:text-[#F5F5F4]",
                                )
                            }
                        >
                            <item.icon className="size-3.5 opacity-70" />
                            {item.label}
                        </NavLink>
                    ))}
                    <div className="my-2 h-px bg-[#E7E5DF] dark:bg-[#2A2724]" />
                    <Link to="/" className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-[#57534E] transition hover:bg-[#F3F1EC] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#1C1917] dark:hover:text-[#F5F5F4]">
                        <FolderKanban className="size-3.5 opacity-70" />
                        本地空间
                    </Link>
                </nav>

                <div className="border-t border-[#E7E5DF] px-3 py-3 dark:border-[#2A2724]">
                    <Dropdown menu={userMenu} trigger={["click"]} placement="topLeft">
                        <button type="button" className="flex w-full items-center gap-2 text-left">
                            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#E7E5DF] text-[11px] font-semibold text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
                                {me?.user.displayName?.slice(0, 1) || "U"}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold">{me?.user.displayName}</span>
                                <span className="block truncate text-[10px] text-[#A8A29E]">{roleLabel(workspace.roleKey)}</span>
                            </span>
                            <ChevronDown className="size-3.5 shrink-0 text-[#A8A29E]" />
                        </button>
                    </Dropdown>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <header className="flex h-12 shrink-0 items-center gap-3 px-6">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-[#A8A29E]">
                        <Link to={workspacePath(workspace.id)} className="truncate transition hover:text-[#1C1917] dark:hover:text-[#F5F5F4]" style={{ color: "inherit" }}>
                            {workspace.name}
                        </Link>
                        {title ? (
                            <>
                                <span className="opacity-50">/</span>
                                <span className="truncate font-medium text-[#1C1917] dark:text-[#F5F5F4]">{title}</span>
                            </>
                        ) : null}
                    </div>
                    <div className="flex-1" />
                    {me && !me.user.emailVerified ? (
                        <Link to="/verify-email" className="rounded-full bg-[#FDF3E3] px-2 py-0.5 text-[10px] text-[#B45309]">
                            邮箱未验证
                        </Link>
                    ) : null}
                    <AnimatedThemeToggler
                        theme={theme}
                        onThemeChange={setTheme}
                        aria-label={theme === "dark" ? "切换到浅色" : "切换到深色"}
                        title={theme === "dark" ? "切换到浅色" : "切换到深色"}
                        className="grid size-7 place-items-center rounded-md text-[#57534E] transition hover:bg-black/5 dark:text-[#A8A29E] dark:hover:bg-white/10"
                    />
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
