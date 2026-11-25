import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function ensureDataDir(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
}

export function filePath(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('invalid storage key');
    return path.join(config.dataDir, key);
}

export async function saveBinary(buffer: Buffer): Promise<string> {
    ensureDataDir();
    const key = crypto.randomUUID().replace(/-/g, '');
    await fs.promises.writeFile(filePath(key), buffer);
    return key;
}

export function isValidKey(key: string): boolean {
    return KEY_PATTERN.test(key);
}

export function signature(key: string, exp: number): string {
    return createHmac('sha256', config.fileUrlSecret).update(`${key}:${exp}`).digest('base64url');
}

export function signedUrl(key: string): string {
    const exp = Math.floor(Date.now() / 1000) + config.fileUrlTtlSeconds;
    return `/api/files/${key}?exp=${exp}&sig=${signature(key, exp)}`;
}

export function verifySignature(key: string, expRaw: unknown, sigRaw: unknown): boolean {
    if (!isValidKey(key) || typeof expRaw !== 'string' || typeof sigRaw !== 'string') return false;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(signature(key, exp));
    const provided = Buffer.from(sigRaw);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
}
