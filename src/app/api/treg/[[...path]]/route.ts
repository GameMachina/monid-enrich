const gone = () => Response.json(
	{ error: 'The Treg integration has been removed. Connect Monid in Configuration.' },
	{ status: 410, headers: { 'cache-control': 'no-store' } },
);

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
export const OPTIONS = gone;
export const HEAD = () => new Response(null, { status: 410, headers: { 'cache-control': 'no-store' } });
