import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default function SignInPage() {
	return <main className="grid min-h-dvh place-items-center bg-canvas px-6 py-8"><Suspense fallback={<p className="text-body-sm text-fg-muted">Loading sign in…</p>}><SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" fallbackRedirectUrl="/app" /></Suspense></main>;
}
