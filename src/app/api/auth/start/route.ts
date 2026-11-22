import { NextResponse } from 'next/server';

/** External identity sign-in is not part of this standalone product. */
export function GET() {
	return new NextResponse('This standalone app uses its local workspace.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
