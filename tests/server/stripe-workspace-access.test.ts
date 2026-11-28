import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Stripe from 'stripe';
import { CLERK_ISSUER, type Account } from '../../src/lib/auth-identity';
import type { Row, Sheet } from '../../src/lib/types';
import { WorkspaceStore } from '../../src/lib/server/workspace-store';
import { billingSnapshot, buildOrgCheckoutParams, claimStripePurchase, handleStripeEvent, verifyStripeEvent } from '../../src/lib/server/stripe-billing';
import { workspaceId } from '../../src/lib/server/database';
import { testDatabase } from '../support/database';

test('first organization trial, additional organization purchase, and Stripe workspace fulfillment', { timeout: 90_000 }, async (t) => {
	const old = {
		required: process.env.ENRICHABLE_BILLING_REQUIRED,
		exempt: process.env.ENRICHABLE_BILLING_EXEMPT_EMAILS,
		secret: process.env.STRIPE_SECRET_KEY,
		webhook: process.env.STRIPE_WEBHOOK_SECRET,
		price: process.env.STRIPE_ONE_TIME_PRICE_ID,
		appUrl: process.env.ENRICHABLE_APP_URL,
		paymentLink: process.env.STRIPE_PAYMENT_LINK_ID,
	};
	t.after(() => {
		for (const [key, value] of Object.entries({ ENRICHABLE_BILLING_REQUIRED: old.required, ENRICHABLE_BILLING_EXEMPT_EMAILS: old.exempt, STRIPE_SECRET_KEY: old.secret, STRIPE_WEBHOOK_SECRET: old.webhook, STRIPE_ONE_TIME_PRICE_ID: old.price, ENRICHABLE_APP_URL: old.appUrl, STRIPE_PAYMENT_LINK_ID: old.paymentLink })) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	});
	process.env.ENRICHABLE_BILLING_REQUIRED = 'true';
	process.env.ENRICHABLE_BILLING_EXEMPT_EMAILS = 'jalendnelson@gmail.com';
	process.env.STRIPE_SECRET_KEY = 'sk_test_local_fixture';
	process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_local_fixture';
	process.env.STRIPE_ONE_TIME_PRICE_ID = 'price_test_local_fixture';
	process.env.ENRICHABLE_APP_URL = 'https://enrich.autonomousgtm.xyz';
	delete process.env.STRIPE_PAYMENT_LINK_ID;

	const { database } = await testDatabase(t);
	const user = (id: string, email: string, org: string): Account => ({
		issuer: CLERK_ISSUER,
		user: { id: `user_${id}`, email, email_verified: true },
		organization: { id: org, name: org },
		role: 'owner',
		partition: `${id}:${org}`,
	});
	const buyer = user('trial-buyer', 'buyer@example.com', 'first-org');
	const store = new WorkspaceStore(database);
	const sheet = (id: string): Sheet => ({ id, name: id, columns: [{ id: 'name', name: 'Name', type: 'source', width: 200, createdAt: 1 }], filters: [], sort: null, createdAt: 1, updatedAt: 1 });
	const row = (id: string, sheetId: string, value = id): Row => ({ id, sheetId, order: Number(id.replace(/\D/g, '')) || 0, cells: { name: { v: value, s: 'done', t: 1 } }, createdAt: 1 });

	const firstStatus = await billingSnapshot(buyer, database);
	assert.equal(firstStatus.isFirstWorkspace, true);
	assert.equal(firstStatus.trial?.sheetLimit, 1);
	assert.equal(firstStatus.trial?.rowLimit, 5);
	assert.equal(firstStatus.requiresPurchase, false);
	await store.create(buyer, { sheet: sheet('trial-sheet'), rows: Array.from({ length: 5 }, (_, index) => row(`r${index}`, 'trial-sheet')) });
	const used = await billingSnapshot(buyer, database);
	assert.deepEqual([used.trial?.sheetsUsed, used.trial?.rowsUsed], [1, 5]);
	await assert.rejects(store.create(buyer, { sheet: sheet('trial-sheet-2'), rows: [] }), /first-organization trial includes one sheet/i);
	const grid = await store.snapshot(buyer, 'trial-sheet');
	await assert.rejects(store.patch(buyer, 'trial-sheet', { revision: grid.sheet.revision, sheet: grid.sheet, rows: [...grid.rows, row('r5', 'trial-sheet')], deleted: [] }), /up to 5 populated rows/i);
	await store.remove(buyer, 'trial-sheet', grid.sheet.revision ?? 1);
	await assert.rejects(store.create(buyer, { sheet: sheet('replacement-sheet'), rows: [] }), /first-organization trial includes one sheet/i, 'deleting the trial sheet must not restore its allowance');

	const secondOrg = user('trial-buyer', 'buyer@example.com', 'second-org');
	const secondStatus = await billingSnapshot(secondOrg, database);
	assert.equal(secondStatus.isFirstWorkspace, false);
	assert.equal(secondStatus.trial, null);
	assert.equal(secondStatus.requiresPurchase, true);
	await assert.rejects(store.create(secondOrg, { sheet: sheet('second-org-sheet'), rows: [] }), /additional organization has no free trial/i);

	const params = buildOrgCheckoutParams(secondOrg, 'buyer@example.com', 'https://enrich.autonomousgtm.xyz', 'price_test_local_fixture', 'abcdefgh');
	assert.equal(params.mode, 'payment');
	assert.equal(params.line_items?.length, 1);
	assert.equal(params.line_items?.[0]?.price, 'price_test_local_fixture');
	assert.equal(params.metadata?.enrichable_workspace_id, workspaceId(secondOrg));
	assert.equal(params.client_reference_id, workspaceId(secondOrg));
	assert.equal(params.success_url, 'https://enrich.autonomousgtm.xyz/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}');
	assert.equal(params.cancel_url, 'https://enrich.autonomousgtm.xyz/access-required?billing=cancelled');

	const event = {
		id: `evt_${randomUUID().replaceAll('-', '')}`,
		type: 'checkout.session.completed',
		created: Math.floor(Date.now() / 1000),
		data: { object: {
			id: `cs_test_${randomUUID().replaceAll('-', '')}`,
			object: 'checkout.session',
			mode: 'payment',
			payment_status: 'paid',
			amount_total: 3700,
			currency: 'usd',
			payment_link: null,
			payment_intent: `pi_${randomUUID().replaceAll('-', '')}`,
			customer: null,
			customer_details: { email: 'buyer@example.com' },
			customer_email: 'buyer@example.com',
			metadata: { enrichable_purchase: 'lifetime_access', enrichable_workspace_id: workspaceId(secondOrg) },
		} },
	} as unknown as Stripe.Event;
	const payload = JSON.stringify(event);
	const timestamp = Math.floor(Date.now() / 1000);
	const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.${payload}`).digest('hex');
	const verified = verifyStripeEvent(payload, `t=${timestamp},v1=${signature}`);
	assert.equal(await handleStripeEvent(verified, database), true);
	assert.equal(await handleStripeEvent(verified, database), false, 'Stripe webhook replay must be idempotent');
	assert.deepEqual(await claimStripePurchase(secondOrg, database, (event.data.object as Stripe.Checkout.Session).id), { claimed: true, alreadyClaimed: true });
	const purchased = await billingSnapshot(secondOrg, database);
	assert.equal(purchased.fullAccess, true);
	assert.equal(purchased.purchase?.amountUsd, 37);
	assert.equal((await billingSnapshot(buyer, database)).fullAccess, false, 'a purchase must not unlock a different organization');

	const thirdOrg = user('trial-buyer', 'buyer@example.com', 'third-org');
	await billingSnapshot(thirdOrg, database);
	await assert.rejects(claimStripePurchase(thirdOrg, database, (event.data.object as Stripe.Checkout.Session).id), /already been claimed by another workspace/i);
	assert.equal((await billingSnapshot(thirdOrg, database)).requiresPurchase, true);

	const admin = user('jalen', 'jalendnelson@gmail.com', 'jalen-first-org');
	const adminFirst = await billingSnapshot(admin, database);
	assert.equal(adminFirst.exempt, true);
	assert.equal(adminFirst.fullAccess, true);
	assert.equal(adminFirst.trial, null);
	const adminSecond = user('jalen', 'jalendnelson@gmail.com', 'jalen-second-org');
	const adminSecondStatus = await billingSnapshot(adminSecond, database);
	assert.equal(adminSecondStatus.exempt, false, 'the admin exemption must not carry into another organization');
	assert.equal(adminSecondStatus.requiresPurchase, true);
});
