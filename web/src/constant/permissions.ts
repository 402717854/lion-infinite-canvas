import permissionsConfig from "./permissions.json";

export type PermissionKey = string;
export type BuiltinRoleKey = "owner" | "admin" | "editor" | "viewer" | "guest";

export type PermissionMeta = {
    group: string;
    key: PermissionKey;
    label: string;
};

export type RoleMeta = {
    key: BuiltinRoleKey;
    name: string;
    description: string;
};

export const PERMISSIONS = permissionsConfig.permissions as PermissionMeta[];
export const ROLE_META = permissionsConfig.roles as RoleMeta[];
export const ROLE_TEMPLATES = permissionsConfig.rolePermissions as Record<BuiltinRoleKey, PermissionKey[]>;
export const PERMISSION_GROUPS = Array.from(new Set(PERMISSIONS.map((item) => item.group)));

export const ROLE_LABELS: Record<BuiltinRoleKey, string> = ROLE_META.reduce(
    (labels, role) => ({ ...labels, [role.key]: role.name }),
    {} as Record<BuiltinRoleKey, string>,
);

export function roleLabel(key: string) {
    return ROLE_LABELS[key as BuiltinRoleKey] || key;
}
