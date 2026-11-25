import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { nanoid } from 'nanoid';

export class AppError extends Error {
    status: number;
    code: string;
    data?: unknown;

    constructor(status: number, code: string, message: string, data?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

export const fail = (status: number, code: string, message: string, data?: unknown) =>
    new AppError(status, code, message, data);

/** 可排序 id：base36 时间戳 + 随机后缀，用于审计游标。 */
export const sortableId = () => Date.now().toString(36).padStart(9, '0') + nanoid(10);

export function requestId(req: Request, res: Response, next: NextFunction): void {
    const id = req.header('x-request-id') || randomUUID();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    next();
}

export function ok(res: Response, data: unknown = null, status = 200): void {
    res.status(status).json({ code: 'OK', message: '', data, requestId: res.locals.requestId });
}

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
    const result = schema.safeParse(input ?? {});
    if (!result.success) {
        const issue = (result.error as ZodError).issues[0];
        throw fail(400, 'INVALID_PARAM', issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message);
    }
    return result.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    const requestId = res.locals.requestId;
    if (err instanceof AppError) {
        res.status(err.status).json({
            code: err.code,
            message: err.message,
            data: err.data,
            requestId,
        });
        return;
    }
    // body-parser 超限 / JSON 解析失败等。
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
        res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: '请求体过大', requestId });
        return;
    }
    if (e?.type === 'entity.parse.failed' || e?.status === 400) {
        res.status(400).json({ code: 'INVALID_PARAM', message: '请求体格式错误', requestId });
        return;
    }
    console.error(`[${requestId}]`, req.method, req.originalUrl, err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: '服务器内部错误', requestId });
}

/** Express 5 已自动转发 async 异常，这里保留同步包装层用于类型收窄。 */
export const h =
    (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
    (req: Request, res: Response, next: NextFunction): void => {
        try {
            const out = fn(req, res, next);
            if (out instanceof Promise) out.catch(next);
        } catch (err) {
            next(err);
        }
    };
