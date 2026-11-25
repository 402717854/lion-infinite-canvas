import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// permissions.json 是权限点与内置角色默认值的唯一来源（前端常量目录，前后端共用）。
const file = path.join(config.rootDir, '..', 'web', 'src', 'constant', 'permissions.json');

interface PermissionDef {
    group: string;
    key: string;
    label: string;
}

interface RoleDef {
    key: string;
    name: string;
    description: string;
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    roles: RoleDef[];
    permissions: PermissionDef[];
    rolePermissions: Record<string, string[]>;
};

export const PERMISSIONS = raw.permissions;
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);
export const ROLES = raw.roles;
export const ROLE_DEFAULTS = raw.rolePermissions;
export const BUILTIN_ROLE_KEYS = ROLES.map((r) => r.key);
/** 允许空间管理员编辑权限点的内置角色（owner/admin 不可编辑）。 */
export const EDITABLE_ROLE_KEYS = ['editor', 'viewer', 'guest'];

if (PERMISSIONS.length !== 41) {
    throw new Error(`permissions.json 权限点数量应为 41，实际 ${PERMISSIONS.length}`);
}
for (const role of ROLES) {
    if (!ROLE_DEFAULTS[role.key]) throw new Error(`permissions.json 缺少角色 ${role.key} 的默认权限`);
    for (const key of ROLE_DEFAULTS[role.key]) {
        if (!PERMISSION_KEY_SET.has(key)) throw new Error(`角色 ${role.key} 引用了未知权限点 ${key}`);
    }
}

export function roleMeta(key: string): RoleDef | undefined {
    return ROLES.find((r) => r.key === key);
}
