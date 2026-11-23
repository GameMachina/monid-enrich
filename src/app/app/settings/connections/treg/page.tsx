import type { Metadata } from 'next';
import { TregConnectionsPage } from '@/components/app/treg-connections-page';

export const metadata: Metadata = { title: 'Treg connections' };
export const instant = false;

export default function Page() {
	return <TregConnectionsPage />;
}
