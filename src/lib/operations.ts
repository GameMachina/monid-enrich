import type { Provider } from './organization-settings';
import { ColumnOpSchema, type ColumnOp, type FailureProvider, type OpKind, type PageSource } from './types';
import { PHONE_STRATEGY_INFO, type PhoneProviderStrategy } from './phone-strategy';
import { SOCIAL_WATERFALL_PROVIDERS } from './social-platform';

/* The operation catalog: one record per operation kind, describing it to every caller (editor, runner, freshness,
   cost estimates, MCP, compose and the server executor). Add a kind here and the rest of the app picks it up. */

type Op<K extends OpKind> = Extract<ColumnOp, { kind: K }>;
type Field<K extends OpKind> = K extends OpKind ? Exclude<keyof Op<K>, 'kind'> & string : never;

/** Any one of these providers satisfies the need. */
export type ProviderNeed = readonly Provider[];
/** What a run reads besides its references: the whole row, only the references, or the whole row when its instruction references nothing. */
export type RowContext = 'row' | 'references' | 'row-unless-referenced';
export interface DefinitionIssue { field: string; message: string }

export interface Operation<K extends OpKind = OpKind> {
	label: string;
	short: string;
	description: string;
	/** Suggested name for a new column. */
	columnName: string;
	/** Fields holding `{{…}}` text or a page source. They drive dependencies and renames alike. */
	references: readonly Field<K>[];
	/** The field holding the user's instruction, which also selects company reference data. */
	instruction?: Field<K>;
	rowContext(op: Op<K>): RowContext;
	/** Evaluated in the browser without a request. */
	local(op: Op<K>): boolean;
	/** Keys the server executor needs before it can start. */
	requires(op: Op<K>): ProviderNeed[];
	/** Rough provider usage units per cell; actual Monid cost is stored with the cell result. */
	credits(op: Op<K>): number;
	/** Slowest plausible single run, so MCP never starts a row it cannot finish. */
	worstCaseMs(op: Op<K>): number;
	/** Who answers failures that do not name their provider. Decisions may use TypeSafe or OpenAI. */
	bills?: FailureProvider;
	/** What a new or edited definition must satisfy beyond its stored shape. Stored definitions stay loadable. */
	issue?(op: Op<K>): DefinitionIssue | null;
}

const MONID: ProviderNeed = ['monid'];
const TREG: ProviderNeed = ['treg'];
const OPENAI: ProviderNeed = ['openai'];
const DECIDER: ProviderNeed = ['openai'];
const pageNeeds = (page?: PageSource): ProviderNeed[] => page ? [MONID] : [];
const pageCredits = (page?: PageSource) => !page ? 0 : page.type === 'find' ? 2 : 1;
const remote = () => false;
const row = (): RowContext => 'row';
const references = (): RowContext => 'references';
const free = () => 0;
const typical = () => 90_000;
const decision = () => 120_000;
const mobileWorstCase = (strategy?: PhoneProviderStrategy) => PHONE_STRATEGY_INFO[strategy ?? 'clay'].providers.reduce((total, provider) => total + (provider === 'clay' ? 180_000 : 60_000), 0);
const mobileDefinitionIssue = (op: { name?: string; company?: string; domain?: string; email?: string; profileUrl?: string; phoneStrategy?: PhoneProviderStrategy }) => {
	const providers = PHONE_STRATEGY_INFO[op.phoneStrategy ?? 'clay'].providers;
	const leadMagicReady = Boolean(op.profileUrl?.trim() || op.email?.trim());
	const clayReady = Boolean(op.name?.trim() && (op.company?.trim() || op.domain?.trim()) && op.profileUrl?.trim());
	if (providers.includes('leadmagic') && leadMagicReady || providers.includes('clay') && clayReady) return null;
	if (providers.includes('leadmagic') && providers.length === 1) return { field: 'profileUrl', message: 'Add a LinkedIn profile URL or email for LeadMagic.' };
	if (providers.includes('clay') && providers.length === 1) return { field: 'profileUrl', message: 'Clay needs a full name, current company, and LinkedIn profile URL.' };
	return { field: 'profileUrl', message: 'Add a LinkedIn profile or email for LeadMagic, or a full name, current company, and LinkedIn profile for Clay.' };
};
const phoneWaterfallIssue = (op: { name: string; company: string; domain: string; profileUrl: string; email: string; providers: readonly string[]; dataProvider?: 'monid' | 'treg' }) => {
	const name = Boolean(op.name.trim()), company = Boolean(op.company.trim()), domain = Boolean(op.domain.trim()), profile = Boolean(op.profileUrl.trim()), email = Boolean(op.email.trim());
	if (op.dataProvider === 'treg') return profile || email || name && domain ? null : { field: 'profileUrl', message: 'Treg needs a LinkedIn URL, email, or a person name and company domain.' };
	const usable = op.providers.some((provider) => {
		switch (provider) {
			case 'leadmagic': return profile || email;
			case 'clay': return profile && name && (company || domain);
			case 'ai_ark': case 'reversecontact': return profile || name && domain;
			case 'prospeo': return profile || email || name && (company || domain);
			default: return false;
		}
	});
	return usable ? null : { field: 'profileUrl', message: 'Add the identifiers needed by a selected provider: a LinkedIn URL or email, or a name with a company domain.' };
};
const phoneWaterfallWorstCase = (op: { providers: readonly string[] }) => op.providers.reduce((sum, provider) => sum + (provider === 'clay' ? 180_000 : provider === 'prospeo' ? 90_000 : 60_000), 0);
const socialWaterfallWorstCase = (op: { providers: readonly string[] }) => op.providers.reduce((sum, provider) => sum + (provider === 'apify' ? 180_000 : provider === 'ploid' ? 60_000 : 45_000), 0);

export const OPERATIONS: { readonly [K in OpKind]: Operation<K> } = {
	'email-enrichment': {
		label: 'Find email', short: 'Email', columnName: 'Work email',
		description: 'Find a work email from the selected data provider and its separate billing balance.',
		references: ['name', 'company', 'domain', 'profileUrl'], rowContext: references, local: remote,
		requires: (op) => [op.dataProvider === 'treg' ? TREG : MONID], credits: free, worstCaseMs: () => 120_000, bills: 'monid',
		issue: (op) => op.dataProvider === 'treg'
			? (!op.profileUrl.trim() && (!op.name.trim() || !op.domain.trim()) ? { field: !op.name.trim() ? 'name' : 'domain', message: 'Treg email lookup needs a LinkedIn URL or both a person name and company domain.' } : null)
			: (!op.name.trim() || !op.domain.trim() ? { field: !op.name.trim() ? 'name' : 'domain', message: 'Monid email lookup needs a person name and company domain.' } : null),
	},
	'phone-enrichment': {
		label: 'Find phone number', short: 'Phone', columnName: 'Mobile Number',
		description: 'Find a person’s phone number with the selected data provider.',
		references: ['name', 'company', 'domain', 'profileUrl', 'email'], rowContext: references, local: remote,
		requires: (op) => [op.dataProvider === 'treg' ? TREG : MONID], credits: free, worstCaseMs: (op) => op.dataProvider === 'treg' ? 120_000 : phoneWaterfallWorstCase(op), bills: 'monid',
		issue: phoneWaterfallIssue,
	},
	'social-enrichment': {
		label: 'Find social', short: 'Social', columnName: 'Social profile',
		description: 'Find one person’s public profile on a selected social network using the selected data provider.',
		references: ['name', 'company', 'domain', 'profileUrl', 'email'], rowContext: references, local: remote,
		requires: (op) => [op.dataProvider === 'treg' ? TREG : MONID], credits: free, worstCaseMs: (op) => op.dataProvider === 'treg' ? 90_000 : socialWaterfallWorstCase(op), bills: 'monid',
		issue: (op) => {
			if (!op.name.trim()) return { field: 'name', message: 'Add a person’s name to find their social profile.' };
			if (op.dataProvider === 'treg' && !(['linkedin', 'instagram', 'tiktok'] as const).includes(op.platform as 'linkedin' | 'instagram' | 'tiktok')) return { field: 'platform', message: `Treg does not support ${op.platform === 'x' ? 'X' : op.platform} profile search yet. Choose LinkedIn, Instagram, TikTok or switch this column to Monid.` };
			const supported = SOCIAL_WATERFALL_PROVIDERS[op.platform] as readonly string[];
			if (op.providers.some((provider) => !supported.includes(provider))) return { field: 'providers', message: `Choose providers that support ${op.platform}.` };
			return null;
		},
	},
	'email-draft': {
		label: 'Email draft', short: 'Email draft', columnName: 'Email draft',
		description: 'Draft a personalized email with AI, or fill an email template from columns.',
		references: ['prompt', 'to', 'cc', 'bcc', 'subject', 'body'], instruction: 'prompt',
		rowContext: (op) => op.mode === 'template' ? 'references' : 'row', local: (op) => op.mode === 'template',
		requires: (op) => op.mode === 'template' ? [] : [OPENAI], credits: free, worstCaseMs: (op) => op.mode === 'template' ? 1_000 : 90_000, bills: 'openai',
	},
	ai: {
		label: 'Ask AI', short: 'AI', columnName: 'AI answer',
		description: 'OpenAI answers a question about each row, using Monid web research when requested.',
		references: ['prompt', 'page'], instruction: 'prompt', rowContext: row, local: remote,
		requires: (op) => [OPENAI, ...(op.research === 'web' ? [MONID] : pageNeeds(op.page))], credits: (op) => (op.research === 'web' ? 4 : 0) + pageCredits(op.page), worstCaseMs: decision, bills: 'openai',
	},
	check: {
		label: 'True / false check', short: 'Check', columnName: 'Check',
		description: 'A yes-or-no answer with a probability. Can read a page first.',
		references: ['question', 'page'], instruction: 'question', rowContext: row, local: remote,
		// Exact-text checks match the row or page without a model.
		requires: (op) => [...pageNeeds(op.page), ...(op.literal?.trim() ? [] : [DECIDER])], credits: (op) => pageCredits(op.page), worstCaseMs: decision,
	},
	classify: {
		label: 'Classify', short: 'Classify', columnName: 'Category',
		description: 'Pick one of your options for each row, with a probability for every option.',
		references: ['question', 'page'], instruction: 'question', rowContext: row, local: remote,
		requires: (op) => [...pageNeeds(op.page), DECIDER], credits: (op) => pageCredits(op.page), worstCaseMs: decision,
	},
	score: {
		label: 'Score', short: 'Score', columnName: 'Score',
		description: 'Rate each row on levels you define, lowest to highest.',
		references: ['question', 'page'], instruction: 'question', rowContext: row, local: remote,
		requires: (op) => [...pageNeeds(op.page), DECIDER], credits: (op) => pageCredits(op.page), worstCaseMs: decision,
	},
	scrape: {
		label: 'Read a page', short: 'Scrape', columnName: 'Page',
		description: 'Fetch a page and keep its text, relevant passages, links or extracted fields.',
		references: ['page', 'query'], rowContext: references, local: remote,
		requires: (op) => [...pageNeeds(op.page), ...(op.mode === 'extract' ? [OPENAI] : [])], credits: (op) => Math.max(1, pageCredits(op.page)), worstCaseMs: typical, bills: 'monid',
		issue: (op) => op.mode === 'extract' && !op.fields?.length && !op.query?.trim() ? { field: 'fields', message: 'Add a field or instructions to extract.' } : null,
	},
	search: {
		label: 'Web search', short: 'Search', columnName: 'Search result',
		description: 'Search the web and keep the top URL, title or snippet.',
		references: ['query'], rowContext: references, local: remote,
		requires: () => [MONID], credits: () => 1, worstCaseMs: typical, bills: 'monid',
	},
	company: {
		label: 'Company data', short: 'Company', columnName: 'Company info',
		description: 'Firmographics, funding, links and socials for a company domain.',
		references: ['domain'], rowContext: references, local: remote,
		requires: () => [MONID], credits: () => 1, worstCaseMs: typical, bills: 'monid',
	},
	person: {
		label: 'Person data', short: 'Person', columnName: 'Person info',
		description: 'Titles, employer, education, profiles and mobile-phone lookups for a person.',
		references: ['name', 'company', 'email', 'profileUrl'], rowContext: references, local: remote,
		requires: () => [MONID], credits: () => 1, worstCaseMs: (op) => op.field === 'mobile' ? mobileWorstCase(op.phoneStrategy) : 90_000, bills: 'monid',
		issue: (op) => op.field === 'mobile' ? mobileDefinitionIssue(op) : null,
	},
	hunter: {
		label: 'Email lookup', short: 'Email', columnName: 'Email status',
		description: 'Find or verify a work email through Monid.',
		references: ['name', 'domain', 'email'], rowContext: references, local: remote,
		requires: () => [MONID], credits: free, worstCaseMs: typical, bills: 'monid',
	},
	prospeo: {
		label: 'Contact profile', short: 'Profile', columnName: 'Contact info',
		description: 'Enrich supported person details, including mobile-phone lookups, through Monid.',
		references: ['name', 'domain', 'email', 'profileUrl'], rowContext: references, local: remote,
		requires: () => [MONID], credits: free, worstCaseMs: (op) => op.field === 'mobile' ? mobileWorstCase(op.phoneStrategy) : typical(), bills: 'monid',
		issue: (op) => op.field === 'mobile' ? mobileDefinitionIssue(op) : null,
	},
	answer: {
		label: 'Deep research', short: 'Research', columnName: 'Research',
		description: 'OpenAI researches the live web through Monid and returns a sourced answer.',
		references: ['task'], instruction: 'task', rowContext: () => 'row-unless-referenced', local: remote,
		requires: () => [MONID, OPENAI], credits: (op) => op.mode === 'ultra' ? 100 : 10, worstCaseMs: () => 130_000, bills: 'openai',
	},
	template: {
		label: 'Text template', short: 'Template', columnName: 'Text',
		description: 'Combine other columns with a template. No API calls.',
		references: ['template'], rowContext: references, local: () => true,
		requires: () => [], credits: free, worstCaseMs: () => 1_000,
	},
};

export const OP_KINDS = Object.keys(OPERATIONS) as OpKind[];

export function operation(kind: OpKind): Operation {
	return OPERATIONS[kind] as Operation;
}

/** The kinds as MCP and compose present them. */
export const operationSummaries = Object.fromEntries(OP_KINDS.map((kind) => [kind, { label: OPERATIONS[kind].label, short: OPERATIONS[kind].short, description: OPERATIONS[kind].description }])) as Record<OpKind, { label: string; short: string; description: string }>;

export const instructionField = (op: ColumnOp) => operation(op.kind).instruction;

export function instructionText(op: ColumnOp): string {
	const field = instructionField(op);
	const value = field ? (op as Record<string, unknown>)[field] : undefined;
	return typeof value === 'string' ? value : '';
}

const YES_NO = /^(?:is|are|was|were|does|do|did|has|have|can|could|will|would|should)\s+/i;
const ASKS = /^(?:please\s+)?(?:(?:who|what|which|where|when|how(?:\s+(?:many|much|big|old|long))?)(?:'s|’s|\s+(is|are|was|were|does|do|did|has|have|can|should|would))?|find|get|list|give|tell me|identify|determine|estimate|look up|extract)\s+/i;
const ARTICLE = /^(?:the|a|an|its|their|this|each|every|any)\s+/i;
const BOUNDARY = /\s+(?:of|for|at|in|on|from|by|with|about|does|do|did|is|are|was|were|has|have|that|which|who|whose|to|than|if)(?=\s|$)|[,;:(]/i;
const BEFORE_REFERENCE = /\s+(?:of|for|at|in|on|from|by|with|about|does|do|did|is|are|was|were|has|have|to)\s+\{\{/i;
const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
const NOT_A_NAME = /^(?:what|who|how|which|whether|if|why|when|where|it|they|this|that)\b/i;

/**
 * A short title-case column name from an AI column's question: "Who is the CEO of {{Company}}?" → "CEO",
 * "Does {{Domain}} offer a free tier?" → "Free Tier?". Empty when the question doesn't name a thing.
 */
export function columnNameFromQuestion(question: string): string {
	let text = (question.trim().split('\n')[0] ?? '').replace(/\{\{[^}]*\}\}(?:'s|’s)/g, ' ');
	// The words before "… of {{Company}}" name the column, even when they hold an "of" themselves ("head of sales").
	const cut = text.search(BEFORE_REFERENCE);
	if (cut > 0) text = text.slice(0, cut);
	text = text.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim();
	const yesNo = YES_NO.test(text);
	if (yesNo) text = text.replace(YES_NO, '');
	else {
		const asked = text.match(ASKS);
		// "What does … sell?" leaves a verb; "How mature is …?" an adjective.
		if (asked?.[1] && /^(?:does|do|did|can|should|would)$/i.test(asked[1]) || /^how\s+(?!many|much|big|old|long)/i.test(text)) return '';
		if (asked) text = text.slice(asked[0].length);
	}
	// "offer a free tier", "Draft a summary": the verb goes, its object names the column.
	text = text.replace(/^\w+\s+(?=(?:a|an|the|any|each|every)\s)/i, '').replace(ARTICLE, '');
	text = (cut > 0 ? text : text.split(BOUNDARY)[0]).replace(/[?.!]+$/, '').trim();
	const words = text.split(' ').filter(Boolean);
	if (!words.length || words.length > 4 || text.length > 32 || NOT_A_NAME.test(text)) return '';
	const name = words.map((word, index) => index && SMALL.has(word.toLowerCase()) ? word.toLowerCase() : /[A-Z]/.test(word.slice(1)) ? word : word[0].toUpperCase() + word.slice(1)).join(' ');
	return yesNo ? `${name}?` : name;
}

export const evaluatesLocally = (op: ColumnOp) => operation(op.kind).local(op);
export const requiredProviders = (op: ColumnOp) => operation(op.kind).requires(op).filter((need, index, needs) =>
	needs.findIndex((candidate) => candidate.length === need.length && candidate.every((provider, position) => provider === need[position])) === index,
);
export const creditsPerCell = (op: ColumnOp) => operation(op.kind).credits(op);
export const worstCaseMs = (op: ColumnOp) => operation(op.kind).worstCaseMs(op);
export const billingProvider = (op: ColumnOp) => (op.kind === 'email-enrichment' || op.kind === 'phone-enrichment' || op.kind === 'social-enrichment') && op.dataProvider === 'treg' ? 'treg' : operation(op.kind).bills;

/** The first provider of each unmet need; empty when the operation can run. */
export function missingProviders(op: ColumnOp, ready: (provider: Provider) => boolean): Provider[] {
	return requiredProviders(op).filter((need) => !need.some(ready)).map((need) => need[0]);
}

export function definitionIssue(op: ColumnOp): DefinitionIssue | null {
	return operation(op.kind).issue?.(op) ?? null;
}

/** New or edited definitions: the stored shape plus each operation's own rules. */
export const ColumnOpInputSchema = ColumnOpSchema.superRefine((op, context) => {
	const issue = definitionIssue(op);
	if (issue) context.addIssue({ code: 'custom', message: issue.message, path: [issue.field] });
});
