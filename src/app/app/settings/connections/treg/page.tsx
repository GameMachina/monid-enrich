import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Connections' };

export default function Page() {
	redirect('/app/settings');
}
