import 'server-only';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Account } from '../auth-identity';
import { DEFAULT_FOLDER_ID, type Cell, type CellMeta, type CellValue, type Column, type EntityKind, type FoundRow, type Row, type Sheet, type SheetFolder } from '../types';
import { PRESENCE_TTL_MS, type presenceInputSchema } from '../collaboration';
import { z } from 'zod';
import { createSheetSchema, patchSheetSchema, parseInput, WorkspaceError } from '../workspace';
import { admittedCell, fitGuessedFormat, invalidCell, redefinedColumns } from '../cell-admission';
import { foundRecords, foundRowColumns, foundRowKey } from '../found-rows';
import { inferredFormat } from '../column-roles';
import { workspaceId, type Database, type Sql } from './database';
import { billingRequired, billingSnapshot } from './stripe-billing';

type Actor = Pick<Account, 'issuer' | 'user' | 'organization'>;

const hasRowData = (row: Row) => Object.values(row.cells).some((cell) => cell.v !== null && cell.v !== '' && !(Array.isArray(cell.v) && cell.v.length === 0));

type TrialLimits = { sheetLimit: number; rowLimit: number; sheetsUsed: number; rowsUsed: number };
type WriteLimits = TrialLimits | { purchaseRequired: true } | null;

async function trialLimits(actor: Actor, database: Database): Promise<WriteLimits> {
	if (!billingRequired()) return null;
	const billing = await billingSnapshot(actor, database);
	if (billing.fullAccess) return null;
	if (billing.requiresPurchase || !billing.trial) return { purchaseRequired: true };
	return billing.trial;
}

async function enforceTrialQuota(sql: Sql, workspace: string, limits: WriteLimits, addedSheets = 0, addedRows = 0) {
	if (!limits) return;
	if ('purchaseRequired' in limits) throw new WorkspaceError('This additional organization has no free trial. Buy lifetime access for $37 once to unlock this workspace.', 402);
	const result = await sql.query('SELECT sheets_used,rows_used FROM enrichable.workspace_trial_usage WHERE workspace_id=$1 FOR UPDATE', [workspace]);
	if (!result.rows.length) throw new WorkspaceError('This organization has no free trial. Buy lifetime access for $37 once to unlock this workspace.', 402);
	const sheetsUsed = Number(result.rows[0].sheets_used ?? 0), rowsUsed = Number(result.rows[0].rows_used ?? 0);
	if (sheetsUsed + addedSheets > limits.sheetLimit) throw new WorkspaceError(`The first-organization trial includes one sheet. Buy lifetime access for $37 once to unlock more sheets.`, 402);
	if (rowsUsed + addedRows > limits.rowLimit) throw new WorkspaceError(`The first-organization trial allows up to ${limits.rowLimit} populated rows. Buy lifetime access for $37 once to unlock more rows.`, 402);
	if (addedSheets || addedRows) await sql.query(`UPDATE enrichable.workspace_trial_usage SET sheets_used=sheets_used+$2,rows_used=rows_used+$3,updated_at=now() WHERE workspace_id=$1`, [workspace, addedSheets, addedRows]);
}

export function collaboratorIdentity(account: Account) {
	const userId = createHash('sha256').update(JSON.stringify([account.issuer, account.user.id])).digest('hex');
	const colors = ['#2563eb', '#9333ea', '#059669', '#dc2626', '#d97706', '#0891b2'];
	return { userId, name: (account.user.name || account.user.email?.split('@')[0] || 'Teammate').slice(0, 128), color: colors[parseInt(userId.slice(0, 4), 16) % colors.length] };
}

export class WorkspaceStore {
	constructor(private database: Database) {}
	private async ensureDefaultFolder(client: Sql, workspace: string) {
		const now = Date.now();
		await client.query(`INSERT INTO enrichable.sheet_folders (workspace_id,id,name,is_default,created_at,updated_at)
			VALUES ($1,$2,'My Sheets',true,$3,$3) ON CONFLICT (workspace_id,id) DO NOTHING`, [workspace, DEFAULT_FOLDER_ID, now]);
		return (await client.query('SELECT id,name,is_default,created_at,updated_at FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2', [workspace, DEFAULT_FOLDER_ID])).rows[0];
	}
	private folderFromRow(entry: Record<string, unknown>, sheetCount = 0): SheetFolder {
		return { id: String(entry.id), name: String(entry.name), isDefault: Boolean(entry.is_default), createdAt: Number(entry.created_at), updatedAt: Number(entry.updated_at), sheetCount };
	}
	private async listFoldersIn(client: Sql, workspace: string) {
		const rows = await client.query(`SELECT f.id,f.name,f.is_default,f.created_at,f.updated_at,count(s.id)::int AS sheet_count
			FROM enrichable.sheet_folders f LEFT JOIN enrichable.sheets s ON s.workspace_id=f.workspace_id
			AND COALESCE(s.data->>'folderId',$2)=f.id WHERE f.workspace_id=$1
			GROUP BY f.workspace_id,f.id ORDER BY f.is_default DESC,f.created_at,f.name`, [workspace, DEFAULT_FOLDER_ID]);
		return rows.rows.map((entry) => this.folderFromRow(entry, Number(entry.sheet_count ?? 0)));
	}
	async listFolders(actor: Actor) {
		return this.database.transaction(async (client, workspace) => {
			await this.ensureDefaultFolder(client, workspace);
			return this.listFoldersIn(client, workspace);
		}, { workspace: actor });
	}
	async createFolder(actor: Actor, input: unknown) {
		const { name } = parseInput(z.object({ name: z.string().trim().min(1).max(80) }).strict(), input, 'Enter a folder name.');
		return this.database.transaction(async (client, workspace) => {
			await this.ensureDefaultFolder(client, workspace);
			const now = Date.now(), id = nanoid(12);
			const result = await client.query(`INSERT INTO enrichable.sheet_folders (workspace_id,id,name,is_default,created_at,updated_at)
				VALUES ($1,$2,$3,false,$4,$4) ON CONFLICT DO NOTHING RETURNING id,name,is_default,created_at,updated_at`, [workspace, id, name, now]);
			if (!result.rows.length) throw new WorkspaceError('A folder with that name already exists.', 409);
			return this.folderFromRow(result.rows[0]);
		}, { workspace: actor });
	}
	async renameFolder(actor: Actor, id: string, input: unknown) {
		const { name } = parseInput(z.object({ name: z.string().trim().min(1).max(80) }).strict(), input, 'Enter a folder name.');
		return this.database.transaction(async (client, workspace) => {
			await this.ensureDefaultFolder(client, workspace);
			const current = await client.query('SELECT id FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2', [workspace, id]);
			if (!current.rows.length) throw new WorkspaceError('Folder not found in this workspace.', 404);
			const duplicate = await client.query('SELECT id FROM enrichable.sheet_folders WHERE workspace_id=$1 AND lower(name)=lower($2) AND id<>$3', [workspace, name, id]);
			if (duplicate.rows.length) throw new WorkspaceError('A folder with that name already exists.', 409);
			const now = Date.now();
			const result = await client.query(`UPDATE enrichable.sheet_folders SET name=$3,updated_at=$4
				WHERE workspace_id=$1 AND id=$2 RETURNING id,name,is_default,created_at,updated_at`, [workspace, id, name, now]);
			return this.folderFromRow(result.rows[0]);
		}, { workspace: actor });
	}
	async deleteFolder(actor: Actor, id: string) {
		if (id === DEFAULT_FOLDER_ID) throw new WorkspaceError('The default folder cannot be deleted.', 400);
		return this.database.transaction(async (client, workspace) => {
			await this.ensureDefaultFolder(client, workspace);
			const folder = await client.query('SELECT id FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2 AND is_default=false', [workspace, id]);
			if (!folder.rows.length) throw new WorkspaceError('Folder not found in this workspace.', 404);
			const count = Number((await client.query(`SELECT count(*)::int AS count FROM enrichable.sheets
				WHERE workspace_id=$1 AND data->>'folderId'=$2`, [workspace, id])).rows[0]?.count ?? 0);
			const now = Date.now();
			await client.query(`UPDATE enrichable.sheets SET data=jsonb_set(jsonb_set(data,'{folderId}',to_jsonb($3::text),true),'{updatedAt}',to_jsonb($4::bigint),true),
				revision=revision+1,updated_by=$5 WHERE workspace_id=$1 AND data->>'folderId'=$2`, [workspace, id, DEFAULT_FOLDER_ID, now, actor.user.id]);
			await client.query('DELETE FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2', [workspace, id]);
			return { movedCount: count };
		}, { workspace: actor });
	}
	async presence(actor: Account, input: z.infer<typeof presenceInputSchema>, now = Date.now()) {
		const identity = collaboratorIdentity(actor), workspace = workspaceId(actor);
		return this.database.transaction(async (client) => {
			await client.query('DELETE FROM enrichable.sheet_presence WHERE workspace_id=$1 AND updated_at<$2', [workspace, now - PRESENCE_TTL_MS]);
			const sheet = await client.query('SELECT data FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2', [workspace, input.sheetId]);
			if (!sheet.rows.length) throw new WorkspaceError('Sheet not found in this workspace.', 404);
			const columns = (sheet.rows[0].data as Sheet).columns;
			if (input.columnId && !columns.some((c) => c.id === input.columnId)) throw new WorkspaceError('Column not found.', 404);
			if (input.rowId) {
				const row = await client.query('SELECT id FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2 AND id=$3', [workspace, input.sheetId, input.rowId]);
				if (!row.rows.length) throw new WorkspaceError('Row not found.', 404);
			}
			const result = await client.query(`INSERT INTO enrichable.sheet_presence (workspace_id,sheet_id,client_id,user_id,name,color,row_id,column_id,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (workspace_id,client_id) DO UPDATE SET sheet_id=excluded.sheet_id,name=excluded.name,color=excluded.color,row_id=excluded.row_id,column_id=excluded.column_id,updated_at=excluded.updated_at WHERE enrichable.sheet_presence.user_id=excluded.user_id RETURNING client_id`, [workspace, input.sheetId, input.clientId, identity.userId, identity.name, identity.color, input.rowId, input.columnId, now]);
			if (!result.rows.length) throw new WorkspaceError('This presence session belongs to another user.', 403);
		});
	}
	async leavePresence(actor: Account, clientId: string) {
		await this.database.transaction(async (client) => { await client.query('DELETE FROM enrichable.sheet_presence WHERE workspace_id=$1 AND client_id=$2 AND user_id=$3', [workspaceId(actor), clientId, collaboratorIdentity(actor).userId]); });
	}
	async list(actor: Actor) {
		const result = await this.database.read('SELECT s.data, s.revision, (SELECT count(*)::int FROM enrichable.sheet_rows r WHERE r.workspace_id=s.workspace_id AND r.sheet_id=s.id) AS row_count FROM enrichable.sheets s WHERE s.workspace_id=$1 ORDER BY s.id', [workspaceId(actor)]);
		return result.rows.map((entry) => ({ sheet: { ...(entry.data as Sheet), folderId: (entry.data as Sheet).folderId ?? DEFAULT_FOLDER_ID, revision: Number(entry.revision) }, rowCount: Number(entry.row_count) }));
	}
	async get(actor: Actor, id: string, offset = 0, revision?: number) {
		// A single SQL statement gives the metadata and row page the same MVCC snapshot.
		const result = await this.database.read(`SELECT s.data, s.revision, COALESCE((
			SELECT jsonb_agg(page.data ORDER BY page.position, page.id) FROM (
				SELECT r.data, r.position, r.id FROM enrichable.sheet_rows r
				WHERE r.workspace_id=s.workspace_id AND r.sheet_id=s.id ORDER BY r.position, r.id LIMIT 101 OFFSET $3
			) page
		), '[]'::jsonb) AS sheet_rows FROM enrichable.sheets s WHERE s.workspace_id=$1 AND s.id=$2`, [workspaceId(actor), id, offset]);
		const record = result.rows[0];
		if (!record) throw new WorkspaceError('Sheet not found in this workspace.', 404);
		if (revision !== undefined && Number(record.revision) !== revision) throw new WorkspaceError('Sheet changed. Refresh and try again.', 409);
		const rows = record.sheet_rows as Row[];
		return { sheet: { ...(record.data as Sheet), folderId: (record.data as Sheet).folderId ?? DEFAULT_FOLDER_ID, revision: Number(record.revision) }, rows: rows.slice(0, 100), next: rows.length > 100 ? offset + 100 : null };
	}
	/** The whole sheet as of one moment, for callers that plan against every row. Pages read one by one fail with 409
	    whenever a write lands between them; one statement reads the sheet and all its rows from one MVCC snapshot. */
	async snapshot(actor: Actor, id: string): Promise<{ sheet: Sheet; rows: Row[] }> {
		const [record, ...rows] = (await this.database.read(`SELECT 0 AS part, s.revision, s.data, 0::double precision AS position, s.id FROM enrichable.sheets s WHERE s.workspace_id=$1 AND s.id=$2
			UNION ALL SELECT 1, NULL, r.data, r.position, r.id FROM enrichable.sheet_rows r WHERE r.workspace_id=$1 AND r.sheet_id=$2
			ORDER BY part, position, id`, [workspaceId(actor), id])).rows;
		if (!record || Number(record.part) !== 0) throw new WorkspaceError('Sheet not found in this workspace.', 404);
		return { sheet: { ...(record.data as Sheet), folderId: (record.data as Sheet).folderId ?? DEFAULT_FOLDER_ID, revision: Number(record.revision) }, rows: rows.map((entry) => entry.data as Row) };
	}
	/** Persist one provider batch into the shared sheet before reporting its progress to a browser. */
	async appendFoundRows(actor: Account, id: string, entity: EntityKind, input: readonly FoundRow[], meta?: CellMeta, mergeExisting = false, persist?: (sql: Sql, result: { added: number; updated: number }) => Promise<void>, tableType?: import('../types').TableTypeDefinition) {
		if (!input.length) return { added: 0, updated: 0 };
		const limits = await trialLimits(actor, this.database);
		return this.database.transaction(async (client, workspace) => {
			const record = await client.query('SELECT data FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2', [workspace, id]);
			if (!record.rows.length) throw new WorkspaceError('Sheet not found in this workspace.', 404);
			const sheet = record.rows[0].data as Sheet;
			const columns = [...sheet.columns];
			const ensureColumn = (name: string, width = 180, format?: Column['format']) => {
				if (columns.some((column) => column.name.toLowerCase() === name.toLowerCase())) return;
				const proposed = { id: nanoid(12), name, type: 'source' as const, width, format: format ?? inferredFormat({ name, type: 'source' }), createdAt: Date.now() };
				columns.push(proposed);
			};
			for (const missing of foundRowColumns(entity, columns, tableType).missing) ensureColumn(missing.name, missing.width, missing.format);
			let mapped = foundRecords(entity, input, columns, meta, tableType);
			for (const row of mapped.records) for (const name of Object.keys(row)) {
				const exists = columns.some((column) => column.name.toLowerCase() === name.toLowerCase());
				if (!exists) ensureColumn(name);
			}
			if (columns.length !== sheet.columns.length) {
				const created = columns.slice(sheet.columns.length);
				for (const column of created) {
					const values = mapped.records.flatMap((row) => Object.entries(row).filter(([name]) => name.toLowerCase() === column.name.toLowerCase()).map(([, value]) => value));
					const fitted = fitGuessedFormat(column, values);
					columns[columns.findIndex((entry) => entry.id === column.id)] = fitted;
				}
				mapped = foundRecords(entity, input, columns, meta, tableType);
			}
			const byName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
			const dedupeColumn = byName.get(mapped.dedupeOn.toLowerCase());
			const candidateKeys = [...new Set(mapped.records.map((row) => foundRowKey(row[mapped.dedupeOn])).filter(Boolean))];
			const existingByKey = new Map<string, Row>();
			if (dedupeColumn && candidateKeys.length) {
				const matching = await client.query(`SELECT id,position,data FROM enrichable.sheet_rows
					WHERE workspace_id=$1 AND sheet_id=$2 AND regexp_replace(regexp_replace(regexp_replace(btrim(lower(data->'cells'->($3)->>'v')), '^https?://', ''), '^www\\.', ''), '/+$', '')=ANY($4::text[])`, [workspace, id, dedupeColumn.id, candidateKeys]);
				for (const entry of matching.rows) {
					const row = entry.data as Row;
					const key = foundRowKey(row.cells[dedupeColumn.id]?.v);
					if (key) existingByKey.set(key, row);
				}
			}
			const previouslyPopulated = new Map([...existingByKey.values()].map((row) => [row.id, hasRowData(row)]));
			const seen = new Set(existingByKey.keys()), changed = new Map<string, Row>(), added: Row[] = [];
			let order = Number((await client.query('SELECT COALESCE(MAX(position),-1)+1 AS next FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2', [workspace, id])).rows[0]?.next ?? 0);
			for (const [index, values] of mapped.records.entries()) {
				const key = foundRowKey(values[mapped.dedupeOn]);
				const existing = key ? existingByKey.get(key) : undefined;
				if (key && seen.has(key)) {
					if (mergeExisting && existing && !changed.has(existing.id)) {
						let didChange = false;
						for (const [field, value] of Object.entries(values)) {
							if (value === null || value === '' || typeof value === 'string' && !value.trim()) continue;
							const column = byName.get(field.toLowerCase());
							if (!column || column.type !== 'source') continue;
							const current = existing.cells[column.id] ?? { v: null, s: 'idle' as const, t: Date.now() };
							if (current.f || current.v !== null && current.v !== '') continue;
							const cellMeta = mapped.cellMeta[index]?.[field];
							existing.cells[column.id] = admittedCell(column, { v: value, s: 'done', t: Date.now(), ...(cellMeta ? { m: cellMeta } : {}) }, 'find-rows');
							didChange = true;
						}
						if (didChange) changed.set(existing.id, existing);
					}
					continue;
				}
				if (key) seen.add(key);
				const cells: Record<string, Cell> = {};
				const valuesByName = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), [name, value] as const]));
				for (const column of columns) {
					const entry = valuesByName.get(column.name.toLowerCase());
					const cellMeta = entry ? mapped.cellMeta[index]?.[entry[0]] : undefined;
					const cell: Cell = column.type === 'source' && entry ? { v: entry[1] as CellValue, s: 'done', t: Date.now(), ...(cellMeta ? { m: cellMeta } : {}) } : { v: null, s: 'idle', t: Date.now() };
					cells[column.id] = admittedCell(column, cell, 'find-rows');
				}
				added.push({ id: nanoid(12), sheetId: id, order: order++, cells, createdAt: Date.now() });
			}
			const rowsToWrite = [...changed.values(), ...added];
			const newlyPopulated = added.filter(hasRowData).length + [...changed.values()].filter((row) => !previouslyPopulated.get(row.id) && hasRowData(row)).length;
			await enforceTrialQuota(client, workspace, limits, 0, newlyPopulated);
			if (rowsToWrite.length) {
				const saved = await client.query(`INSERT INTO enrichable.sheet_rows (workspace_id,sheet_id,id,position,data)
					SELECT $1,$2,value->>'id',(value->>'order')::double precision,value FROM jsonb_array_elements($3::jsonb)
					ON CONFLICT (workspace_id,id) DO UPDATE SET position=excluded.position,data=excluded.data
					WHERE enrichable.sheet_rows.sheet_id=excluded.sheet_id RETURNING id`, [workspace, id, JSON.stringify(rowsToWrite)]);
				if (saved.rows.length !== rowsToWrite.length) throw new WorkspaceError('A row ID is already used by another sheet.', 409);
			}
			if (columns.length !== sheet.columns.length || rowsToWrite.length) {
				await client.query('UPDATE enrichable.sheets SET data=$3::jsonb,revision=revision+1,updated_by=$4 WHERE workspace_id=$1 AND id=$2', [workspace, id, JSON.stringify({ ...sheet, ...(columns.length !== sheet.columns.length ? { columns } : {}), updatedAt: Date.now() }), actor.user.id]);
			}
			const result = { added: added.length, updated: changed.size };
			await persist?.(client, result);
			return result;
		}, { workspace: actor });
	}
	async create(actor: Actor, input: unknown) {
		const { sheet, rows } = parseInput(createSheetSchema, input, 'Invalid sheet data.');
		this.validateRows(sheet, rows);
		const limits = await trialLimits(actor, this.database);
		return this.database.transaction(async (client, workspace) => {
			await this.ensureDefaultFolder(client, workspace);
			await enforceTrialQuota(client, workspace, limits, 1, rows.filter(hasRowData).length);
			const folderId = sheet.folderId ?? DEFAULT_FOLDER_ID;
			const folder = await client.query('SELECT id FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2', [workspace, folderId]);
			if (!folder.rows.length) throw new WorkspaceError('Choose a folder in this workspace.', 404);
			const storedSheet = { ...sheet, folderId };
			const created = await client.query('INSERT INTO enrichable.sheets (workspace_id, id, data, created_by, updated_by) VALUES ($1,$2,$3::jsonb,$4,$4) ON CONFLICT DO NOTHING RETURNING id', [workspace, storedSheet.id, JSON.stringify(storedSheet), actor.user.id]);
			if (!created.rows.length) throw new WorkspaceError('This sheet already exists.', 409);
			await this.putRows(client, workspace, storedSheet.id, rows);
			return { ...storedSheet, revision: 1 };
		}, { workspace: actor });
	}
	async patch(actor: Actor, id: string, input: unknown) {
		const patch = parseInput(patchSheetSchema, input, 'Invalid sheet data.');
		if (patch.sheet.id !== id) throw new WorkspaceError('Sheet ID mismatch.');
		this.validateRows(patch.sheet, patch.rows);
		const limits = await trialLimits(actor, this.database);
		return this.database.transaction(async (client, workspace) => {
			const record = await client.query('SELECT revision, data FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2', [workspace, id]);
			if (!record.rows.length) throw new WorkspaceError('Sheet not found in this workspace.', 404);
			if (Number(record.rows[0].revision) !== patch.revision) throw new WorkspaceError('Another member changed this sheet. Refresh and retry your edit.', 409);
			await this.ensureDefaultFolder(client, workspace);
			const folderId = patch.sheet.folderId ?? DEFAULT_FOLDER_ID;
			const folder = await client.query('SELECT id FROM enrichable.sheet_folders WHERE workspace_id=$1 AND id=$2', [workspace, folderId]);
			if (!folder.rows.length) throw new WorkspaceError('Choose a folder in this workspace.', 404);
			await this.validateValues(client, workspace, record.rows[0].data as Sheet, patch);
			const previousRows = await client.query('SELECT id,data FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2', [workspace, id]);
			const previousById = new Map(previousRows.rows.map((entry) => [String(entry.id), entry.data as Row]));
			const newlyPopulated = patch.rows.filter((row) => hasRowData(row) && !hasRowData(previousById.get(row.id) ?? { ...row, cells: {} })).length;
			await enforceTrialQuota(client, workspace, limits, 0, newlyPopulated);
			await client.query('DELETE FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2 AND id=ANY($3::text[])', [workspace, id, patch.deleted]);
			await this.putRows(client, workspace, id, patch.rows);
			const sheet = { ...patch.sheet, folderId, updatedAt: Date.now() };
			const result = await client.query('UPDATE enrichable.sheets SET data=$3::jsonb, revision=revision+1, updated_by=$4 WHERE workspace_id=$1 AND id=$2 RETURNING revision', [workspace, id, JSON.stringify(sheet), actor.user.id]);
			return { revision: Number(result.rows[0].revision), updatedAt: sheet.updatedAt };
		}, { workspace: actor });
	}
	/** Compare-and-set one cell in one transaction under the workspace's lock: `change` sees the sheet and its rows (in
	    sheet order) as they are, and returns the cell to store, or undefined to leave it. Every writer to the workspace
	    waits for that lock, so no revision conflict can refuse the write. */
	async changeCell(actor: Actor, id: string, target: { rowId: string; columnId: string }, change: (grid: { sheet: Sheet; rows: Row[] }) => Cell | undefined) {
		const limits = await trialLimits(actor, this.database);
		return this.database.transaction(async (client, workspace) => {
			const record = await client.query('SELECT revision, data FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2', [workspace, id]);
			if (!record.rows.length) throw new WorkspaceError('Sheet not found in this workspace.', 404);
			const data = record.rows[0].data as Sheet, sheet = { ...data, revision: Number(record.rows[0].revision) };
			const rows = (await client.query('SELECT data FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2 ORDER BY position, id', [workspace, id])).rows.map((entry) => entry.data as Row);
			const row = rows.find((entry) => entry.id === target.rowId);
			const cell = row && sheet.columns.some((column) => column.id === target.columnId) ? change({ sheet, rows }) : undefined;
			if (!row || !cell) return undefined;
			const written = { ...row, cells: { ...row.cells, [target.columnId]: cell } };
			await enforceTrialQuota(client, workspace, limits, 0, !hasRowData(row) && hasRowData(written) ? 1 : 0);
			await this.validateValues(client, workspace, data, { sheet: data, rows: [written], deleted: [] });
			await this.putRows(client, workspace, id, [written]);
			await client.query('UPDATE enrichable.sheets SET data=$3::jsonb, revision=revision+1, updated_by=$4 WHERE workspace_id=$1 AND id=$2', [workspace, id, JSON.stringify({ ...data, updatedAt: Date.now() }), actor.user.id]);
			return cell;
		}, { workspace: actor });
	}
	async remove(actor: Actor, id: string, revision: number) {
		return this.database.transaction(async (client, workspace) => {
			const result = await client.query('DELETE FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id', [workspace, id, revision]);
			if (!result.rows.length) throw new WorkspaceError('Sheet changed or was deleted. Refresh before deleting.', 409);
		}, { workspace: actor });
	}
	private validateRows(sheet: Sheet, rows: Row[]) {
		if (new Set(sheet.columns.map((column) => column.id)).size !== sheet.columns.length || new Set(rows.map((row) => row.id)).size !== rows.length) throw new WorkspaceError('Duplicate row or column IDs.');
		const columns = new Set(sheet.columns.map((column) => column.id));
		if (rows.some((row) => row.sheetId !== sheet.id || Object.keys(row.cells).some((id) => !columns.has(id)))) throw new WorkspaceError('Rows must belong to the sheet and its columns.');
	}
	/** Typed columns keep their format whoever writes (an MCP agent, a stale tab): each written cell that changed, and
	    every cell of a column whose format changed, must fit it. Unchanged values are not rechecked, so a value stored
	    before this check existed never blocks an unrelated edit. */
	private async validateValues(client: Sql, workspace: string, stored: Sheet, patch: { sheet: Pick<Sheet, 'columns'>; rows: Row[]; deleted: string[] }) {
		const { columns } = patch.sheet;
		const redefined = redefinedColumns(stored.columns, columns).size > 0;
		if (!redefined && !patch.rows.length) return;
		const existing = redefined
			? await client.query('SELECT data FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2', [workspace, stored.id])
			: await client.query('SELECT data FROM enrichable.sheet_rows WHERE workspace_id=$1 AND sheet_id=$2 AND id=ANY($3::text[])', [workspace, stored.id, patch.rows.map((row) => row.id)]);
		const before = existing.rows.map((entry) => entry.data as Row);
		const written = new Set(patch.rows.map((row) => row.id)), deleted = new Set(patch.deleted);
		const rows = redefined ? [...before.filter((row) => !written.has(row.id) && !deleted.has(row.id)), ...patch.rows] : patch.rows;
		const problem = invalidCell({ columns: stored.columns, rows: before }, { columns, rows });
		if (problem) throw new WorkspaceError(problem, 422);
	}
	private async putRows(client: Sql, workspace: string, sheetId: string, rows: Row[]) {
		if (!rows.length) return;
		const result = await client.query(`INSERT INTO enrichable.sheet_rows (workspace_id, sheet_id, id, position, data)
			SELECT $1, $2, value->>'id', (value->>'order')::double precision, value FROM jsonb_array_elements($3::jsonb)
			ON CONFLICT (workspace_id, id) DO UPDATE SET position=excluded.position, data=excluded.data
			WHERE enrichable.sheet_rows.sheet_id=excluded.sheet_id RETURNING id`, [workspace, sheetId, JSON.stringify(rows)]);
		if (result.rows.length !== rows.length) throw new WorkspaceError('A row ID is already used by another sheet.', 409);
	}
}
