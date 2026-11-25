import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Dropdown, Tooltip } from "antd";
import { ChevronDown, Cloud, LogOut, MonitorSmartphone } from "lucide-react";

import { roleLabel } from "@/constant/permissions";
import { useAuthStore } from "@/stores/use-auth-store";

export function AccountEntry() {
    const navigate = useNavigate();
    const status = useAuthStore((state) => state.status);
    const me = useAuthStore((state) => state.me);
    const loadSession = useAuthStore((state) => state.loadSession);
    const logout = useAuthStore((state) => state.logout);

    useEffect(() => {
        if (status === "idle") void loadSession();
    }, [loadSession, status]);

    if (status === "loading" || status === "idle") return null;

    if (status === "guest" || !me) {
        return (
            <div className="flex items-center gap-2">
                <Tooltip title="本地模式：画布与素材只保存在这台设备">
                    <span className="hidden items-center gap-1 rounded-full border border-stone-200 px-2 py-0.5 text-[10px] text-stone-500 sm:inline-flex dark:border-stone-800 dark:text-stone-400">
                        <MonitorSmartphone className="size-3" />
                        本地
                    </span>
                </Tooltip>
                <Link to="/login" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-stone-700 transition hover:bg-black/5 dark:text-stone-200 dark:hover:bg-white/10">
                    登录
                </Link>
                <Link to="/register" className="hidden h-7 items-center rounded-md border border-stone-200 px-2 text-xs text-stone-600 transition hover:bg-stone-50 sm:inline-flex dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900">
                    创建空间
                </Link>
            </div>
        );
    }

    const current = me.workspaces[0];
    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                items: [
                    ...me.workspaces.map((workspace) => ({
                        key: workspace.id,
                        label: (
                            <div className="flex min-w-44 flex-col">
                                <span className="text-sm">{workspace.name}</span>
                                <span className="text-xs text-stone-400">
                                    {roleLabel(workspace.roleKey)} · {workspace.memberCount} 人
                                </span>
                            </div>
                        ),
                        icon: <Cloud className="size-3.5" />,
                    })),
                    { type: "divider" as const },
                    { key: "local", label: "切换回本地模式", icon: <MonitorSmartphone className="size-3.5" /> },
                    { key: "logout", label: "退出登录", icon: <LogOut className="size-3.5" />, danger: true },
                ],
                onClick: async ({ key }) => {
                    if (key === "local") {
                        navigate("/");
                        return;
                    }
                    if (key === "logout") {
                        await logout();
                        navigate("/");
                        return;
                    }
                    navigate(`/w/${key}`);
                },
            }}
        >
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 transition hover:bg-black/5 dark:hover:bg-white/10">
                <span className="grid size-6 place-items-center rounded-full bg-stone-800 text-[10px] font-semibold text-white dark:bg-stone-200 dark:text-stone-900">{me.user.displayName.slice(0, 1) || "U"}</span>
                <span className="hidden max-w-24 truncate text-xs text-stone-700 sm:block dark:text-stone-200">{current?.name || "我的空间"}</span>
                <ChevronDown className="size-3 text-stone-400" />
            </button>
        </Dropdown>
    );
}
