import 'server-only';

import { chmod, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Connection, Driver, Rows } from './database';

/** Apply each migration once to the persistent local database. The process owns this single connection. */
async function migrateLocalDatabase(database: PGlite, directory: string) {
	await database.query(`CREATE TABLE IF NOT EXISTS public.monid_enrich_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
	const applied = new Set((await database.query<{ name: string }>('SELECT name FROM public.monid_enrich_schema_migrations')).rows.map(({ name }) => name));
	const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
	if (!files.length) throw new Error(`No database migrations found in ${directory}.`);
	for (const name of files) {
		if (applied.has(name)) continue;
		const sql = await readFile(resolve(directory, name), 'utf8');
		await database.transaction(async (transaction) => {
			for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await transaction.exec(statement);
			await transaction.query('INSERT INTO public.monid_enrich_schema_migrations (name) VALUES ($1)', [name]);
		});
	}
}

/** PGlite has one session, so serialize reads and transactions to prevent interleaving statements. */
function localDriver(database: PGlite): Driver {
	let queue = Promise.resolve();
	const connect = async (): Promise<Connection> => {
		const previous = queue;
		let unlock!: () => void;
		queue = new Promise<void>((resolveQueue) => { unlock = resolveQueue; });
		await previous;
		let released = false;
		return {
			query: async (text, values = []) => database.query<Record<string, unknown>>(text, values) as Promise<{ rows: Rows }>,
			release: () => { if (!released) { released = true; unlock(); } },
		};
	};
	return {
		connect,
		read: async (text, values) => {
			const connection = await connect();
			try { return await connection.query(text, values); }
			finally { connection.release(); }
		},
	};
}

export async function openEmbeddedDriver(options: { dataDirectory: string; migrationsDirectory: string }) {
	const dataDirectory = resolve(options.dataDirectory);
	await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') await chmod(dataDirectory, 0o700);
	const database = await PGlite.create(dataDirectory);
	try {
		await migrateLocalDatabase(database, options.migrationsDirectory);
		return { driver: localDriver(database), close: () => database.close() };
	} catch (error) {
		await database.close().catch(() => {});
		throw error;
	}
}
