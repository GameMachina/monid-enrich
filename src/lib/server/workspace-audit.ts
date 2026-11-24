import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Account } from '../auth-identity';
import type { Database, Rows, Sql } from './database';

export type WorkspaceAuditAction =
	| 'workspace.export'
	| 'workspace.close'
	| 'workspace.settings.update'
	| 'workspace.settings.import'
	| 'workspace.mcp_key.create'
	| 'workspace.mcp_key.rotate'
	| 'workspace.member.added'
	| 'workspace.member.updated'
	| 'workspace.member.removed'
	| 'workspace.invitation.created'
	| 'workspace.invitation.accepted'
	| 'workspace.invitation.revoked';

export type WorkspaceAuditDetails = Record<string, string | number | boolean | null>;

function safeDetails(details: Record<string, unknown>): WorkspaceAuditDetails {
	const safe: WorkspaceAuditDetails = {};
	for (const [key, value] of Object.entries(details).slice(0, 20)) {
		if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
		if (typeof value === 'string') safe[key] = value.slice(0, 160);
		else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
		else if (typeof value === 'boolean' || value === null) safe[key] = value;
	}
	return safe;
}

export async function appendWorkspaceAuditEvent(sql: Sql, workspace: string, actorId: string, action: WorkspaceAuditAction, details: WorkspaceAuditDetails = {}) {
	await sql.query('INSERT INTO enrichable.workspace_audit_events (workspace_id,id,actor_id,action,details) VALUES ($1,$2,$3,$4,$5::jsonb)', [workspace, randomUUID(), actorId, action, JSON.stringify(safeDetails(details))]);
}

export async function workspaceAuditReport(database: Database, actor: Account) {
	return database.transaction(async (sql: Sql, workspace: string) => {
		const result = await sql.query('SELECT id,actor_id,action,details,created_at FROM enrichable.workspace_audit_events WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100', [workspace]);
		return result.rows.map((row: Rows[number]) => ({
			id: String(row.id),
			actorId: String(row.actor_id),
			action: String(row.action),
			details: safeDetails(row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details as Record<string, unknown> : {}),
			createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
		}));
	}, { workspace: actor, readOnly: true });
}
