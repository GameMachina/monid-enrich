import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Account } from '../auth-identity';
import { canonicalJson } from '../cell-content';
import { classifyFailure } from './enrich-failure';
import { mcpAccess } from './provider-access';
import { MAX_ROWS } from '../workspace';
import { foundRowColumns, foundRowKey } from '../found-rows';
import { PopulateRequestSchema, type EnrichFailure, type PopulateEvent, type PopulateRequest } from '../types';
import { WorkspaceError } from '../workspace';
import { OrganizationStore } from './organization-store';
import { runPopulate } from './populate';
import { withDatabase, workspaceId, type Database, type Sql } from './database';
import { WorkspaceStore } from './workspace-store';
import { acquireDurableWorkerSlot, releaseDurableWorkerSlot } from './durable-slots';
import { billingSnapshot } from './stripe-billing';

const ACTIVE = "status IN ('queued','running')";
const TERMINAL = new Set(['succeeded', 'failed', 'uncertain', 'cancelled']);
const MAX_ACTIVE_PER_MEMBER = 100;
const MAX_ACTIVE_PER_WORKSPACE = 500;
const REQUEST_FIELDS = ['query', 'entity', 'dataProvider', 'enrichFullProfiles', 'target', 'countries', 'idempotencyKey'] as const;

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
function jobFingerprint(sheetId: string, request: PopulateRequest) {
	return digest(canonicalJson({ sheetId, ...Object.fromEntries(REQUEST_FIELDS.filter((field) => field !== 'idempotencyKey').map((field) => [field, request[field]])) }) ?? '');
}

/** Enqueue an account-scoped search without persisting caller-supplied row keys or capacity claims. */
export async function enqueuePopulate(actor: Account, sheetId: string, input: PopulateRequest) {
	if (!input.idempotencyKey) throw new WorkspaceError('A durable Find rows idempotency key is required.', 400);
	const request = PopulateRequestSchema.parse(Object.fromEntries(REQUEST_FIELDS.map((field) => [field, input[field]])));
	const billing = await withDatabase((database) => billingSnapshot(actor, database));
	const fingerprint = jobFingerprint(sheetId, request), id = randomUUID();
	return withDatabase(async (database) => {
		const store = new WorkspaceStore(database);
		await store.get(actor, sheetId, 0);
		const active = await database.transaction(async (sql, workspace) => {
			const existing = (await sql.query('SELECT id,input_fingerprint,status FROM enrichable.populate_jobs WHERE workspace_id=$1 AND idempotency_key=$2', [workspace, request.idempotencyKey])).rows[0];
			if (existing) {
				if (String(existing.input_fingerprint) !== fingerprint) throw new WorkspaceError('This retry key was already used for a different search. Start a new Find rows request.', 409);
				return { jobId: String(existing.id), status: String(existing.status), added: 0, updated: 0 };
			}
			const counts = (await sql.query(`SELECT count(*)::int AS workspace_count, count(*) FILTER (WHERE actor_id=$2)::int AS member_count FROM (
				SELECT actor_id FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND ${ACTIVE}
				UNION ALL SELECT actor_id FROM enrichable.populate_jobs WHERE workspace_id=$1 AND ${ACTIVE}
			) active_jobs`, [workspace, actor.user.id])).rows[0];
			if (Number(counts?.member_count ?? 0) >= MAX_ACTIVE_PER_MEMBER) throw new WorkspaceError('You already have 100 enrichment runs queued or running. Wait for some to finish before adding more.', 429);
			if (Number(counts?.workspace_count ?? 0) >= MAX_ACTIVE_PER_WORKSPACE) throw new WorkspaceError('This workspace already has 500 enrichment runs queued or running. Wait for some to finish before adding more.', 429);
			let effectiveRequest = request;
			if (billing.trial) {
				if (request.target > billing.trial.rowLimit) throw new WorkspaceError(`The free trial includes up to ${billing.trial.rowLimit} rows. Unlock larger searches with lifetime access for $37 once.`, 402);
				const reserved = Number((await sql.query(`SELECT COALESCE(sum((request->>'target')::int),0)::int AS reserved_rows
					FROM enrichable.populate_jobs WHERE workspace_id=$1 AND sheet_id=$2 AND ${ACTIVE} AND request IS NOT NULL`, [workspace, sheetId])).rows[0]?.reserved_rows ?? 0);
				const remaining = Math.max(0, billing.trial.rowLimit - billing.trial.rowsUsed - reserved);
				if (!remaining) throw new WorkspaceError(`The free trial is complete. Unlock more rows with lifetime access for $37 once.`, 402);
				effectiveRequest = { ...request, target: Math.min(request.target, remaining) };
			}
			const savedRequest = Object.fromEntries(REQUEST_FIELDS.map((field) => [field, effectiveRequest[field]]));
			const inserted = await sql.query(`INSERT INTO enrichable.populate_jobs (workspace_id,id,idempotency_key,input_fingerprint,actor_id,sheet_id,request,status)
				VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'queued') ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id,status`, [workspace, id, request.idempotencyKey, fingerprint, actor.user.id, sheetId, JSON.stringify(savedRequest)]);
			const job = inserted.rows[0] ?? (await sql.query('SELECT id,status,input_fingerprint FROM enrichable.populate_jobs WHERE workspace_id=$1 AND idempotency_key=$2', [workspace, request.idempotencyKey])).rows[0];
			if (!job || String(job.input_fingerprint ?? fingerprint) !== fingerprint) throw new WorkspaceError('This retry key was already used for a different search. Start a new Find rows request.', 409);
			return { jobId: String(job.id), status: String(job.status), added: 0, updated: 0 };
		}, { workspace: actor });
		return { ...active, sheetId, durable: true };
	});
}

type Job = { workspace_id: string; id: string; actor_id: string; sheet_id: string; idempotency_key: string; request: Record<string, unknown>; lease_owner: string; attempts: number };

export async function recoverExpiredPopulateJobs(database: Database) {
	await database.transaction(async (sql) => {
		await sql.query(`UPDATE enrichable.populate_jobs SET status='uncertain',lease_owner=NULL,lease_expires_at=NULL,
			progress='Worker stopped after the provider may have started.',error='This multi-step search may have incurred provider charges. Check provider usage and the sheet before retrying.',
			failure='{"reason":"provider_error","retryable":false}'::jsonb,request=NULL,updated_at=now(),completed_at=now()
			WHERE status='running' AND lease_expires_at < now()`);
	});
}

async function claim(database: Database): Promise<Job | null> {
	return database.transaction(async (sql) => {
		const row = (await sql.query(`SELECT j.workspace_id,j.id,j.actor_id,j.sheet_id,j.idempotency_key,j.request,j.attempts
			FROM enrichable.populate_jobs j JOIN enrichable.workspaces w ON w.id=j.workspace_id AND w.deleted_at IS NULL
			WHERE j.status='queued' ORDER BY j.created_at LIMIT 1 FOR UPDATE OF w,j SKIP LOCKED`)).rows[0] as Omit<Job, 'lease_owner'> | undefined;
		if (!row) return null;
		const lease = randomUUID();
		if (!await acquireDurableWorkerSlot(sql, row.workspace_id, row.id, lease)) return null;
		const saved = await sql.query("UPDATE enrichable.populate_jobs SET status='running',attempts=attempts+1,lease_owner=$3,lease_expires_at=now()+interval '7 minutes',progress='Starting search…',updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id", [row.workspace_id, row.id, lease]);
		if (!saved.rows.length) { await releaseDurableWorkerSlot(sql, row.workspace_id, row.id, lease); return null; }
		return { ...row, lease_owner: lease, attempts: Number(row.attempts) + 1, request: row.request as Record<string, unknown> };
	});
}

function actorFor(job: Job, workspace: Record<string, unknown>): Account {
	const issuer = String(workspace.issuer), organization = { id: String(workspace.organization_id), name: String(workspace.name) }, userId = String(job.actor_id);
	return { issuer, organization, user: { id: userId, email_verified: false }, partition: digest(JSON.stringify([issuer, userId, organization.id])) };
}

async function updateJob(database: Database, job: Job, patch: { status?: string; progress?: string; completionMessage?: string | null; error?: string | null; failure?: EnrichFailure; clearRequest?: boolean }) {
	await database.transaction(async (sql) => {
		const result = await sql.query(`UPDATE enrichable.populate_jobs SET
			status=COALESCE($4,status), progress=COALESCE($5,progress), completion_message=COALESCE($6,completion_message),
			error=$7, failure=COALESCE($8::jsonb,failure),
			lease_owner=CASE WHEN $9 THEN NULL ELSE lease_owner END,
			lease_expires_at=CASE WHEN $9 THEN NULL ELSE lease_expires_at END,
			request=CASE WHEN $10 THEN NULL ELSE request END,
			updated_at=now(),completed_at=CASE WHEN $4 IN ('succeeded','failed','uncertain','cancelled') THEN now() ELSE completed_at END
			WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='running' RETURNING id`, [job.workspace_id, job.id, job.lease_owner, patch.status ?? null, patch.progress ?? null, patch.completionMessage ?? null, patch.error ?? null, patch.failure ? JSON.stringify(patch.failure) : null, Boolean(patch.status && TERMINAL.has(patch.status)), Boolean(patch.clearRequest || patch.status && TERMINAL.has(patch.status))]);
		if (!result.rows.length) throw new Error('The Find rows job lease is no longer current.');
		if (patch.status && TERMINAL.has(patch.status)) await releaseDurableWorkerSlot(sql, job.workspace_id, job.id, job.lease_owner);
	});
}

async function processClaimed(database: Database, job: Job) {
	const workspace = (await database.read('SELECT issuer,organization_id,name FROM enrichable.workspaces WHERE id=$1', [job.workspace_id])).rows[0];
	if (!workspace) throw new Error('Workspace record is missing.');
	const actor = actorFor(job, workspace);
	const parsed = PopulateRequestSchema.safeParse(job.request);
	if (!parsed.success || !parsed.data.idempotencyKey || parsed.data.idempotencyKey !== job.idempotency_key) {
		await updateJob(database, job, { status: 'failed', progress: 'Invalid saved search request.', error: 'The saved Find rows request is invalid. Create a new search.', clearRequest: true });
		return;
	}
	const request = parsed.data;
	const store = new WorkspaceStore(database), grid = await store.snapshot(actor, job.sheet_id);
	const keyColumn = foundRowColumns(request.entity, grid.sheet.columns).key;
	const count = grid.rows.length;
	const billing = await billingSnapshot(actor, database);
	const trialCapacity = billing.trial ? Math.max(0, billing.trial.rowLimit - billing.trial.rowsUsed) : MAX_ROWS;
	const availableRows = Math.min(MAX_ROWS - count, trialCapacity);
	if (!availableRows) {
		await updateJob(database, job, { status: 'failed', progress: 'Sheet row limit reached.', error: `This sheet already has ${MAX_ROWS.toLocaleString()} rows. Delete rows before finding more.`, clearRequest: true });
		return;
	}
	const existingKeys = keyColumn
		? grid.rows.map((row) => foundRowKey(row.cells[keyColumn.id]?.v)).filter(Boolean).slice(0, 20_000)
		: [];
	const execution = { ...request, availableRows, existingKeys };
	let access: Awaited<ReturnType<typeof mcpAccess>> | undefined;
	let completionMessage: string | undefined;
	let completed = false;
	let searchError: { message: string; failure?: EnrichFailure } | undefined;
	try {
		access = await mcpAccess(new Headers(), actor, new OrganizationStore(database));
		await access.checkEndpoint();
		access.spend.attribution = { actorId: actor.user.id, sheetId: job.sheet_id };
		await updateJob(database, job, { progress: `Searching ${request.entity}…` });
		await runPopulate(access, execution, async (event: PopulateEvent) => {
			if (event.type === 'status') await updateJob(database, job, { progress: event.message.slice(0, 240) });
			else if (event.type === 'done') {
				completed = true;
				completionMessage = event.message?.slice(0, 1000);
				await updateJob(database, job, { progress: 'Saving final results…', completionMessage: completionMessage ?? null });
			} else if (event.type === 'error') searchError = { message: event.message.slice(0, 1000), failure: event.failure };
			else if (event.type === 'rows') {
				await store.appendFoundRows(actor, job.sheet_id, request.entity, event.rows, event.meta, Boolean(event.updateExisting), async (sql: Sql, result) => {
					const updated = await sql.query(`UPDATE enrichable.populate_jobs SET added=added+$4,updated_count=updated_count+$5,
						progress=$6,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND lease_owner=$3 AND status='running' RETURNING id`, [job.workspace_id, job.id, job.lease_owner, result.added, result.updated, `Saved ${result.added} new rows${result.updated ? `, refreshed ${result.updated} existing` : ''}.`]);
					if (!updated.rows.length) throw new Error('The Find rows job lease is no longer current.');
				});
			}
		}, new AbortController().signal);
		if (searchError) {
			await updateJob(database, job, { status: 'failed', progress: 'Search did not complete.', error: access.redact(searchError.message), failure: searchError.failure ?? classifyFailure(new Error(searchError.message), request.dataProvider), clearRequest: true });
		} else if (!completed) {
			await updateJob(database, job, { status: 'failed', progress: 'Search ended without a completion result.', error: 'The search ended before a completion result was recorded. Check the sheet and provider usage before starting another search.', failure: { reason: 'provider_error', retryable: false, provider: request.dataProvider }, clearRequest: true });
		} else {
			await updateJob(database, job, { status: 'succeeded', progress: 'Find rows complete.', completionMessage: completionMessage ?? null, clearRequest: true });
		}
	} catch (error) {
		const safe = access?.redact(error) ?? 'The workspace provider connection could not be loaded for this search.';
		const failure = classifyFailure(error, request.dataProvider) ?? { reason: 'provider_error' as const, retryable: false, provider: request.dataProvider };
		const uncertain = Boolean(access?.spend.paid);
		await updateJob(database, job, {
			status: uncertain ? 'uncertain' : 'failed',
			progress: uncertain ? 'Search stopped after provider work may have started.' : 'Find rows failed.',
			error: uncertain ? 'The search stopped after one or more provider calls may have been charged. Check provider usage and the sheet before retrying.' : safe.slice(0, 1000),
			failure: uncertain ? { ...failure, retryable: false } : failure,
			clearRequest: true,
		}).catch(() => {});
	}
}

export async function processOnePopulateJob(recoverExpired = true) {
	return withDatabase(async (database) => {
		if (recoverExpired) await recoverExpiredPopulateJobs(database);
		const job = await claim(database);
		if (!job) return false;
		try { await processClaimed(database, job); }
		catch {
			// Keep the lease after an unknown worker failure. Once it expires, the job becomes uncertain and will not replay.
		}
		return true;
	});
}

export async function processPopulateJobs(maxJobs = 2, timeBudgetMs = 270_000) {
	const started = Date.now(); let processed = 0;
	while (processed < maxJobs && (processed === 0 || Date.now() - started < timeBudgetMs)) {
		if (!await processOnePopulateJob()) break;
		processed += 1;
	}
	return processed;
}

function publicJob(job: Record<string, unknown>) {
	return {
		jobId: String(job.id), status: String(job.status), progress: String(job.progress ?? ''), added: Number(job.added ?? 0), updated: Number(job.updated_count ?? 0),
		completionMessage: typeof job.completion_message === 'string' ? job.completion_message : undefined,
		error: typeof job.error === 'string' ? job.error : undefined,
		failure: job.failure as EnrichFailure | undefined,
		updatedAt: job.updated_at instanceof Date ? job.updated_at.getTime() : job.updated_at ? new Date(String(job.updated_at)).getTime() : Date.now(),
	};
}

export async function getPopulateJob(actor: Account, id: string) {
	return withDatabase(async (database) => {
		const row = (await database.read('SELECT id,status,progress,added,updated_count,completion_message,error,failure,updated_at FROM enrichable.populate_jobs WHERE workspace_id=$1 AND id=$2', [workspaceId(actor), id])).rows[0];
		if (!row) throw new WorkspaceError('Find rows run not found in this workspace.', 404);
		return publicJob(row);
	});
}

/** Return the exact submission's latest state, including terminal results, so reload recovery can report failures. */
export async function findPopulateJob(actor: Account, sheetId: string, idempotencyKey: string) {
	return withDatabase(async (database) => {
		const row = (await database.read(`SELECT id,status,progress,added,updated_count,completion_message,error,failure,updated_at FROM enrichable.populate_jobs
			WHERE workspace_id=$1 AND sheet_id=$2 AND idempotency_key=$3 ORDER BY created_at DESC LIMIT 1`, [workspaceId(actor), sheetId, idempotencyKey])).rows[0];
		return row ? publicJob(row) : null;
	});
}

export async function cancelPopulateJob(actor: Account, id: string) {
	return withDatabase(async (database) => database.transaction(async (sql, workspace) => {
		const job = (await sql.query('SELECT actor_id,status FROM enrichable.populate_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspace, id])).rows[0];
		if (!job) throw new WorkspaceError('Find rows run not found in this workspace.', 404);
		if (String(job.actor_id) !== actor.user.id && actor.role !== 'owner' && actor.role !== 'admin') throw new WorkspaceError('Only the search owner or a workspace admin can cancel this run.', 403);
		if (String(job.status) === 'queued') {
			await sql.query("UPDATE enrichable.populate_jobs SET status='cancelled',progress='Cancelled before the provider request started.',error='Cancelled before the provider request started.',request=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now(),completed_at=now() WHERE workspace_id=$1 AND id=$2", [workspace, id]);
			return { jobId: id, status: 'cancelled' };
		}
		if (String(job.status) === 'running') throw new WorkspaceError('This search is running in the background and cannot be stopped safely after its provider calls begin.', 409);
		return { jobId: id, status: String(job.status) };
	}, { workspace: actor }));
}

