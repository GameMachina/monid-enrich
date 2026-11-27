import { loadEnvConfig } from '@next/env';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { migrateDatabase } from './database-migrations';

async function migrate() {
	loadEnvConfig(process.cwd());
	const connection = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
	if (!connection) throw new Error('Set DATABASE_URL to the dedicated Monid Enrich Neon database.');
	const sql = neon(connection);
	await migrateDatabase((statements) => sql.transaction(statements.map((statement) => sql.query(statement))), join(process.cwd(), 'migrations'));
	console.log('Monid Enrich workspace schema is ready.');
}

function safeErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, 'postgresql://[redacted]')
		.replace(/((?:password|secret|token|api[_ -]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
		.slice(0, 500);
}

void migrate().catch((error: unknown) => {
	const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
	console.error(`Database migration failed${code}: ${safeErrorMessage(error)}`);
	process.exitCode = 1;
});
