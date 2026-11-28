import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlatformAdmin } from '@/components/app/platform-admin';
import { currentAccount } from '@/lib/server/auth';
import { isPlatformAdmin } from '@/lib/server/platform-admin';

export const metadata: Metadata = { title: 'Admin · Monid Enrich', robots: { index: false, follow: false } };

export default async function PlatformAdminPage() {
	const account = await currentAccount();
	if (!account) redirect('/login');
	if (!isPlatformAdmin(account)) redirect('/app');
	return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:p-8">
		<header><p className="text-caption font-medium uppercase tracking-wide text-fg-subtle">Private platform administration</p><h1 className="mt-1 text-h2 text-fg">Admin</h1><p className="mt-2 max-w-3xl text-body-sm text-fg-muted">Review organizations, workspace activity, sheets, trial access, and purchases. Sensitive customer row contents are not shown here.</p></header>
		<PlatformAdmin />
	</div>;
}
