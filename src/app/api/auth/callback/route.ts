import { NextResponse } from 'next/server';

/** OAuth callbacks for the upstream hosted product are not used here. */
export function GET() {
	return new NextResponse('This standalone app uses its local workspace.', { status: 404, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
