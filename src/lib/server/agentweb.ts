import 'server-only';
import type { Account } from '../auth-identity';
import { WorkspaceError } from '../workspace';
import { decryptSecret, encryptSecret } from './credentials';
import type { Database } from './database';
import { localCredentialMasterKey } from './local-credential-store';
import { credentialKeyId, deriveCredentialKey } from './credential-keyring';

const API = 'https://mcp.agentweb.us';

export interface AgentWebUsage {
	creditsRemaining?: number;
	balanceUsd?: number;
	actionPrice?: number;
	billingStatus?: string;
}

export interface AgentWebConnectionInfo {
	connected: true;
	keyPrefix: string;
	createdAt: number;
	updatedAt: number;
	needsReconnection?: boolean;
	usageError?: string;
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): AgentWebUsage {
	const response = object(value);
	const result = object(response.result);
	const billing = Object.keys(object(response.billing)).length ? object(response.billing) : object(result.billing);
	const creditsRemaining = finite(billing.balance_remaining);
	const balanceUsd = finite(billing.balance_usd);
	const actionPrice = finite(billing.action_price);
	const billingStatus = typeof billing.billing_status === 'string' ? billing.billing_status : undefined;
	return {
		...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
		...(balanceUsd !== undefined ? { balanceUsd } : {}),
		...(actionPrice !== undefined ? { actionPrice } : {}),
		...(billingStatus ? { billingStatus } : {}),
	};
}

/** Read the authenticated member's current AgentWeb billing state. This does not execute an action. */
export async function agentWebUsage(apiKey: string): Promise<AgentWebUsage> {
	let response: Response;
	try {
		response = await fetch(`${API}/api/usage`, {
			method: 'GET',
			headers: { authorization: `Bearer ${apiKey}` },
			cache: 'no-store',
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		throw new WorkspaceError('Could not reach AgentWeb. Try again shortly.', 503);
	}
	if (response.status === 401 || response.status === 403) throw new WorkspaceError('AgentWeb rejected this API key. Check the key and try again.', 401);
	if (response.status === 429) throw new WorkspaceError('AgentWeb is rate limiting balance checks. Try again shortly.', 429);
	if (!response.ok) throw new WorkspaceError(`AgentWeb returned HTTP ${response.status} while checking the account.`, 502);
	const body: unknown = await response.json().catch(() => ({}));
	return normalizeUsage(body);
}

export class AgentWebConnectionStore {
	constructor(private readonly database: Database, private readonly encryptionSecret = () => process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET) {}

	private async key(secret = this.encryptionSecret()?.trim()) {
		if (secret) {
			if (secret.length < 32) throw new WorkspaceError('ENRICHABLE_MCP_ENCRYPTION_SECRET must contain at least 32 characters.', 503);
			return deriveCredentialKey(secret, 'enrichable:agentweb-member-connections:v1');
		}
		if (process.env.DATABASE_URL?.trim() && !process.env.ENRICHABLE_LOCAL_VAULT_SECRET?.trim()) {
			throw new WorkspaceError('Set ENRICHABLE_MCP_ENCRYPTION_SECRET (or ENRICHABLE_LOCAL_VAULT_SECRET) to encrypt member AgentWeb connections in the shared database.', 503);
		}
		// A local standalone install gets the same persistent, file-protected credential key used by its local key vault.
		return localCredentialMasterKey();
	}

	private keyId() {
		const shared = this.encryptionSecret()?.trim();
		if (shared) return credentialKeyId(shared);
		const local = process.env.ENRICHABLE_LOCAL_VAULT_SECRET?.trim();
		return local ? `local-${credentialKeyId(local)}` : 'local';
	}

	private async keyForVersion(version: string) {
		const currentVersion = this.keyId();
		if (version === currentVersion) return this.key();
		const previous = process.env.ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET?.trim();
		if (previous && previous.length >= 32 && version === credentialKeyId(previous)) return this.key(previous);
		if (version === 'legacy') return this.key(previous && previous.length >= 32 ? previous : undefined);
		throw new WorkspaceError('The AgentWeb connection uses an unknown encryption key version.', 503);
	}

	private identity(actor: Account) { return [actor.issuer, actor.user.id] as const; }

	async info(actor: Account): Promise<AgentWebConnectionInfo | null> {
		const [issuer, userId] = this.identity(actor);
		const row = (await this.database.read('SELECT key_prefix,created_at,updated_at FROM enrichable.agentweb_connections WHERE issuer=$1 AND user_id=$2', [issuer, userId])).rows[0];
		return row ? { connected: true, keyPrefix: String(row.key_prefix), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) } : null;
	}

	async secret(actor: Account): Promise<string | null> {
		const [issuer, userId] = this.identity(actor);
		return this.database.transaction(async (sql) => {
			const row = (await sql.query('SELECT encrypted_key,encryption_key_id FROM enrichable.agentweb_connections WHERE issuer=$1 AND user_id=$2 FOR UPDATE', [issuer, userId])).rows[0];
			if (!row) return null;
			const version = String(row.encryption_key_id ?? 'legacy');
			const secret = decryptSecret(await this.keyForVersion(version), String(row.encrypted_key), [issuer, userId]);
			if (!secret) throw new WorkspaceError('The AgentWeb connection could not be decrypted. Check the shared server encryption secret.', 503);
			const currentVersion = this.keyId();
			if (version !== currentVersion) await sql.query('UPDATE enrichable.agentweb_connections SET encrypted_key=$3,encryption_key_id=$4,updated_at=$5 WHERE issuer=$1 AND user_id=$2', [issuer, userId, encryptSecret(await this.key(), secret, [issuer, userId]), currentVersion, Date.now()]);
			return secret;
		});
	}

	async save(actor: Account, apiKey: string) {
		const key = apiKey.trim();
		if (!/^aw_[A-Za-z0-9._-]{16,500}$/.test(key)) throw new WorkspaceError('Enter a valid AgentWeb API key beginning with aw_.');
		const [issuer, userId] = this.identity(actor);
		const now = Date.now();
		const encryptionKey = await this.key(), encryptionKeyId = this.keyId();
		await this.database.transaction(async (sql) => {
			await sql.query(`INSERT INTO enrichable.agentweb_connections (issuer,user_id,encrypted_key,encryption_key_id,key_prefix,created_at,updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$6)
				ON CONFLICT (issuer,user_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,encryption_key_id=excluded.encryption_key_id,key_prefix=excluded.key_prefix,updated_at=excluded.updated_at`,
			[issuer, userId, encryptSecret(encryptionKey, key, [issuer, userId]), encryptionKeyId, key.slice(0, 8), now]);
		});
	}

	async disconnect(actor: Account) {
		const [issuer, userId] = this.identity(actor);
		await this.database.transaction(async (sql) => {
			await sql.query('DELETE FROM enrichable.agentweb_connections WHERE issuer=$1 AND user_id=$2', [issuer, userId]);
		});
	}
}
