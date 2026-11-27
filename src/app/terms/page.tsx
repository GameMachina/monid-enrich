import type { Metadata } from 'next';
import { LegalPage } from '@/components/site/legal-page';
import { PRODUCT_NAME } from '@/lib/constants';
import { siteUrl } from '@/lib/server/deployment';

export const metadata: Metadata = {
	title: 'Terms of Service',
	description: `Terms for using ${PRODUCT_NAME}.`,
	alternates: { canonical: new URL('/terms', siteUrl()).toString() },
};

const updated = 'November 27, 2026';

export default function TermsPage() {
	return <LegalPage title="Terms of Service" updated={updated} intro={`These terms apply to your use of the hosted ${PRODUCT_NAME} service. By using the service, you agree to these terms. If you do not agree, do not use the hosted service.`} sections={[
		{ title: 'The service and your account', paragraphs: [
			<>Monid Enrich provides spreadsheet tools for company and people research, enrichment, and export. You must provide accurate account information, protect your sign-in credentials, and use only workspaces you are authorized to access.</>,
			<>You are responsible for the content and instructions you submit, the people who can access your workspace, and activity performed through your account. Keep your own copies of important information; the app includes workspace and sheet export features.</>,
		]},
		{ title: 'Payments and third-party providers', paragraphs: [
			<>Hosted workspace access is offered for a one-time fee of $37 USD where checkout is available. That purchase does not include usage fees charged by Monid or other providers. Provider charges, balances, and terms remain separate, and the app identifies the provider for supported operations.</>,
			<>You may connect provider credentials to enable features. You authorize the app to use the selected provider and relevant inputs to perform operations you request. You are responsible for the provider account, its balance, and compliance with that provider’s terms.</>,
		]},
		{ title: 'Acceptable use and data rights', paragraphs: [
			<>Use the service only for lawful purposes. Do not use it to violate another person’s rights, send unlawful or deceptive communications, bypass access controls, interfere with the service, or submit data you are not authorized to process.</>,
			<>You retain your rights in content you provide. You instruct Monid Enrich and the selected third-party providers to process that content as needed to provide the features you request. You are responsible for having the notices, permissions, and lawful basis required for your use of personal or business contact data.</>,
		]},
		{ title: 'Research results and availability', paragraphs: [
			<>Research and enrichment results can be incomplete, outdated, or incorrect. Sources and usage information are shown where available; you are responsible for checking important results before relying on them or contacting anyone.</>,
			<>The service and third-party integrations may change or be unavailable. We may suspend access to protect users, respond to misuse, or maintain the service.</>,
		]},
		{ title: 'Open-source software and changes', paragraphs: [
			<>The Monid Enrich source code is also available under the MIT license. These terms cover the hosted service; the MIT license governs use of the open-source code. Third-party services and data remain subject to their own terms.</>,
			<>We may update these terms as the service changes. Continued use after an updated version is posted means you accept the revised terms.</>,
		]},
		{ title: 'Contact', paragraphs: [
			<>Questions about these terms can be sent to <a className="underline underline-offset-2" href="mailto:jalendnelson@gmail.com">jalendnelson@gmail.com</a>.</>,
		]},
	]} />;
}
