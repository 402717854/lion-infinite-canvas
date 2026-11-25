import type { NextFunction, Request, Response } from 'express';
import { fail } from '../lib/http.js';
import { CSRF_COOKIE } from './session.js';

const PUBLIC_AUTH_PATHS = new Set([
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/verify-email',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 双提交 CSRF 令牌：非安全方法必须让 x-csrf-token 与 ic_csrf Cookie 一致。 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    const path = req.path.replace(/\/+$/, '');
    if (PUBLIC_AUTH_PATHS.has(path)) return next();
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.header('x-csrf-token');
    if (typeof cookieToken !== 'string' || !cookieToken || headerToken !== cookieToken) {
        next(fail(403, 'CSRF_INVALID', 'CSRF 校验失败，请刷新页面后重试'));
        return;
    }
    next();
}
