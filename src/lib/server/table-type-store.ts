import 'server-only';
import { WorkspaceError } from '../workspace';
import { TableTypeDefinitionSchema, type EntityKind, type TableTypeDefinition } from '../types';
import { isRunnableTableType, tableTypeRunnableError } from '../table-types';
import { registeredMonidOperations } from './monid';
import type { Database } from './database';

export const BUILT_IN_TABLE_TYPE_IDS = new Set(['companies', 'people', 'websites']);

function parseDefinition(value: unknown): TableTypeDefinition {
	const parsed = TableTypeDefinitionSchema.safeParse(value);
	if (!parsed.success) throw new WorkspaceError('This table-type definition is invalid. Review its fields and mappings.', 400);
	return parsed.data;
}

function validateRegisteredOperations(definition: TableTypeDefinition) {
	const allowed = new Set(registeredMonidOperations());
	if (new Set(definition.operations).size !== definition.operations.length || definition.operations.some((operation) => !allowed.has(operation as never))) {
		throw new WorkspaceError('Choose operations from the registered Monid operation list.', 400);
	}
	if (new Set(definition.chaining.operations).size !== definition.chaining.operations.length || definition.chaining.operations.some((operation) => !allowed.has(operation as never))) {
		throw new WorkspaceError('Chained operations must also be registered Monid operations.', 400);
	}
	if (new Set(definition.requiredInputs.map((input) => input.key)).size !== definition.requiredInputs.length) throw new WorkspaceError('Required input keys must be unique.', 400);
}

function validatePublish(definition: TableTypeDefinition) {
	if (definition.status !== 'published') return;
	const reason = tableTypeRunnableError(definition);
	if (reason) throw new WorkspaceError(`This table type cannot be published yet: ${reason}`, 400);
}

export class TableTypeStore {
	constructor(private readonly database: Database) {}

	async listAll() {
		const rows = (await this.database.read('SELECT id,definition,created_at,updated_at FROM enrichable.table_types ORDER BY definition->>\'category\', definition->>\'name\', id')).rows;
		return rows.map((row) => {
			const definition = parseDefinition(row.definition);
			return { definition, runnable: isRunnableTableType(definition), readinessError: tableTypeRunnableError(definition), createdAt: row.created_at, updatedAt: row.updated_at };
		});
	}

	async listRunnablePublished() {
		return (await this.listAll()).filter((entry) => entry.runnable).map((entry) => entry.definition);
	}

	async resolvePublished(id: string | undefined, entity: EntityKind): Promise<TableTypeDefinition> {
		const typeId = id || entity;
		const row = (await this.database.read('SELECT definition FROM enrichable.table_types WHERE id=$1', [typeId])).rows[0];
		if (!row) throw new WorkspaceError('This search type is not available. Reload the app and choose a published type.', 400);
		const definition = parseDefinition(row.definition);
		if (!isRunnableTableType(definition) || definition.entity !== entity) throw new WorkspaceError('This search type is not currently available for searching.', 400);
		return definition;
	}

	async create(input: unknown) {
		const definition = parseDefinition(input);
		if (definition.status !== 'draft') throw new WorkspaceError('New table types must start as drafts.', 400);
		validateRegisteredOperations(definition);
		try {
			await this.database.transaction(async (sql) => {
				await sql.query('INSERT INTO enrichable.table_types (id,definition) VALUES ($1,$2::jsonb)', [definition.id, JSON.stringify(definition)]);
			});
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new WorkspaceError('A table type with that ID already exists.', 409);
			throw error;
		}
		return definition;
	}

	async update(id: string, input: unknown) {
		const definition = parseDefinition(input);
		if (definition.id !== id) throw new WorkspaceError('A table type ID cannot be changed.', 400);
		validateRegisteredOperations(definition);
		if (BUILT_IN_TABLE_TYPE_IDS.has(id) && definition.status !== 'published') throw new WorkspaceError('The built-in search types must stay published so the existing search choices keep working.', 400);
		validatePublish(definition);
		return this.database.transaction(async (sql) => {
			const existing = (await sql.query('SELECT id FROM enrichable.table_types WHERE id=$1 FOR UPDATE', [id])).rows[0];
			if (!existing) throw new WorkspaceError('This table type no longer exists.', 404);
			const updated = (await sql.query('UPDATE enrichable.table_types SET definition=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING definition', [id, JSON.stringify(definition)])).rows[0];
			return parseDefinition(updated?.definition);
		});
	}

	async deleteDraft(id: string) {
		if (BUILT_IN_TABLE_TYPE_IDS.has(id)) throw new WorkspaceError('Built-in search types cannot be deleted.', 400);
		return this.database.transaction(async (sql) => {
			const row = (await sql.query('SELECT definition FROM enrichable.table_types WHERE id=$1 FOR UPDATE', [id])).rows[0];
			if (!row) throw new WorkspaceError('This table type no longer exists.', 404);
			const definition = parseDefinition(row.definition);
			if (definition.status !== 'draft') throw new WorkspaceError('Only draft table types can be deleted.', 400);
			await sql.query('DELETE FROM enrichable.table_types WHERE id=$1', [id]);
			return { deleted: true };
		});
	}
}
