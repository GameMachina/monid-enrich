'use client';

import { notifyContextRequest } from './context-credits';
import { notifyTrialLimit } from './ai-trial';
import { ApiError, parseFailure, readError } from './api';
import { keyHeaders } from './keys';
import { accountHeaders } from './account-storage';
import type { PopulateEvent, PopulateRequest } from './types';

/** Newline-delimited lines of a streamed body, ending with any unterminated tail. */
async function* ndjsonLines(body: ReadableStream<Uint8Array>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		yield* lines;
	}
	yield buffer + decoder.decode();
}

/**
 * Stream rows from the populate agent. `completed` is true only when the server sent its `done` event:
 * a body that simply ends (cut connection, function timeout) is not a finished search.
 */
type PopulateJob = { jobId: string; status: string; progress: string; added: number; updated: number; completionMessage?: string; error?: string; failure?: unknown };

function wait(delay: number, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
		const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
		const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
		signal?.addEventListener('abort', abort, { once: true });
	});
}

async function pollPopulateJob(jobId: string, onEvent: (event: PopulateEvent) => void | Promise<void>, signal?: AbortSignal) {
	let delayMs = 1_000;
	while (true) {
		const response = await fetch(`/api/populate/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store', headers: accountHeaders(), signal });
		if (!response.ok) throw await readError(response);
		const job = await response.json() as PopulateJob;
		await onEvent({ type: 'durable', jobId, status: job.status });
		await onEvent({ type: 'status', message: job.progress || 'Finding rows…' });
		await onEvent({ type: 'progress', added: job.added ?? 0, updated: job.updated ?? 0 });
		if (job.status === 'succeeded') {
			await onEvent({ type: 'done', total: job.added ?? 0, message: job.completionMessage });
			return { completed: true, jobId, durable: true };
		}
		if (['failed', 'uncertain', 'cancelled'].includes(job.status)) {
			const message = job.error || (job.status === 'uncertain' ? 'The search may have incurred provider charges. Check provider usage before retrying.' : 'Find rows did not complete.');
			const failure = parseFailure(job.failure);
			notifyTrialLimit(message, failure);
			await onEvent({ type: 'error', message, failure });
			throw new ApiError(message, job.status === 'cancelled' ? 409 : 0, failure);
		}
		await wait(delayMs, signal);
		delayMs = Math.min(5_000, Math.round(delayMs * 1.5));
	}
}

export async function lookupActivePopulateJob(sheetId: string, idempotencyKey: string): Promise<PopulateJob | null> {
	const query = new URLSearchParams({ sheetId, idempotencyKey });
	const response = await fetch(`/api/populate/jobs?${query}`, { cache: 'no-store', headers: accountHeaders() });
	if (!response.ok) throw await readError(response);
	const result = await response.json() as { job?: PopulateJob | null };
	return result.job ?? null;
}

export async function cancelPopulateJob(jobId: string) {
	const response = await fetch(`/api/populate/jobs/${encodeURIComponent(jobId)}`, { method: 'POST', headers: accountHeaders() });
	if (!response.ok) throw await readError(response);
	return await response.json() as { jobId: string; status: string };
}

export async function streamPopulate(request: PopulateRequest, sheetId: string, onEvent: (event: PopulateEvent) => void | Promise<void>, signal?: AbortSignal, options: { jobId?: string } = {}): Promise<{ completed: boolean; jobId?: string; durable?: boolean }> {
	// Discovery can perform several Context requests between streamed row events.
	const timer = setInterval(notifyContextRequest, 2_000);
	let completed = false;
	const handle = async (line: string) => {
		if (!line.trim()) return;
		let event: PopulateEvent;
		try { event = JSON.parse(line) as PopulateEvent; }
		catch { return; }
		if (event.type === 'error') {
			const failure = parseFailure(event.failure);
			notifyTrialLimit(event.message, failure);
			throw new ApiError(event.message, 0, failure);
		}
		if (event.type === 'done') completed = true;
		await onEvent(event);
	};
	try {
		if (options.jobId) {
			await onEvent({ type: 'durable', jobId: options.jobId });
			return await pollPopulateJob(options.jobId, onEvent, signal);
		}
		const response = await fetch('/api/populate', { method: 'POST', headers: keyHeaders(), body: JSON.stringify({ ...request, sheetId }), signal });
		if (!response.ok) throw await readError(response);
		if (response.headers.get('content-type')?.includes('application/json')) {
			const queued = await response.json() as { jobId?: unknown; durable?: unknown; status?: unknown };
			if (typeof queued.jobId !== 'string' || !queued.jobId) throw new ApiError('The server did not return a Find rows job ID.', response.status);
			await onEvent({ type: 'durable', jobId: queued.jobId, status: typeof queued.status === 'string' ? queued.status : 'queued' });
			return await pollPopulateJob(queued.jobId, onEvent, signal);
		}
		if (!response.body) throw new ApiError(`Request failed (${response.status})`, response.status);
		// Events apply strictly in order; the next chunk is read only after the previous lines are handled.
		for await (const line of ndjsonLines(response.body)) await handle(line);
		return { completed, durable: false };
	} finally {
		clearInterval(timer);
		notifyContextRequest();
	}
}
