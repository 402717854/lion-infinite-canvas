import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { closeDb, pool } from './db.js';

// tsc 不复制 .sql：优先找 dist/schema.sql，其次 src/schema.sql。
const candidates = [
    path.join(import.meta.dirname, 'schema.sql'),
    path.resolve(import.meta.dirname, '..', 'src', 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'schema.sql'),
];
const schemaFile = candidates.find((p) => fs.existsSync(p));
if (!schemaFile) {
    console.error('schema.sql not found, looked in:\n' + candidates.join('\n'));
    process.exit(1);
}

const sql = fs.readFileSync(schemaFile, 'utf8');

try {
    await pool.query(sql);
    console.log(`migrate OK (${path.relative(process.cwd(), schemaFile)})`);
} catch (err) {
    console.error('migrate failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
} finally {
    await closeDb();
}
