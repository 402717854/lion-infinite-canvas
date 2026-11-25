import fs from 'node:fs';
import path from 'node:path';

// canvas-api 根目录（src 与 dist 的上一级）。
const rootDir = path.resolve(import.meta.dirname, '..');

// 零依赖读取 canvas-api/.env，不覆盖已有环境变量。
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m || m[1] in process.env) continue;
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
}

const bool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : v === 'true' || v === '1');
const int = (v: string | undefined, fallback: number) => (v ? Number.parseInt(v, 10) || fallback : fallback);

const dataDir = process.env.DATA_DIR || 'data/uploads';

export const config = {
    rootDir,
    port: int(process.env.PORT, 8787),
    databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:55432/infinite_canvas',
    appOrigin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
    secureCookie: bool(process.env.SESSION_COOKIE_SECURE, false),
    registrationMode: (process.env.REGISTRATION_MODE || 'open') as 'open' | 'invite' | 'closed',
    autoVerifyEmail: bool(process.env.AUTO_VERIFY_EMAIL, true),
    devMode: process.env.NODE_ENV !== 'production',
    dataDir: path.resolve(rootDir, dataDir),
    fileUrlSecret: process.env.FILE_URL_SECRET || 'canvas-dev-secret-change-me',
    fileUrlTtlSeconds: int(process.env.FILE_URL_TTL_SECONDS, 3600),
};

export type Config = typeof config;
