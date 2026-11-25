import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Form, Input, type FormRule } from "antd";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { ApiError, apiErrorMessage } from "@/services/api/client";
import { useAuthStore } from "@/stores/use-auth-store";

type LoginValues = { email: string; password: string; remember: boolean };

const emailRules: FormRule[] = [
    { required: true, message: "请输入邮箱" },
    { type: "email", message: "请输入有效的邮箱地址" },
];

export default function LoginPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [form] = Form.useForm<LoginValues>();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const status = useAuthStore((state) => state.status);
    const expired = useAuthStore((state) => state.expired);
    const nextPath = searchParams.get("next");

    useEffect(() => {
        if (status === "idle") void useAuthStore.getState().loadSession();
    }, [status]);

    useEffect(() => {
        if (status !== "authed" || submitting) return;
        const me = useAuthStore.getState().me;
        if (!me) return;
        const target = nextPath && nextPath.startsWith("/") ? nextPath : me.workspaces[0] ? `/w/${me.workspaces[0].id}` : "/";
        navigate(target, { replace: true });
    }, [status, submitting, nextPath, navigate]);

    const onSubmit = async (values: LoginValues) => {
        setSubmitting(true);
        setError("");
        try {
            const me = await useAuthStore.getState().login(values.email.trim(), values.password, Boolean(values.remember));
            const target = nextPath && nextPath.startsWith("/") ? nextPath : me.workspaces[0] ? `/w/${me.workspaces[0].id}` : "/";
            navigate(target, { replace: true });
        } catch (err) {
            setError(err instanceof ApiError && err.code === "LOCKED" ? "登录失败次数过多，请 15 分钟后再试。" : apiErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthShell>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">登录</h2>
            <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">欢迎回来，继续你的画布。</p>

            {expired ? <Alert className="mt-4" type="info" showIcon message="登录状态已过期，请重新登录。" /> : null}

            <Form form={form} layout="vertical" requiredMark={false} size="large" className="mt-5" initialValues={{ remember: true }} onFinish={onSubmit}>
                <Form.Item name="email" label="邮箱" rules={emailRules}>
                    <Input placeholder="you@example.com" autoComplete="email" />
                </Form.Item>

                <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                    <Input.Password placeholder="请输入密码" autoComplete="current-password" />
                </Form.Item>

                <div className="mb-5 flex items-center justify-between gap-3">
                    <Form.Item name="remember" valuePropName="checked" noStyle>
                        <Checkbox>记住我 30 天</Checkbox>
                    </Form.Item>
                    <Link to="/forgot-password" className="text-[12px] text-[#C2410C] transition hover:opacity-80 dark:text-[#FB923C]">
                        忘记密码？
                    </Link>
                </div>

                {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}

                <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                    登录
                </Button>
            </Form>

            <p className="mt-5 text-center text-[12px] text-[#78716C] dark:text-[#A8A29E]">
                还没有账号？
                <Link to="/register" className="font-medium text-[#C2410C] transition hover:opacity-80 dark:text-[#FB923C]">
                    创建团队空间
                </Link>
            </p>

            <div className="mt-5 border-t border-[#E7E5DF] pt-4 dark:border-[#2A2724]">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[12px] font-medium">只想自己用？</div>
                        <div className="mt-0.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]">不登录也能完整使用，数据只存在本机</div>
                    </div>
                    <Link to="/" className="shrink-0 rounded-md px-2 py-1 text-[12px] whitespace-nowrap text-[#C2410C] transition hover:bg-[#C2410C]/10 dark:text-[#FB923C]">
                        继续用本地模式 →
                    </Link>
                </div>
            </div>

            <p className="mt-4 text-[11px] leading-5 text-[#A8A29E] dark:text-[#78716C]">登录即表示同意《服务条款》与《隐私政策》。团队模式下画布与素材存储在服务端，渠道密钥不会下发到浏览器。</p>
        </AuthShell>
    );
}
