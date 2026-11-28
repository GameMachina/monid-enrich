import 'server-only';
import { CLERK_ISSUER, type Account } from '../auth-identity';
import { WorkspaceError } from '../workspace';

/** The owner explicitly designated this verified account as the initial platform administrator. Additional operators
 * are managed through the server-only allowlist. Workspace roles never grant global table-type access. */
const INITIAL_PLATFORM_ADMIN_EMAIL = 'jalendnelson@gmail.com';

export function isPlatformAdmin(account: Account) {
	if (account.issuer !== CLERK_ISSUER || !account.user.email_verified || !account.user.email) return false;
	const allowlist = new Set([INITIAL_PLATFORM_ADMIN_EMAIL, ...(process.env.ENRICHABLE_PLATFORM_ADMIN_EMAILS ?? '').split(',')].map((email) => email.trim().toLowerCase()).filter(Boolean));
	return allowlist.has(account.user.email.toLowerCase());
}

export function requirePlatformAdmin(account: Account) {
	if (!isPlatformAdmin(account)) throw new WorkspaceError('A verified platform administrator account is required.', 403);
}
