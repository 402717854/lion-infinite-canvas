import { useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, Result, Spin, Steps, type FormRule } from "antd";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { AuthTheme, BrandMark } from "@/components/auth/auth-shell";
import { apiErrorMessage } from "@/services/api/client";
import { workspaceApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type NameValues = { name: string };

const steps = [
    { title: "命名空间", content: "空间名会展示给所有成员" },
    { title: "选择模型", content: "决定成员可以调用什么" },
    { title: "迁移本地数据", content: "复制到空间，本地保留" },
];

const nameRules: FormRule[] = [
    { required: true, message: "请输入空间名称" },
    { max: 40, message: "空间名称最多 40 个字符" },
];

export default function OnboardingPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const [searchParams] = useSearchParams();
    const [form] = Form.useForm<NameValues>();
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const status = useAuthStore((state) => state.status);
    const me = useAuthStore((state) => state.me);
    const loadSession = useAuthStore((state) => state.loadSession);

    const workspaceId = searchParams.get("ws") || me?.workspaces[0]?.id || "";
    const workspace = me?.workspaces.find((item) => item.id === workspaceId);

    useEffect(() => {
        if (status === "idle") void loadSession();
    }, [status, loadSession]);

    if (status === "idle" || status === "loading") {
        return (
            <div className="flex h-dvh items-center justify-center bg-[#FAF9F7] dark:bg-[#14120F]">
                <Spin />
            </div>
        );
    }

    if (status !== "authed" || !me) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;

    if (!workspace) {
        return (
            <AuthTheme>
                <div className="flex h-dvh items-center justify-center bg-[#FAF9F7] px-5 text-[#1C1917] dark:bg-[#14120F] dark:text-[#F5F5F4]">
                    <Result status="warning" title="找不到这个空间" subTitle="空间可能已被删除，或你没有访问权限。" extra={<Button onClick={() => navigate("/", { replace: true })}>返回首页</Button>} />
                </div>
            </AuthTheme>
        );
    }

    const gotoWorkspace = (suffix = "") => navigate(`/w/${workspace.id}${suffix}`);

    const saveName = async (values: NameValues) => {
        if (saving) return;
        setSaving(true);
        setError("");
        try {
            await workspaceApi.update(workspace.id, { name: values.name.trim() });
            const store = useAuthStore.getState();
            await store.refreshSession().catch(() => undefined);
            message.success("空间名称已更新");
            setStep(1);
        } catch (err) {
            setError(apiErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AuthTheme>
            <div className="h-dvh overflow-y-auto bg-[#FAF9F7] text-[#1C1917] dark:bg-[#14120F] dark:text-[#F5F5F4]">
                <div className="flex min-h-full">
                    <aside className="hidden w-[300px] shrink-0 flex-col gap-6 border-r border-[#E7E5DF] px-6 py-8 lg:flex dark:border-[#2A2724]">
                        <div className="flex items-center gap-2">
                            <BrandMark className="size-6" />
                            <span className="text-[13px] font-semibold tracking-tight">设置你的空间</span>
                        </div>
                        <Steps orientation="vertical" current={step} items={steps} />
                        <div className="mt-auto text-[11px] leading-5 text-[#A8A29E] dark:text-[#78716C]">所有步骤都可以稍后在「空间设置」里补做，不会阻塞使用。</div>
                    </aside>

                    <main className="flex min-w-0 flex-1 items-center justify-center px-5 py-10 sm:px-8">
                        <div className="w-full max-w-[560px]">
                            <div className="mb-6 flex items-center gap-2 lg:hidden">
                                <BrandMark className="size-5" />
                                <span className="text-[12px] font-medium">设置你的空间 · 第 {step + 1} / 3 步</span>
                            </div>

                            <div className="rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 dark:border-[#2A2724] dark:bg-[#1F1C19]">
                                {step === 0 ? (
                                    <>
                                        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">空间叫什么名字？</h2>
                                        <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">空间名会展示给被邀请的成员，也会出现在项目与素材的归属里。</p>
                                        <Form form={form} layout="vertical" requiredMark={false} size="large" className="mt-5" initialValues={{ name: workspace.name }} onFinish={saveName}>
                                            <Form.Item name="name" label="空间名称" rules={nameRules}>
                                                <Input placeholder="例如 设计组" maxLength={40} />
                                            </Form.Item>
                                            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
                                            <div className="flex items-center justify-between gap-3">
                                                <Button type="text" onClick={() => setStep(1)}>
                                                    跳过
                                                </Button>
                                                <Button type="primary" htmlType="submit" loading={saving}>
                                                    保存并继续
                                                </Button>
                                            </div>
                                        </Form>
                                    </>
                                ) : null}

                                {step === 1 ? (
                                    <>
                                        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">成员可以用哪些模型？</h2>
                                        <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">模型管理将在下一迭代提供，本期先跳过；成员可以继续使用自己的本地渠道。</p>
                                        <Alert className="mt-5" type="info" showIcon message="模型管理将在下一迭代提供" description="之后可以在「模型管理 → 授权与配额」里按角色配置可用模型与额度，这里暂时无需设置。" />
                                        <div className="mt-6 flex items-center justify-between gap-3">
                                            <Button type="text" onClick={() => setStep(0)}>
                                                上一步
                                            </Button>
                                            <div className="flex gap-2">
                                                <Button onClick={() => setStep(2)}>跳过</Button>
                                                <Button type="primary" onClick={() => setStep(2)}>
                                                    下一步
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : null}

                                {step === 2 ? (
                                    <>
                                        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">要现在迁移本地数据吗？</h2>
                                        <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">把本机浏览器里的项目复制到空间，换设备也能继续编辑。</p>
                                        <Alert className="mt-5" type="info" showIcon message="迁移是复制，不是移动" description="本地项目和素材不会被删除，之后也可以再次迁移；渠道密钥不会上传。" />
                                        <div className="mt-6 flex items-center justify-between gap-3">
                                            <Button type="text" onClick={() => setStep(1)}>
                                                上一步
                                            </Button>
                                            <div className="flex gap-2">
                                                <Button onClick={() => gotoWorkspace()}>稍后再说</Button>
                                                <Button type="primary" onClick={() => gotoWorkspace("?migrate=1")}>
                                                    开始迁移
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        </AuthTheme>
    );
}
