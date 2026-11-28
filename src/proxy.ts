import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';
import { clerkScope, newSecret, sessionConfig, readSession, safeRedirectUrl, safeReturnTo, SESSION_COOKIE } from '@/lib/server/auth';
import { contextSignInEnabled, managedAuthEnabled, selfHostedEnabled } from '@/lib/server/deployment';
import { selfHostedCookieOptions } from '@/lib/server/self-hosted';
import { CREDIT_REPORT_PATH, creditReportAuthorized } from '@/lib/server/credit-report';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/account-messages';

const clerkProxy = clerkMiddleware(async (auth, request) => {
	const path = request.nextUrl.pathname;
	if (['/api/health/live', '/api/health/ready', '/api/stripe/webhook', '/api/clerk/webhook', '/api/internal/jobs/run'].includes(path)) return NextResponse.next();
	const session = await auth();
	const api = path.startsWith('/api/');
	if (!session.userId) {
		if (api) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
		if (path.startsWith('/app') || path === '/login') return NextResponse.redirect(new URL(`/sign-in?redirect_url=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`, request.url));
		return NextResponse.next();
	}
	if (path === '/login') return NextResponse.redirect(new URL('/app', request.url));
	if (api && path !== '/api/auth/session' && (request.headers.get('x-enrichable-account') !== clerkScope(session).partition || request.headers.get('x-enrichable-session') !== clerkScope(session).sessionId)) return NextResponse.json({ error: ACCOUNT_CHANGED_MESSAGE }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
	if (api && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && path !== '/api/stripe/webhook') {
		const origin = request.headers.get('origin');
		if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
	}
	const response = NextResponse.next();
	if (api || path.startsWith('/app')) response.headers.set('Cache-Control', 'private, no-store');
	return response;
}, { frontendApiProxy: { enabled: true, path: '/__clerk' } });

function standaloneProxy(request: NextRequest) {
	if (['/api/health/live', '/api/health/ready', '/api/stripe/webhook', '/api/clerk/webhook', '/api/internal/jobs/run'].includes(request.nextUrl.pathname)) return NextResponse.next();
	const selfHosted = selfHostedEnabled();
	if (contextSignInEnabled() && process.env.NODE_ENV === 'production' && request.nextUrl.origin !== sessionConfig().origin) {
		return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, sessionConfig().origin), 308);
	}
	if (request.nextUrl.pathname === CREDIT_REPORT_PATH) {
		if (!creditReportAuthorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
		return NextResponse.next();
	}
	if (selfHosted && ['/api/auth/start', '/api/auth/callback', '/api/auth/dev', '/api/auth/logout'].includes(request.nextUrl.pathname)) return new NextResponse(null, { status: 404 });
	if (['/api/auth/dev', '/api/auth/start', '/api/auth/callback', '/api/auth/session', '/api/auth/logout'].includes(request.nextUrl.pathname)) return NextResponse.next();
	if (request.nextUrl.pathname === '/login') return selfHosted ? NextResponse.redirect(safeRedirectUrl(request.nextUrl.searchParams.get('returnTo'), request.url)) : NextResponse.next();
	const token = request.cookies.get(SESSION_COOKIE)?.value;
	const account = readSession(token);
	const api = request.nextUrl.pathname.startsWith('/api/');
	const secureCookie = process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:';
	if (selfHosted && !account && !api) {
		const response = NextResponse.redirect(request.nextUrl);
		response.cookies.set(SESSION_COOKIE, `local.${newSecret()}`, selfHostedCookieOptions(secureCookie));
		response.headers.set('Cache-Control', 'private, no-store');
		return response;
	}
	if (!account) return api ? NextResponse.json({ error: selfHosted ? 'Open the app to initialize your workspace.' : 'Sign in to continue.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) : NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(safeReturnTo(request.nextUrl.pathname + request.nextUrl.search))}`, request.url));
	if (api && request.nextUrl.pathname !== '/api/auth/session' && (request.headers.get('x-enrichable-account') !== account.partition || request.headers.get('x-enrichable-session') !== account.sessionId)) return NextResponse.json({ error: ACCOUNT_CHANGED_MESSAGE }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
	// NextURL normalizes loopback IPs to localhost. Preserve the incoming Host
	// when checking browser origins (also supports custom self-hosted domains).
	const origin = selfHosted ? `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}` : sessionConfig().origin;
	if (api && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
	const response = NextResponse.next();
	if (selfHosted && !api) response.cookies.set(SESSION_COOKIE, token!, selfHostedCookieOptions(secureCookie));
	response.headers.set('Cache-Control', 'private, no-store');
	return response;
}

// Next invokes proxy with an event. The one-argument overload is retained for
// the standalone path and its unit tests, which deliberately exercise the
// local session flow without Clerk's runtime.
export function proxy(request: NextRequest): NextResponse;
export function proxy(request: NextRequest, event: NextFetchEvent): ReturnType<typeof clerkProxy>;
export function proxy(request: NextRequest, event?: NextFetchEvent) {
	if (managedAuthEnabled()) {
		if (!event) throw new Error('Clerk proxy requires the Next.js fetch event.');
		return clerkProxy(request, event);
	}
	return standaloneProxy(request);
}

export const config = { matcher: ['/login', '/app/:path*', '/api/:path*', '/sign-in/:path*', '/sign-up/:path*', '/access-required/:path*', '/workspace-closed/:path*', '/__clerk/:path*'] };
