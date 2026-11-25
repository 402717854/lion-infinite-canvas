#!/usr/bin/env node
/**
 * 仓库内开发 Postgres 辅助脚本（Windows 本地环境）。
 * 用法：
 *   node scripts/dev-db.mjs start    # 启动并确保 infinite_canvas 数据库存在
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs status
 *   node scripts/dev-db.mjs restart
 *
 * 可用环境变量覆盖：PG_BIN、PGDATA、PGPORT。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// 默认使用 PATH 中的 PostgreSQL 工具；也可通过 PG_BIN 指向安装目录。
const pgBin = process.env.PG_BIN || '';
const dataDir = process.env.PGDATA || path.join(root, '.dev', 'pgdata');
const port = process.env.PGPORT || '55432';
const logFile = path.join(root, '.dev', 'postgres.log');
const database = 'infinite_canvas';

const exe = (name) => (pgBin ? path.join(pgBin, process.platform === 'win32' ? `${name}.exe` : name) : name);

function run(name, args, quiet = false) {
    const result = spawnSync(exe(name), args, { stdio: quiet ? 'ignore' : 'inherit' });
    if (result.error) {
        console.error(`无法执行 ${exe(name)}：${result.error.message}`);
        process.exit(1);
    }
    return result.status ?? 1;
}

function isReady() {
    return run('pg_isready', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres'], true) === 0;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitReady(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (isReady()) return true;
        sleep(300);
    }
    return false;
}

function ensureDatabase() {
    // createdb 已存在时会失败，这里静默忽略。
    run('createdb', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', database], true);
}

function start() {
    if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`初始化数据目录：${dataDir}`);
        const code = run('initdb', ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8']);
        if (code !== 0) process.exit(code);
    }
    if (isReady()) {
        console.log(`Postgres 已在 127.0.0.1:${port} 运行`);
    } else {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        const code = run('pg_ctl', ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -h 127.0.0.1`, 'start']);
        if (code !== 0) process.exit(code);
        if (!waitReady()) {
            console.error(`Postgres 未能就绪，请查看日志：${logFile}`);
            process.exit(1);
        }
    }
    ensureDatabase();
    console.log(`开发数据库已就绪：postgres://postgres@127.0.0.1:${port}/${database}`);
}

function stop() {
    const code = run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop']);
    if (code !== 0) process.exit(code);
}

function status() {
    const ready = isReady();
    console.log(ready ? `运行中：postgres://postgres@127.0.0.1:${port}/${database}` : '未运行');
    process.exit(ready ? 0 : 1);
}

switch (process.argv[2] || 'status') {
    case 'start':
        start();
        break;
    case 'stop':
        stop();
        break;
    case 'restart':
        stop();
        start();
        break;
    case 'status':
        status();
        break;
    default:
        console.error('用法：node scripts/dev-db.mjs <start|stop|status|restart>');
        process.exit(1);
}
