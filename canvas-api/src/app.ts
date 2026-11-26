import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { attachAuth } from './auth/session.js';
import { csrfProtection } from './auth/csrf.js';
import { errorHandler, fail, ok, requestId } from './lib/http.js';
import { ensureDataDir } from './lib/storage.js';
import { authRouter } from './routes/auth.js';
import { invitationsRouter, workspacesRouter } from './routes/workspaces.js';
import { importRouter, projectsRouter, workspaceProjectsRouter } from './routes/projects.js';
import { assetsRouter, workspaceAssetsRouter } from './routes/assets.js';
import { filesRouter, workspaceFilesRouter } from './routes/files.js';
import { auditRouter } from './routes/audit.js';
import { channelsRouter } from './routes/channels.js';
import { modelsRouter } from './routes/models.js';
import { usageRouter } from './routes/usage.js';
import { gatewayRouter } from './routes/gateway.js';

export function createApp() {
    ensureDataDir();
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', true);

    app.use(requestId);

    // 同源 CORS：APP_ORIGIN 支持逗号分隔的白名单。
    const origins = config.appOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    app.use((req: Request, res: Response, next: NextFunction) => {
        const origin = req.header('origin');
        if (origin && origins.includes(origin)) {
            res.setHeader('access-control-allow-origin', origin);
            res.setHeader('access-control-allow-credentials', 'true');
            res.setHeader('vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
            res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            res.setHeader('access-control-allow-headers', 'content-type,x-csrf-token,x-request-id');
            res.setHeader('access-control-max-age', '600');
            res.status(204).end();
            return;
        }
        next();
    });

    app.use(cookieParser());
    app.use(attachAuth);
    app.use(csrfProtection);

    // 网关自带 body 解析（multipart/SSE），必须挂在全局 express.json 之前。
    app.use('/v1/gateway', gatewayRouter);
    app.use(express.json({ limit: '10mb' }));

    app.get('/api/health', (_req, res) => ok(res, { status: 'ok' }));
    app.use('/api/auth', authRouter);
    app.use('/api/workspaces', workspacesRouter);
    app.use('/api/workspaces', workspaceProjectsRouter);
    app.use('/api/workspaces', workspaceAssetsRouter);
    app.use('/api/workspaces', workspaceFilesRouter);
    app.use('/api/workspaces', importRouter);
    app.use('/api/workspaces', auditRouter);
    app.use('/api/workspaces', channelsRouter);
    app.use('/api/workspaces', modelsRouter);
    app.use('/api/workspaces', usageRouter);
    app.use('/api/invitations', invitationsRouter);
    app.use('/api/projects', projectsRouter);
    app.use('/api/assets', assetsRouter);
    app.use('/api/files', filesRouter);

    app.use('/v1', (_req, _res, next) => {
        next(fail(404, 'NOT_FOUND', '接口不存在'));
    });
    app.use('/api', (_req, _res, next) => {
        next(fail(404, 'NOT_FOUND', '接口不存在'));
    });
    app.use(errorHandler);
    return app;
}
