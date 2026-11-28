import { currentAccount } from '@/lib/server/auth';
import { managedAuthEnabled } from '@/lib/server/deployment';

export async function GET(request: Request) {
	if (await currentAccount()) return Response.redirect(new URL('/access-required', request.url), 303);
	const signIn = managedAuthEnabled() ? '/sign-in?redirect_url=%2Faccess-required' : '/login?returnTo=%2Faccess-required';
	return Response.redirect(new URL(signIn, request.url), 303);
}
