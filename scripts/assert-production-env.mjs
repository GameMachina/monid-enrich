const production = process.env.VERCEL_ENV === 'production';
if (!production) process.exit(0);

const missing = [];
const requireValue = (key, predicate = (value) => Boolean(value?.trim())) => {
	const value = process.env[key];
	if (!predicate(value ?? '')) missing.push(key);
};

requireValue('DATABASE_URL');
requireValue('DATABASE_URL_UNPOOLED');
requireValue('ENRICHABLE_AUTH_MODE', (value) => value === 'clerk');
requireValue('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', (value) => value.startsWith('pk_live_'));
requireValue('CLERK_SECRET_KEY', (value) => value.startsWith('sk_live_'));
requireValue('CLERK_WEBHOOK_SIGNING_SECRET', (value) => value.startsWith('whsec_'));
requireValue('ENRICHABLE_BILLING_REQUIRED', (value) => value === 'true');
requireValue('STRIPE_SECRET_KEY', (value) => value.startsWith('sk_live_'));
requireValue('STRIPE_WEBHOOK_SECRET', (value) => value.startsWith('whsec_'));
requireValue('STRIPE_ONE_TIME_PRICE_ID', (value) => value.startsWith('price_'));
requireValue('STRIPE_PAYMENT_LINK_ID', (value) => value.startsWith('plink_'));
requireValue('STRIPE_PAYMENT_LINK_URL', (value) => {
	try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'buy.stripe.com'; } catch { return false; }
});
requireValue('ENRICHABLE_APP_URL', (value) => {
	try { return new URL(value).protocol === 'https:'; } catch { return false; }
});
requireValue('ENRICHABLE_MCP_ENCRYPTION_SECRET', (value) => value.trim().length >= 32);
requireValue('ENRICHABLE_DURABLE_ENRICHMENT', (value) => value === 'true');
requireValue('CRON_SECRET', (value) => value.trim().length >= 32);
requireValue('NEON_REALTIME_URL');
requireValue('NEON_REALTIME_SECRET');

if (missing.length) {
	console.error(`Refusing to build a production deployment. Configure these Vercel Production variables first: ${missing.join(', ')}`);
	process.exit(1);
}
