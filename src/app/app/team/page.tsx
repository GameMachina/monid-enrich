import { OrganizationProfile, OrganizationSwitcher } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { currentAccount } from '@/lib/server/auth';
import { managedAuthEnabled } from '@/lib/server/deployment';
import { PageColumn, PageHeader } from '@/components/app/page-header';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Team' };
export const instant = false;

export default async function TeamPage() {
	if (!managedAuthEnabled()) redirect('/app/settings');
	const account = await currentAccount();
	if (!account) redirect('/sign-in');
	const hasOrganization = !account.organization.id.startsWith('personal:');
	return <PageColumn>
		<PageHeader title="Team" description="Manage workspace members, invitations, and roles." />
		{!hasOrganization ? <section className="glass-card flex flex-col gap-4 p-5">
			<h2 className="text-body text-fg">Create a team workspace</h2>
			<p className="text-body-sm text-fg-muted">You are using a personal workspace. Create or select an organization to invite teammates and share sheets.</p>
			<OrganizationSwitcher hidePersonal={false} />
		</section> : account.role !== 'owner' && account.role !== 'admin' ? <section className="glass-card p-5">
			<h2 className="text-body text-fg">Ask a workspace admin</h2>
			<p className="mt-1 text-body-sm text-fg-muted">Only workspace owners and admins can invite members or change roles.</p>
		</section> : <div className="glass-card min-h-[36rem] overflow-hidden p-3 sm:p-5"><OrganizationProfile routing="hash" /></div>}
	</PageColumn>;
}
