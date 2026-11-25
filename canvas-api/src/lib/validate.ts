import { z } from 'zod';
import { AppError } from './http.js';

export const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确').max(254);
export const displayNameSchema = z.string().trim().min(1).max(40);

const WEAK_PASSWORDS = new Set([
    'password123',
    '1234567890',
    'qwerty12345',
    'password1234',
    'admin12345',
    '12345678a',
    'abcd123456',
    'aaaa111111',
]);

export const passwordSchema = z
    .string()
    .min(10, '密码至少 10 位')
    .max(128, '密码过长')
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), '密码需同时包含字母与数字')
    .refine((v) => !WEAK_PASSWORDS.has(v.toLowerCase()), '密码过于常见');

export function assertPassword(password: string): void {
    const result = passwordSchema.safeParse(password);
    if (!result.success) throw new AppError(400, 'INVALID_PARAM', result.error.issues[0].message);
}

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, '请输入密码').max(128),
    remember: z.boolean().optional(),
});

export const registerSchema = z.object({
    email: emailSchema,
    password: z.string().max(128),
    displayName: displayNameSchema.optional(),
    inviteToken: z.string().min(8).max(200).optional(),
});

export const workspaceNameSchema = z.string().trim().min(1, '空间名不能为空').max(60);

export const docSchema = z.object({
    nodes: z.array(z.unknown()).default([]),
    connections: z.array(z.unknown()).default([]),
    chatSessions: z.array(z.unknown()).default([]),
    activeChatId: z.string().nullable().optional(),
    backgroundMode: z.string().optional(),
    showImageInfo: z.boolean().optional(),
    viewport: z.record(z.unknown()).optional(),
});
