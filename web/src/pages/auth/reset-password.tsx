import { useState } from "react";
import { Alert, App, Button, Form, Input, Result, type FormRule } from "antd";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "@/components/auth/auth-shell";
import { apiErrorMessage } from "@/services/api/client";
import { authApi } from "@/services/api/team";
import { useAuthStore } from "@/stores/use-auth-store";

type ResetValues = { password: string; confirm: string };

const passwordRules: FormRule[] = [
    { required: true, message: "请输入新密码" },
    { min: 10, message: "密码至少 10 位" },
    { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: "密码需同时包含字母与数字" },
];

export default function ResetPasswordPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [form] = Form.useForm<ResetValues>();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const token = searchParams.get("token") || "";

    const onSubmit = async (values: ResetValues) => {
        setSubmitting(true);
        setError("");
        try {
            await authApi.resetPassword(token, values.password);
            useAuthStore.setState({ me: null, status: "guest", expired: false });
            message.success("密码已重置，请用新密码登录");
            navigate("/login", { replace: true });
        } catch (err) {
            setError(apiErrorMessage(err));
            setSubmitting(false);
        }
    };

    if (!token) {
        return (
            <AuthShell>
                <Result
                    status="warning"
                    title="重置链接无效"
                    subTitle="链接缺少令牌，可能已被截断。请重新申请一封重置邮件。"
                    extra={
                        <Button type="primary" onClick={() => navigate("/forgot-password")}>
                            重新申请
                        </Button>
                    }
                />
            </AuthShell>
        );
    }

    return (
        <AuthShell>
            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">设置新密码</h2>
            <p className="mt-1.5 text-[12px] text-[#78716C] dark:text-[#A8A29E]">设置完成后，其他设备上的登录会被退出。</p>

            <Form form={form} layout="vertical" requiredMark={false} size="large" className="mt-5" onFinish={onSubmit}>
                <Form.Item name="password" label="新密码" rules={passwordRules} extra={<span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">至少 10 位，需同时包含字母与数字。</span>}>
                    <Input.Password placeholder="请输入新密码" autoComplete="new-password" />
                </Form.Item>

                <Form.Item
                    name="confirm"
                    label="确认新密码"
                    dependencies={["password"]}
                    rules={[
                        { required: true, message: "请再次输入新密码" },
                        ({ getFieldValue }) => ({
                            validator: (_, value: string) => (!value || value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致"))),
                        }),
                    ]}
                >
                    <Input.Password placeholder="再次输入新密码" autoComplete="new-password" />
                </Form.Item>

                {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}

                <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                    重置密码
                </Button>
            </Form>

            <p className="mt-5 text-center text-[12px] text-[#78716C] dark:text-[#A8A29E]">
                <Link to="/login" className="font-medium text-[#C2410C] transition hover:opacity-80 dark:text-[#FB923C]">
                    返回登录
                </Link>
            </p>
        </AuthShell>
    );
}
