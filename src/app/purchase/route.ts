import { stripePaymentLinkUrl } from '@/lib/server/stripe-billing';

export async function GET() {
	const url = stripePaymentLinkUrl();
	if (!url) return Response.json({ error: 'The hosted $37 Stripe payment link is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	return Response.redirect(url, 303);
}
