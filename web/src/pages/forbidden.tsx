import { Link } from "react-router-dom";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { useAuthStore } from "@/stores/use-auth-store";

export default function ForbiddenPage() {
    const workspaceId = useAuthStore.getState().me?.workspaces[0]?.id;

    return (
        <div className="grid min-h-[calc(100dvh-3rem)] place-items-center bg-[#FAF9F7] px-6 py-16 text-[#1C1917] dark:bg-[#14120F] dark:text-[#F5F5F4]">
            <div className="w-full max-w-md rounded-2xl border border-[#E7E5DF] bg-white p-8 text-center dark:border-[#2A2724] dark:bg-[#1F1C19]">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-[#F3F1EC] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                    <ShieldAlert className="size-5" />
                </div>
                <div className="mt-4 font-mono text-[11px] tracking-[0.2em] text-[#A8A29E]">403 FORBIDDEN</div>
                <h1 className="mt-1 text-lg font-semibold tracking-tight">你没有访问该页面的权限</h1>
                <p className="mt-2 text-xs leading-6 text-[#78716C] dark:text-[#A8A29E]">
                    当前空间没有为你分配所需权限，可能需要空间所有者或管理员调整你的角色。你也可以返回空间首页或继续使用本地画布。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {workspaceId ? (
                        <Link
                            to={`/w/${workspaceId}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#C2410C] px-4 text-xs font-medium text-white transition hover:bg-[#9A3412] dark:bg-[#FB923C] dark:text-[#14120F] dark:hover:bg-[#FDBA74]"
                        >
                            返回空间首页
                        </Link>
                    ) : null}
                    <Link
                        to="/"
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E7E5DF] px-4 text-xs text-[#1C1917] transition hover:bg-[#F3F1EC] dark:border-[#3A3631] dark:text-[#F5F5F4] dark:hover:bg-[#292524]"
                    >
                        <ArrowLeft className="size-3.5" />
                        返回本地画布
                    </Link>
                </div>
            </div>
        </div>
    );
}
