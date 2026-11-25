import { useState } from "react";
import { Alert, App, Button, Checkbox, Form, Input, type FormRule } from "antd";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { apiErrorMessage } from "@/services/api/client";
import { authApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type RegisterValues = { displayName?: string; email: string; password: string; inviteToken?: string; terms: boolean };

const passwordRules: FormRule[] = [
    { required: true, message: "请输入密码" },
    { min: 10, message: "密码至少 10 位" },
    { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: "密码需同时包含字母与数字" },
];

const emailRules: FormRule[] = [
    { required: true, message: "请输入邮箱" },
    { type: "email", message: "请输入有效的邮箱地址" },
];

export default function RegisterPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [form] = Form.useForm<RegisterValues>();
    const [submitting, setSubmitting] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState("");
    const [phase, setPhase] = useState<"form" | "pending" | "dev">("form");
    const [verificationToken, setVerificationToken] = useState("");
    const [onboardingPath, setOnboardingPath] = useState("/");
    const password = Form.useWatch("password", form) || "";

    const passwordChecks = [
        { label: "长度 ≥ 10", ok: password.length >= 10 },
        { label: "含字母", ok: /[A-Za-z]/.test(password) },
        { label: "含数字", ok: /\d/.test(password) },
        { label: "含额外字符", ok: /[^A-Za-z0-9]/.test(password) },
    ];
    const score = passwordChecks.filter((check) => check.ok).length;
    const strengthLabel = score >= 4 ? "很强" : score === 3 ? "较强" : score === 2 ? "中等" : "偏弱";

    const onSubmit = async (values: RegisterValues) => {
        setSubmitting(true);
        setError("");
        try {
            const result = await useAuthStore.getState().register({
                email: values.email.trim(),
                password: values.password,
                displayName: values.displayName?.trim() || undefined,
                inviteToken: values.inviteToken?.trim() || undefined,
            });
            if (result.pending) {
                setPhase("pending");
                return;
            }
            const workspaceId = result.workspaces?.[0]?.id;
            const nextPath = workspaceId ? `/onboarding?ws=${workspaceId}` : "/";
            if (result.verificationToken) {
                setVerificationToken(result.verificationToken);
                setOnboardingPath(nextPath);
                setPhase("dev");
                return;
            }
            navigate(nextPath, { replace: true });
        } catch (err) {
            setError(apiErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    const verifyNow = async () => {
        setVerifying(true);
        try {
            await authApi.verifyEmail(verificationToken);
            const store = useAuthStore.getState();
            if (store.status === "authed") await store.refreshSession().catch(() => undefined);
            message.success("邮箱已验证");
            navigate(onboardingPath, { replace: true });
        } catch (err) {
            message.error(apiErrorMessage(err));
            setVerifying(false);
        }
    };

    if (phase === "pending") {
        return (
            <AuthShell>
                <h2 className="text-[21px] font-semibold tracking-[-0.02em]">查收验证邮件</h2>
                <Alert className="mt-4" type="success" showIcon message="如果该邮箱可用，我们已发送验证邮件" description="请点击邮件中的链接完成验证。已有账号也可以直接登录。" />
                <div className="mt-5 flex flex-col gap-2">
                    <Button type="primary" size="large" block onClick={() => navigate("/login", { replace: true })}>
                        去登录
                    </Button>
                    <Button size="large" block onClick={() => setPhase("form")}>
                        换个邮箱重试
                    </Button>
                </div>
                <p className="mt-5 text-center text-[11px] text-[#A8A29E] dark:text-[#78716C]">
                    未验证的账号仍可使用本地模式，
                    <Link to="/" className="text-[#C2410C] dark:text-[#FB923C]">
                        继续用本地模式 →
                    </Link>
                </p>
            </AuthShell>
        );
    }

    if (phase === "dev") {
        return (
            <AuthShell>
                <h2 className="text-[21px] font-semibold tracking-[-0.02em]">账号已创建</h2>
                <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">还差一步：验证邮箱后即可使用团队功能。</p>
                <Alert className="mt-4" type="warning" showIcon message="开发提示：当前环境未配置邮件服务" description={<span className="break-all">验证邮件未真正发出，可直接用下方按钮完成验证。令牌：{verificationToken}</span>} />
                <div className="mt-5 flex flex-col gap-2">
                    <Button type="primary" size="large" block loading={verifying} onClick={verifyNow}>
                        立即验证邮箱
                    </Button>
                    <Button size="large" block onClick={() => navigate(onboardingPath, { replace: true })}>
                        稍后验证，先设置空间
                    </Button>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">创建账号</h2>
            <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">20 秒完成。注册后可以把本机项目搬到云端。</p>

            <Form form={form} layout="vertical" requiredMark={false} size="large" className="mt-5" initialValues={{ inviteToken: searchParams.get("invite") || "" }} onFinish={onSubmit}>
                <Form.Item name="displayName" label="昵称" rules={[{ max: 32, message: "昵称最多 32 个字符" }]}>
                    <Input placeholder="团队里显示的名字" autoComplete="nickname" />
                </Form.Item>

                <Form.Item name="email" label="邮箱" rules={emailRules}>
                    <Input placeholder="you@example.com" autoComplete="email" />
                </Form.Item>

                <Form.Item
                    name="password"
                    label="密码"
                    rules={passwordRules}
                    extra={
                        <div>
                            <div className="flex gap-1">
                                {passwordChecks.map((check) => (
                                    <span key={check.label} title={check.label} className={`h-[3px] flex-1 rounded-full ${check.ok ? "bg-[#C2410C] dark:bg-[#FB923C]" : "bg-[#E7E5DF] dark:bg-[#2A2724]"}`} />
                                ))}
                            </div>
                            <div className="mt-1.5 text-[11px] text-[#A8A29E] dark:text-[#78716C]">至少 10 位，需同时包含字母与数字{password ? ` · 当前强度：${strengthLabel}` : ""}</div>
                        </div>
                    }
                >
                    <Input.Password placeholder="至少 10 位，含字母与数字" autoComplete="new-password" />
                </Form.Item>

                <Form.Item name="inviteToken" label="邀请码（可选）" extra={<span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">来自空间邀请链接，填写后注册即加入该空间。</span>}>
                    <Input placeholder="例如 DSGN-8F2K" autoComplete="off" />
                </Form.Item>

                <Form.Item name="terms" valuePropName="checked" rules={[{ validator: (_, value: boolean) => (value ? Promise.resolve() : Promise.reject(new Error("请先阅读并同意服务条款与隐私政策"))) }]}>
                    <Checkbox>
                        <span className="text-[12px] leading-5 text-[#57534E] dark:text-[#A8A29E]">我已阅读并同意《服务条款》《隐私政策》，并了解生成内容需自行承担合规责任。</span>
                    </Checkbox>
                </Form.Item>

                {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}

                <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                    创建账号并进入空间
                </Button>
            </Form>

            <p className="mt-5 text-center text-[12px] text-[#78716C] dark:text-[#A8A29E]">
                已有账号？
                <Link to="/login" className="font-medium text-[#C2410C] transition hover:opacity-80 dark:text-[#FB923C]">
                    直接登录
                </Link>
            </p>

            <p className="mt-4 border-t border-[#E7E5DF] pt-4 text-[11px] leading-5 text-[#A8A29E] dark:border-[#2A2724] dark:text-[#78716C]">
                注册后邮箱需验证；未验证的账号仍可使用本地模式，
                <Link to="/" className="text-[#C2410C] dark:text-[#FB923C]">
                    继续用本地模式 →
                </Link>
            </p>
        </AuthShell>
    );
}
