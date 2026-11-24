import 'server-only';
import { withDatabase } from './database';
import { processOneEnrichmentJob, recoverExpiredEnrichmentJobs } from './enrichment-jobs';
import { processOnePopulateJob, recoverExpiredPopulateJobs } from './populate-jobs';

/** The cron worker claims one oldest job per invocation. A paid job may use most of the function's execution window. */
export async function processOneDurableJob(): Promise<'cell' | 'populate' | false> {
	const first = await withDatabase(async (database) => {
		// Expire stale leases on every scheduled pass, including when no queued job remains.
		await recoverExpiredEnrichmentJobs(database);
		await recoverExpiredPopulateJobs(database);
		const row = (await database.read(`SELECT kind FROM (
			SELECT 'cell'::text AS kind,created_at FROM enrichable.enrichment_jobs WHERE status='queued'
			UNION ALL SELECT 'populate'::text AS kind,created_at FROM enrichable.populate_jobs WHERE status='queued'
		) queued ORDER BY created_at,kind LIMIT 1`)).rows[0];
		return row?.kind === 'populate' ? 'populate' : row?.kind === 'cell' ? 'cell' : false;
	});
	if (!first) return false;
	const other = first === 'cell' ? 'populate' : 'cell';
	const run = async (kind: 'cell' | 'populate') => kind === 'cell' ? processOneEnrichmentJob(false) : processOnePopulateJob(false);
	if (await run(first)) return first;
	return await run(other) ? other : false;
}
