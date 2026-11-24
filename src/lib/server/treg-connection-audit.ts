import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ProviderAccess } from './provider-access';
import { withDatabase } from './database';
import { logWorkspaceError } from './workspace-logging';
import { recordWorkspaceAuditEvent, type WorkspaceAuditAction, type WorkspaceAuditDetails } from './workspace-audit';

/** Treg manages the connection itself. Keep a local, secret-free workspace audit trail of lifecycle actions. */
export async function auditTregConnectionAction(access: ProviderAccess, action: WorkspaceAuditAction, details: WorkspaceAuditDetails) {
	const account = access.account;
	if (!account) return;
	const started = performance.now();
	try {
		await withDatabase((database) => recordWorkspaceAuditEvent(database, account, action, details));
	} catch (error) {
		// The upstream operation may already have succeeded; do not turn an audit-storage error into a retry that
		// could create a duplicate connection or top-up. Keep the failure visible in redacted server diagnostics.
		logWorkspaceError(error, { requestId: randomUUID(), operation: 'treg.connection.audit', phase: action, durationMs: Math.round(performance.now() - started) });
	}
}
