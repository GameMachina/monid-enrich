export interface MonidFixtureRequest {
	provider: string;
	endpoint: string;
	input: { body?: Record<string, unknown>; queryParams?: Record<string, unknown>; pathParams?: Record<string, unknown> };
}

/** Build the run receipt shape returned by Monid, keeping unit fixtures on the same wire contract as production. */
export function monidFixtureResponse(request: MonidFixtureRequest, output: unknown, extra: Record<string, unknown> = {}) {
	return Response.json({
		runId: `fixture-${request.endpoint}`,
		provider: request.provider,
		endpoint: request.endpoint,
		status: 'COMPLETED',
		output,
		cost: { value: 0, currency: 'USD' },
		...extra,
	});
}

export async function monidFixtureRequest(request: Request): Promise<MonidFixtureRequest> {
	return await request.json() as MonidFixtureRequest;
}
