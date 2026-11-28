'use client';

import { accountHeaders } from '@/lib/account-storage';
import type { TableTypeDefinition } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Check, CircleAlert, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type Item = { definition: TableTypeDefinition; runnable: boolean; readinessError: string | null; createdAt: string; updatedAt: string };
type Registry = { items: Item[]; operations: string[] };
type Draft = TableTypeDefinition;

const seedDraft = (): Draft => ({
	id: 'new-table-type', entity: 'new-type', category: 'New category', name: 'New table type', description: '', instructions: '',
	examplePrompts: [], requiredInputs: [{ key: 'query', label: 'Search description', description: 'Natural-language description of the records to find.', type: 'text', required: true }],
	defaultColumns: [{ name: 'Record name', field: 'Record name' }], rowMapping: [{ sourceField: 'Record name', columnName: 'Record name' }],
	identity: { sourceField: 'Record name', normalization: 'url' }, operations: [], pagination: { strategy: 'none', maxCalls: 1 }, chaining: { enabled: false, operations: [] }, status: 'draft',
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, { ...init, headers: { ...accountHeaders(), ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers }, cache: 'no-store' });
	const body = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
	return body;
}

function lines(value: string[]) { return value.join('\n'); }
function parseLines(value: string) { return value.split('\n').map((line) => line.trim()).filter(Boolean); }
function pretty(value: unknown) { return JSON.stringify(value, null, 2); }

export function TableTypesAdmin() {
	const [registry, setRegistry] = useState<Registry | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [newDraft, setNewDraft] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const { toast } = useToast();

	const reload = useCallback(async (prefer?: string) => {
		setLoading(true); setError(null);
		try {
			const result = await api<Registry>('/api/admin/table-types');
			setRegistry(result);
			const selected = result.items.find((item) => item.definition.id === prefer) ?? result.items[0];
			setSelectedId(selected?.definition.id ?? null);
			setDraft(selected ? structuredClone(selected.definition) : null);
			setNewDraft(false);
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load table types.'); }
		finally { setLoading(false); }
	}, []);

	useEffect(() => {
		const initial = window.setTimeout(() => { void reload(); }, 0);
		return () => window.clearTimeout(initial);
	}, [reload]);

	function select(id: string) {
		const item = registry?.items.find((entry) => entry.definition.id === id);
		if (!item) return;
		setSelectedId(id); setDraft(structuredClone(item.definition)); setNewDraft(false); setError(null);
	}

	function update(patch: Partial<Draft>) { setDraft((current) => current ? { ...current, ...patch } : current); }

	async function save() {
		if (!draft) return;
		setSaving(true); setError(null);
		try {
			if (newDraft) {
				const result = await api<{ definition: Draft }>('/api/admin/table-types', { method: 'POST', body: JSON.stringify({ ...draft, status: 'draft' }) });
				toast(`Saved draft “${result.definition.name}”`, 'success'); await reload(result.definition.id);
			} else {
				const result = await api<{ definition: Draft }>(`/api/admin/table-types/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify(draft) });
				toast(`Saved “${result.definition.name}”`, 'success'); await reload(result.definition.id);
			}
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this table type.'); }
		finally { setSaving(false); }
	}

	async function createDraft() {
		const fresh = seedDraft();
		setDraft(fresh); setSelectedId(null); setNewDraft(true); setError(null);
	}

	async function removeDraft() {
		if (!draft) return;
		setSaving(true); setError(null);
		try { await api(`/api/admin/table-types/${encodeURIComponent(draft.id)}`, { method: 'DELETE' }); toast('Deleted draft', 'success'); setDeleteOpen(false); await reload(); }
		catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this draft.'); }
		finally { setSaving(false); }
	}

	const item = registry?.items.find((entry) => entry.definition.id === draft?.id);
	const builtIn = Boolean(item && ['companies', 'people', 'websites'].includes(item.definition.id));
	const operationOptions = registry?.operations ?? [];
	const toggleOperation = (operation: string, field: 'operations' | 'chain') => {
		if (!draft) return;
		const current = field === 'operations' ? draft.operations : draft.chaining.operations;
		const next = current.includes(operation) ? current.filter((entry) => entry !== operation) : [...current, operation];
		if (field === 'operations') update({ operations: next });
		else update({ chaining: { ...draft.chaining, operations: next } });
	};

	return <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
		<aside className="flex min-h-0 flex-col rounded-xl border border-hairline bg-surface p-3">
			<div className="flex items-center justify-between gap-2 px-2 py-2"><h2 className="text-body-sm font-semibold">Default types</h2><button type="button" onClick={() => void createDraft()} className="grid size-8 place-items-center rounded-md hover:bg-tint/[0.06]" aria-label="Create draft"><Plus size={16} /></button></div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{loading && <p className="px-2 py-3 text-caption text-fg-subtle">Loading table types…</p>}
				{registry?.items.map(({ definition, runnable, readinessError }) => <button type="button" key={definition.id} onClick={() => select(definition.id)} className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${selectedId === definition.id ? 'bg-brand-soft text-fg' : 'hover:bg-tint/[0.05]'}`}>
					<span className="block truncate text-body-sm font-medium">{definition.name}</span><span className="mt-0.5 block truncate text-caption text-fg-subtle">{definition.category}</span>
					<span className={`mt-1 block text-caption ${runnable ? 'text-success' : 'text-warning'}`}>{runnable ? 'Published · runnable' : `${definition.status === 'published' ? 'Published · blocked' : 'Draft'}${readinessError ? ` · ${readinessError}` : ''}`}</span>
				</button>)}
				{!loading && registry?.items.length === 0 && <p className="px-2 py-3 text-caption text-fg-subtle">No table types found.</p>}
			</div>
			<p className="px-2 pt-3 text-caption text-fg-subtle">Only published definitions with a trusted search adapter appear in Find rows.</p>
		</aside>
		<section className="min-h-0 overflow-y-auto rounded-xl border border-hairline bg-surface p-5 sm:p-7">
			{!draft ? <div className="grid min-h-60 place-items-center text-body-sm text-fg-subtle">{loading ? 'Loading…' : 'Select a table type or create a draft.'}</div> : <>
		<div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-h3 text-fg">Table type definition</h1><p className="mt-1 max-w-3xl text-body-sm text-fg-muted">Global Monid defaults. Instructions help interpret prompts; code-owned adapters control validation and endpoint dispatch.</p></div><div className="flex gap-2"><Button disabled={saving || builtIn || newDraft} onClick={() => setDeleteOpen(true)} variant="outline" title={builtIn ? 'Built-in types cannot be deleted' : 'Delete draft'}><Trash2 size={15} />Delete draft</Button><Button disabled={saving} onClick={() => void save()} variant="brand"><Save size={15} />{saving ? 'Saving…' : 'Save'}</Button></div></div>
				{error && <p role="alert" className="mb-5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-body-sm text-danger">{error}</p>}
				{item?.runnable && <p className="mb-5 flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-body-sm text-success"><Check size={16} />This definition is available in Find rows.</p>}
				{item && !item.runnable && <p className="mb-5 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-body-sm text-fg"><CircleAlert size={16} />{item.readinessError ?? 'This definition is a draft and is not available in Find rows.'}</p>}
				<div className="grid gap-5 md:grid-cols-2">
					<Field label="ID"><Input value={draft.id} disabled={Boolean(item)} onChange={(event) => update({ id: event.target.value })} /></Field>
					<Field label="Entity adapter"><Input value={draft.entity} disabled={builtIn} onChange={(event) => update({ entity: event.target.value })} /></Field>
					<Field label="Category"><Input value={draft.category} onChange={(event) => update({ category: event.target.value })} /></Field>
					<Field label="Table type name"><Input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></Field>
					<Field label="Description" className="md:col-span-2"><Textarea rows={2} value={draft.description} onChange={(event) => update({ description: event.target.value })} /></Field>
					<Field label="Default prompt instructions" className="md:col-span-2"><Textarea rows={5} value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} /></Field>
					<Field label="Example prompts · one per line" className="md:col-span-2"><Textarea rows={3} value={lines(draft.examplePrompts)} onChange={(event) => update({ examplePrompts: parseLines(event.target.value) })} /></Field>
						<JsonField key={`${selectedId ?? 'new'}:inputs`} label="Required search inputs" value={draft.requiredInputs} onChange={(requiredInputs) => update({ requiredInputs })} className="md:col-span-2" />
						<JsonField key={`${selectedId ?? 'new'}:columns`} label="Default columns" value={draft.defaultColumns} onChange={(defaultColumns) => update({ defaultColumns })} className="md:col-span-2" />
						<JsonField key={`${selectedId ?? 'new'}:mapping`} label="Result-to-row mapping" value={draft.rowMapping} onChange={(rowMapping) => update({ rowMapping })} className="md:col-span-2" />
					<div className="grid gap-4 rounded-lg border border-hairline p-4 md:col-span-2 md:grid-cols-3">
						<Field label="Stable identity source"><Input value={draft.identity.sourceField} onChange={(event) => update({ identity: { ...draft.identity, sourceField: event.target.value } })} /></Field>
						<Field label="Identity normalization"><select className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body-sm text-fg" value={draft.identity.normalization} onChange={(event) => update({ identity: { ...draft.identity, normalization: event.target.value as Draft['identity']['normalization'] } })}><option value="domain">Domain</option><option value="profile-url">Profile URL</option><option value="url">URL</option></select></Field>
						<Field label="Status"><select className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body-sm text-fg" value={draft.status} disabled={builtIn} onChange={(event) => update({ status: event.target.value as Draft['status'] })}><option value="draft">Draft</option><option value="published">Published</option></select></Field>
					</div>
					<fieldset className="rounded-lg border border-hairline p-4 md:col-span-2"><legend className="px-1 text-body-sm font-medium">Registered Monid operations</legend><div className="grid gap-2 sm:grid-cols-2">{operationOptions.map((operation) => <label key={operation} className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={draft.operations.includes(operation)} onChange={() => toggleOperation(operation, 'operations')} />{operation}</label>)}</div></fieldset>
					<div className="grid gap-4 rounded-lg border border-hairline p-4 md:col-span-2 md:grid-cols-3">
							<Field label="Pagination"><select className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body-sm text-fg" value={draft.pagination.strategy} onChange={(event) => update({ pagination: { ...draft.pagination, strategy: event.target.value as Draft['pagination']['strategy'] } })}><option value="none">One search call</option><option value="cursor">Monid cursor</option><option value="page">Page number</option><option value="offset">Result offset</option><option value="queries">Multiple search queries</option></select></Field>
						<Field label="Maximum search calls"><Input type="number" min={1} max={20} value={draft.pagination.maxCalls} onChange={(event) => update({ pagination: { ...draft.pagination, maxCalls: Number(event.target.value) } })} /></Field>
						<label className="flex items-center gap-2 pt-6 text-body-sm"><input type="checkbox" checked={draft.chaining.enabled} onChange={(event) => update({ chaining: { ...draft.chaining, enabled: event.target.checked } })} />Enable supported chaining</label>
						<fieldset className="md:col-span-3"><legend className="mb-2 text-caption text-fg-muted">Chained operations</legend><div className="grid gap-2 sm:grid-cols-2">{operationOptions.map((operation) => <label key={operation} className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={draft.chaining.operations.includes(operation)} onChange={() => toggleOperation(operation, 'chain')} />{operation}</label>)}</div></fieldset>
					</div>
				</div>
				{deleteOpen && <ConfirmDialog title={`Delete “${draft.name}”?`} description="This permanently removes the draft definition. It does not affect sheets or search results." confirmLabel="Delete draft" danger onClose={() => setDeleteOpen(false)} onConfirm={() => void removeDraft()} />}
			</>}
		</section>
	</div>;
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
	return <label className={`block min-w-0 ${className}`}><span className="mb-1.5 block text-caption font-medium text-fg-muted">{label}</span>{children}</label>;
}

function JsonField<T>({ label, value, onChange, className = '' }: { label: string; value: T; onChange: (value: T) => void; className?: string }) {
	const [text, setText] = useState(pretty(value));
	const [invalid, setInvalid] = useState(false);
	return <Field label={`${label} · JSON`} className={className}><Textarea rows={Math.min(12, Math.max(4, pretty(value).split('\n').length))} value={text} aria-invalid={invalid} onChange={(event) => { setText(event.target.value); try { onChange(JSON.parse(event.target.value) as T); setInvalid(false); } catch { setInvalid(true); } }} className={invalid ? '!border-danger' : ''} />{invalid && <span className="mt-1 block text-caption text-danger">Enter valid JSON to update this field.</span>}</Field>;
}
