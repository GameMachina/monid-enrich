import Link from 'next/link';
import { PRODUCT_NAME } from '@/lib/constants';

type LegalSection = { title: string; paragraphs: React.ReactNode[] };

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
	return (
		<main className="min-h-dvh bg-canvas px-5 py-8 text-fg md:px-10 md:py-12">
			<article className="mx-auto max-w-[800px]">
				<Link href="/" className="text-body-sm font-medium text-fg-muted transition-colors hover:text-fg">← {PRODUCT_NAME}</Link>
				<header className="mt-10 border-b border-line pb-7">
					<h1 className="text-title font-medium tracking-[-0.03em]">{title}</h1>
					<p className="mt-2 text-body-sm text-fg-subtle">Last updated {updated}</p>
					<p className="mt-5 text-body leading-relaxed text-fg-muted">{intro}</p>
				</header>
				<div className="divide-y divide-line">
					{sections.map((section) => (
						<section key={section.title} className="py-7">
							<h2 className="text-h4 font-medium tracking-[-0.02em]">{section.title}</h2>
							<div className="mt-3 space-y-3 text-body-sm leading-relaxed text-fg-muted">{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
						</section>
					))}
				</div>
				<footer className="border-t border-line pt-6 text-caption text-fg-subtle">
					Questions? Contact <a className="underline underline-offset-2 hover:text-fg" href="mailto:jalendnelson@gmail.com">jalendnelson@gmail.com</a>.
				</footer>
			</article>
		</main>
	);
}
