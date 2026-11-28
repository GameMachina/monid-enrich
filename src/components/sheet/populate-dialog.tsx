'use client';

import type { EnrichFailure, EntityKind, PopulateRequest, Sheet } from '@/lib/types';
import { columnsEntity } from '@/lib/column-roles';
import { deleteSheet } from '@/lib/db';
import { foundRowColumns } from '@/lib/found-rows';
import { MAX_POPULATE_LIMIT, populateLimitError, promptEntity, promptResultCount } from '@/lib/populate-limit';
import { populateRunner, type PopulateState } from '@/lib/populate-runner';
import { Dialog } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/field';
import { AutoTextarea } from '@/components/ui/auto-textarea';
import { CountryPicker } from '@/components/ui/country-picker';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { isImeComposing } from '@/components/ui/keyboard';
import { trackEvent } from '@/lib/analytics';
import { useSettings } from '@/components/app/settings-context';
import { ArrowRight, Info, TriangleAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { accountHeaders } from '@/lib/account-storage';
import { FailureFix } from './halted-banner';
import './populate-dialog.css';
import { type FormEvent, type ReactNode, type RefObject, useEffect, useEffectEvent, useId, useState } from 'react';

const EXAMPLES: Record<EntityKind, string> = {
	companies: 'Residential solar installers in Texas',
	people: 'Heads of growth at Series B fintechs in the US',
	websites: 'SaaS pricing pages that mention a free tier',
};
const NOUNS: Record<EntityKind, [string, string]> = { companies: ['company', 'companies'], people: ['person', 'people'], websites: ['website', 'websites'] };
/** "1 company", "20 companies". */
const entityCount = (entity: EntityKind, count: number) => `${count.toLocaleString()} ${NOUNS[entity][count === 1 ? 0 : 1]}`;

function sheetEntity(sheet: Sheet): EntityKind {
	if (sheet.populate?.entity) return sheet.populate.entity;
	const listed = columnsEntity(sheet.columns);
	return listed === 'people' || listed === 'websites' ? listed : 'companies';
}

/** Until `picked` (a click in the picker), the prompt chooses what to find: "heads of growth at …" finds people. */
export interface FindRowsDraft { entity: EntityKind; query: string; countries: string[]; target?: number; targetPicked?: boolean; picked?: boolean }

type BillingAccess = { required: boolean; fullAccess: boolean; canManage: boolean; trial: null | { rowsUsed: number; rowLimit: number; sheetsUsed: number; sheetLimit: number } };

/** "Adds Website, Description columns · skips rows already in the sheet": what Find rows changes in a sheet that has rows or columns. */
function sheetChanges(sheet: Sheet, entity: EntityKind, rowCount: number) {
	const missing = rowCount || sheet.columns.length ? foundRowColumns(entity, sheet.columns).missing.map((column) => column.name) : [];
	const named = missing.length > 2 ? `${missing.slice(0, 2).join(', ')} and ${missing.length - 2} more` : missing.join(', ');
	const parts = [missing.length ? `Adds ${named} ${missing.length === 1 ? 'column' : 'columns'}` : '', rowCount ? `${missing.length ? 's' : 'S'}kips rows already in the sheet` : ''];
	return parts.filter(Boolean).join(' · ') || null;
}

/**
 * The Find rows prompt: what to find, a description, and countries. The row count comes from the prompt
 * ("Find 50 …"), 20 by default, up to 100. Shared by the Sheets page and the sheet's Find rows dialog.
 */
export function FindRowsComposer({ draft, onDraftChange, onSubmit, busy = false, error, errorAction, notice, fallbackEntity = 'companies', onClose, autoFocus, children }: { draft: FindRowsDraft; onDraftChange: (draft: FindRowsDraft) => void; onSubmit: (request: PopulateRequest) => void; busy?: boolean; error?: string | null; errorAction?: ReactNode; notice?: string | null; fallbackEntity?: EntityKind; onClose?: () => void; autoFocus?: boolean; children?: ReactNode }) {
	const countryId = useId();
	const messageId = useId();
	const { entity, query, countries } = draft;
	const { connections } = useSettings();
	const router = useRouter();
	const [billing, setBilling] = useState<BillingAccess | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		void fetch('/api/billing', { headers: accountHeaders(), cache: 'no-store', signal: controller.signal })
			.then(async (response) => response.ok ? await response.json() as BillingAccess : null)
			.then((data) => { if (!controller.signal.aborted && data) setBilling(data); })
			.catch(() => {});
		return () => controller.abort();
	}, []);
	const target = draft.target ?? promptResultCount(query) ?? 5;
	const trial = billing ? billing.required && !billing.fullAccess : true;
	const rowLimit = trial ? billing?.trial?.rowLimit ?? 5 : MAX_POPULATE_LIMIT;
	const rowsRemaining = trial ? Math.max(0, (billing?.trial?.rowLimit ?? 5) - (billing?.trial?.rowsUsed ?? 0)) : MAX_POPULATE_LIMIT;
	const limitError = populateLimitError(target);
	const trialMessage = trial && target > rowLimit ? `The free trial includes up to ${rowLimit} rows. Unlock larger searches for $37 once.` : trial && rowsRemaining === 0 ? 'The five-row trial is complete. Unlock more rows and sheets for $37 once.' : null;
	const message = limitError ?? trialMessage ?? error;
	const ready = query.trim().length >= 3 && !limitError && !trialMessage && !busy;
	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (ready) onSubmit({ query: query.trim(), entity, target, countries, dataProvider: 'monid', idempotencyKey: crypto.randomUUID() });
	};
	return (
		<form className="populate-composer" onSubmit={submit} noValidate>
			{message ? <div role="alert" id={messageId} className="populate-error"><TriangleAlert aria-hidden size={16} /><span>{message}</span>{!limitError && errorAction && <span className="populate-error-action">{errorAction}</span>}</div>
				: notice ? <div role="status" id={messageId} className="populate-notice"><Info aria-hidden size={16} /><span>{notice}</span></div> : null}
			<div className="populate-front-wrap">
				{onClose && <button type="button" aria-label="Close" onClick={onClose} className="populate-close"><X aria-hidden size={16} /></button>}
				<fieldset disabled={busy} className="populate-front">
					<div className="populate-picker">
						<Segmented label="What to find" value={entity} size="sm" onChange={(value) => onDraftChange({ ...draft, entity: value, picked: true })} options={([
							{ value: 'companies', label: 'Companies' }, { value: 'people', label: 'People' }, { value: 'websites', label: 'Websites' },
						] as const).map((option) => ({ ...option, label: <><EntityGlyph entity={option.value} active={entity === option.value} />{option.label}</> }))} />
					</div>
					<div className="populate-entry">
						<AutoTextarea aria-label="Describe the rows you want" aria-invalid={!!limitError || !!trialMessage} aria-describedby={message || notice ? messageId : undefined} rows={2} maxRows={10} autoFocus={autoFocus} value={query} onChange={(event) => { const next = event.target.value; onDraftChange({ ...draft, query: next, target: draft.targetPicked ? target : promptResultCount(next) ?? 5, entity: draft.picked ? entity : promptEntity(next) ?? fallbackEntity }); }} onKeyDown={(event) => {
							if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
							event.preventDefault();
							if (!isImeComposing(event)) submit();
						}} placeholder={`Describe the ${NOUNS[entity][1]} you want, e.g. ${EXAMPLES[entity]}`} className="populate-prompt" />
					</div>
					<div className="populate-bottom">
						<span className="populate-summary">{limitError ? '—' : entityCount(entity, target)}<span className="populate-cap"> · up to {trial ? rowLimit : MAX_POPULATE_LIMIT.toLocaleString()}</span></span>
						<label className="sr-only" htmlFor="find-rows-target">Rows to find</label>
						<Select id="find-rows-target" variant="pill" aria-label="Rows to find" value={String(target)} onValueChange={(value) => onDraftChange({ ...draft, target: Number(value), targetPicked: true })}>
							{[5, 10, 20, 50, 100, 250, 500, 1000].map((count) => <option key={count} value={count}>{count.toLocaleString()} rows</option>)}
						</Select>
						<span className="populate-actions">
							<span className="rounded-full bg-surface-secondary px-3 py-2 text-caption text-fg-muted">Monid · workspace wallet</span>
							<span className="populate-country">
								<label htmlFor={countryId} className="sr-only">Countries</label>
								<CountryPicker id={countryId} value={countries} onChange={(next) => onDraftChange({ ...draft, countries: next })} disabled={busy} />
							</span>
							<button type="submit" aria-label={`Find ${NOUNS[entity][1]}`} aria-busy={busy || undefined} disabled={!ready} className="populate-send">{busy ? <span aria-hidden className="spinner !border-current !border-t-transparent" /> : <ArrowRight aria-hidden size={18} />}</button>
						</span>
					</div>
				</fieldset>
			</div>
			{trialMessage && <div className="mt-2 flex flex-wrap items-center gap-3 text-caption text-warning" role="status"><span>{trialMessage}</span>{billing?.canManage !== false && <button type="button" onClick={() => router.push('/access-required?unlock=rows')} className="font-medium text-brand underline underline-offset-2">Unlock with $37 once</button>}</div>}
			{trial && rowsRemaining > 0 && target <= rowLimit && <p className="populate-provider-note">Trial: one sheet · {rowsRemaining} of {rowLimit} rows available. Upgrade to search more and add sheets.</p>}
			{connections.monid.state === 'missing' || connections.monid.state === 'expired'
				? <p role="status" className="populate-provider-note">Connect Monid in Configuration before searching.</p>
				: <p className="populate-provider-note">Searches are billed to your workspace Monid wallet.</p>}
			{children}
		</form>
	);
}

type View = 'form' | 'collapsing' | 'hidden';

/** "Find rows" on a sheet: collapses into the toolbar while rows stream in, and reopens only to explain a miss or a failure. */
export function PopulateDialog({ sheet, rowCount, initialEntity, onClose, onGenerate, collapseTarget }: { sheet: Sheet; rowCount: number; initialEntity?: EntityKind; onClose: () => void; onGenerate: (request: PopulateRequest) => Promise<unknown>; collapseTarget: RefObject<HTMLElement | null> }) {
	const { toast } = useToast();
	const router = useRouter();
	// A sheet with rows keeps its kind; an empty one follows the prompt until the user picks.
	const [draft, setDraft] = useState<FindRowsDraft>(() => ({ entity: initialEntity ?? sheetEntity(sheet), query: sheet.populate?.query ?? '', countries: sheet.populate?.countries ?? [], target: sheet.populate?.target ?? promptResultCount(sheet.populate?.query ?? '') ?? 5, picked: Boolean(initialEntity) || rowCount > 0 }));
	// A search handed off from the Sheets page is already streaming: stay collapsed until it settles.
	const [view, setView] = useState<View>(() => { const run = populateRunner.getSnapshot(sheet.id); return run.handoff && run.running ? 'hidden' : 'form'; });
	// The Sheets page created this sheet for its search; if nothing came of it, closing removes the empty sheet.
	const [handedOff] = useState(() => populateRunner.getSnapshot(sheet.id).handoff);
	const [error, setError] = useState<{ message: string; failure?: EnrichFailure } | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	function present(result: PopulateState) {
		const entity = result.request?.entity ?? draft.entity;
		if (result.phase === 'stopped' || result.phase === 'idle') { onClose(); return; }
		if (result.phase === 'finished' && (result.added > 0 || result.updated > 0)) {
			toast(`Added ${entityCount(entity, result.added)}${result.updated ? ` · updated ${result.updated} existing rows` : ''}`, 'success');
			onClose();
			return;
		}
		setView('form');
		if (result.phase === 'finished') setNotice(result.completionMessage ?? `Search finished: no ${NOUNS[entity][1]} matched. Try a broader description${result.request?.countries?.length ? ' or remove country filters' : ''}.`);
		else setError({ message: result.error ?? 'Could not find rows. Try again.', failure: result.failure });
	}
	const presentHandoff = useEffectEvent((result: PopulateState, late: boolean) => {
		populateRunner.acknowledge(sheet.id);
		// A search that settled before this dialog opened only reports what still needs the user.
		if (late && !(result.phase === 'failed' || result.phase === 'interrupted' || result.phase === 'finished' && result.added === 0)) return;
		present(result);
	});
	useEffect(() => {
		const snapshot = populateRunner.getSnapshot(sheet.id);
		if (!snapshot.handoff) return;
		const pending = populateRunner.settled(sheet.id);
		let active = true;
		void (pending ?? Promise.resolve(snapshot)).then((result) => { if (active) presentHandoff(result, !pending); });
		return () => { active = false; };
	}, [sheet.id]);

	async function run(request: PopulateRequest) {
		setError(null);
		setNotice(null);
		setView('collapsing');
		trackEvent('rows_requested', { kind: request.entity });
		try {
			await onGenerate(request);
			present(populateRunner.getSnapshot(sheet.id));
		} catch (error) {
			present({ ...populateRunner.getSnapshot(sheet.id), phase: 'failed', error: error instanceof Error ? error.message : 'Could not find rows. Try again.' });
		}
	}
	// Closing mid-search only hides the dialog; the search keeps going and reports back here.
	const close = () => {
		if (view === 'collapsing' || populateRunner.getSnapshot(sheet.id).running) setView('hidden');
		else if (handedOff && rowCount === 0) {
			router.push('/app');
			void deleteSheet(sheet.id).then(() => toast('Removed the empty sheet'), () => {});
		} else onClose();
	};
	const changes = sheetChanges(sheet, draft.entity, rowCount);

	if (view === 'hidden') return null;
	return (
		<Dialog unframed title="Find rows" onClose={close} collapsing={view === 'collapsing'} collapseTarget={collapseTarget} size="lg">
			<FindRowsComposer draft={draft} onDraftChange={(next) => { setDraft(next); setError(null); setNotice(null); }} onSubmit={(request) => void run(request)} busy={view === 'collapsing'} error={error?.message} errorAction={error?.failure && <FailureFix issue={error.failure} />} notice={notice} fallbackEntity={sheetEntity(sheet)} onClose={close} autoFocus>
				{changes && <p className="populate-shelf">{changes}</p>}
			</FindRowsComposer>
		</Dialog>
	);
}

const GLYPHS: Record<EntityKind, string[]> = {
	companies: ['..222..', '..2.2..', '..2.222', '..2.2.2', '..2.2.2', '..2.2.2', '2222222'],
	people: ['..222..', '..2.2..', '..222..', '.......', '.22222.', '.2...2.', '.2...2.'],
	websites: ['..222..', '.2.2.2.', '2222222', '2..2..2', '2222222', '.2.2.2.', '..222..'],
};
const GLYPH_CELLS = Object.fromEntries(Object.entries(GLYPHS).map(([entity, rows]) => [entity, rows.join('').split('').map((cell, index) => ({ id: `${entity}-${index}`, on: cell === '2' }))])) as Record<EntityKind, Array<{ id: string; on: boolean }>>;

function EntityGlyph({ entity, active }: { entity: EntityKind; active: boolean }) {
	return <span aria-hidden className="populate-glyph" style={{ color: active ? 'var(--color-brand)' : undefined }}>{GLYPH_CELLS[entity].map((cell) => <span key={cell.id} style={{ background: cell.on ? 'currentColor' : undefined }} />)}</span>;
}
