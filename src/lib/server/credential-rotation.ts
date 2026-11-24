import 'server-only';
import { createHash } from 'node:crypto';
import { WorkspaceError } from '../workspace';
import { decryptSecret, encryptSecret } from './credentials';
import { credentialKeyId, deriveCredentialKey, currentEncryptionSecret, previousEncryptionSecret } from './credential-keyring';
import type { Database } from './database';
import { appendWorkspaceAuditEvent } from './workspace-audit';

const BATCH_SIZE = 50;

/** Re-encrypt at most 150 rows per call. Repeat until remaining is zero, then remove the previous key. */
export async function rotateCredentialBatch(database: Database) {
	const current = currentEncryptionSecret(), previous = previousEncryptionSecret();
	if (!previous) throw new WorkspaceError('Set ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET to the old key before running credential rotation.', 400);
	const currentId = credentialKeyId(current), previousId = credentialKeyId(previous);
	const currentOrgKey = deriveCredentialKey(current, 'enrichable:organization-providers:v1');
	const previousOrgKey = deriveCredentialKey(previous, 'enrichable:organization-providers:v1');
	const currentAgentWebKey = deriveCredentialKey(current, 'enrichable:agentweb-member-connections:v1');
	const previousAgentWebKey = deriveCredentialKey(previous, 'enrichable:agentweb-member-connections:v1');
	const currentMcpKey = createHash('sha256').update(current).digest();
	const previousMcpKey = createHash('sha256').update(previous).digest();
	return database.transaction(async (sql) => {
		const organizations = await sql.query(`SELECT workspace_id,provider,encrypted_secret,encryption_key_id FROM enrichable.organization_providers
			WHERE encryption_key_id<>$1 ORDER BY workspace_id,provider LIMIT $2 FOR UPDATE SKIP LOCKED`, [currentId, BATCH_SIZE]);
		const organizationCounts = new Map<string, number>();
		for (const row of organizations.rows) {
			const workspace = String(row.workspace_id), provider = String(row.provider), envelope = String(row.encrypted_secret);
			const version = String(row.encryption_key_id ?? 'legacy');
			if (version !== 'legacy' && version !== previousId) throw new WorkspaceError('A credential row has an unknown encryption key version; keep both keys configured and investigate before retrying.', 409);
			const secret = decryptSecret(previousOrgKey, envelope, [workspace, provider]);
			if (secret === null) throw new WorkspaceError('The configured previous key cannot decrypt an organization credential. Rotation made no changes; verify the old key.', 409);
			await sql.query('UPDATE enrichable.organization_providers SET encrypted_secret=$3,encryption_key_id=$4 WHERE workspace_id=$1 AND provider=$2', [workspace, provider, encryptSecret(currentOrgKey, secret, [workspace, provider]), currentId]);
			organizationCounts.set(workspace, (organizationCounts.get(workspace) ?? 0) + 1);
		}

		const agentWeb = await sql.query(`SELECT issuer,user_id,encrypted_key,encryption_key_id FROM enrichable.agentweb_connections
			WHERE encryption_key_id<>$1 ORDER BY issuer,user_id LIMIT $2 FOR UPDATE SKIP LOCKED`, [currentId, BATCH_SIZE]);
		for (const row of agentWeb.rows) {
			const issuer = String(row.issuer), userId = String(row.user_id), envelope = String(row.encrypted_key), version = String(row.encryption_key_id ?? 'legacy');
			if (version !== 'legacy' && version !== previousId) throw new WorkspaceError('An AgentWeb connection has an unknown encryption key version; keep both keys configured and investigate before retrying.', 409);
			const secret = decryptSecret(previousAgentWebKey, envelope, [issuer, userId]);
			if (secret === null) throw new WorkspaceError('The configured previous key cannot decrypt an AgentWeb connection. Rotation made no changes; verify the old key.', 409);
			await sql.query('UPDATE enrichable.agentweb_connections SET encrypted_key=$3,encryption_key_id=$4,updated_at=$5 WHERE issuer=$1 AND user_id=$2', [issuer, userId, encryptSecret(currentAgentWebKey, secret, [issuer, userId]), currentId, Date.now()]);
		}

		const mcpKeys = await sql.query(`SELECT workspace_id,version,key_hash,encrypted_secret,encryption_key_id FROM enrichable.mcp_keys
			WHERE encrypted_secret IS NOT NULL AND encryption_key_id<>$1 ORDER BY workspace_id LIMIT $2 FOR UPDATE SKIP LOCKED`, [currentId, BATCH_SIZE]);
		for (const row of mcpKeys.rows) {
			const workspace = String(row.workspace_id), version = String(row.version), envelope = String(row.encrypted_secret), keyVersion = String(row.encryption_key_id ?? 'legacy');
			if (keyVersion !== 'legacy' && keyVersion !== previousId) throw new WorkspaceError('An MCP key has an unknown encryption key version; keep both keys configured and investigate before retrying.', 409);
			const secret = decryptSecret(previousMcpKey, envelope, [workspace, version]);
			if (secret === null || createHash('sha256').update(secret).digest('hex') !== row.key_hash) throw new WorkspaceError('The configured previous key cannot decrypt an MCP key. Rotation made no changes; verify the old key.', 409);
			await sql.query('UPDATE enrichable.mcp_keys SET encrypted_secret=$2,encryption_key_id=$3 WHERE workspace_id=$1', [workspace, encryptSecret(currentMcpKey, secret, [workspace, version]), currentId]);
			organizationCounts.set(workspace, (organizationCounts.get(workspace) ?? 0) + 1);
		}
		for (const [workspace, count] of organizationCounts) await appendWorkspaceAuditEvent(sql, workspace, 'system:credential-rotation', 'workspace.credentials.reencrypted', { count });

		const remaining = await sql.query(`SELECT
			(SELECT count(*)::int FROM enrichable.organization_providers WHERE encryption_key_id<>$1) AS organization,
			(SELECT count(*)::int FROM enrichable.agentweb_connections WHERE encryption_key_id<>$1) AS agentweb,
			(SELECT count(*)::int FROM enrichable.mcp_keys WHERE encrypted_secret IS NOT NULL AND encryption_key_id<>$1) AS mcp`, [currentId]);
		return {
			rotated: { organizationProviders: organizations.rows.length, agentweb: agentWeb.rows.length, mcpKeys: mcpKeys.rows.length },
			remaining: { organization: Number(remaining.rows[0]?.organization ?? 0), agentweb: Number(remaining.rows[0]?.agentweb ?? 0), mcpKeys: Number(remaining.rows[0]?.mcp ?? 0) },
		};
	});
}
