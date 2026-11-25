import { useState } from "react";
import { Alert, Button, Form, Input, type FormRule } from "antd";
import { Link } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { apiErrorMessage } from "@/services/api/client";
import { authApi } from "@/services/api/team";

type ForgotValues = { email: string };

const emailRules: FormRule[] = [
    { required: true, message: "请输入邮箱" },
    { type: "email", message: "请输入有效的邮箱地址" },
];

export default function ForgotPasswordPage() {
    const [form] = Form.useForm<ForgotValues>();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [sent, setSent] = useState<{ resetToken?: string } | null>(null);

    const onSubmit = async (values: ForgotValues) => {
        setSubmitting(true);
        setError("");
        try {
            const result = await authApi.forgotPassword(values.email.trim());
            setSent({ resetToken: result.resetToken });
        } catch (err) {
            setSent(null);
            setError(apiErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthShell>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">重置密码</h2>
            <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">填写注册邮箱，我们会把重置链接发送给你。</p>

            {sent ? (
                <>
                    <Alert className="mt-4" type="success" showIcon message="如果该邮箱存在，我们已发送重置邮件" description="链接 30 分钟内有效。没收到？可以稍后重新发送。" />
                    {sent.resetToken ? (
                        <Alert
                            className="mt-3"
                            type="warning"
                            showIcon
                            message="开发模式：未配置邮件服务"
                            description={
                                <Link to={`/reset-password?token=${encodeURIComponent(sent.resetToken)}`} className="break-all text-[#C2410C] underline underline-offset-2 dark:text-[#FB923C]">
                                    打开重置密码页面
                                </Link>
                            }
                        />
                    ) : null}
                    <div className="mt-5 flex flex-col gap-2">
                        <Button type="primary" size="large" block loading={submitting} onClick={() => void onSubmit({ email: form.getFieldValue("email") || "" })}>
                            重新发送
                        </Button>
                        <Link to="/login" className="text-center text-[12px] text-[#C2410C] dark:text-[#FB923C]">
                            返回登录
                        </Link>
                    </div>
                </>
            ) : (
                <>
                    <Form form={form} layout="vertical" requiredMark={false} size="large" className="mt-5" onFinish={onSubmit}>
                        <Form.Item name="email" label="邮箱" rules={emailRules}>
                            <Input placeholder="you@example.com" autoComplete="email" />
                        </Form.Item>

                        {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}

                        <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                            发送重置邮件
                        </Button>
                    </Form>

                    <p className="mt-5 text-center text-[12px] text-[#78716C] dark:text-[#A8A29E]">
                        想起密码了？
                        <Link to="/login" className="font-medium text-[#C2410C] transition hover:opacity-80 dark:text-[#FB923C]">
                            返回登录
                        </Link>
                    </p>
                </>
            )}
        </AuthShell>
    );
}
