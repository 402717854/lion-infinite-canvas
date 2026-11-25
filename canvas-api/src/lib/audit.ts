import { query } from '../db.js';
import { sortableId } from './http.js';

export interface AuditInput {
    workspaceId: string | null;
    actorId: string | null;
    actorName?: string | null;
    actorIp?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    result?: 'success' | 'failure';
    diff?: unknown;
}

/** 审计只追加；写入失败不影响主流程，但会记录到进程日志。 */
export async function writeAudit(input: AuditInput): Promise<void> {
    try {
        await query(
            `INSERT INTO audit_logs (id, workspace_id, actor_id, actor_name, actor_ip, action, target_type, target_id, result, diff)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                sortableId(),
                input.workspaceId,
                input.actorId,
                input.actorName ?? null,
                input.actorIp ?? null,
                input.action,
                input.targetType ?? null,
                input.targetId ?? null,
                input.result ?? 'success',
                input.diff === undefined ? null : JSON.stringify(input.diff),
            ],
        );
    } catch (err) {
        console.error('[audit] write failed', input.action, err instanceof Error ? err.message : err);
    }
}
