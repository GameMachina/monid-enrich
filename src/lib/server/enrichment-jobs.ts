import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { ColumnOpSchema, type Cell, type EnrichResponse, type Row } from '../types';
import { canonicalJson } from '../cell-content';
import { inputFingerprint } from '../enrichment-freshness';
import { failureCell, planCell, resultCell, type EnrichmentPlan } from '../enrichment-plan';
import { WorkspaceError } from '../workspace';
import type { Account } from '../auth-identity';
import { WorkspaceStore } from './workspace-store';
import { OrganizationStore } from './organization-store';
import { mcpAccess } from './provider-access';
import { runOp } from './enrich';
import { withDatabase, workspaceId, type Database } from './database';
import { logWorkspaceError } from './workspace-logging';

const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['succeeded', 'failed', 'uncertain', 'cancelled']);
const MAX_ACTIVE_JOBS_PER_MEMBER = 100;
const MAX_ACTIVE_JOBS_PER_WORKSPACE = 500;

export async function enqueueEnrichment(actor: Account, input: { op: unknown; row: Record<string, unknown>; idempotencyKey: string; context: { sheetId: string; rowId: string; columnId: string } }) {
	return withDatabase(async (database) => {
		const store = new WorkspaceStore(database);
		const grid = await store.snapshot(actor, input.context.sheetId);
		const column = grid.sheet.columns.find((entry) => entry.id === input.context.columnId);
		const parsed = ColumnOpSchema.safeParse(column?.op);
		const plan = planCell(grid, { rowId: input.context.rowId, columnId: input.context.columnId });
		if (!column || !plan || !parsed.success) throw new WorkspaceError('The enrichment column or row no longer exists.', 409);
		if (canonicalJson(parsed.data) !== canonicalJson(input.op) || canonicalJson(plan.op) !== canonicalJson(input.op)) throw new WorkspaceError('The enrichment column changed. Refresh and run it again.', 409);
		if (canonicalJson(plan.record) !== canonicalJson(input.row)) throw new WorkspaceError('This row changed before the run started. Refresh and run it again.', 409);
		const inputFingerprint = inputFingerprintOf(plan);
		const id = randomUUID();
		const retryable = 'dataProvider' in plan.op && plan.op.dataProvider === 'treg';
		return database.transaction(async (sql, workspace) => {
			const existing = (await sql.query('SELECT id,input_fingerprint,status FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND idempotency_key=$2', [workspace, input.idempotencyKey])).rows[0];
			if (existing) {
				if (String(existing.input_fingerprint) !== inputFingerprint) throw new WorkspaceError('This retry key was already used for different inputs. Run the cell again to create a new job.', 409);
				return { jobId: String(existing.id), status: String(existing.status) };
			}
			const active = (await sql.query(`SELECT count(*)::int AS workspace_count, count(*) FILTER (WHERE actor_id=$2)::int AS member_count
				FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND status IN ('queued','running')`, [workspace, actor.user.id])).rows[0];
			if (Number(active?.member_count ?? 0) >= MAX_ACTIVE_JOBS_PER_MEMBER) throw new WorkspaceError('You already have 100 enrichment runs queued or running. Wait for some to finish before adding more.', 429);
			if (Number(active?.workspace_count ?? 0) >= MAX_ACTIVE_JOBS_PER_WORKSPACE) throw new WorkspaceError('This workspace already has 500 enrichment runs queued or running. Wait for some to finish before adding more.', 429);
			const inserted = await sql.query(`INSERT INTO enrichable.enrichment_jobs (workspace_id,id,idempotency_key,actor_id,sheet_id,row_id,column_id,input_fingerprint,retryable,status)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id,input_fingerprint,status`, [workspace, id, input.idempotencyKey, actor.user.id, input.context.sheetId, input.context.rowId, input.context.columnId, inputFingerprint, retryable]);
			const job = inserted.rows[0] ?? (await sql.query('SELECT id,input_fingerprint,status FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND idempotency_key=$2', [workspace, input.idempotencyKey])).rows[0];
			if (!job || String(job.input_fingerprint) !== inputFingerprint) throw new WorkspaceError('This retry key was already used for different inputs. Run the cell again to create a new job.', 409);
			return { jobId: String(job.id), status: String(job.status) };
		}, { workspace: actor });
	});
}

function inputFingerprintOf(plan: EnrichmentPlan) {
	return inputFingerprint(plan.version);
}

type Job = { workspace_id: string; id: string; actor_id: string; sheet_id: string; row_id: string; column_id: string; input_fingerprint: string; idempotency_key: string; attempts: number };

async function recoverExpired(database: Database) {
	await database.transaction(async (sql) => {
		const expired = await sql.query(`SELECT j.workspace_id,j.id,j.sheet_id,j.row_id,j.column_id,j.input_fingerprint,j.retryable,r.data AS row_data
			FROM enrichable.enrichment_jobs j LEFT JOIN enrichable.sheet_rows r ON r.workspace_id=j.workspace_id AND r.sheet_id=j.sheet_id AND r.id=j.row_id
			WHERE j.status='running' AND j.lease_expires_at < now() FOR UPDATE OF j SKIP LOCKED`);
		for (const job of expired.rows) {
			const row = job.row_data as Row | null;
			const cell = row?.cells?.[String(job.column_id)] as Cell | undefined;
			if (cell?.s === 'done' && cell.m?.inputFingerprint === job.input_fingerprint) {
				await sql.query("UPDATE enrichable.enrichment_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2", [job.workspace_id, job.id]);
			} else if (job.retryable) {
				await sql.query("UPDATE enrichable.enrichment_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,error=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2", [job.workspace_id, job.id]);
			} else {
				await sql.query("UPDATE enrichable.enrichment_jobs SET status='uncertain',lease_owner=NULL,lease_expires_at=NULL,error='The worker stopped after the provider request may have started. Check provider usage before retrying.',updated_at=now() WHERE workspace_id=$1 AND id=$2", [job.workspace_id, job.id]);
			}
		}
	});
}

async function claim(database: Database): Promise<Job | null> {
	await recoverExpired(database);
	return database.transaction(async (sql) => {
		const row = (await sql.query(`SELECT j.workspace_id,j.id,j.actor_id,j.sheet_id,j.row_id,j.column_id,j.input_fingerprint,j.idempotency_key,j.attempts
			FROM enrichable.enrichment_jobs j JOIN enrichable.workspaces w ON w.id=j.workspace_id AND w.deleted_at IS NULL
			WHERE j.status='queued' ORDER BY j.created_at LIMIT 1 FOR UPDATE OF w,j SKIP LOCKED`)).rows[0] as Job | undefined;
		if (!row) return null;
		await sql.query("UPDATE enrichable.enrichment_jobs SET status='running',attempts=attempts+1,lease_owner=$3,lease_expires_at=now()+interval '7 minutes',updated_at=now() WHERE workspace_id=$1 AND id=$2", [row.workspace_id, row.id, randomUUID()]);
		return { ...row, attempts: Number(row.attempts) + 1 };
	});
}

function actorFor(row: Record<string, unknown>, workspace: Record<string, unknown>): Account {
	const issuer = String(workspace.issuer), organization = { id: String(workspace.organization_id), name: String(workspace.name) }, userId = String(row.actor_id);
	return { issuer, organization, user: { id: userId, email_verified: false }, partition: fingerprint(JSON.stringify([issuer, userId, organization.id])) };
}

async function saveResult(database: Database, actor: Account, job: Job, result: EnrichResponse) {
	const store = new WorkspaceStore(database);
	const saved = await store.changeCell(actor, job.sheet_id, { rowId: job.row_id, columnId: job.column_id }, ({ sheet, rows }) => {
		const plan = planCell({ sheet, rows }, { rowId: job.row_id, columnId: job.column_id });
		if (!plan || inputFingerprint(plan.version) !== job.input_fingerprint) return undefined;
		if (result.error) return failureCell(plan, result.error, { ...(result.meta ?? {}), ...(result.failure ? { failure: result.failure } : {}) }, Date.now(), plan.cell);
		return resultCell(plan, result.value, result.meta);
	});
	return saved;
}

async function processClaimed(database: Database, job: Job) {
	const workspace = (await database.read('SELECT issuer,organization_id,name FROM enrichable.workspaces WHERE id=$1', [job.workspace_id])).rows[0];
	if (!workspace) throw new Error('Workspace record is missing.');
	const actor = actorFor(job, workspace);
	const grid = await new WorkspaceStore(database).snapshot(actor, job.sheet_id);
	const plan = planCell(grid, { rowId: job.row_id, columnId: job.column_id });
	if (!plan || inputFingerprint(plan.version) !== job.input_fingerprint) {
		await database.transaction((sql) => sql.query("UPDATE enrichable.enrichment_jobs SET status='failed',error='The row or column changed while the run was queued. Run the cell again.',updated_at=now() WHERE workspace_id=$1 AND id=$2", [job.workspace_id, job.id]).then(() => undefined));
		return;
	}
	let result: EnrichResponse;
	let access: Awaited<ReturnType<typeof mcpAccess>> | undefined;
	try {
		access = await mcpAccess(new Headers(), actor, new OrganizationStore(database));
		result = await runOp(access, plan.op, plan.record, { idempotencyKey: job.idempotency_key, runContext: { sheetId: job.sheet_id, rowId: job.row_id, columnId: job.column_id } });
	} catch (error) {
		const safe = access?.redact(error) ?? 'The provider connection could not be loaded for this workspace.';
		result = { value: null, error: safe, failure: { reason: 'credential_missing', retryable: false }, meta: { dataProvider: 'dataProvider' in plan.op ? plan.op.dataProvider : undefined } };
	}
	const saved = await saveResult(database, actor, job, result);
	const status = !saved ? 'failed' : result.error ? 'failed' : 'succeeded';
	const safeError = result.error ? result.error.slice(0, 1000) : !saved ? 'The row changed while the provider was running. Run the cell again.' : null;
	await database.transaction(async (sql) => {
		await sql.query('UPDATE enrichable.enrichment_jobs SET status=$3,error=$4,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2', [job.workspace_id, job.id, status, safeError]);
	});
}

export async function processOneEnrichmentJob() {
	return withDatabase(async (database) => {
		const job = await claim(database);
		if (!job) return false;
		try { await processClaimed(database, job); }
		catch (error) {
			logWorkspaceError(error, { requestId: job.id, operation: 'enrichment.worker', phase: 'execute', durationMs: 0 });
			// Keep a lease after an unknown failure; expiration moves non-idempotent runs to uncertain,
			// while Treg runs reuse their stable idempotency key.
		}
		return true;
	});
}

/** Drain a bounded batch so a single Vercel cron invocation can make steady progress. */
export async function processEnrichmentJobs(maxJobs = 5, timeBudgetMs = 270_000) {
	const started = Date.now();
	let processed = 0;
	while (processed < maxJobs && (processed === 0 || Date.now() - started < timeBudgetMs)) {
		if (!await processOneEnrichmentJob()) break;
		processed += 1;
	}
	return processed;
}

export async function getEnrichmentJob(actor: Account, id: string) {
	return withDatabase(async (database) => {
		const workspace = workspaceId(actor);
		const job = (await database.read('SELECT id,status,error,sheet_id,row_id,column_id FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND id=$2', [workspace, id])).rows[0];
		if (!job) throw new WorkspaceError('Enrichment run not found.', 404);
		const status = String(job.status);
		if (!terminal.has(status)) return { jobId: id, status };
		if (status === 'uncertain') return { jobId: id, status, error: String(job.error ?? 'Provider status is uncertain; check usage before retrying.'), failure: { reason: 'provider_error', retryable: false } };
		if (status === 'cancelled') return { jobId: id, status, error: 'This enrichment was cancelled.', failure: { reason: 'provider_error', retryable: false } };
		const row = (await database.read('SELECT data FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2 AND id=$3', [workspace, job.sheet_id, job.row_id])).rows[0]?.data as Row | undefined;
		const cell = row?.cells?.[String(job.column_id)];
		if (status === 'succeeded') return { jobId: id, status, value: cell?.v ?? null, meta: cell?.m };
		return { jobId: id, status, value: cell?.v ?? null, meta: cell?.m, error: String(job.error ?? cell?.e ?? 'Enrichment failed.'), failure: cell?.m?.failure ?? { reason: 'provider_error', retryable: false } };
	});
}

export async function cancelEnrichmentJob(actor: Account, id: string) {
	return withDatabase(async (database) => {
		const workspace = workspaceId(actor);
		return database.transaction(async (sql) => {
			const job = (await sql.query('SELECT actor_id,status FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspace, id])).rows[0];
			if (!job) throw new WorkspaceError('Enrichment run not found.', 404);
			if (String(job.actor_id) !== actor.user.id && actor.role !== 'owner' && actor.role !== 'admin') throw new WorkspaceError('Only the run owner or a workspace admin can cancel this run.', 403);
			if (String(job.status) === 'queued') {
				await sql.query("UPDATE enrichable.enrichment_jobs SET status='cancelled',error='Cancelled before the provider request started.',updated_at=now() WHERE workspace_id=$1 AND id=$2", [workspace, id]);
				return { jobId: id, status: 'cancelled' };
			}
			if (String(job.status) === 'running') throw new WorkspaceError('The provider request is already running and cannot be safely cancelled. It will finish in the background.', 409);
			return { jobId: id, status: String(job.status) };
		}, { workspace: actor });
	});
}
