import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/legal-page';
import { PRODUCT_NAME } from '@/lib/constants';
import { siteUrl } from '@/lib/server/deployment';

export const metadata: Metadata = {
	title: 'Privacy Policy',
	description: `How ${PRODUCT_NAME} handles account, workspace, and service data.`,
	alternates: { canonical: new URL('/privacy', siteUrl()).toString() },
};

const updated = 'November 27, 2026';

export default function PrivacyPolicyPage() {
	return <LegalPage title="Privacy Policy" updated={updated} intro={`${PRODUCT_NAME} is a spreadsheet for company and people research. This policy describes the hosted service at monid-enrich.vercel.app. If you run a self-hosted copy, its operator controls its data handling and hosting configuration.`} sections={[
		{ title: 'Information the service handles', paragraphs: [
			<>When you create an account or join a workspace, the service receives account and organization details from its sign-in provider, including information such as your name and email address.</>,
			<>Workspace content can include sheets, rows, column definitions, prompts, imported files, research results, source references, and contact or company information you choose to enter or obtain. Workspace administrators can export workspace data from the app.</>,
			<>When you connect Monid or an optional OpenAI key, the key is stored in the hosted service’s encrypted server-side credential store. The app records operation status and, when returned by the provider, usage, cost, and provenance details.</>,
			<>If you purchase hosted access, checkout and payment processing are handled by Stripe. The app receives purchase and billing status; payment card details are handled by Stripe.</>,
		]},
		{ title: 'How data is used and shared', paragraphs: [
			<>The service uses account and workspace data to provide sign-in, collaboration, spreadsheet storage, requested research and enrichment, exports, billing, security, and support.</>,
			<>When you run a Monid search or enrichment, the relevant query and row inputs needed for that operation are sent to Monid. Reasoning features that you choose to use may send their relevant inputs to OpenAI using the key connected to your workspace. Those providers process data under their own terms and privacy practices.</>,
			<>The hosted service relies on infrastructure and service providers for authentication, hosting, database storage, payments, provider requests, and—if enabled for the deployment—product analytics. These providers process data to deliver their services. Product analytics may include page views, web performance, outbound-link events, and limited product events; the app’s named event properties exclude sheet contents, prompts, and API keys. The analytics SDK may also collect interaction and browser metadata.</>,
			<>The service does not sell workspace data. Data may also be disclosed where required by law, to protect the service and its users, or as part of a business transfer.</>,
		]},
		{ title: 'Storage and retention', paragraphs: [
			<>Hosted workspace sheets, settings, credentials, and usage records are stored in workspace-scoped server storage. Access is restricted by workspace membership and the service’s access controls. Necessary authentication cookies are used to maintain your session.</>,
			<>Workspace administrators can export data and close a workspace from its settings. Closing a workspace removes its sheets, settings, connected provider credentials, and agent keys. Billing, provider-usage, audit, security, and backup records may be retained for accounting, security, or legal requirements.</>,
			<>Third-party providers may keep data they receive according to their own retention policies. Review their policies and settings for details about data they process.</>,
		]},
		{ title: 'Your choices and responsibilities', paragraphs: [
			<>You can manage workspace membership and connected keys in Configuration, export workspace data, or ask the workspace administrator to close the workspace. You can contact us with questions about account or privacy requests.</>,
			<>Only upload or research information you are authorized to use. You are responsible for complying with privacy, marketing, and data-protection rules that apply to your use of contact and company data.</>,
		]},
		{ title: 'Changes and contact', paragraphs: [
			<>We may update this policy as the service changes. The date above shows when this page was last updated. Material changes will be reflected here.</>,
			<>For privacy questions, contact <a className="underline underline-offset-2" href="mailto:jalendnelson@gmail.com">jalendnelson@gmail.com</a>.</>,
		]},
	]} />;
}
