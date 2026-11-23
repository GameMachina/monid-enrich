import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { GithubIcon, Logo } from '@/components/ui/logo';
import { DOCS_URL, GITHUB_URL, PRODUCT_NAME, SITE_DESCRIPTION, SITE_LEDE, SITE_TITLE } from '@/lib/constants';
import { siteUrl } from '@/lib/server/deployment';

export const metadata: Metadata = {
	title: { absolute: SITE_TITLE },
	description: SITE_DESCRIPTION,
	alternates: { canonical: '/' },
	// Page-level openGraph/twitter replace the layout's objects, so repeat the shared fields.
	openGraph: { type: 'website', siteName: PRODUCT_NAME, locale: 'en_US', title: SITE_TITLE, description: SITE_DESCRIPTION, url: '/' },
	twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
};

const FEATURES = [
	{ title: 'Build lead lists from a prompt', body: 'Ask for “every Series A fintech in Europe” or “VPs of Sales at US logistics companies”. Choose Monid or Treg and stream company or people results into the sheet.' },
	{ title: 'Research every row', body: 'Add a column with a question like “Who is the CEO?” or “Does the pricing page offer a free tier?”. Research results include source links so you can check the answer.' },
	{ title: 'Qualify and score accounts', body: 'True or false checks, categories and scores on levels you define. Each call comes with a probability or confidence, so you can filter on how sure it is.' },
	{ title: 'Find work emails', body: 'Choose Monid or Treg to find or verify work email addresses from a person name and company domain.' },
	{ title: 'Draft outreach and documents', body: 'Write a personalized email or a branded PDF for every row, using the research already in the sheet.' },
	{ title: 'Use real spreadsheet formulas', body: 'SUM, IF, VLOOKUP and hundreds more run in your browser through IronCalc, with no API calls and no keys.' },
	{ title: 'Export anywhere', body: 'Download CSV, Excel or JSON, with or without confidence scores and sources.' },
	{ title: 'Work from your AI agent', body: 'A built-in MCP server lets compatible agents read sheets, add columns and run enrichment in the same workspace.' },
];

const STEPS = [
	{ title: 'Find rows', body: 'Describe the companies or people you want, import a CSV, or start from a blank sheet.' },
	{ title: 'Add research columns', body: 'Write a question and reference other columns, like {{Website}}. Choose Monid or Treg for supported web research and company or people data. Add your OpenAI key for reasoning features.' },
	{ title: 'Review and export', body: 'Open any cell to see its sources and confidence. Rerun or edit it, filter the rows that pass, and export.' },
];

const FAQ = [
	{ q: `What is ${PRODUCT_NAME}?`, a: `${PRODUCT_NAME} is a spreadsheet for company and people research. Find rows, enrich each row, review the evidence, and export the result.` },
	{ q: 'Where does the data come from?', a: 'Choose Monid or Treg for each supported research and enrichment operation. They have separate connections and billing, with no automatic fallback. OpenAI is optional and only used when you connect your own key for reasoning features.' },
	{ q: 'Can I use the app without an OpenAI key?', a: 'Yes. Spreadsheet editing, formulas, imports, exports, and supported Monid or Treg searches and enrichments remain available. AI reasoning and classification features explain when they need an OpenAI key.' },
	{ q: 'Can I self-host it?', a: 'Yes. Run it locally with Node.js and connect either Monid or Treg. Add your own OpenAI key only if you want reasoning features. See the repository README for setup.' },
	{ q: 'Can AI agents use it?', a: 'The app includes an MCP server so compatible clients can work with sheets and enrichment operations.' },
];

function structuredData() {
	const url = siteUrl().toString();
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{ '@type': 'Organization', '@id': `${url}#organization`, name: PRODUCT_NAME, url },
			{ '@type': 'WebSite', '@id': `${url}#website`, url, name: PRODUCT_NAME, description: SITE_DESCRIPTION, inLanguage: 'en', publisher: { '@id': `${url}#organization` } },
			{
				'@type': 'SoftwareApplication', '@id': `${url}#app`, name: PRODUCT_NAME, url, description: SITE_DESCRIPTION, image: new URL('/opengraph-image.png', url).toString(),
				applicationCategory: 'BusinessApplication', applicationSubCategory: 'Data enrichment', operatingSystem: 'Web', browserRequirements: 'Requires JavaScript',
				isAccessibleForFree: true, license: 'https://opensource.org/licenses/MIT', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
				featureList: FEATURES.map((feature) => feature.title), sameAs: [GITHUB_URL], publisher: { '@id': `${url}#organization` }, creator: { '@id': `${url}#organization` },
			},
			{ '@type': 'SoftwareSourceCode', name: PRODUCT_NAME, codeRepository: GITHUB_URL, programmingLanguage: 'TypeScript', runtimePlatform: 'Node.js', license: 'https://opensource.org/licenses/MIT', targetProduct: { '@id': `${url}#app` } },
			{ '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
		],
	};
}

/** Faint sample cells laid on the background grid: one finished column, one still researching. */
const DOMAINS = ['sunnova.com', 'tesla.com', 'nextracker.com', 'sunrun.com', 'enphase.com', 'aurorasolar.com', 'firstsolar.com', 'sunpower.com', 'arcadia.com', 'palmetto.com', 'solaredge.com'];
const CEOS = ['John Berger', 'Elon Musk', 'Dan Shugar', 'Mary Powell', 'Badri Kothandaraman'];

const primaryButton = 'inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[1rem] font-medium text-white shadow-[0_1px_2px_rgb(37_99_235/0.3),0_8px_24px_-8px_rgb(37_99_235/0.55)] transition-[background-color,scale] duration-150 hover:bg-brand-hover active:scale-[0.98] motion-reduce:active:scale-100';
const secondaryButton = 'inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-surface px-[22px] text-[1rem] font-medium shadow-[inset_0_0_0_1px_#d9d9d9] transition-[box-shadow,scale] duration-150 hover:shadow-[inset_0_0_0_1px_var(--color-fg)] active:scale-[0.98] motion-reduce:active:scale-100';
const inlineLink = 'font-medium text-fg underline decoration-line-strong underline-offset-[3px] transition-colors hover:decoration-fg';

export default function Landing() {
	return (
		<div className="bg-surface text-fg">
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()).replace(/</g, '\\u003c') }} />

			<div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
				<SheetBackdrop />
				<header className="flex items-center justify-between gap-4 px-5 pt-5 pb-3 md:px-12 md:pt-7 short:pt-3 short:pb-1">
					<Link href="/" className="flex items-center gap-2.5 rounded-md" aria-label={`${PRODUCT_NAME} home`}>
						<Logo size={24} />
						<span className="text-[17px] font-semibold tracking-[-0.01em]">{PRODUCT_NAME}</span>
					</Link>
					<nav aria-label="Site" className="flex items-center gap-1 text-body text-fg-muted">
						<a href="#how-it-works" className="hidden rounded-md px-2.5 py-1.5 transition-colors hover:text-fg sm:block">How it works</a>
						<a href="#faq" className="hidden rounded-md px-2.5 py-1.5 transition-colors hover:text-fg sm:block">FAQ</a>
						<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors hover:text-fg">
							<GithubIcon className="size-4" /> GitHub
						</a>
					</nav>
				</header>

				<main className="flex flex-1 flex-col items-center justify-center px-5 pb-8 text-center md:px-12 short:pb-3">
					<h1 className="max-w-[840px] text-[clamp(2.5rem,1.4rem+3.6vw,4.25rem)] leading-[1.06] font-medium tracking-[-0.035em] text-balance short:text-[2.25rem]">
						A spreadsheet that <span className="text-brand">enriches itself</span> from the internet.
					</h1>
					<p className="mt-5 max-w-[600px] text-[1.0625rem] leading-relaxed text-pretty text-fg-muted md:mt-6 md:text-[1.1875rem] short:mt-3 short:text-[1rem]">{SITE_LEDE}</p>
					<div className="mt-8 flex w-full max-w-[350px] flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row sm:gap-3 short:mt-5">
						<Link href="/app" data-track="landing_cta" data-cta="start" className={`${primaryButton} short:h-11`}>
							Start enriching <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
						</Link>
						<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" data-track="landing_cta" data-cta="github" className={`${secondaryButton} short:h-11`}>
							<GithubIcon className="size-[17px]" /> View on GitHub
						</a>
					</div>
				</main>

				<div className="flex flex-col items-center justify-center gap-1.5 px-5 pb-7 text-body-sm text-fg-subtle sm:flex-row sm:gap-3.5 md:pb-8 short:pb-3">
					<span>Free and open source (MIT)</span>
					<span aria-hidden className="hidden h-3.5 w-px bg-line-strong sm:block" />
					<PoweredByProviders />
				</div>
			</div>

			<Section id="what-is-enrichable" title={`What is ${PRODUCT_NAME}?`}>
				<div className="space-y-4 text-[1.0625rem] leading-relaxed text-fg-muted">
					<p>
						<strong className="font-medium text-fg">{PRODUCT_NAME} is an open-source spreadsheet for data enrichment.</strong> Describe a list, such as “solar companies in the US with 50+ employees”, and use Monid or Treg to find company or people results.
					</p>
					<p>Add columns for research, classification, scoring, or contact data. Results retain their sources, status, and confidence where available. Add your own OpenAI key for reasoning-dependent columns.</p>
				</div>
			</Section>

			<Section id="features" title="What you can do with it">
				<ul className="grid gap-x-12 sm:grid-cols-2">
					{FEATURES.map((feature) => (
						<li key={feature.title} className="border-t border-line py-6">
							<h3 className="text-h5 font-medium tracking-[-0.01em]">{feature.title}</h3>
							<p className="mt-2 leading-relaxed text-pretty text-fg-muted">{feature.body}</p>
						</li>
					))}
				</ul>
			</Section>

			<Section id="how-it-works" title="How it works">
				<ol className="overflow-hidden rounded-[10px] border border-line">
					{STEPS.map((step, index) => (
						<li key={step.title} className="flex border-b border-line-subtle last:border-b-0">
							<span aria-hidden className="flex w-12 shrink-0 justify-center border-r border-line-subtle bg-neutral-5 pt-[22px] text-caption text-fg-subtle tabular">{index + 1}</span>
							<div className="px-5 py-5 md:px-6">
								<h3 className="text-h5 font-medium tracking-[-0.01em]">{step.title}</h3>
								<p className="mt-1.5 leading-relaxed text-pretty text-fg-muted">{step.body}</p>
							</div>
						</li>
					))}
				</ol>
			</Section>

			<Section id="open-source" title="Open source, provider choice">
				<div className="space-y-4 text-[1.0625rem] leading-relaxed text-fg-muted">
					<p>
						{PRODUCT_NAME} is an independent open-source product. Each supported research or enrichment operation explicitly selects Monid or Treg, with separate credentials and billing. OpenAI is optional and only uses a key supplied by the workspace owner.
					</p>
					<p>
						Run it locally or self-host from the <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={inlineLink}>public repository</a>. Your spreadsheet data stays in the configured workspace storage.
					</p>
				</div>
			</Section>

			<Section id="faq" title="Frequently asked questions">
				<dl className="grid gap-x-12 sm:grid-cols-2">
					{FAQ.map(({ q, a }) => (
						<div key={q} className="border-t border-line py-6">
							<dt><h3 className="text-h5 font-medium tracking-[-0.01em]">{q}</h3></dt>
							<dd className="mt-2 leading-relaxed text-pretty text-fg-muted">{a}</dd>
						</div>
					))}
				</dl>
			</Section>

			<section aria-labelledby="try-enrichable" className="border-t border-line bg-canvas">
				<div className="mx-auto flex w-full max-w-[1080px] flex-col items-start gap-6 px-5 py-16 md:flex-row md:items-center md:justify-between md:px-12 md:py-20">
					<div>
						<h2 id="try-enrichable" className="text-h3 font-medium tracking-[-0.02em]">Try it on a list you need this week.</h2>
						<p className="mt-2 text-fg-muted">Free and open source. Use it here or run your own copy.</p>
					</div>
					<div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
						<Link href="/app" data-track="landing_cta" data-cta="footer_start" className={primaryButton}>
							Open {PRODUCT_NAME} <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
						</Link>
						<a href={DOCS_URL} target="_blank" rel="noopener noreferrer" data-track="landing_cta" data-cta="docs" className={secondaryButton}>Read the docs</a>
					</div>
				</div>
			</section>

			<footer className="border-t border-line">
				<div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-5 py-8 text-body-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between md:px-12">
					<div className="flex items-center gap-2 text-fg">
						<Logo size={18} />
						<span className="font-semibold tracking-[-0.01em]">{PRODUCT_NAME}</span>
						<span className="text-fg-subtle">· MIT license</span>
					</div>
					<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
						<a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-fg">GitHub</a>
						<a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="hover:text-fg">Docs</a>
						<a href={`${GITHUB_URL}/blob/main/docs/mcp.md`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">MCP</a>
						<PoweredByProviders />
					</div>
				</div>
			</footer>
		</div>
	);
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
	return (
		<section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-line">
			<div className="mx-auto grid w-full max-w-[1080px] gap-6 px-5 py-16 md:grid-cols-[280px_1fr] md:gap-12 md:px-12 md:py-24">
				<h2 id={`${id}-title`} className="text-h3 font-medium tracking-[-0.02em] text-balance">{title}</h2>
				<div className="min-w-0">{children}</div>
			</div>
		</section>
	);
}

function PoweredByProviders() {
	return (
		<span className="inline-flex items-center gap-[7px] rounded-md">
			Choose <Image src="/providers/monid.svg" alt="" width={18} height={18} unoptimized /> <span className="font-semibold tracking-[-0.01em] text-fg">Monid</span>
			<span aria-hidden>or</span><Image src="/providers/treg.svg" alt="" width={18} height={18} unoptimized /> <span className="font-semibold tracking-[-0.01em] text-fg">Treg</span>
		</span>
	);
}

function SheetBackdrop() {
	return (
		<div aria-hidden data-nosnippet className="sheet-backdrop pointer-events-none absolute inset-0 -z-10 select-none">
			<div className="sheet-backdrop-column left-[calc(50%-630px)]">
				<span className="sheet-backdrop-head">Website</span>
				{DOMAINS.map((domain) => (
					<span key={domain}>{domain}</span>
				))}
			</div>
			<div className="sheet-backdrop-column left-[calc(50%+450px)]">
				<span className="sheet-backdrop-head">
					<i className="sheet-backdrop-dot" /> CEO
				</span>
				{CEOS.map((ceo, index) => (
					<span key={ceo} className="sheet-backdrop-arrival" style={{ animationDelay: `${300 + index * 140}ms` }}>
						{ceo}
					</span>
				))}
				<span className="sheet-backdrop-active">
					<i className="sheet-backdrop-dot" /> Researching…
				</span>
			</div>
		</div>
	);
}
