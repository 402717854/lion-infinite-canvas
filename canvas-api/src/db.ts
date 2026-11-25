import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

export type Queryable = Pick<pg.Pool, 'query'>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
    db: Queryable = pool,
): Promise<T[]> {
    const res = await db.query<T>(text, params as never);
    return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
    db: Queryable = pool,
): Promise<T | undefined> {
    const rows = await query<T>(text, params, db);
    return rows[0];
}

/** 多步写入用事务；回调抛出异常时回滚。 */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
    } finally {
        client.release();
    }
}

export async function closeDb(): Promise<void> {
    await pool.end();
}
