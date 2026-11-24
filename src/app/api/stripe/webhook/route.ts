import { handleStripeEvent, verifyStripeEvent } from '@/lib/server/stripe-billing';
import { withDatabase } from '@/lib/server/database';

export const maxDuration = 30;

export async function POST(request: Request) {
	const raw = await request.text();
	if (Buffer.byteLength(raw) > 1_000_000) return Response.json({ error: 'Webhook payload too large.' }, { status: 413 });
	let event;
	try { event = verifyStripeEvent(raw, request.headers.get('stripe-signature')); }
	catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid webhook signature.' }, { status: 400 }); }
	try {
		const processed = await withDatabase((database) => handleStripeEvent(event, database));
		return Response.json({ received: true, processed }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		// Return a retryable status while keeping event and customer details out of the response.
		return Response.json({ error: 'Webhook processing failed; Stripe may retry this event.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	}
}
