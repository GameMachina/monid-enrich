import { currentAccount } from '@/lib/server/auth';
import { managedAuthEnabled } from '@/lib/server/deployment';
import { redirect } from 'next/navigation';
import { AccessRequired } from '@/components/app/access-required';

export const metadata = { title: 'Unlock Monid Enrich', robots: { index: false, follow: false } };
export const instant = false;

export default async function AccessRequiredPage({ searchParams }: { searchParams: Promise<{ billing?: string; unlock?: string; session_id?: string }> }) {
	if (!await currentAccount()) redirect(managedAuthEnabled() ? '/sign-in?redirect_url=%2Faccess-required' : '/login?returnTo=%2Faccess-required');
	const query = await searchParams;
	return <AccessRequired billingResult={query.billing === 'success' ? 'success' : query.billing === 'cancelled' ? 'cancelled' : null} sessionId={query.session_id ?? null} unlock={query.unlock === 'sheets' ? 'sheets' : 'rows'} />;
}
