import 'server-only';
import Stripe from 'stripe';
import { WorkspaceError } from '../workspace';
import type { Account } from '../auth-identity';
import { workspaceId, withDatabase, type Database, type Sql, type WorkspaceActor } from './database';
import { jsonError } from './credentials';
import { appendWorkspaceAuditEvent, recordWorkspaceAuditEvent } from './workspace-audit';

const PURCHASE_AMOUNT_CENTS = 3700;
const PURCHASE_CURRENCY = 'usd';
let cached: { key: string; client: Stripe } | undefined;

export function stripeConfigured() {
	return Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_') && process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') && process.env.STRIPE_ONE_TIME_PRICE_ID?.startsWith('price_') && process.env.STRIPE_PAYMENT_LINK_ID?.startsWith('plink_') && stripePaymentLinkUrl() && publicAppUrl());
}
export function billingRequired() { return process.env.ENRICHABLE_BILLING_REQUIRED === 'true'; }
export function stripePaymentLinkUrl() {
	const value = process.env.STRIPE_PAYMENT_LINK_URL;
	if (!value || !URL.canParse(value)) return null;
	const url = new URL(value);
	return url.protocol === 'https:' && url.hostname === 'buy.stripe.com' ? url.toString() : null;
}
function publicAppUrl() {
	const value = process.env.ENRICHABLE_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
	if (!value || !URL.canParse(value)) return null;
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) return null;
	return url.origin;
}
function stripe() {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key?.startsWith('sk_')) throw new WorkspaceError('Stripe payments are not configured. Ask the workspace owner to finish billing setup.', 503);
	if (!cached || cached.key !== key) cached = { key, client: new Stripe(key) };
	return cached.client;
}
function priceId() {
	const value = process.env.STRIPE_ONE_TIME_PRICE_ID;
	if (!value?.startsWith('price_')) throw new WorkspaceError('The $37 one-time price is not configured.', 503);
	return value;
}
function workspaceActor(account: Account): WorkspaceActor { return { issuer: account.issuer, organization: account.organization }; }
function accountWorkspace(account: Account) { return workspaceId(workspaceActor(account)); }

async function verifiedPrice() {
	const price = await stripe().prices.retrieve(priceId());
	if (!price.active || price.unit_amount !== PURCHASE_AMOUNT_CENTS || price.currency !== PURCHASE_CURRENCY || price.recurring) {
		throw new WorkspaceError('The configured Stripe price must be active, one-time, and exactly $37 USD.', 503);
	}
	return price.id;
}

async function customerFor(account: Account, database: Database) {
	const workspace = accountWorkspace(account);
	const existing = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (existing) return String(existing.customer_id);
	const created = await stripe().customers.create({
		name: account.organization.name,
		...(account.user.email ? { email: account.user.email } : {}),
		metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer },
	}, { idempotencyKey: `enrichable-customer-${workspace}` });
	await database.transaction(async (sql) => {
		await sql.query('INSERT INTO enrichable.stripe_customers (workspace_id,customer_id) VALUES ($1,$2) ON CONFLICT (workspace_id) DO NOTHING', [workspace, created.id]);
	}, { workspace: account });
	const saved = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (!saved) throw new WorkspaceError('Could not save the workspace payment customer.', 503);
	return String(saved.customer_id);
}

export async function billingSnapshot(account: Account, database: Database) {
	const workspace = accountWorkspace(account);
	const [purchaseResult, subscriptionResult] = await Promise.all([
		database.read(`SELECT session_id,status,amount_total,currency,created_at FROM enrichable.stripe_one_time_purchases
			WHERE workspace_id=$1 AND status IN ('paid','refunded','disputed') ORDER BY (status='paid') DESC,created_at DESC LIMIT 1`, [workspace]),
		database.read(`SELECT s.status,s.price_id,s.current_period_end,s.cancel_at_period_end,s.subscription_id
			FROM enrichable.workspace_subscriptions s WHERE s.workspace_id=$1`, [workspace]),
	]);
	const row = subscriptionResult.rows[0];
	const purchase = purchaseResult.rows[0];
	const legacySubscription = row ? { status: String(row.status), priceId: row.price_id ? String(row.price_id) : null, currentPeriodEnd: row.current_period_end === null ? null : Number(row.current_period_end), cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), active: ['active', 'trialing'].includes(String(row.status)) } : null;
	const activePurchase = purchase && String(purchase.status) === 'paid' ? {
		status: 'paid' as const,
		amountUsd: Number(purchase.amount_total ?? PURCHASE_AMOUNT_CENTS) / 100,
		currency: String(purchase.currency ?? PURCHASE_CURRENCY),
		purchasedAt: purchase.created_at instanceof Date ? purchase.created_at.toISOString() : String(purchase.created_at),
	} : null;
	return {
		configured: stripeConfigured(), required: billingRequired(), priceUsd: PURCHASE_AMOUNT_CENTS / 100,
		purchase: activePurchase,
		purchaseStatus: purchase ? String(purchase.status) : null,
		legacySubscription,
		hasAccess: Boolean(activePurchase || legacySubscription?.active),
	};
}

export async function createCheckout(account: Account, database: Database, idempotencyKey: string) {
	const origin = publicAppUrl();
	if (!origin) throw new WorkspaceError('Set ENRICHABLE_APP_URL to the public HTTPS app URL before enabling payments.', 503);
	const snapshot = await billingSnapshot(account, database);
	if (snapshot.hasAccess) throw new WorkspaceError('This workspace already has Monid Enrich access.', 409);
	const [price, customer] = await Promise.all([verifiedPrice(), customerFor(account, database)]);
	const workspace = accountWorkspace(account);
	const session = await stripe().checkout.sessions.create({
		mode: 'payment', customer, client_reference_id: workspace,
		line_items: [{ price, quantity: 1 }],
		success_url: `${origin}/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${origin}/app/settings?billing=cancelled`,
		metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer, enrichable_purchase: 'lifetime_access' },
		payment_intent_data: { metadata: { enrichable_workspace_id: workspace, enrichable_issuer: account.issuer, enrichable_purchase: 'lifetime_access' } },
	}, { idempotencyKey });
	if (!session.url) throw new WorkspaceError('Stripe did not return a checkout URL.', 502);
	await recordWorkspaceAuditEvent(database, account, 'workspace.billing.checkout_started', { provider: 'stripe', mode: 'payment', amountUsd: PURCHASE_AMOUNT_CENTS / 100 });
	return { url: session.url };
}

export async function createPortal(account: Account, database: Database) {
	const origin = publicAppUrl();
	if (!origin) throw new WorkspaceError('Set ENRICHABLE_APP_URL to the public HTTPS app URL before enabling payments.', 503);
	const workspace = accountWorkspace(account);
	const customer = (await database.read('SELECT customer_id FROM enrichable.stripe_customers WHERE workspace_id=$1', [workspace])).rows[0];
	if (!customer) throw new WorkspaceError('This workspace has no legacy subscription to manage.', 404);
	const session = await stripe().billingPortal.sessions.create({ customer: String(customer.customer_id), return_url: `${origin}/app/settings` });
	await recordWorkspaceAuditEvent(database, account, 'workspace.billing.portal_opened', { provider: 'stripe', legacy: true });
	return { url: session.url };
}

export async function requirePurchase(account: Account | undefined) {
	if (!billingRequired()) return;
	if (!account) throw new WorkspaceError('Sign in required.', 401);
	const snapshot = await withDatabase((database) => billingSnapshot(account, database));
	if (!snapshot.configured) throw new WorkspaceError('One-time Stripe payments are not configured. Enrichment is temporarily unavailable.', 503);
	if (!snapshot.hasAccess) throw new WorkspaceError('Purchase Monid Enrich lifetime access for $37 once in Configuration to use enrichment.', 402);
}

export async function purchaseGate(account: Account | undefined): Promise<Response | null> {
	try { await requirePurchase(account); return null; }
	catch (error) { return jsonError(error instanceof Error ? error.message : 'Purchase verification failed.', error instanceof WorkspaceError ? error.status : 503); }
}

/** Kept as a source-compatible alias while route consumers move from subscriptions to one-time access. */
export const subscriptionGate = purchaseGate;

function asId(value: string | Stripe.Customer | Stripe.DeletedCustomer | Stripe.Charge | Stripe.PaymentIntent | Stripe.PaymentLink | Stripe.Subscription | null | undefined) {
	return typeof value === 'string' ? value : value?.id ?? null;
}
function sessionEmail(session: Stripe.Checkout.Session) {
	return (session.customer_details?.email ?? session.customer_email ?? '').trim().toLowerCase() || null;
}

async function savePurchase(sql: Sql, session: Stripe.Checkout.Session, status: 'paid' | 'unpaid', workspaceHint?: string) {
	const customerId = asId(session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null);
	const paymentIntentId = asId(session.payment_intent as string | Stripe.PaymentIntent | null);
	const appCheckout = session.metadata?.enrichable_purchase === 'lifetime_access';
	const linkedWorkspace = workspaceHint || (appCheckout && customerId ? (await sql.query('SELECT workspace_id FROM enrichable.stripe_customers WHERE customer_id=$1', [customerId])).rows[0]?.workspace_id : undefined);
	const workspace = typeof linkedWorkspace === 'string' && linkedWorkspace ? linkedWorkspace : null;
	const paymentLinkId = asId(session.payment_link as string | Stripe.PaymentLink | null);
	await sql.query(`INSERT INTO enrichable.stripe_one_time_purchases (session_id,workspace_id,customer_id,payment_intent_id,payment_link_id,buyer_email,amount_total,currency,status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (session_id) DO UPDATE SET
			workspace_id=COALESCE(enrichable.stripe_one_time_purchases.workspace_id,excluded.workspace_id),
			customer_id=COALESCE(excluded.customer_id,enrichable.stripe_one_time_purchases.customer_id),
			payment_intent_id=COALESCE(excluded.payment_intent_id,enrichable.stripe_one_time_purchases.payment_intent_id),
			payment_link_id=COALESCE(excluded.payment_link_id,enrichable.stripe_one_time_purchases.payment_link_id),
			buyer_email=COALESCE(excluded.buyer_email,enrichable.stripe_one_time_purchases.buyer_email),
			amount_total=excluded.amount_total,currency=excluded.currency,
			status=CASE WHEN enrichable.stripe_one_time_purchases.status IN ('refunded','disputed') THEN enrichable.stripe_one_time_purchases.status WHEN excluded.status='paid' THEN 'paid' ELSE enrichable.stripe_one_time_purchases.status END,
			updated_at=now()`, [session.id, workspace, customerId, paymentIntentId, paymentLinkId, sessionEmail(session), session.amount_total, session.currency, status]);
	return workspace;
}

export async function claimStripePurchase(account: Account, database: Database, sessionId: string) {
	if (!account.user.email || !account.user.email_verified) throw new WorkspaceError('Verify your account email before claiming this purchase.', 403);
	const session = await stripe().checkout.sessions.retrieve(sessionId);
	if (session.mode !== 'payment' || session.payment_status !== 'paid' || session.amount_total !== PURCHASE_AMOUNT_CENTS || session.currency !== PURCHASE_CURRENCY) {
		throw new WorkspaceError('Stripe has not confirmed a $37 USD payment for this session.', 409);
	}
	const workspace = accountWorkspace(account);
	const sessionWorkspace = session.metadata?.enrichable_workspace_id ?? session.client_reference_id;
	const appCheckout = sessionWorkspace === workspace && session.metadata?.enrichable_issuer === account.issuer && session.metadata?.enrichable_purchase === 'lifetime_access';
	const paymentLink = asId(session.payment_link as string | Stripe.PaymentLink | null);
	const publicLinkCheckout = Boolean(process.env.STRIPE_PAYMENT_LINK_ID && paymentLink === process.env.STRIPE_PAYMENT_LINK_ID && sessionEmail(session) === account.user.email.trim().toLowerCase());
	if (!appCheckout && !publicLinkCheckout) throw new WorkspaceError('This paid Stripe session is not linked to your workspace or verified account email.', 403);
	const workspaceHint = appCheckout ? workspace : undefined;
	return database.transaction(async (sql, scopedWorkspace) => {
		const before = (await sql.query('SELECT workspace_id,status FROM enrichable.stripe_one_time_purchases WHERE session_id=$1 FOR UPDATE', [session.id])).rows[0];
		await savePurchase(sql, session, 'paid', workspaceHint);
		if (before?.workspace_id === scopedWorkspace && before.status === 'paid') return { claimed: true, alreadyClaimed: true };
		const claimed = await sql.query(`UPDATE enrichable.stripe_one_time_purchases SET workspace_id=$2,updated_at=now()
			WHERE session_id=$1 AND status='paid' AND (workspace_id IS NULL OR workspace_id=$2) RETURNING session_id`, [session.id, scopedWorkspace]);
		if (!claimed.rows.length) {
			const current = (await sql.query('SELECT workspace_id,status FROM enrichable.stripe_one_time_purchases WHERE session_id=$1', [session.id])).rows[0];
			if (current?.workspace_id === scopedWorkspace && current.status === 'paid') return { claimed: true, alreadyClaimed: true };
			throw new WorkspaceError('This purchase is not available to claim. Check the payment status or contact support.', 409);
		}
		await appendWorkspaceAuditEvent(sql, scopedWorkspace, account.user.id, 'workspace.billing.purchase_updated', { status: 'paid', amountUsd: PURCHASE_AMOUNT_CENTS / 100, source: publicLinkCheckout ? 'payment_link' : 'checkout' });
		return { claimed: true, alreadyClaimed: false };
	}, { workspace: account });
}

async function updatePurchaseStatus(sql: Sql, paymentIntentId: string, status: 'refunded' | 'disputed' | 'paid') {
	const rows = await sql.query(`UPDATE enrichable.stripe_one_time_purchases SET status=$2,updated_at=now()
		WHERE payment_intent_id=$1 AND ($2<>'paid' OR status<>'refunded') RETURNING workspace_id,status,amount_total`, [paymentIntentId, status]);
	for (const row of rows.rows) if (typeof row.workspace_id === 'string') {
		await appendWorkspaceAuditEvent(sql, row.workspace_id, 'system:stripe', 'workspace.billing.purchase_updated', { status: String(row.status), amountUsd: Number(row.amount_total ?? 0) / 100 });
	}
}

export async function processStripeEvent(event: Stripe.Event, database: Database) {
	let session: Stripe.Checkout.Session | undefined;
	let subscription: Stripe.Subscription | undefined;
	let workspaceHint: string | undefined;
	let charge: Stripe.Charge | undefined;
	let disputeStatus: 'disputed' | 'paid' | undefined;
	if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.async_payment_failed') {
		session = event.data.object as Stripe.Checkout.Session;
		if (session.mode === 'subscription') {
			workspaceHint = session.metadata?.enrichable_workspace_id ?? session.client_reference_id ?? undefined;
			const subId = asId(session.subscription as string | Stripe.Subscription | null);
			if (subId) subscription = await stripe().subscriptions.retrieve(subId);
		}
	} else if (event.type.startsWith('customer.subscription.')) {
		const snapshot = event.data.object as Stripe.Subscription;
		// Read current Stripe state so a late event cannot overwrite a newer cancellation or payment recovery.
		subscription = await stripe().subscriptions.retrieve(snapshot.id);
	} else if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded') {
		const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
		const subId = asId(invoice.subscription);
		if (subId) subscription = await stripe().subscriptions.retrieve(subId);
	} else if (event.type === 'charge.refunded') {
		charge = event.data.object as Stripe.Charge;
	} else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
		const dispute = event.data.object as Stripe.Dispute;
		const chargeId = asId(dispute.charge as string | Stripe.Charge);
		if (chargeId) charge = await stripe().charges.retrieve(chargeId);
		disputeStatus = event.type === 'charge.dispute.closed' && dispute.status === 'won' ? 'paid' : 'disputed';
	}
	return database.transaction(async (sql) => {
		const inserted = await sql.query('INSERT INTO enrichable.stripe_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id', [event.id, event.type]);
		if (!inserted.rows.length) return false;
		if (session?.mode === 'payment') {
			workspaceHint = session.metadata?.enrichable_workspace_id ?? session.client_reference_id ?? undefined;
			const validPurchase = session.amount_total === PURCHASE_AMOUNT_CENTS && session.currency === PURCHASE_CURRENCY && (session.metadata?.enrichable_purchase === 'lifetime_access' || asId(session.payment_link as string | Stripe.PaymentLink | null) === process.env.STRIPE_PAYMENT_LINK_ID);
			const status = validPurchase && session.payment_status === 'paid' && event.type !== 'checkout.session.async_payment_failed' ? 'paid' : 'unpaid';
			const workspace = await savePurchase(sql, session, status, workspaceHint);
			if (workspace && status === 'paid') await appendWorkspaceAuditEvent(sql, workspace, 'system:stripe', 'workspace.billing.purchase_updated', { status: 'paid', amountUsd: Number(session.amount_total ?? 0) / 100, source: session.payment_link ? 'payment_link' : 'checkout' });
		}
		if (charge?.payment_intent) {
			const paymentIntentId = asId(charge.payment_intent as string | Stripe.PaymentIntent);
			if (paymentIntentId) {
				if (charge.refunded && charge.amount_refunded >= charge.amount) await updatePurchaseStatus(sql, paymentIntentId, 'refunded');
				else if (disputeStatus) await updatePurchaseStatus(sql, paymentIntentId, disputeStatus);
			}
		}
		if (subscription) {
			const workspace = await saveSubscription(sql, subscription, workspaceHint);
			if (workspace) await appendWorkspaceAuditEvent(sql, workspace, 'system:stripe', 'workspace.billing.subscription_updated', {
				stripeEvent: event.type, status: subscription.status, priceId: subscription.items.data[0]?.price.id ?? null, cancelAtPeriodEnd: subscription.cancel_at_period_end,
			});
		}
		return true;
	});
}

async function saveSubscription(sql: Sql, subscription: Stripe.Subscription, workspaceHint?: string) {
	const customerId = asId(subscription.customer);
	if (!customerId) return;
	const metadataWorkspace = subscription.metadata?.enrichable_workspace_id;
	const workspace = workspaceHint || metadataWorkspace || (await sql.query('SELECT workspace_id FROM enrichable.stripe_customers WHERE customer_id=$1', [customerId])).rows[0]?.workspace_id;
	if (typeof workspace !== 'string' || !workspace) throw new Error('Stripe subscription could not be mapped to a workspace.');
	const firstItem = subscription.items.data[0];
	const periodEnd = firstItem?.current_period_end ?? null;
	await sql.query(`INSERT INTO enrichable.workspace_subscriptions (workspace_id,customer_id,subscription_id,price_id,status,current_period_end,cancel_at_period_end,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (workspace_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,price_id=excluded.price_id,status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`, [workspace, customerId, subscription.id, firstItem?.price.id ?? null, subscription.status, periodEnd, subscription.cancel_at_period_end]);
	return String(workspace);
}

export const handleStripeEvent = processStripeEvent;

export function verifyStripeEvent(payload: string, signature: string | null) {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret?.startsWith('whsec_') || !signature) throw new WorkspaceError('Stripe webhook signature is missing or payments are not configured.', 400);
	try { return stripe().webhooks.constructEvent(payload, signature, secret); }
	catch { throw new WorkspaceError('Stripe webhook signature is invalid.', 400); }
}
