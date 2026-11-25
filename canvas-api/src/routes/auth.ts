import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import {
    clearAuthCookies,
    createSession,
    hashToken,
    newToken,
    requireAuth,
    revokeSession,
} from '../auth/session.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok, parse } from '../lib/http.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/mailer.js';
import { assertPassword, loginSchema, registerSchema } from '../lib/validate.js';
import { ROLE_DEFAULTS, roleMeta } from '../permissions.js';
import type { UserRow, WorkspaceRow } from '../types.js';

export const authRouter = Router();

const VERIFY_TTL = 24 * 60 * 60 * 1000;
const RESET_TTL = 30 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 单实例内存限流：resend-verification 3 次/小时。 */
const resendHits = new Map<string, number[]>();

function checkResendLimit(userId: string): boolean {
    const now = Date.now();
    const hits = (resendHits.get(userId) ?? []).filter((t) => now - t < HOUR);
    if (hits.length >= 3) {
        resendHits.set(userId, hits);
        return false;
    }
    hits.push(now);
    resendHits.set(userId, hits);
    return true;
}

function userPayload(user: UserRow) {
    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified_at !== null,
    };
}

interface WorkspaceListItem {
    id: string;
    name: string;
    slug: string;
    roleKey: string;
    roleName: string;
    permissions: string[];
    memberCount: number;
    ownerId: string;
    createdAt: Date;
}

async function workspacesForUser(userId: string): Promise<WorkspaceListItem[]> {
    const rows = await query<
        WorkspaceRow & { role_key: string; count: string; override_permissions: string[] | null }
    >(
        `SELECT w.*, m.role_key,
                (SELECT count(*)::text FROM workspace_members x WHERE x.workspace_id = w.id AND x.status = 'active') AS count,
                (SELECT r.permissions FROM workspace_roles r WHERE r.workspace_id = w.id AND r.key = m.role_key) AS override_permissions
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = $1 AND m.status = 'active' AND w.deleted_at IS NULL
         ORDER BY m.joined_at ASC`,
        [userId],
    );
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        roleKey: row.role_key,
        roleName: roleMeta(row.role_key)?.name ?? row.role_key,
        permissions: row.override_permissions ?? ROLE_DEFAULTS[row.role_key] ?? [],
        memberCount: Number(row.count),
        ownerId: row.owner_id,
        createdAt: row.created_at,
    }));
}

async function mePayload(user: UserRow) {
    return { user: userPayload(user), workspaces: await workspacesForUser(user.id) };
}

export async function issueEmailToken(userId: string, kind: 'verify' | 'reset', ttlMs: number): Promise<string> {
    const token = newToken();
    await query('INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || \' milliseconds\')::interval)', [
        nanoid(),
        userId,
        kind,
        hashToken(token),
        ttlMs,
    ]);
    return token;
}

function slugify(name: string): string {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    return `${base || 'workspace'}-${nanoid(6).toLowerCase()}`;
}

async function activateInvitation(userId: string, userEmail: string, rawToken: string): Promise<string | null> {
    const invite = await one<{
        id: string;
        workspace_id: string;
        email: string | null;
        role_key: string;
        status: string;
        expires_at: Date;
        max_uses: number;
        used_count: number;
    }>('SELECT * FROM invitations WHERE token_hash = $1', [hashToken(rawToken)]);
    if (!invite) return null;
    if (invite.status !== 'pending' || invite.expires_at.getTime() <= Date.now() || invite.used_count >= invite.max_uses) return null;
    if (invite.email && invite.email !== userEmail) return null;
    const ws = await one<{ id: string }>('SELECT id FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [invite.workspace_id]);
    if (!ws) return null;
    await tx(async (client) => {
        await client.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role_key, status, invited_by)
             VALUES ($1,$2,$3,'active',(SELECT created_by FROM invitations WHERE id = $4))
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [invite.workspace_id, userId, invite.role_key, invite.id],
        );
        await client.query('UPDATE invitations SET used_count = used_count + 1 WHERE id = $1', [invite.id]);
        await client.query(
            `UPDATE invitations SET status = CASE
                 WHEN used_count >= max_uses OR email IS NOT NULL THEN 'accepted'
                 ELSE status END
             WHERE id = $1`,
            [invite.id],
        );
    });
    return invite.workspace_id;
}

async function inviteValid(rawToken: string): Promise<boolean> {
    const invite = await one<{ status: string; expires_at: Date; max_uses: number; used_count: number; workspace_id: string }>(
        'SELECT status, expires_at, max_uses, used_count, workspace_id FROM invitations WHERE token_hash = $1',
        [hashToken(rawToken)],
    );
    if (!invite) return false;
    if (invite.status !== 'pending' || invite.expires_at.getTime() <= Date.now() || invite.used_count >= invite.max_uses) return false;
    const ws = await one('SELECT id FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [invite.workspace_id]);
    return Boolean(ws);
}

authRouter.post('/register', async (req, res) => {
    const body = parse(registerSchema, req.body);
    assertPassword(body.password);

    if (config.registrationMode === 'closed') throw fail(403, 'REGISTRATION_CLOSED', '当前不开放注册');
    if (config.registrationMode === 'invite' && (!body.inviteToken || !(await inviteValid(body.inviteToken)))) {
        throw fail(403, 'INVITATION_REQUIRED', '当前仅支持持邀请注册');
    }

    const existing = await one<UserRow>('SELECT * FROM users WHERE email = $1', [body.email]);
    if (existing) {
        // 不暴露邮箱是否已注册：统一返回 pending，且不创建第二个账号、不下发会话。
        await writeAudit({
            workspaceId: null,
            actorId: null,
            actorIp: req.ip,
            action: 'auth.register',
            targetType: 'user',
            targetId: existing.id,
            result: 'failure',
            diff: { reason: 'email_exists' },
        });
        ok(res, { pending: true });
        return;
    }

    const displayName = body.displayName || body.email.split('@')[0];
    const passwordHash = await hashPassword(body.password);
    const userId = nanoid();

    try {
        await tx(async (client) => {
            await client.query(
                `INSERT INTO users (id, email, password_hash, display_name, email_verified_at)
                 VALUES ($1,$2,$3,$4,$5)`,
                [userId, body.email, passwordHash, displayName, config.autoVerifyEmail ? new Date() : null],
            );
            const wsId = nanoid();
            const wsName = `${displayName}的空间`;
            await client.query(
                `INSERT INTO workspaces (id, name, slug, owner_id, settings) VALUES ($1,$2,$3,$4,$5)`,
                [wsId, wsName, slugify(wsName), userId, JSON.stringify({})],
            );
            await client.query(
                `INSERT INTO workspace_members (workspace_id, user_id, role_key, status) VALUES ($1,$2,'owner','active')`,
                [wsId, userId],
            );
        });
    } catch (err) {
        if ((err as { code?: string }).code === '23505') {
            ok(res, { pending: true });
            return;
        }
        throw err;
    }

    if (body.inviteToken && (await inviteValid(body.inviteToken))) {
        await activateInvitation(userId, body.email, body.inviteToken);
    }

    const user = (await one<UserRow>('SELECT * FROM users WHERE id = $1', [userId]))!;
    await createSession(userId, false, req, res);
    await writeAudit({
        workspaceId: null,
        actorId: userId,
        actorName: user.display_name,
        actorIp: req.ip,
        action: 'auth.register',
        targetType: 'user',
        targetId: userId,
    });

    const payload: Record<string, unknown> = await mePayload(user);
    if (!config.autoVerifyEmail) {
        const token = await issueEmailToken(userId, 'verify', VERIFY_TTL);
        sendVerificationEmail(user.email, token);
        payload.verificationToken = token;
    }
    ok(res, payload);
});

authRouter.post('/login', async (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [body.email]);
    const generic = fail(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');

    if (!user) {
        await writeAudit({
            workspaceId: null,
            actorId: null,
            actorIp: req.ip,
            action: 'auth.login',
            result: 'failure',
            diff: { email: body.email },
        });
        throw generic;
    }
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        const retryAfter = Math.max(1, Math.ceil((user.locked_until.getTime() - Date.now()) / 1000));
        res.setHeader('retry-after', String(retryAfter));
        throw fail(429, 'LOCKED', '登录失败次数过多，请稍后再试', { retryAfter });
    }
    const valid = await verifyPassword(user.password_hash, body.password);
    if (!valid) {
        const failed = user.failed_login_count + 1;
        const lock = failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await query('UPDATE users SET failed_login_count = $2, locked_until = $3 WHERE id = $1', [user.id, lock ? 0 : failed, lock]);
        await writeAudit({
            workspaceId: null,
            actorId: user.id,
            actorName: user.display_name,
            actorIp: req.ip,
            action: 'auth.login',
            result: 'failure',
            diff: { failedCount: failed, locked: Boolean(lock) },
        });
        if (lock) {
            const retryAfter = 15 * 60;
            res.setHeader('retry-after', String(retryAfter));
            throw fail(429, 'LOCKED', '登录失败次数过多，请稍后再试', { retryAfter });
        }
        throw generic;
    }

    await query('UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [user.id]);
    await createSession(user.id, Boolean(body.remember), req, res);
    await writeAudit({
        workspaceId: null,
        actorId: user.id,
        actorName: user.display_name,
        actorIp: req.ip,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
    });
    ok(res, await mePayload(user));
});

authRouter.post('/logout', async (req, res) => {
    const auth = requireAuth(req);
    await revokeSession(auth.session.id, auth.user.id);
    clearAuthCookies(res);
    ok(res, { loggedOut: true });
});

authRouter.get('/me', async (req, res) => {
    const auth = requireAuth(req);
    ok(res, await mePayload(auth.user));
});

authRouter.post('/verify-email', async (req, res) => {
    const body = parse(z.object({ token: z.string().min(8) }), req.body);
    const row = await one<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
        `SELECT * FROM email_tokens WHERE token_hash = $1 AND kind = 'verify'`,
        [hashToken(body.token)],
    );
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
        throw fail(400, 'TOKEN_INVALID', '验证链接无效或已过期');
    }
    await tx(async (client) => {
        await client.query('UPDATE email_tokens SET used_at = now() WHERE id = $1', [row.id]);
        await client.query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1', [row.user_id]);
    });
    const user = (await one<UserRow>('SELECT * FROM users WHERE id = $1', [row.user_id]))!;
    await writeAudit({
        workspaceId: null,
        actorId: user.id,
        actorName: user.display_name,
        actorIp: req.ip,
        action: 'auth.email.verify',
        targetType: 'user',
        targetId: user.id,
    });
    ok(res, { verified: true, user: userPayload(user) });
});

authRouter.post('/resend-verification', async (req, res) => {
    const auth = requireAuth(req);
    if (auth.user.email_verified_at) {
        ok(res, { sent: false, reason: 'verified' });
        return;
    }
    if (!checkResendLimit(auth.user.id)) throw fail(429, 'RATE_LIMITED', '验证邮件发送过于频繁，请稍后再试');
    const token = await issueEmailToken(auth.user.id, 'verify', VERIFY_TTL);
    sendVerificationEmail(auth.user.email, token);
    await writeAudit({
        workspaceId: null,
        actorId: auth.user.id,
        actorName: auth.user.display_name,
        actorIp: req.ip,
        action: 'auth.email.resend',
        targetType: 'user',
        targetId: auth.user.id,
    });
    ok(res, { sent: true });
});

authRouter.post('/forgot-password', async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
    const user = await one<UserRow>('SELECT * FROM users WHERE email = $1', [body.email]);
    const payload: Record<string, unknown> = { sent: true };
    if (user) {
        const token = await issueEmailToken(user.id, 'reset', RESET_TTL);
        sendPasswordResetEmail(user.email, token);
        await writeAudit({
            workspaceId: null,
            actorId: user.id,
            actorName: user.display_name,
            actorIp: req.ip,
            action: 'auth.password.forgot',
            targetType: 'user',
            targetId: user.id,
        });
        if (config.devMode) payload.resetToken = token;
    }
    // 始终 202，且不暴露邮箱是否存在。
    ok(res, payload, 202);
});

authRouter.post('/reset-password', async (req, res) => {
    const body = parse(z.object({ token: z.string().min(8), password: z.string().max(128) }), req.body);
    assertPassword(body.password);
    const row = await one<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
        `SELECT * FROM email_tokens WHERE token_hash = $1 AND kind = 'reset'`,
        [hashToken(body.token)],
    );
    if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) {
        throw fail(400, 'TOKEN_INVALID', '重置链接无效或已过期');
    }
    const hash = await hashPassword(body.password);
    await tx(async (client) => {
        await client.query('UPDATE email_tokens SET used_at = now() WHERE id = $1', [row.id]);
        await client.query(
            'UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
            [row.user_id, hash],
        );
        await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
    });
    await writeAudit({
        workspaceId: null,
        actorId: row.user_id,
        actorIp: req.ip,
        action: 'auth.password.reset',
        targetType: 'user',
        targetId: row.user_id,
    });
    ok(res, { reset: true });
});

authRouter.get('/sessions', async (req, res) => {
    const auth = requireAuth(req);
    const rows = await query<{
        id: string;
        user_agent: string | null;
        ip: string | null;
        remember: boolean;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
    }>(
        `SELECT id, user_agent, ip, remember, created_at, last_seen_at, expires_at
         FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY last_seen_at DESC`,
        [auth.user.id],
    );
    ok(res, {
        items: rows.map((row) => ({
            id: row.id,
            current: row.id === auth.session.id,
            userAgent: row.user_agent,
            ip: row.ip,
            remember: row.remember,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            expiresAt: row.expires_at,
        })),
    });
});

authRouter.delete('/sessions/:id', async (req, res) => {
    const auth = requireAuth(req);
    const revoked = await revokeSession(req.params.id, auth.user.id);
    if (!revoked) throw fail(404, 'NOT_FOUND', '会话不存在');
    if (req.params.id === auth.session.id) clearAuthCookies(res);
    ok(res, { revoked: true });
});
