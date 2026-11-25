import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import express, { Router } from 'express';
import { one, query } from '../db.js';
import { requireWorkspace } from '../auth/session.js';
import { writeAudit } from '../lib/audit.js';
import { fail, ok } from '../lib/http.js';
import { filePath, isValidKey, saveBinary, signedUrl, verifySignature } from '../lib/storage.js';

export const workspaceFilesRouter = Router();
export const filesRouter = Router();

const MAX_BYTES = 200 * 1024 * 1024;

// 原始二进制上传：route 级 express.raw，避免被全局 JSON 解析器消费。
workspaceFilesRouter.post(
    '/:id/files',
    express.raw({ type: () => true, limit: '200mb' }),
    async (req, res) => {
        const ctx = await requireWorkspace(req, req.params.id, 'asset.create');
        const body = req.body as unknown;
        if (!Buffer.isBuffer(body) || body.length === 0) throw fail(400, 'INVALID_PARAM', '缺少文件内容');
        if (body.length > MAX_BYTES) throw fail(413, 'PAYLOAD_TOO_LARGE', '文件超过 200MB');
        const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim().slice(0, 200) : 'file';
        const mimeType = (req.header('content-type') || 'application/octet-stream').split(';')[0].trim();
        const storageKey = await saveBinary(body);
        await query(
            'INSERT INTO files (key, workspace_id, owner_id, name, bytes, mime_type) VALUES ($1,$2,$3,$4,$5,$6)',
            [storageKey, ctx.workspace.id, ctx.member.user_id, name, body.length, mimeType],
        );
        await writeAudit({
            workspaceId: ctx.workspace.id,
            actorId: ctx.member.user_id,
            actorName: ctx.member.display_name,
            actorIp: req.ip,
            action: 'file.upload',
            targetType: 'file',
            targetId: storageKey,
            diff: { name, bytes: body.length, mimeType },
        });
        ok(res, { storageKey, url: signedUrl(storageKey), bytes: body.length, mimeType }, 201);
    },
);

// 公开签名读取：HMAC-SHA256(key + exp)。
filesRouter.get('/:key', async (req, res) => {
    const key = req.params.key;
    if (!isValidKey(key) || !verifySignature(key, req.query.exp, req.query.sig)) {
        throw fail(403, 'SIGNATURE_INVALID', '文件链接无效或已过期');
    }
    const row = await one<{ mime_type: string | null; bytes: string }>('SELECT mime_type, bytes FROM files WHERE key = $1', [key]);
    if (!row) throw fail(404, 'NOT_FOUND', '文件不存在');
    const abs = filePath(key);
    if (!fs.existsSync(abs)) throw fail(404, 'NOT_FOUND', '文件不存在');
    res.status(200);
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(row.bytes));
    res.setHeader('Cache-Control', 'private, max-age=300');
    await pipeline(fs.createReadStream(abs), res);
});
