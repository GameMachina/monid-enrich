import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { z } from 'zod';
import { identitySchema, CLERK_ISSUER, type Account } from '../auth-identity';
import { authMode, configuredUrl, contextSignInEnabled, managedAuthEnabled, selfHostedEnabled } from './deployment';
import { selfHostedAccount } from './self-hosted';

export const authCookieName = (name: string) => `${process.env.NODE_ENV === 'production' ? '__Host-' : ''}enrichable.${name}`;
export const SESSION_COOKIE = authCookieName('session');
export const FLOW_COOKIE = authCookieName('signin');
export const SESSION_SECONDS = 14 * 24 * 60 * 60;
const flowSchema = z.object({ state: z.string().min(32), verifier: z.string().min(43), returnTo: z.string(), reconnect: z.boolean().optional() });
const sessionSchema = identitySchema.extend({ partition: z.string().regex(/^[a-f0-9]{64}$/), sessionId: z.string().min(32) });

export const DEV_ISSUER = 'https://dev.enrichable.localhost';
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

export function devAuthEnabled(requestOrigin?: string) {
	if (process.env.NODE_ENV !== 'development' || process.env.ENRICHABLE_DEV_AUTH !== 'true') return false;
	try {
		const app = new URL(process.env.ENRICHABLE_APP_URL || 'http://localhost:3000');
		return ['http:', 'https:'].includes(app.protocol) && loopbackHosts.includes(app.hostname) && (requestOrigin === undefined || requestOrigin === app.origin);
	} catch { return false; }
}

export function sessionConfig() {
	const app = configuredUrl('ENRICHABLE_APP_URL', process.env.ENRICHABLE_APP_URL || 'http://localhost:3000');
	const issuer = configuredUrl('CONTEXT_IDENTITY_ISSUER', process.env.CONTEXT_IDENTITY_ISSUER || 'https://www.context.dev');
	for (const url of [app, issuer]) if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Authentication requires HTTPS');
	const secret = z.string().min(32).parse(process.env.ENRICHABLE_SESSION_SECRET);
	return { origin: app.origin, issuer: issuer.origin, secret };
}

export function authConfig() {
	if (!contextSignInEnabled()) throw new Error('Context.dev sign-in is not available in Monid Enrich.');
	const config = sessionConfig();
	return { ...config, clientId: z.string().min(1).parse(process.env.CONTEXT_OAUTH_CLIENT_ID), clientSecret: z.string().min(32).parse(process.env.CONTEXT_OAUTH_CLIENT_SECRET), callback: `${config.origin}/api/auth/callback` };
}

export function seal(value: unknown, purpose: 'flow' | 'session', seconds: number, now = Date.now()): string {
	const body = Buffer.from(JSON.stringify({ value, purpose, exp: now + seconds * 1000 })).toString('base64url');
	return `${body}.${createHmac('sha256', sessionConfig().secret).update(body).digest('base64url')}`;
}

export function unseal(token: string | undefined, purpose: 'flow' | 'session', now?: number): unknown {
	if (!token || token.length > 8192) return null;
	try {
		const [body, signature, extra] = token.split('.');
		if (!body || !signature || extra) return null;
		const expected = createHmac('sha256', sessionConfig().secret).update(body).digest();
		const actual = Buffer.from(signature, 'base64url');
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
		const data = JSON.parse(Buffer.from(body, 'base64url').toString());
		return data.purpose === purpose && Number.isFinite(data.exp) && data.exp > (now ?? Date.now()) ? data.value : null;
	} catch { return null; }
}

export function readSession(token?: string): (Account & { sessionId: string }) | null {
	if (selfHostedEnabled()) return selfHostedAccount(token);
	if (authMode() === 'unconfigured') return null;
	const result = sessionSchema.safeParse(unseal(token, 'session'));
	return result.success && acceptedIssuer(result.data.issuer) ? result.data : null;
}

export function clerkScope(input: { userId: string; orgId?: string | null; sessionId?: string | null }) {
	const organizationId = input.orgId || `personal:${input.userId}`;
	return {
		organizationId,
		partition: createHash('sha256').update(JSON.stringify([CLERK_ISSUER, input.userId, organizationId])).digest('hex'),
		sessionId: createHash('sha256').update(`clerk-session:${input.sessionId || input.userId}`).digest('hex'),
	};
}

/** Map the verified active Clerk session to the app's existing workspace identity. Organization scope comes only
 * from Clerk's signed session, and personal accounts are isolated as their own workspace. */
export async function clerkAccount() {
	const { auth } = await import('@clerk/nextjs/server');
	const session = await auth();
	if (!session.userId) return null;
	const claims = session.sessionClaims as Record<string, unknown>;
	const scope = clerkScope(session);
	const email = typeof claims.email === 'string' && z.string().email().safeParse(claims.email).success ? claims.email : undefined;
	const name = typeof claims.name === 'string' ? claims.name : undefined;
	const organizationName = typeof claims.org_name === 'string' ? claims.org_name : typeof claims.org_slug === 'string' ? claims.org_slug : session.orgId ? session.orgId : 'Personal workspace';
	return {
		issuer: CLERK_ISSUER,
		user: { id: session.userId, ...(email ? { email } : {}), email_verified: claims.email_verified === true || claims.email_verified === 'true', ...(name ? { name } : {}) },
		organization: { id: scope.organizationId, name: organizationName },
		role: !session.orgId ? 'owner' as const : session.orgRole === 'org:admin' ? 'admin' as const : 'member' as const,
		partition: scope.partition,
		sessionId: scope.sessionId,
	};
}

export async function currentAccount() {
	await connection();
	if (managedAuthEnabled()) return clerkAccount();
	return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}
export const cookieOptions = () => ({ httpOnly: true, secure: sessionConfig().origin.startsWith('https:'), sameSite: 'lax' as const, path: '/' });
export const newSecret = () => randomBytes(32).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export const safeReturnTo = (value: string | null) => value && /^\/app(?:[/?]|$)/.test(value) && !/[\\\r\n]/.test(value) ? value : '/app';

/** The only way auth flows build a redirect from a caller-supplied return path: an /app path on `base`'s origin, else /app. */
export function safeRedirectUrl(returnTo: string | null, base: string | URL) {
	const url = new URL(safeReturnTo(returnTo), base);
	return url.origin === new URL(base).origin ? url : new URL('/app', base);
}

export function readFlow(token?: string) {
	const result = flowSchema.safeParse(unseal(token, 'flow'));
	return result.success ? result.data : null;
}

function acceptedIssuer(issuer: string) {
	if (issuer === DEV_ISSUER) return devAuthEnabled();
	return issuer === sessionConfig().issuer;
}

export function accountFromIdentity(input: unknown): Account {
	const identity = identitySchema.parse(input);
	if (!identity.scope?.split(/\s+/).includes('logolink.read')) delete identity.organization.logolink_public_id;
	if (!acceptedIssuer(identity.issuer)) throw new Error('Unexpected identity issuer');
	return { ...identity, partition: createHash('sha256').update(JSON.stringify([identity.issuer, identity.user.id, identity.organization.id])).digest('hex') };
}
