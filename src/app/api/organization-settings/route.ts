import { apiRoute, readJson } from '@/lib/server/api-route';
import { OrganizationStore, organizationPersistenceEnabled } from '@/lib/server/organization-store';
import { organizationPreferencesSchema } from '@/lib/organization-settings';
import { z } from 'zod';
import { WorkspaceError } from '@/lib/workspace';

const localPreferencesPatch = z.strictObject({ revision: z.number().int().min(0), preferences: z.strictObject({ mobilePhoneProviders: organizationPreferencesSchema.shape.mobilePhoneProviders.optional() }).optional() });

export const GET = apiRoute('organization-settings.get', async ({ account, database }) => {
	const organization = await new OrganizationStore(database).get(account);
	return organizationPersistenceEnabled(account) ? organization : { ...organization, local: true };
});

const write = apiRoute('organization-settings.save', async ({ account, database, request }) => {
	const store = new OrganizationStore(database);
	if (organizationPersistenceEnabled(account)) return store.patch(account, await readJson(request));
	const input = localPreferencesPatch.safeParse(await readJson(request));
	if (!input.success) throw new WorkspaceError(input.error.issues[0]?.message ?? 'Invalid local workspace setting.', 400);
	return { ...(await store.patch(account, input.data)), local: true };
});
export const PATCH = write;
