import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const DEV_KEY = 'canvas-dev-encryption-key-change-me';

if (!config.encryptionKey) {
    if (!config.devMode) throw new Error('缺少 APP_ENCRYPTION_KEY，生产环境无法启动');
    console.warn('[canvas-api] 未设置 APP_ENCRYPTION_KEY，使用开发默认密钥，请勿用于生产');
}

// 任意长度的环境变量统一散列成 32 字节 AES-256 密钥。
const KEY = createHash('sha256')
    .update(config.encryptionKey || DEV_KEY)
    .digest();

/** AES-256-GCM 加密，输出 iv.tag.data 三段 base64url。 */
export function encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
    const [ivRaw, tagRaw, dataRaw] = payload.split('.');
    if (!ivRaw || !tagRaw || !dataRaw) throw new Error('密文格式不合法');
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const data = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]);
    return data.toString('utf8');
}

/** 掩码：保留前 3 位与后 4 位，过短的密钥整体打码。 */
export function maskSecret(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 12) return '••••••';
    return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}
