import 'server-only';
import { createHash, hkdfSync } from 'node:crypto';
import { WorkspaceError } from '../workspace';

export function credentialKeyId(secret: string) {
	return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function currentEncryptionSecret() {
	const secret = process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET?.trim();
	if (!secret || secret.length < 32) throw new WorkspaceError('Set ENRICHABLE_MCP_ENCRYPTION_SECRET to a stable value of at least 32 characters.', 503);
	return secret;
}

export function previousEncryptionSecret() {
	const secret = process.env.ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET?.trim();
	if (!secret) return null;
	if (secret.length < 32) throw new WorkspaceError('ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET must contain at least 32 characters.', 503);
	if (secret === process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET?.trim()) throw new WorkspaceError('The current and previous credential encryption secrets must be different.', 503);
	return secret;
}

export function currentEncryptionKeyId() { return credentialKeyId(currentEncryptionSecret()); }

export function credentialEncryptionConfigured() {
	try {
		currentEncryptionSecret();
		previousEncryptionSecret();
		return true;
	} catch { return false; }
}

/** Legacy envelopes used the current secret without storing a key ID. During rotation, prefer the configured previous key. */
export function encryptionSecretForKeyId(keyId: string) {
	const current = currentEncryptionSecret(), previous = previousEncryptionSecret();
	if (keyId === credentialKeyId(current)) return current;
	if (keyId === 'legacy') return previous ?? current;
	if (previous && keyId === credentialKeyId(previous)) return previous;
	return null;
}

export function deriveCredentialKey(secret: string, info: string) {
	return Buffer.from(hkdfSync('sha256', secret, '', info, 32));
}

