import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Create your account', robots: { index: false, follow: false } };

export default function SignUpPage() {
	return <main className="grid min-h-dvh place-items-center bg-canvas px-6 py-8"><Suspense fallback={<p className="text-body-sm text-fg-muted">Loading sign up…</p>}><SignUp path="/sign-up" routing="path" signInUrl="/sign-in" fallbackRedirectUrl="/app" /></Suspense></main>;
}
