import { apiRoute, readJson } from '@/lib/server/api-route';
import { MemberSettingsStore } from '@/lib/server/member-settings-store';

export const GET = apiRoute('member-settings.get', async ({ account, database }) => new MemberSettingsStore(database).get(account));
export const PATCH = apiRoute('member-settings.save', async ({ account, database, request }) => new MemberSettingsStore(database).patch(account, await readJson(request)));
