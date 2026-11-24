'use client';

import { useRef, useState } from 'react';
import { ActionColumnSchema, type ActionChannel } from '@/lib/action-column';
import { newColumn } from '@/lib/db';
import { danglingActionReferences, findColumn, nameTaken, substituteReferences, uniqueName } from '@/lib/references';
import { formatValue } from '@/lib/template';
import type { Row, Sheet } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Segmented } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ArrowUpRight, MousePointerClick } from 'lucide-react';
import { ColumnPrompt } from './column-prompt';
import { columnAddress } from '@/lib/formula-input';
import type { SheetCommands } from '@/lib/sheet-commands';
import type { ActionColumnState } from './use-sheet-overlays';

const CHANNELS: Array<{ value: ActionChannel; label: string }> = [
	{ value: 'linkedin', label: 'LinkedIn' },
	{ value: 'instagram', label: 'Instagram' },
	{ value: 'facebook', label: 'Facebook' },
	{ value: 'email-sequencer', label: 'Email sequence' },
	{ value: 'agentweb-site', label: 'Other website' },
];

const ACTIONS: Partial<Record<ActionChannel, Array<{ id: string; label: string; description: string }>>> = {
	linkedin: [
		{ id: 'send_message', label: 'Send a message', description: 'Message an existing LinkedIn conversation.' },
		{ id: 'start_conversation', label: 'Start a conversation', description: 'Message a first-degree connection.' },
		{ id: 'send_inmail', label: 'Send an InMail', description: 'Message someone outside your first-degree connections.' },
		{ id: 'send_connection_request', label: 'Send a connection request', description: 'Invite a person to connect.' },
		{ id: 'create_post', label: 'Publish a text post', description: 'Publish to your profile and feed.' },
		{ id: 'approve_invitation', label: 'Accept an invitation', description: 'Accept a connection invitation you received.' },
		{ id: 'reject_invitation', label: 'Decline an invitation', description: 'Dismiss a connection invitation you received.' },
	],
	instagram: [
		{ id: 'create_photo', label: 'Publish a photo', description: 'Publish a PNG or JPEG from a public HTTPS URL.' },
		{ id: 'create_reel', label: 'Publish a Reel', description: 'Publish a Reel from public video and cover URLs.' },
		{ id: 'add_like', label: 'Like a post', description: 'Like a post as the connected account.' },
		{ id: 'remove_like', label: 'Unlike a post', description: 'Remove the connected account’s like.' },
		{ id: 'add_repost', label: 'Repost a post', description: 'Repost without adding a note.' },
		{ id: 'remove_repost', label: 'Remove a repost', description: 'Remove a repost made by the connected account.' },
		{ id: 'add_comment', label: 'Comment on a post', description: 'Add a comment to a post.' },
		{ id: 'delete_comment', label: 'Delete a comment', description: 'Delete a comment you are allowed to remove.' },
		{ id: 'send_post', label: 'Send a post in Direct', description: 'Share a post with one recipient.' },
		{ id: 'send_message', label: 'Send a Direct message', description: 'Send text to an existing Direct thread.' },
		{ id: 'add_save', label: 'Save a post', description: 'Save a post to the connected account.' },
		{ id: 'remove_save', label: 'Unsave a post', description: 'Remove a post from saved items.' },
	],
	'email-sequencer': [
		{ id: 'add_to_sequence', label: 'Add a person to a sequence', description: 'Queue a person for a future email sequence.' },
	],
};

const channelName = (channel: ActionChannel) => CHANNELS.find((item) => item.value === channel)?.label ?? 'Action';
const actionName = (channel: ActionChannel, id: string) => ACTIONS[channel]?.find((item) => item.id === id)?.label ?? (channel === 'facebook' ? 'Facebook action' : channel === 'agentweb-site' ? id || 'AgentWeb action' : id);
const initialInstruction = (channel: ActionChannel, action: string) => `Use the referenced row values to prepare the inputs for “${actionName(channel, action)}”.`;
const initialName = (channel: ActionChannel, action: string) => `${channelName(channel)} · ${actionName(channel, action)}`;

/** Saves an editable, row-aware action definition. No external action runs from this dialog. */
export function ActionColumnDialog({ sheet, rows, state, commands, onClose }: { sheet: Sheet; rows: Row[]; state: ActionColumnState; commands: SheetCommands; onClose: () => void }) {
	const { toast } = useToast();
	const existing = state.column?.action;
	const [channel, setChannel] = useState<ActionChannel>(existing?.channel ?? 'linkedin');
	const [action, setAction] = useState(existing?.action ?? 'send_message');
	const [name, setName] = useState(state.column?.name ?? initialName('linkedin', 'send_message'));
	const [nameEdited, setNameEdited] = useState(Boolean(state.column));
	const [instructions, setInstructions] = useState(existing?.instructions ?? initialInstruction('linkedin', 'send_message'));
	const [domain, setDomain] = useState(existing?.domain ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const insertInstruction = useRef<((columnName: string) => void) | null>(null);
	const columns = sheet.columns.filter((column) => column.id !== state.column?.id);
	const actionOptions = ACTIONS[channel] ?? [];
	const previewRow = rows[0];
	const preview = previewRow ? substituteReferences(instructions, (reference) => {
		const column = findColumn(sheet.columns, reference);
		return column ? formatValue(previewRow.cells[column.id]?.v) || '(empty)' : `{{${reference}}}`;
	}) : instructions;

	function chooseChannel(next: ActionChannel) {
		setChannel(next);
		const nextAction = ACTIONS[next]?.[0]?.id ?? (next === 'facebook' ? 'not-mapped' : next === 'agentweb-site' ? '' : 'add_to_sequence');
		setAction(nextAction);
		if (!nameEdited) setName(initialName(next, nextAction));
		if (instructions === initialInstruction(channel, action)) setInstructions(initialInstruction(next, nextAction));
		setError('');
	}

	function chooseAction(next: string) {
		setAction(next);
		if (!nameEdited) setName(initialName(channel, next));
		if (instructions === initialInstruction(channel, action)) setInstructions(initialInstruction(channel, next));
		setError('');
	}

	async function save() {
		setError('');
		if (!name.trim()) { setError('Enter a column name.'); return; }
		if (state.column && nameTaken(name, sheet.columns, state.column.id)) { setError('A column with this name already exists.'); return; }
		const parsed = ActionColumnSchema.safeParse({ channel, action: channel === 'agentweb-site' ? action.trim() : action, instructions, ...(channel === 'agentweb-site' ? { domain } : {}) });
		if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the action setup.'); return; }
		const dangling = danglingActionReferences(parsed.data, sheet.columns);
		if (dangling.length) { setError(`Choose an existing column for {{${dangling[0]}}}, or remove that reference.`); return; }
		setBusy(true);
		try {
			if (state.column) await commands.editColumn(state.column.id, { name: name.trim(), action: parsed.data });
			else {
				const column = newColumn({ name: uniqueName(name.trim(), sheet.columns.map((item) => item.name)), type: 'enriched', action: parsed.data });
				await commands.addColumns([column], { kind: 'blank', position: state.insertAt });
			}
			onClose();
			toast(state.column ? 'Action column saved.' : 'Action column added.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the action column.'); }
		finally { setBusy(false); }
	}

	return <Dialog
		title={<span className="flex items-center gap-2"><MousePointerClick aria-hidden className="size-5 text-brand" />Action Column</span>}
		description="Choose a channel and action, then reference row columns in its instructions. This saves the setup only; it does not send, publish, or change anything."
		size="xl"
		onClose={() => { if (!busy) onClose(); }}
		footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="brand" loading={busy} disabled={!name.trim() || !action.trim() || !instructions.trim() || channel === 'agentweb-site' && !domain.trim()} onClick={() => void save()}>{state.column ? 'Save action setup' : 'Add action column'}</Button></>}
		footerNote="Configuration only · no external action runs"
	>
		<div className="grid items-start gap-6 md:grid-cols-2">
			<div className="flex min-w-0 flex-col gap-5">
				<Field label="Column name">{(id) => <Input id={id} value={name} onChange={(event) => { setName(event.target.value); setNameEdited(true); }} />}</Field>
				<Field label="Channel">{() => <Segmented value={channel} onChange={chooseChannel} label="Action channel" options={CHANNELS.map((item) => ({ value: item.value, label: item.label }))} />}</Field>
				{actionOptions.length > 0 && <Field label="Action">{(id) => <Select id={id} value={action} onValueChange={chooseAction}>{actionOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>}</Field>}
				{channel === 'agentweb-site' && <div className="grid grid-cols-2 gap-3">
					<Field label="Website domain" required>{(id) => <Input id={id} placeholder="example.com" value={domain} onChange={(event) => setDomain(event.target.value)} />}</Field>
					<Field label="AgentWeb action" required>{(id) => <Input id={id} placeholder="Action name" value={action} onChange={(event) => setAction(event.target.value)} />}</Field>
				</div>}
				{channel === 'facebook' && <p role="status" className="rounded-lg bg-neutral-5 px-3 py-2.5 text-body-sm text-fg-muted">AgentWeb does not currently have a Facebook action map. You can save this setup now; it will not run until a supported integration is available.</p>}
				{channel === 'email-sequencer' && <p role="status" className="rounded-lg bg-neutral-5 px-3 py-2.5 text-body-sm text-fg-muted">IDEAL’s email sequencer is planned. This setup will not enroll contacts until that connection is implemented.</p>}
				{channel === 'agentweb-site' && <p className="rounded-lg bg-neutral-5 px-3 py-2.5 text-body-sm text-fg-muted">Use an action name from the selected website’s AgentWeb map. The current setup is saved only; it does not call AgentWeb.</p>}
				<div className="flex flex-col gap-3">
					<Field label="Action instructions" help="Reference row values with {{Column name}}. Type / in the editor to browse columns, or use the chips below.">
						{(id) => <div className="rounded-lg border border-line">
							<ColumnPrompt id={id} value={instructions} onChange={setInstructions} columns={columns} rows={4} disabled={busy} insertRef={insertInstruction} placeholder="e.g. Use {{Name}} and {{Company}} to prepare this action for the row" />
							<div className="flex flex-wrap gap-1.5 border-t border-line-subtle p-2">{columns.map((column) => <button key={column.id} type="button" disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-caption text-fg-muted hover:bg-neutral-5 disabled:opacity-50" onPointerDown={(event) => event.preventDefault()} onClick={() => insertInstruction.current?.(column.name)}><span className="text-fg-subtle">{columnAddress(sheet.columns.indexOf(column))}</span>{column.name}</button>)}</div>
						</div>}
					</Field>
				</div>
				{error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
			</div>
			<div className="flex min-w-0 flex-col gap-4">
				<section aria-label="Action preview" className="min-w-0 overflow-hidden rounded-xl border border-line-subtle bg-surface">
					<div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-subtle bg-neutral-5 px-4 py-3"><h3 className="text-body-sm font-medium">Action preview</h3><span className="text-caption text-fg-subtle">{previewRow ? `Row ${previewRow.order + 1}` : 'No rows yet'}</span></div>
					<div className="flex flex-col gap-2 p-4">
						<p className="text-caption text-fg-subtle">{channelName(channel)} · {actionName(channel, action)}</p>
						<p className="whitespace-pre-wrap break-words text-body-sm text-fg">{preview || 'Your action instructions will appear here.'}</p>
						{channel === 'agentweb-site' && domain && <p className="text-caption text-fg-subtle">Website · {domain}</p>}
					</div>
				</section>
			<section className="flex flex-col gap-2 rounded-xl bg-neutral-5 p-4">
				<h3 className="text-body-sm font-medium text-fg">Channel status</h3>
				{channel === 'linkedin' || channel === 'instagram'
					? <p className="text-body-sm text-fg-muted">Action choices come from AgentWeb’s current {channelName(channel)} map. Connect your AgentWeb account in Settings; actual execution and per-row review are a separate step.</p>
					: channel === 'facebook'
						? <p className="text-body-sm text-fg-muted">Not mapped in AgentWeb yet.</p>
						: channel === 'email-sequencer'
							? <p className="text-body-sm text-fg-muted">Planned integration: IDEAL email sequencer.</p>
							: <p className="text-body-sm text-fg-muted">AgentWeb site actions use the selected website’s action map once execution is connected.</p>}
				<p className="flex items-start gap-2 border-t border-line-subtle pt-3 text-caption text-fg-subtle"><ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0" />Social sends and posts will require a per-row review before execution is enabled.</p>
			</section>
			</div>
		</div>
	</Dialog>;
}
