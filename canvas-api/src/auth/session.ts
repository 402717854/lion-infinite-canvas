import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { fail } from '../lib/http.js';
import { BUILTIN_ROLE_KEYS, ROLE_DEFAULTS, roleMeta } from '../permissions.js';
import type { AuthContext, MemberRow, SessionRow, UserRow, WorkspaceContext, WorkspaceRow } from '../types.js';

export const SESSION_COOKIE = 'ic_session';
export const CSRF_COOKIE = 'ic_csrf';
const DAY = 24 * 60 * 60 * 1000;

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const baseCookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookie,
    path: '/',
};

export function sessionTtl(remember: boolean): number {
    return remember ? 30 * DAY : 7 * DAY;
}

export function setCsrfCookie(res: Response, token: string, maxAge: number): void {
    res.cookie(CSRF_COOKIE, token, { ...baseCookie, httpOnly: false, maxAge });
}

export async function createSession(
    userId: string,
    remember: boolean,
    req: Request,
    res: Response,
): Promise<SessionRow> {
    const token = newToken();
    const csrf = newToken(18);
    const ttl = sessionTtl(remember);
    const rows = await query<SessionRow>(
        `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, remember, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' milliseconds')::interval)
         RETURNING *`,
        [randomUUID(), userId, hashToken(token), req.header('user-agent')?.slice(0, 400) ?? null, req.ip ?? null, remember, ttl],
    );
    const session = rows[0];
    res.cookie(SESSION_COOKIE, token, { ...baseCookie, maxAge: ttl });
    setCsrfCookie(res, csrf, ttl);
    return session;
}

export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
    const rows = await query(
        'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
        [sessionId, userId],
    );
    return rows.length > 0;
}

export async function revokeAllSessions(userId: string): Promise<void> {
    await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export function clearAuthCookies(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { ...baseCookie });
    res.clearCookie(CSRF_COOKIE, { ...baseCookie, httpOnly: false });
}

/** 会话中间件：解析 Cookie 中的会话，滑动续期 7/30 天。 */
export async function attachAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const token = req.cookies?.[SESSION_COOKIE];
        if (typeof token !== 'string' || !token) return next();
        const row = await one<
            UserRow & {
                session_id: string;
                remember: boolean;
                token_hash: string;
                user_agent: string | null;
                session_ip: string | null;
                session_created_at: Date;
                last_seen_at: Date;
                expires_at: Date;
                revoked_at: Date | null;
            }
        >(
            `SELECT s.id AS session_id, s.remember, s.token_hash, s.user_agent, s.ip AS session_ip,
                    s.created_at AS session_created_at, s.last_seen_at, s.expires_at, s.revoked_at, u.*
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
            [hashToken(token)],
        );
        if (!row) {
            res.clearCookie(SESSION_COOKIE, { ...baseCookie });
            return next();
        }
        const ttl = sessionTtl(row.remember);
        const expiresAt = new Date(Date.now() + ttl);
        await query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1', [row.session_id, expiresAt]);
        res.cookie(SESSION_COOKIE, token, { ...baseCookie, maxAge: ttl });
        const session: SessionRow = {
            id: row.session_id,
            user_id: row.id,
            token_hash: row.token_hash,
            user_agent: row.user_agent,
            ip: row.session_ip,
            remember: row.remember,
            created_at: row.session_created_at,
            last_seen_at: row.last_seen_at,
            expires_at: expiresAt,
            revoked_at: null,
        };
        const user: UserRow = {
            id: row.id,
            email: row.email,
            password_hash: row.password_hash,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            email_verified_at: row.email_verified_at,
            status: row.status,
            failed_login_count: row.failed_login_count,
            locked_until: row.locked_until,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
        req.auth = { user, session, ip: req.ip ?? '' };
        next();
    } catch (err) {
        next(err);
    }
}

export function requireAuth(req: Request): AuthContext {
    if (!req.auth) throw fail(401, 'UNAUTHENTICATED', '未登录或会话已过期');
    return req.auth;
}

export function assertEmailVerified(user: UserRow): void {
    if (!user.email_verified_at) throw fail(403, 'EMAIL_NOT_VERIFIED', '请先验证邮箱后再使用团队功能');
}

export async function rolePermissions(workspaceId: string, roleKey: string): Promise<string[]> {
    const override = await one<{ permissions: string[] }>(
        'SELECT permissions FROM workspace_roles WHERE workspace_id = $1 AND key = $2',
        [workspaceId, roleKey],
    );
    if (override) return override.permissions;
    return ROLE_DEFAULTS[roleKey] ?? [];
}

export interface Membership {
    member: MemberRow;
    workspace: WorkspaceRow;
}

export async function getMembership(workspaceId: string, userId: string): Promise<Membership | undefined> {
    const row = await one<
        MemberRow & {
            name: string;
            slug: string;
            owner_id: string;
            plan: string;
            member_limit: number;
            settings: Record<string, unknown>;
            deleted_at: Date | null;
            w_created_at: Date;
            w_updated_at: Date;
        }
    >(
        `SELECT m.workspace_id, m.user_id, m.role_key, m.status, m.invited_by, m.joined_at, m.last_active_at,
                u.email, u.display_name, u.avatar_url,
                w.id AS w_id, w.name, w.slug, w.owner_id, w.plan, w.member_limit, w.settings,
                w.created_at AS w_created_at, w.updated_at AS w_updated_at, w.deleted_at
         FROM workspace_members m
         JOIN users u ON u.id = m.user_id
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active' AND w.deleted_at IS NULL`,
        [workspaceId, userId],
    );
    if (!row) return undefined;
    const workspace: WorkspaceRow = {
        id: row.workspace_id,
        name: row.name,
        slug: row.slug,
        owner_id: row.owner_id,
        plan: row.plan,
        member_limit: row.member_limit,
        settings: row.settings,
        created_at: row.w_created_at,
        updated_at: row.w_updated_at,
        deleted_at: row.deleted_at,
    };
    return { member: row, workspace };
}

/**
 * 统一鉴权：会话 → 成员（非成员 404）→ 邮箱验证 → 权限点。
 * 返回空间上下文供后续资源 ACL 使用。
 */
export async function requireWorkspace(
    req: Request,
    workspaceId: string,
    permission?: string,
): Promise<WorkspaceContext> {
    const auth = requireAuth(req);
    const membership = await getMembership(workspaceId, auth.user.id);
    if (!membership) throw fail(404, 'NOT_FOUND', '空间不存在或无权访问');
    assertEmailVerified(auth.user);
    const permissions = await rolePermissions(workspaceId, membership.member.role_key);
    if (permission && !permissions.includes(permission)) {
        throw fail(403, 'PERMISSION_DENIED', '缺少权限点：' + permission, { missingPermission: permission });
    }
    return {
        workspace: membership.workspace,
        member: membership.member,
        roleKey: membership.member.role_key,
        roleName: roleMeta(membership.member.role_key)?.name ?? membership.member.role_key,
        permissions,
    };
}

export function workspacePayload(ctx: WorkspaceContext, memberCount: number) {
    return {
        id: ctx.workspace.id,
        name: ctx.workspace.name,
        slug: ctx.workspace.slug,
        roleKey: ctx.roleKey,
        roleName: ctx.roleName,
        permissions: ctx.permissions,
        memberCount,
        ownerId: ctx.workspace.owner_id,
        createdAt: ctx.workspace.created_at,
    };
}

export async function memberCount(workspaceId: string): Promise<number> {
    const row = await one<{ count: string }>(
        "SELECT count(*)::text AS count FROM workspace_members WHERE workspace_id = $1 AND status = 'active'",
        [workspaceId],
    );
    return Number(row?.count ?? 0);
}

export async function requireWorkspaceRow(workspaceId: string): Promise<WorkspaceRow> {
    const row = await one<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1 AND deleted_at IS NULL', [workspaceId]);
    if (!row) throw fail(404, 'NOT_FOUND', '空间不存在或无权访问');
    return row;
}

export function isBuiltinRole(key: string): boolean {
    return BUILTIN_ROLE_KEYS.includes(key);
}
