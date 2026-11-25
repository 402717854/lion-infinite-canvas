import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";

import { useThemeStore } from "@/stores/use-theme-store";

const valuePoints = [
    { title: "画布编排与生成在同一张画布", description: "节点编排、生图改图、视频生成、提示词与素材沉淀在一个界面里。" },
    { title: "团队共享一套模型与额度", description: "管理员配好渠道，成员直接选模型，密钥不会下发到浏览器。" },
    { title: "本地模式始终可用", description: "不登录也能完整使用，数据和密钥只留在本机。" },
];

export function BrandMark({ className }: { className: string }) {
    return <img src="/logo.svg" alt="" aria-hidden className={`shrink-0 ${className}`} />;
}

export function AuthBrandPanel() {
    return (
        <aside className="relative hidden w-[46%] max-w-[640px] shrink-0 flex-col overflow-hidden bg-[#1C1917] px-11 py-10 text-[#F5F5F4] lg:flex">
            <div className="pointer-events-none absolute -right-32 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(194,65,12,0.36),transparent_62%)]" />

            <Link to="/" className="relative flex items-center gap-2.5" style={{ color: "#F5F5F4" }}>
                <BrandMark className="size-7" />
                <span className="text-sm font-semibold tracking-tight">Viral AI</span>
                <span className="ml-1 rounded-full border border-[#3A3631] px-2 py-0.5 text-[11px] text-[#B4ACA3]">团队空间</span>
            </Link>

            <h1 className="relative mt-11 max-w-[460px] text-[31px] leading-[1.25] font-semibold tracking-[-0.03em]">
                把灵感铺满
                <br />
                一张会生长的画布
            </h1>
            <p className="relative mt-3 max-w-[430px] text-[13px] leading-[1.7] text-[#B4ACA3]">画布编排、AI 生图与改图、视频生成、提示词与素材沉淀在同一个界面里。团队共享一套模型与额度，密钥留在服务端。</p>

            <ul className="relative mt-auto flex flex-col gap-4 pt-12">
                {valuePoints.map((point) => (
                    <li key={point.title} className="flex gap-3">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#C2410C]/20 text-[#FB923C]">
                            <Check className="size-3" />
                        </span>
                        <div className="min-w-0">
                            <div className="text-[13px] font-medium">{point.title}</div>
                            <div className="mt-0.5 text-[12px] leading-5 text-[#A8A29E]">{point.description}</div>
                        </div>
                    </li>
                ))}
            </ul>
        </aside>
    );
}

export function AuthTheme({ children }: { children: ReactNode }) {
    const dark = useThemeStore((state) => state.theme === "dark");
    const accent = dark ? "#FB923C" : "#C2410C";

    return (
        <ConfigProvider
            theme={{
                token: {
                    colorPrimary: accent,
                    colorInfo: accent,
                    colorLink: accent,
                    colorBorder: dark ? "#3A3631" : "#D6D1C7",
                    colorBgContainer: dark ? "#1F1C19" : "#FFFFFF",
                    colorText: dark ? "#F5F5F4" : "#1C1917",
                    colorTextSecondary: dark ? "#A8A29E" : "#57534E",
                    colorTextPlaceholder: dark ? "#78716C" : "#A8A29E",
                    colorTextLightSolid: dark ? "#14120F" : "#FFFFFF",
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function AuthShell({ children }: { children: ReactNode }) {
    return (
        <AuthTheme>
            <div className="h-dvh overflow-y-auto bg-[#FAF9F7] text-[#1C1917] dark:bg-[#14120F] dark:text-[#F5F5F4]">
                <div className="flex min-h-full">
                    <AuthBrandPanel />

                    <main className="flex min-w-0 flex-1 items-center justify-center px-5 py-10 sm:px-8">
                        <div className="w-full max-w-[356px]">
                            <Link to="/" className="mb-8 flex items-center gap-2 lg:hidden">
                                <BrandMark className="size-6" />
                                <span className="text-sm font-semibold tracking-tight">Viral AI</span>
                            </Link>
                            <div className="rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 dark:border-[#2A2724] dark:bg-[#1F1C19]">{children}</div>
                        </div>
                    </main>
                </div>
            </div>
        </AuthTheme>
    );
}
