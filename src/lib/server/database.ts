import 'server-only';
import { createHash } from 'node:crypto';
import { neon, neonConfig, Pool, type NeonQueryFunction } from '@neondatabase/serverless';
import WebSocket from 'ws';
import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as databaseFetch } from 'undici';
import { join, resolve } from 'node:path';
import type { Account } from '../auth-identity';
import { WorkspaceError } from '../workspace';
import { openEmbeddedDriver } from './embedded-database';

// Keep database networking independent of the process-wide fetch/DNS defaults.
// Prefer IPv4 while retaining IPv6 fallback on networks with broken IPv6 routes.
const databaseLookup: LookupFunction = (hostname, options, callback) => lookup(hostname, { ...options, order: 'ipv4first' }, callback);
const connectionOptions = { lookup: databaseLookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 250 };
const databaseAgent = new Agent({ connect: { ...connectionOptions, timeout: 10_000 } });
neonConfig.fetchFunction = (url: Parameters<typeof databaseFetch>[0], options: Parameters<typeof databaseFetch>[1]) => databaseFetch(url, { ...options, dispatcher: databaseAgent });

neonConfig.webSocketConstructor = class extends WebSocket {
	constructor(address: string) {
		const options = { ...connectionOptions, handshakeTimeout: 10_000 };
		super(address, options);
	}
};

export type Rows = Record<string, unknown>[];
/** Statements inside one transaction. */
export interface Sql { query(text: string, values?: unknown[]): Promise<{ rows: Rows }> }
/** Whose workspace a transaction writes: the verified issuer and organization, never request input. */
export type WorkspaceActor = Pick<Account, 'issuer' | 'organization'>;
export const workspaceId = (actor: WorkspaceActor) => createHash('sha256').update(JSON.stringify([actor.issuer, actor.organization.id])).digest('hex');

/**
 * The server's Postgres. `read` runs one statement on its own; a statement sees one snapshot, so a single read needs no
 * transaction. `transaction` commits everything `run` does or nothing: a write transaction with `workspace` first creates
 * that workspace and locks it, so writes to one workspace serialize; `readOnly` reads several statements from one
 * snapshot. A failed transaction rethrows the error `run` threw, whatever happens to its rollback.
 */
export interface Database {
	read(text: string, values?: unknown[]): Promise<{ rows: Rows }>;
	transaction<T>(run: (sql: Sql) => Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
	transaction<T>(run: (sql: Sql, workspace: string) => Promise<T>, options: { workspace: WorkspaceActor; readOnly?: boolean }): Promise<T>;
}

/** A session an Adapter lends to one transaction. Released with an error, the session is broken and must be discarded. */
export interface Connection extends Sql { release(error?: Error): void }
/** What an Adapter supplies; everything else about a Database is shared. */
export interface Driver {
	connect(): Promise<Connection>;
	read(text: string, values: unknown[]): Promise<{ rows: Rows }>;
}

export function createDatabase(driver: Driver): Database {
	async function transaction<T>(run: (sql: Sql, workspace: string) => Promise<T>, options: { workspace?: WorkspaceActor; readOnly?: boolean } = {}): Promise<T> {
		const connection = await driver.connect();
		let broken: Error | undefined;
		try {
			await connection.query(options.readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
			const actor = options.workspace, workspace = actor ? workspaceId(actor) : '';
			if (actor && !options.readOnly) {
				await connection.query('INSERT INTO enrichable.workspaces (id, issuer, organization_id, name) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [workspace, actor.issuer, actor.organization.id, actor.organization.name]);
				await connection.query('SELECT id FROM enrichable.workspaces WHERE id = $1 FOR UPDATE', [workspace]);
			}
			const result = await run(connection, workspace);
			await connection.query('COMMIT');
			return result;
		} catch (error) {
			// The caller needs the original failure (a 409 must stay a 409); a session that cannot roll back is discarded.
			await connection.query('ROLLBACK').catch((rollback: unknown) => { broken = rollback instanceof Error ? rollback : new Error('Rollback failed.'); });
			throw error;
		} finally { connection.release(broken); }
	}
	return { read: (text, values = []) => driver.read(text, values), transaction };
}

// Checked on first use, so requests that never touch storage work on deployments without it.
function databaseUrl() {
	const url = process.env.DATABASE_URL?.trim();
	if (!url) throw new WorkspaceError('Database storage is not configured for this workspace.', 503);
	return url;
}

// Next emits route handlers as separate server bundles. Keep one PGlite session for the process across those bundles.
type EmbeddedWorkspaceHandle = { database: Database; close: () => Promise<void> };
const localDatabaseState = globalThis as typeof globalThis & { __monidEnrichEmbeddedDatabase?: Promise<EmbeddedWorkspaceHandle> };
async function embeddedWorkspaceDatabase() {
	if (!localDatabaseState.__monidEnrichEmbeddedDatabase) {
		const path = process.env.ENRICHABLE_LOCAL_DATABASE_PATH?.trim() || join(process.cwd(), '.data', 'database');
		const directory = resolve(process.cwd(), 'migrations');
		localDatabaseState.__monidEnrichEmbeddedDatabase = openEmbeddedDriver({ dataDirectory: path, migrationsDirectory: directory }).then(({ driver, close }) => ({ database: createDatabase(driver), close }));
	}
	const pending = localDatabaseState.__monidEnrichEmbeddedDatabase;
	try { return (await pending).database; }
	catch (error) {
		if (localDatabaseState.__monidEnrichEmbeddedDatabase === pending) delete localDatabaseState.__monidEnrichEmbeddedDatabase;
		throw error;
	}
}

/** Gracefully close the local database, primarily for test/process shutdown hooks. */
export async function closeEmbeddedWorkspaceDatabase() {
	const pending = localDatabaseState.__monidEnrichEmbeddedDatabase;
	delete localDatabaseState.__monidEnrichEmbeddedDatabase;
	if (pending) await (await pending).close();
}

/** Use embedded PGlite for one local process, or Neon for a shared deployment. Neon resources last only for `run`. */
export async function withDatabase<T>(run: (database: Database) => Promise<T>): Promise<T> {
	if (!process.env.DATABASE_URL?.trim()) return run(await embeddedWorkspaceDatabase());
	let pool: Pool | undefined, http: NeonQueryFunction<false, false> | undefined;
	try {
		return await run(createDatabase({
			connect: async () => (pool ??= new Pool({ connectionString: databaseUrl(), max: 3, connectionTimeoutMillis: 10_000 })).connect(),
			read: async (text, values) => ({ rows: await (http ??= neon(databaseUrl())).query(text, values) }),
		}));
	} finally { await pool?.end().catch(() => {}); }
}
