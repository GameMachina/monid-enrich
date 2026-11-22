import 'server-only';
import type { Account } from '../auth-identity';
import { organizationPreferencesSchema } from '../organization-settings';
import { DEFAULT_MEMBER_PREFERENCES, memberPreferencesSchema, memberSettingsPatchSchema, type MemberPreferences } from '../member-settings';
import { allowedPhoneStrategies } from '../phone-strategy';
import { parseInput, WorkspaceError } from '../workspace';
import type { Database, Sql } from './database';

export type MemberSettings = { revision: number; preferences: MemberPreferences };

export class MemberSettingsStore {
	constructor(private database: Database) {}

	private read<T>(actor: Account, run: (sql: Sql, workspace: string) => Promise<T>) {
		return this.database.transaction(run, { workspace: actor, readOnly: true });
	}

	private write<T>(actor: Account, run: (sql: Sql, workspace: string) => Promise<T>) {
		return this.database.transaction(async (sql, workspace) => {
			await sql.query('INSERT INTO enrichable.member_settings (workspace_id,member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [workspace, actor.partition]);
			return run(sql, workspace);
		}, { workspace: actor });
	}

	private async snapshot(sql: Sql, workspace: string, memberId: string): Promise<MemberSettings> {
		const row = (await sql.query('SELECT revision,preferences FROM enrichable.member_settings WHERE workspace_id=$1 AND member_id=$2', [workspace, memberId])).rows[0];
		return { revision: Number(row?.revision ?? 0), preferences: memberPreferencesSchema.parse(row?.preferences ?? DEFAULT_MEMBER_PREFERENCES) };
	}

	get(actor: Account) {
		return this.read(actor, (sql, workspace) => this.snapshot(sql, workspace, actor.partition));
	}

	patch(actor: Account, input: unknown) {
		const args = parseInput(memberSettingsPatchSchema, input);
		return this.write(actor, async (sql, workspace) => {
			const current = await this.snapshot(sql, workspace, actor.partition);
			if (current.revision !== args.revision) throw new WorkspaceError('Your preferences changed in another session. Reload before saving.', 409);
			const preferences = memberPreferencesSchema.parse({ ...current.preferences, ...args.preferences });
			const organizationRow = (await sql.query('SELECT preferences FROM enrichable.organization_settings WHERE workspace_id=$1', [workspace])).rows[0];
			const organization = organizationPreferencesSchema.parse(organizationRow?.preferences ?? {});
			if (!allowedPhoneStrategies(organization.mobilePhoneProviders).includes(preferences.defaultPhoneStrategy)) throw new WorkspaceError('Your default strategy uses a mobile provider disabled by the workspace.', 400);
			await sql.query('UPDATE enrichable.member_settings SET preferences=$3::jsonb,revision=revision+1,updated_at=$4 WHERE workspace_id=$1 AND member_id=$2', [workspace, actor.partition, JSON.stringify(preferences), Date.now()]);
			return this.snapshot(sql, workspace, actor.partition);
		});
	}
}
