import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TableTypesAdmin } from '@/components/app/table-types-admin';
import { currentAccount } from '@/lib/server/auth';
import { isPlatformAdmin } from '@/lib/server/platform-admin';

export const metadata: Metadata = { title: 'Table Types · Monid Enrich', robots: { index: false, follow: false } };

export default async function TableTypesAdminPage() {
	const account = await currentAccount();
	if (!account) redirect('/login');
	if (!isPlatformAdmin(account)) redirect('/app');
	return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:p-8">
		<header><p className="text-caption font-medium uppercase tracking-wide text-fg-subtle">Platform administration</p><h1 className="mt-1 text-h2 text-fg">Table Types</h1><p className="mt-2 max-w-3xl text-body-sm text-fg-muted">Manage Monid’s global search defaults. Published types appear in Find rows only when a trusted backend adapter validates their inputs, mapping, identity, operations, and pagination.</p></header>
		<TableTypesAdmin />
	</div>;
}
