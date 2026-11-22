'use client';

import { appendRows, createSheetFromRecords, db, importTargets } from '@/lib/db';
import { csvToRecords, parseCsv } from '@/lib/csv';
import { fromXlsx } from '@/lib/xlsx';
import { trackEvent } from '@/lib/analytics';
import type { CellValue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogError } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Upload, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { plural } from './sheet-page-utils';

const PREVIEW_COLUMNS = 8;

/** Appending matches columns by header; a new sheet is created together with its rows. */
async function importRecords(records: Record<string, CellValue>[], target: { sheetId: string; afterRowId?: string } | { name: string }) {
	if ('sheetId' in target) return { sheetId: target.sheetId, added: await appendRows(target.sheetId, records, { createColumns: true, afterRowId: target.afterRowId }) };
	const sheet = await createSheetFromRecords(target.name, records);
	trackEvent('sheet_created', { source: 'import' });
	return { sheetId: sheet.id, added: records.length };
}

/** Imported values that didn't fit their column's format are kept as flagged text; count them so the user knows to look. */
async function flaggedCells(sheetId: string) {
	const sheet = await db.sheets.get(sheetId);
	const sources = new Set(sheet?.columns.filter((column) => column.type === 'source').map((column) => column.id));
	let count = 0;
	await db.rows.where('sheetId').equals(sheetId).each((row) => { for (const [columnId, cell] of Object.entries(row.cells)) if (sources.has(columnId) && cell.s === 'error' && cell.v !== null) count++; });
	return count;
}

function jsonRecords(text: string): { headers: string[]; records: Record<string, CellValue>[] } {
	let value: unknown;
	try { value = JSON.parse(text); } catch { throw new Error('This JSON file could not be parsed.'); }
	const candidate = Array.isArray(value) ? value : value && typeof value === 'object'
		? (value as { records?: unknown; data?: unknown }).records ?? (value as { data?: unknown }).data
		: null;
	if (!Array.isArray(candidate)) throw new Error('JSON import expects an array of row objects.');
	if (candidate.every(Array.isArray)) {
		const matrix = candidate as unknown[][];
		return csvToRecords(matrix.map((row) => row.map((item) => item === null || item === undefined ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item))));
	}
	if (!candidate.every((row) => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('Each JSON row must be an object.');
	const headers: string[] = [];
	for (const row of candidate as Array<Record<string, unknown>>) for (const key of Object.keys(row)) {
		if (!headers.some((header) => header.toLocaleLowerCase() === key.toLocaleLowerCase())) headers.push(key || `Column ${headers.length + 1}`);
	}
	const records = (candidate as Array<Record<string, unknown>>).map((row) => Object.fromEntries(headers.map((header) => {
		const item = Object.entries(row).find(([key]) => key.toLocaleLowerCase() === header.toLocaleLowerCase())?.[1];
		const cell: CellValue = item === undefined || item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
			? item ?? null
			: Array.isArray(item) && item.every((entry) => typeof entry === 'string') ? item as string[] : JSON.stringify(item);
		return [header, cell];
	})));
	return { headers, records };
}

/** Reads tabular CSV/TSV, XLSX and JSON files without a product row-count cap. */
function useImportSource({ onRead, onChange, onError }: { onRead: (fileName: string) => void; onChange: () => void; onError: (message: string) => void }) {
	const [text, setText] = useState('');
	const [parsed, setParsed] = useState<{ headers: string[]; records: Record<string, CellValue>[] } | null>(null);
	const [file, setFile] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const latest = useRef(0);
	function choose(next: File) {
		const read = ++latest.current;
		setReading(true); setFile(null); setParsed(null); setText(''); onChange();
		void (async () => {
			if (next.size > 25 * 1024 * 1024) throw new Error('Choose a file smaller than 25 MB.');
			const extension = next.name.split('.').at(-1)?.toLowerCase();
			let data: { headers: string[]; records: Record<string, CellValue>[] };
			if (extension === 'xlsx') data = fromXlsx(new Uint8Array(await next.arrayBuffer()));
			else {
				const contents = await next.text();
				data = extension === 'json' ? jsonRecords(contents) : csvToRecords(parseCsv(contents));
				if (read === latest.current) setText(contents);
			}
			if (read === latest.current) { setFile(next.name); setParsed(data); onRead(next.name); }
		})().catch((error: unknown) => { if (read === latest.current) onError(error instanceof Error ? error.message : `Could not read ${next.name}.`); }).finally(() => { if (read === latest.current) setReading(false); });
	}
	function paste(value: string) {
		latest.current++; setReading(false); setFile(null); setText(value);
		setParsed(value.trim() ? csvToRecords(parseCsv(value)) : null); onChange();
	}
	function clear() { latest.current++; setText(''); setParsed(null); setFile(null); setReading(false); onChange(); }
	return { text, parsed, file, reading, choose, paste, clear };
}

/** Column matches are shared with appendRows so preview and commit agree. */
function useImportPlan(sheetId: string | undefined, parsed: { headers: string[]; records: Record<string, CellValue>[] } | null) {
	const columns = useLiveQuery(async () => sheetId ? (await db.sheets.get(sheetId))?.columns ?? [] : [], [sheetId]);
	const targets = useMemo(() => importTargets(columns ?? [], parsed?.headers ?? []), [columns, parsed]);
	const total = parsed?.records.length ?? 0;
	const newHeaders = sheetId && parsed ? parsed.headers.filter((header) => !targets.has(header)).length : 0;
	return { targets, total, importable: total, newHeaders };
}

function importSummary(parsed: { headers: string[] } | null, total: number, newHeaders: number) {
	if (!parsed) return 'Nothing to import yet';
	return `${plural(total, 'row')} · ${plural(parsed.headers.length, 'column')}${newHeaders ? ` · ${newHeaders} new` : ''}`;
}

/** Import a CSV as a new sheet, or append rows to an existing one (matching columns by header name). */
export function ImportCsvDialog({ sheetId, afterRowId, onClose, onImported }: { sheetId?: string; afterRowId?: string; onClose: () => void; onImported: (sheetId: string, added: number) => void }) {
	const { toast } = useToast();
	const errorId = useId();
	const [name, setName] = useState('Imported sheet');
	const nameEdited = useRef(false);
	const [state, setState] = useState<{ status: 'idle' | 'importing' } | { status: 'failed'; error: string }>({ status: 'idle' });
	const { text, parsed, file, reading, choose, paste, clear } = useImportSource({
		onRead: (fileName) => { if (!sheetId && !nameEdited.current) setName(fileName.replace(/\.[^.]+$/, '') || 'Imported sheet'); },
		onChange: () => setState({ status: 'idle' }),
		onError: (error) => setState({ status: 'failed', error }),
	});
	const { targets, total, importable, newHeaders } = useImportPlan(sheetId, parsed);
	const importing = state.status === 'importing';
	const failed = state.status === 'failed';

	// A second click before the busy state renders must not import (or create a sheet) twice.
	const inFlight = useRef(false);
	async function run() {
		if (!parsed || importable === 0 || inFlight.current) return;
		inFlight.current = true;
		setState({ status: 'importing' });
		const records = parsed.records.slice(0, importable);
		try {
			const imported = await importRecords(records, sheetId ? { sheetId, afterRowId } : { name: name.trim() || 'Imported sheet' });
			const flagged = await flaggedCells(imported.sheetId).catch(() => 0);
			if (flagged) toast(`${plural(flagged, 'value')} didn’t match ${flagged === 1 ? 'its column’s' : 'their columns’'} format. ${flagged === 1 ? 'It’s' : 'They’re'} kept and marked in red to fix.`, 'info');
			else if (sheetId) toast(`Added ${plural(imported.added, 'row')}`, 'success');
			onImported(imported.sheetId, imported.added);
			onClose();
		} catch (error) {
			setState({ status: 'failed', error: error instanceof Error && error.message ? error.message : 'Import failed. Try again.' });
		} finally { inFlight.current = false; }
	}


	return (
		<Dialog
			title={sheetId ? 'Add rows from a file' : 'Import a spreadsheet'}
			description={sheetId ? 'Columns are matched by header name. New headers become new columns.' : 'The first row becomes the column headers.'}
			onClose={() => { if (!importing) onClose(); }}
			size="lg"
			footerNote={importSummary(parsed, total, newHeaders)}
			footer={
				<>
					<Button size="sm" onClick={onClose} disabled={importing}>Cancel</Button>
					<Button size="sm" variant="brand" loading={importing} disabled={importable === 0 || reading} aria-describedby={failed ? errorId : undefined} onClick={() => void run()}>
						Import
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{!sheetId && <Field label="Sheet name">{(id) => <Input id={id} value={name} onChange={(event) => { setName(event.target.value); nameEdited.current = true; }} />}</Field>}
				<FileDrop file={file} reading={reading} disabled={importing} onChoose={choose} onClear={clear} />
				{!file && <Field label="Or paste CSV or TSV">{(id) => <Textarea id={id} rows={6} value={text} onChange={(event) => paste(event.target.value)} placeholder={'Company,Website\nSunrun,sunrun.com'} className="font-mono text-caption" spellCheck={false} readOnly={importing} />}</Field>}
				{parsed && parsed.headers.length > 0 && <CsvPreview headers={parsed.headers} records={parsed.records} targets={sheetId ? targets : undefined} />}
				{state.status === 'failed' && <DialogError id={errorId}>{state.error}</DialogError>}
			</div>
		</Dialog>
	);
}

/** The first rows as they will import. When appending, each header says which existing column it fills, if any. */
function CsvPreview({ headers, records, targets }: { headers: string[]; records: Record<string, CellValue>[]; targets?: ReadonlyMap<string, string> }) {
	const shown = headers.slice(0, PREVIEW_COLUMNS);
	// Keyed by CSV line number (the header is line 1).
	const rows = records.slice(0, 3).map((record, index) => ({ line: index + 2, record }));
	return (
		<div tabIndex={0} role="region" aria-label="CSV preview" className="min-w-0 overflow-x-auto rounded-lg border border-line">
			<table className="w-full text-caption">
				<thead className="bg-neutral-5 text-fg-muted">
					<tr>
						{shown.map((header) => {
							const target = targets?.get(header);
							return (
								<th key={header} scope="col" className="px-2.5 py-1.5 text-left align-top font-normal whitespace-nowrap">
									<span className="block text-fg">{header}</span>
									{targets && <span className={`block text-[11px] ${target ? 'text-fg-subtle' : 'text-brand'}`}>{!target ? '+ New column' : target.toLowerCase() === header.toLowerCase() ? '→ Existing' : `→ ${target}`}</span>}
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody className="divide-y divide-line-subtle">
					{rows.map(({ line, record }) => (
						<tr key={line}>
							{shown.map((header) => <td key={header} className="max-w-[160px] truncate px-2.5 py-1.5 text-fg">{String(record[header] ?? '')}</td>)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Drop or choose CSV, TSV, XLSX or JSON. Once a file is chosen it replaces the paste box. */
function FileDrop({ file, reading, disabled, onChoose, onClear }: { file: string | null; reading: boolean; disabled: boolean; onChoose: (file: File) => void; onClear: () => void }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<div
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				event.preventDefault();
				const dropped = event.dataTransfer.files[0];
				if (dropped && !disabled) onChoose(dropped);
			}}
			className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-body-sm ${file ? 'border-line bg-neutral-5' : 'border-dashed border-line-strong text-fg-muted'}`}
		>
			{file ? (
				<span className="flex min-w-0 flex-1 items-center gap-2.5">
					<FileText aria-hidden className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.5} />
					<span className="min-w-0 truncate text-fg">{file}</span>
				</span>
			) : <span className="min-w-0 flex-1">{reading ? 'Reading file…' : 'Drop a CSV, XLSX or JSON file here, or'}</span>}
			<span className="flex items-center gap-1">
				<Button size="sm" onClick={() => input.current?.click()} disabled={disabled}>
					<Upload strokeWidth={1.5} /> {file ? 'Choose another' : 'Choose file'}
				</Button>
				{file && <Button size="sm" variant="ghost" aria-label="Remove file" onClick={onClear} disabled={disabled}><X strokeWidth={1.5} /></Button>}
			</span>
			<input
				ref={input}
				type="file"
				accept=".csv,text/csv,.tsv,text/tab-separated-values,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.json,application/json"
				className="hidden"
				onChange={(event) => {
					const picked = event.target.files?.[0];
					event.target.value = '';
					if (picked) onChoose(picked);
				}}
			/>
		</div>
	);
}
