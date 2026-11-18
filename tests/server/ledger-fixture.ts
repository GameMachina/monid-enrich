import type { Account } from '../../src/lib/auth-identity';
import { CreditLedger, DOLLAR_NANO, type LedgerAccess, type LedgerKind } from '../../src/lib/server/credit-ledger';
import { testDatabase } from '../support/database';

export const actor = (user = 'alice', org = 'one', issuer = 'https://identity.example.com'): Account => ({ issuer, user: { id: user, email: `${user}@example.com`, email_verified: true }, organization: { id: org, name: org }, partition: `${user}-${org}` });

/** A ledger on the migrated test database. */
export async function ledgerFixture(t: { after: (fn: () => Promise<void>) => void }, kind: LedgerKind, ceilingUsd?: number) {
	const { db, database } = await testDatabase(t);
	const ledger = new CreditLedger(kind, database, ceilingUsd === undefined ? undefined : ceilingUsd * DOLLAR_NANO);
	const access: LedgerAccess = async (operation) => operation(ledger);
	return { db, database, ledger, access };
}
