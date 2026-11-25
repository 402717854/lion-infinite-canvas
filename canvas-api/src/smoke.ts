/**
 * 进程内冒烟测试：随机端口启动 app，用 fetch + 手动 Cookie jar 跑通核心链路。
 * 运行：node dist/smoke.js（需先 node dist/migrate.js，且本机 Postgres 可用）
 */
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { nanoid } from 'nanoid';

class CookieJar {
    private cookies = new Map<string, string>();

    store(res: Response): void {
        for (const line of res.headers.getSetCookie()) {
            const pair = line.split(';')[0];
            const index = pair.indexOf('=');
            if (index <= 0) continue;
            const name = pair.slice(0, index).trim();
            const value = pair.slice(index + 1).trim();
            if (!value) this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
    }

    get(name: string): string | undefined {
        return this.cookies.get(name);
    }

    header(): string {
        return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    }
}

interface ApiResult {
    status: number;
    body: Record<string, unknown>;
    headers: Headers;
}

async function main(): Promise<void> {
    // 冒烟测试固定开启自动验证与开放注册，避免受本地 .env 影响。
    process.env.AUTO_VERIFY_EMAIL = 'true';
    process.env.REGISTRATION_MODE = 'open';

    const { createApp } = await import('./app.js');
    const { closeDb } = await import('./db.js');

    const app = createApp();
    const server: Server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');
    const base = `http://127.0.0.1:${address.port}`;

    const call = async (
        jar: CookieJar,
        method: string,
        path: string,
        options: { json?: unknown; raw?: Buffer; contentType?: string } = {},
    ): Promise<ApiResult> => {
        const headers: Record<string, string> = { cookie: jar.header() };
        const csrf = jar.get('ic_csrf');
        if (csrf) headers['x-csrf-token'] = csrf;
        let body: string | Buffer | undefined;
        if (options.raw) {
            body = options.raw;
            headers['content-type'] = options.contentType || 'application/octet-stream';
        } else if (options.json !== undefined) {
            body = JSON.stringify(options.json);
            headers['content-type'] = 'application/json';
        }
        const res = await fetch(base + path, { method, headers, body });
        jar.store(res);
        const text = await res.text();
        let parsed: Record<string, unknown> = {};
        try {
            parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
            parsed = { raw: text };
        }
        return { status: res.status, body: parsed, headers: res.headers };
    };

    const expectStatus = (result: ApiResult, status: number, step: string) => {
        if (result.status !== status) {
            throw new Error(`${step}: 期望 HTTP ${status}，实际 ${result.status}，响应 ${JSON.stringify(result.body)}`);
        }
        if (result.body.code !== undefined && status < 400) assert.equal(result.body.code, 'OK', `${step}: code 应为 OK`);
    };

    const data = (result: ApiResult) => result.body.data as Record<string, unknown>;

    const owner = new CookieJar();
    const guest = new CookieJar();
    const suffix = nanoid(6).toLowerCase();
    const ownerEmail = `owner.${suffix}@example.com`;
    const guestEmail = `guest.${suffix}@example.com`;
    const password = `Passw0rd${suffix}`;

    try {
        // 1. 注册 owner
        const register = await call(owner, 'POST', '/api/auth/register', {
            json: { email: ownerEmail.toUpperCase(), password, displayName: '冒烟所有者' },
        });
        expectStatus(register, 200, 'register owner');
        const registerData = data(register);
        assert.ok(registerData.user, 'register 应返回 me 结构');
        assert.equal((registerData.user as Record<string, unknown>).email, ownerEmail, '邮箱应转小写');
        const ownerWorkspaces = registerData.workspaces as Array<Record<string, unknown>>;
        assert.equal(ownerWorkspaces.length, 1, '注册应自动创建个人空间');
        assert.equal(ownerWorkspaces[0].roleKey, 'owner');
        assert.ok(owner.get('ic_session'), '应设置 ic_session Cookie');
        assert.ok(owner.get('ic_csrf'), '应设置 ic_csrf Cookie');

        // 2. me
        const me = await call(owner, 'GET', '/api/auth/me');
        expectStatus(me, 200, 'me');
        assert.equal((data(me).user as Record<string, unknown>).email, ownerEmail);

        // 3. 创建邀请
        const workspaceId = ownerWorkspaces[0].id as string;
        const invite = await call(owner, 'POST', `/api/workspaces/${workspaceId}/invitations`, {
            json: { email: guestEmail, roleKey: 'editor', maxUses: 1, expiresInDays: 7 },
        });
        expectStatus(invite, 201, 'create invitation');
        const inviteData = data(invite);
        assert.ok(inviteData.token, '邀请应返回 token');
        assert.equal(inviteData.inviteUrl, `/invite/${String(inviteData.token)}`);
        const inviteToken = inviteData.token as string;

        // 4. 注册第二账号并接受邀请（注册时带 inviteToken 自动加入）
        const guestRegister = await call(guest, 'POST', '/api/auth/register', {
            json: { email: guestEmail, password, displayName: '冒烟访客', inviteToken },
        });
        expectStatus(guestRegister, 200, 'register guest');
        const guestWorkspaces = data(guestRegister).workspaces as Array<Record<string, unknown>>;
        assert.equal(guestWorkspaces.length, 2, '带邀请注册应同时加入邀请空间');
        assert.ok(
            guestWorkspaces.some((ws) => ws.id === workspaceId && ws.roleKey === 'editor'),
            '应加入邀请空间且角色为 editor',
        );

        // 5. 角色列表
        const roles = await call(owner, 'GET', `/api/workspaces/${workspaceId}/roles`);
        expectStatus(roles, 200, 'roles');
        const roleItems = data(roles).items as Array<Record<string, unknown>>;
        assert.equal(roleItems.length, 5, '应有 5 个内置角色');
        assert.ok(
            roleItems.some((role) => role.key === 'owner' && Array.isArray(role.permissions) && (role.permissions as string[]).length === 41),
            'owner 角色应包含 41 个权限点',
        );

        // 6. 建项目
        const created = await call(owner, 'POST', `/api/workspaces/${workspaceId}/projects`, {
            json: { title: '冒烟画布', visibility: 'workspace' },
        });
        expectStatus(created, 201, 'create project');
        const projectId = data(created).id as string;
        assert.ok(projectId, '项目应返回 id');

        // 7. 保存 + 版本冲突
        const save = await call(owner, 'PUT', `/api/projects/${projectId}`, {
            json: { title: '冒烟画布 v2', version: 1, doc: { nodes: [{ id: 'n1' }], connections: [], chatSessions: [] } },
        });
        expectStatus(save, 200, 'save project');
        assert.equal(data(save).version, 2, '保存后版本应为 2');
        const conflict = await call(owner, 'PUT', `/api/projects/${projectId}`, {
            json: { version: 1, doc: { nodes: [] } },
        });
        expectStatus(conflict, 409, 'version conflict');
        assert.equal(conflict.body.code, 'VERSION_CONFLICT');

        // 8. 文件上传 + 签名读取 + 素材
        const payload = Buffer.from(`smoke-binary-${suffix}`);
        const upload = await call(owner, 'POST', `/api/workspaces/${workspaceId}/files?name=smoke.png`, {
            raw: payload,
            contentType: 'image/png',
        });
        expectStatus(upload, 201, 'upload file');
        const storageKey = data(upload).storageKey as string;
        const fileUrl = data(upload).url as string;
        assert.ok(fileUrl.startsWith(`/api/files/${storageKey}?exp=`), '文件 URL 应带签名参数');
        const download = await fetch(base + fileUrl);
        assert.equal(download.status, 200, '签名文件应先读成功');
        const downloaded = Buffer.from(await download.arrayBuffer());
        assert.deepEqual(downloaded, payload, '下载内容应与上传一致');
        const badSig = await fetch(base + `/api/files/${storageKey}?exp=99999999999&sig=deadbeef`);
        assert.equal(badSig.status, 403, '错误签名应返回 403');

        const assetCreate = await call(owner, 'POST', `/api/workspaces/${workspaceId}/assets`, {
            json: { kind: 'image', title: '冒烟素材', storageKey, bytes: payload.length, mimeType: 'image/png', tags: ['smoke'] },
        });
        expectStatus(assetCreate, 201, 'create asset');
        const assetList = await call(owner, 'GET', `/api/workspaces/${workspaceId}/assets`);
        expectStatus(assetList, 200, 'list assets');
        const assets = data(assetList).items as Array<Record<string, unknown>>;
        assert.ok(assets.some((asset) => asset.id === data(assetCreate).id), '素材列表应包含新建素材');

        // 9. 审计列表
        const audit = await call(owner, 'GET', `/api/workspaces/${workspaceId}/audit?limit=50`);
        expectStatus(audit, 200, 'audit list');
        const auditItems = data(audit).items as Array<Record<string, unknown>>;
        assert.ok(auditItems.length > 0, '审计应有记录');
        assert.ok(
            auditItems.some((item) => item.action === 'project.save' || item.action === 'project.create'),
            '审计应包含项目操作',
        );

        // 10. 改角色：editor -> viewer，然后验证 viewer 无法建项目
        const guestUserId = (data(guestRegister).user as Record<string, unknown>).id as string;
        const roleUpdate = await call(owner, 'PATCH', `/api/workspaces/${workspaceId}/members/${guestUserId}`, {
            json: { roleKey: 'viewer' },
        });
        expectStatus(roleUpdate, 200, 'update member role');
        assert.equal(data(roleUpdate).roleKey, 'viewer');
        const denied = await call(guest, 'POST', `/api/workspaces/${workspaceId}/projects`, { json: { title: '不应创建' } });
        expectStatus(denied, 403, 'viewer create project denied');
        assert.equal(denied.body.code, 'PERMISSION_DENIED');
        assert.equal((denied.body.data as Record<string, unknown>).missingPermission, 'project.create');

        // 11. private 项目对非协作者 404
        const privateProject = await call(owner, 'POST', `/api/workspaces/${workspaceId}/projects`, {
            json: { title: '私有画布' },
        });
        expectStatus(privateProject, 201, 'create private project');
        const privateId = data(privateProject).id as string;
        const hidden = await call(guest, 'GET', `/api/projects/${privateId}`);
        expectStatus(hidden, 404, 'private project hidden from non-collaborator');
        assert.equal(hidden.body.code, 'NOT_FOUND');

        // 12. 公开邀请信息
        const publicInvite = await fetch(`${base}/api/invitations/${inviteToken}`);
        assert.equal(publicInvite.status, 200, '公开邀请信息应可读');
        const publicInviteBody = (await publicInvite.json()) as { data?: Record<string, unknown> };
        assert.equal(publicInviteBody.data?.email, guestEmail);
        assert.equal(publicInviteBody.data?.status, 'accepted');

        // 13. 登出后 me 401
        const logout = await call(owner, 'POST', '/api/auth/logout');
        expectStatus(logout, 200, 'logout');
        const meAfter = await call(owner, 'GET', '/api/auth/me');
        expectStatus(meAfter, 401, 'me after logout');
        assert.equal(meAfter.body.code, 'UNAUTHENTICATED');

        console.log('SMOKE OK');
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await closeDb();
    }
}

main().catch((err) => {
    console.error('SMOKE FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
});
