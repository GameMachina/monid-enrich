import 'server-only';
import Stripe from 'stripe';
import { WorkspaceError } from '../workspace';
import type { Account } from '../auth-identity';
import { workspaceId, withDatabase, type Database, type Sql, type WorkspaceActor } from './database';
import { jsonError } from './credentials';

let cached: { key: string; client: Stripe } | undefined;
export function stripeConfigured() {
	return Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_') && process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') && process.env.STRIPE_PRICE_ID?.startsWith('price_') && publicAppUrl());
}
export function billingRequired() { return process.env.ENRICHABLE_BILLING_REQUIRED === 'true'; }
function publicAppUrl() {
	const value = process.env.ENRICHABLE_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
	if (!value || !URL.canParse(value)) return null;
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) return null;
	return url.origin;
}
function stripe() {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key?.startsWith('sk_')) throw new WorkspaceError('Subscription billing is not configured. Ask the workspace owner to finish billing setup.', 503);
	if (!cached || cached.key !== key) cached = { key, client: new Stripe(key) };
	return cached.client;
}
function priceId() {
	const value = process.env.STRIPE_PRICE_ID;
	if (!value?.startsWith('price_')) throw new WorkspaceError('Subscription plan is not configured.', 503);
	return value;
}
function workspaceActor(account: Account): WorkspaceActor { return { issuer: account.issuer, organization: account.organization }; }

async function customerFor(account: Account, database: Database) {
	const workspace = workspaceId(workspaceActor(account));
	const existing = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (existing) return String(existing.customer_id);
	const created = await stripe().customers.create({
		name: account.organization.name,
		...(account.user.email ? { email: account.user.email } : {}),
		metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer },
	}, { idempotencyKey: `enrichable-customer-${workspace}` });
	await database.transaction(async (sql) => {
		await sql.query('INSERT INTO enrichable.stripe_customers (workspace_id,customer_id) VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING', [workspace, created.id]);
	});
	const saved = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (!saved) throw new WorkspaceError('Could not save subscription customer.', 503);
	return String(saved.customer_id);
}

export async function billingSnapshot(account: Account, database: Database) {
	const workspace = workspaceId(workspaceActor(account));
	const row = (await database.read(`SELECT s.status,s.price_id,s.current_period_end,s.cancel_at_period_end,s.subscription_id
		FROM enrichable.workspace_subscriptions s WHERE s.workspace_id=$1`, [workspace])).rows[0];
	return {
		configured: stripeConfigured(), required: billingRequired(),
		subscription: row ? { status: String(row.status), priceId: row.price_id ? String(row.price_id) : null, currentPeriodEnd: row.current_period_end === null ? null : Number(row.current_period_end), cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), active: ['active', 'trialing'].includes(String(row.status)) } : null,
	};
}

export async function createCheckout(account: Account, database: Database, idempotencyKey: string) {
	const origin = publicAppUrl();
	if (!origin) throw new WorkspaceError('Set ENRICHABLE_APP_URL to the public HTTPS app URL before enabling billing.', 503);
	const workspace = workspaceId(workspaceActor(account));
	const customer = await customerFor(account, database);
	const session = await stripe().checkout.sessions.create({
		mode: 'subscription', customer, client_reference_id: workspace,
		line_items: [{ price: priceId(), quantity: 1 }],
		success_url: `${origin}/app/settings?billing=success`,
		cancel_url: `${origin}/app/settings?billing=cancelled`,
		metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer },
		subscription_data: { metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer } },
	}, { idempotencyKey });
	if (!session.url) throw new WorkspaceError('Stripe did not return a checkout URL.', 502);
	return { url: session.url };
}

export async function createPortal(account: Account, database: Database) {
	const origin = publicAppUrl();
	if (!origin) throw new WorkspaceError('Set ENRICHABLE_APP_URL to the public HTTPS app URL before enabling billing.', 503);
	const workspace = workspaceId(workspaceActor(account));
	const customer = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (!customer) throw new WorkspaceError('This workspace has no subscription customer yet.', 404);
	const session = await stripe().billingPortal.sessions.create({ customer: String(customer.customer_id), return_url: `${origin}/app/settings` });
	return { url: session.url };
}

export async function requireActiveSubscription(account: Account | undefined) {
	if (!billingRequired()) return;
	if (!account) throw new WorkspaceError('Sign in required.', 401);
	const snapshot = await withDatabase((database) => billingSnapshot(account, database));
	if (!snapshot.configured) throw new WorkspaceError('Subscription billing is not configured. Enrichment is temporarily unavailable.', 503);
	if (!snapshot.subscription?.active) throw new WorkspaceError('An active Monid Enrich subscription is required. Open Configuration to manage billing.', 402);
}

export async function subscriptionGate(account: Account | undefined): Promise<Response | null> {
	try { await requireActiveSubscription(account); return null; }
	catch (error) { return jsonError(error instanceof Error ? error.message : 'Subscription verification failed.', error instanceof WorkspaceError ? error.status : 503); }
}

function asId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null) { return typeof value === 'string' ? value : value?.id ?? null; }
async function saveSubscription(sql: Sql, database: Database, subscription: Stripe.Subscription, workspaceHint?: string) {
	const customerId = asId(subscription.customer);
	if (!customerId) return;
	const metadataWorkspace = subscription.metadata?.enrichable_workspace_id;
	const workspace = workspaceHint || metadataWorkspace || (await sql.query('SELECT workspace_id FROM enrichable.stripe_customers WHERE customer_id=$1', [customerId])).rows[0]?.workspace_id;
	if (typeof workspace !== 'string' || !workspace) throw new Error('Stripe subscription could not be mapped to a workspace.');
	const firstItem = subscription.items.data[0];
	const periodEnd = firstItem?.current_period_end ?? subscription.items.data[0]?.current_period_end ?? null;
	await sql.query(`INSERT INTO enrichable.workspace_subscriptions (workspace_id,customer_id,subscription_id,price_id,status,current_period_end,cancel_at_period_end,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (workspace_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,price_id=excluded.price_id,status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`, [workspace, customerId, subscription.id, firstItem?.price.id ?? null, subscription.status, periodEnd, subscription.cancel_at_period_end]);
}

export async function processStripeEvent(event: Stripe.Event, database: Database) {
	let session: Stripe.Checkout.Session | undefined;
	let subscription: Stripe.Subscription | undefined;
	let workspaceHint: string | undefined;
	if (event.type === 'checkout.session.completed') {
		session = event.data.object as Stripe.Checkout.Session;
		workspaceHint = session.metadata?.enrichable_workspace_id ?? session.client_reference_id ?? undefined;
		const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
		if (subId) subscription = await stripe().subscriptions.retrieve(subId);
	} else if (event.type.startsWith('customer.subscription.')) {
		const snapshot = event.data.object as Stripe.Subscription;
		// Webhooks may arrive late or out of order. Fetch Stripe's current subscription state so an older
		// `updated` snapshot cannot overwrite a newer cancellation or payment recovery.
		subscription = await stripe().subscriptions.retrieve(snapshot.id);
	}
	return database.transaction(async (sql) => {
		const inserted = await sql.query('INSERT INTO enrichable.stripe_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id', [event.id, event.type]);
		if (!inserted.rows.length) return false;
		if (session) {
			const customerId = asId(session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null);
			if (workspaceHint && customerId) await sql.query('INSERT INTO enrichable.stripe_customers (workspace_id,customer_id) VALUES ($1,$2) ON CONFLICT (workspace_id) DO UPDATE SET customer_id=excluded.customer_id,updated_at=now()', [workspaceHint, customerId]);
		}
		if (subscription) await saveSubscription(sql, database, subscription, workspaceHint);
		return true;
	});
}

export const handleStripeEvent = processStripeEvent;

export function verifyStripeEvent(payload: string, signature: string | null) {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret?.startsWith('whsec_') || !signature) throw new WorkspaceError('Stripe webhook signature is missing or billing is not configured.', 400);
	try { return stripe().webhooks.constructEvent(payload, signature, secret); }
	catch { throw new WorkspaceError('Stripe webhook signature is invalid.', 400); }
}
