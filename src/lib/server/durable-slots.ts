import 'server-only';
import type { Sql } from './database';

/** One shared pool caps provider work across cell and Find rows jobs, including parallel Vercel instances. */
export async function acquireDurableWorkerSlot(sql: Sql, workspaceId: string, jobId: string, leaseOwner: string) {
	const slot = (await sql.query(`SELECT slot_id FROM enrichable.durable_worker_slots
		WHERE lease_expires_at IS NULL OR lease_expires_at < now()
		ORDER BY slot_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
	if (!slot) return false;
	const result = await sql.query(`UPDATE enrichable.durable_worker_slots SET workspace_id=$2,job_id=$3,lease_owner=$4,lease_expires_at=now()+interval '7 minutes'
		WHERE slot_id=$1 RETURNING slot_id`, [slot.slot_id, workspaceId, jobId, leaseOwner]);
	return result.rows.length > 0;
}

export async function releaseDurableWorkerSlot(sql: Sql, workspaceId: string, jobId: string, leaseOwner: string) {
	await sql.query(`UPDATE enrichable.durable_worker_slots SET workspace_id=NULL,job_id=NULL,lease_owner=NULL,lease_expires_at=NULL
		WHERE workspace_id=$1 AND job_id=$2 AND lease_owner=$3`, [workspaceId, jobId, leaseOwner]);
}
