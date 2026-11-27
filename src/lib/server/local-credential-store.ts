import 'server-only';

import { randomBytes, hkdfSync } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Account } from '../auth-identity';
import { SELF_HOSTED_ISSUER } from '../auth-identity';
import { decryptSecret, encryptSecret } from './credentials';
import { WorkspaceError } from '../workspace';

type KeyName = 'monid' | 'openai';
type VaultFile = Record<string, Partial<Record<KeyName, string>>>;
type LegacyVaultFile = Record<string, Partial<Record<KeyName | 'treg', string>>>;
const NAMES: readonly KeyName[] = ['monid', 'openai'];
let writes: Promise<unknown> = Promise.resolve();
let legacyTregMigration: Promise<void> | null = null;

function directory() { return path.resolve(/*turbopackIgnore: true*/ process.env.ENRICHABLE_LOCAL_VAULT_DIR?.trim() || path.join(process.cwd(), '.data')); }

function needsConfiguredSecret() {
	return process.env.NODE_ENV === 'production' && (process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || Boolean(process.env.NETLIFY));
}

export async function localCredentialMasterKey(): Promise<Buffer> {
	const secret = process.env.ENRICHABLE_LOCAL_VAULT_SECRET || process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET;
	if (secret) {
		if (secret.length < 32) throw new WorkspaceError('ENRICHABLE_LOCAL_VAULT_SECRET must contain at least 32 characters.', 503);
		return Buffer.from(hkdfSync('sha256', secret, 'monid-enrich', 'local-credentials-v1', 32));
	}
	const folder = directory();
	await mkdir(folder, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') await chmod(folder, 0o700);
	const file = path.join(folder, 'credentials.key');
	try {
		const key = await readFile(file);
		if (key.length !== 32) throw new WorkspaceError('The local credential vault key is invalid.', 503);
		return key;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		if (needsConfiguredSecret()) throw new WorkspaceError('Set ENRICHABLE_LOCAL_VAULT_SECRET or configure DATABASE_URL and ENRICHABLE_MCP_ENCRYPTION_SECRET to save API keys securely on an ephemeral deployment.', 503);
		const key = randomBytes(32);
		try { const handle = await open(file, 'wx', 0o600); await handle.writeFile(key); await handle.close(); }
		catch (race) { if ((race as NodeJS.ErrnoException).code !== 'EEXIST') throw race; return localCredentialMasterKey(); }
		return key;
	}
}

async function readFileData(): Promise<LegacyVaultFile> {
	try {
		const value: unknown = JSON.parse(await readFile(path.join(directory(), 'credentials.json'), 'utf8'));
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid vault file');
		return value as VaultFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw new WorkspaceError('The local credential vault could not be read.', 503);
	}
}

async function writeFileData(data: LegacyVaultFile) {
	const folder = directory();
	await mkdir(folder, { recursive: true, mode: 0o700 });
	const temporary = path.join(folder, `credentials.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
	await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
	await rename(temporary, path.join(folder, 'credentials.json'));
}

/** Remove the retired provider credential from the self-hosted vault, keeping Monid and OpenAI secrets intact. */
async function removeLegacyTregCredentials() {
	if (!legacyTregMigration) {
		const migration = writes.catch(() => {}).then(async () => {
			const data = await readFileData();
			let changed = false;
			for (const saved of Object.values(data)) {
				if (!saved || !('treg' in saved)) continue;
				delete saved.treg;
				changed = true;
			}
			if (changed) await writeFileData(data);
		});
		legacyTregMigration = migration.catch((error: unknown) => { legacyTregMigration = null; throw error; });
		writes = legacyTregMigration;
	}
	await legacyTregMigration;
}

function actorKey(account: Account) {
	if (account.issuer !== SELF_HOSTED_ISSUER) throw new WorkspaceError('Local credentials are only available to this self-hosted workspace.', 403);
	return account.partition;
}

export async function localCredentialVault(account: Account) {
	await removeLegacyTregCredentials();
	const workspace = actorKey(account), key = await localCredentialMasterKey(), data = await readFileData(), saved = data[workspace] ?? {};
	const keys: Partial<Record<KeyName, string>> = {};
	for (const name of NAMES) {
		const encrypted = saved[name];
		if (!encrypted) continue;
		const value = decryptSecret(key, encrypted, [workspace, name]);
		if (value === null) throw new WorkspaceError('A saved API key could not be decrypted. Check the local vault secret.', 503);
		keys[name] = value;
	}
	return { keys, preferences: {} };
}

export async function localCredentialStatus(account: Account) {
	const vault = await localCredentialVault(account);
	return Object.fromEntries(NAMES.map((name) => {
		const value = vault.keys[name];
		return [name, value ? { connected: true, prefix: value.length >= 12 ? value.slice(0, 7) : '' } : { connected: false }];
	})) as Record<KeyName, { connected: boolean; prefix?: string }>;
}

export async function updateLocalCredentials(account: Account, patch: Partial<Record<KeyName, string | null>>) {
	await removeLegacyTregCredentials();
	const workspace = actorKey(account);
	const current = writes.catch(() => {}).then(async () => {
		const key = await localCredentialMasterKey(), data = await readFileData(), saved = { ...(data[workspace] ?? {}) };
		for (const name of NAMES) {
			const value = patch[name];
			if (value === undefined) continue;
			if (value === null || value.trim() === '') delete saved[name];
			else {
				if (value.length > 512 || /[\r\n]/.test(value)) throw new WorkspaceError(`Invalid ${name === 'monid' ? 'Monid' : 'OpenAI'} API key.`, 400);
				saved[name] = encryptSecret(key, value.trim(), [workspace, name]);
			}
		}
		if (Object.keys(saved).length) data[workspace] = saved; else delete data[workspace];
		await writeFileData(data);
	});
	writes = current;
	await current;
	return localCredentialStatus(account);
}
