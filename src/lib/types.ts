import type { DateFormat } from './date-format';
import type { ActionColumnDefinition } from './action-column';
import { PhoneProviderStrategySchema } from './phone-strategy';
import { SocialPlatformSchema, SocialProviderSchema } from './social-platform';
import { z } from 'zod';

/* ───────────────────────────── Column operations ─────────────────────────────
   Every enriched column carries one operation. The same zod schemas validate the
   editor on the client and the request body on the server. */

export const OUTPUT_TYPES = ['text', 'document', 'number', 'boolean', 'url', 'date', 'list'] as const;
export const COLUMN_FORMATS = [...OUTPUT_TYPES, 'currency', 'percent', 'unit', 'year', 'checkbox', 'website', 'webpage', 'email-draft', 'email', 'category'] as const;
export type ColumnFormat = (typeof COLUMN_FORMATS)[number];
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Where a page-reading operation gets its page from. */
export const PageSourceSchema = z.discriminatedUnion('type', [
	/** A column that already holds a URL (or a domain). */
	z.object({ type: z.literal('column'), column: z.string().min(1) }),
	/** The homepage of a domain column. */
	z.object({ type: z.literal('homepage'), column: z.string().min(1) }),
	/** Find a specific page on the site (pricing, careers, about…) by guessing paths and mapping the site. */
	z.object({ type: z.literal('find'), column: z.string().min(1), page: z.string().min(1).max(60) }),
	/** A URL template such as https://{{Domain}}/pricing */
	z.object({ type: z.literal('template'), template: z.string().min(1).max(500) }),
]);
export type PageSource = z.infer<typeof PageSourceSchema>;

export const DECIDERS = ['openai'] as const;
export type Decider = (typeof DECIDERS)[number];

const deciderField = z.enum(DECIDERS).default('openai');
const pageField = PageSourceSchema.optional();

export const PROSPEO_FIELDS = ['email', 'mobile', 'full_name', 'title', 'company', 'company_domain', 'linkedin', 'location'] as const;

export const EmailDraftSchema = z.object({
 to: z.string(), cc: z.string(), bcc: z.string(), subject: z.string(), body: z.string(),
});
export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export const EMAIL_PROVIDERS = ['quickenrich', 'hunter', 'apollo', 'prospeo', 'contactout'] as const;
export const DATA_PROVIDERS = ['monid', 'treg'] as const;
export const DataProviderSchema = z.enum(DATA_PROVIDERS);
export type DataProvider = typeof DATA_PROVIDERS[number];
export type EmailProvider = typeof EMAIL_PROVIDERS[number] | 'monid';
const STORED_EMAIL_PROVIDERS = ['monid', ...EMAIL_PROVIDERS] as const;
export const PHONE_LOOKUP_PROVIDERS = ['leadmagic', 'clay', 'ai_ark', 'reversecontact', 'prospeo'] as const;
export type PhoneLookupProvider = typeof PHONE_LOOKUP_PROVIDERS[number];
const PhoneLookupProviderSchema = z.enum(PHONE_LOOKUP_PROVIDERS);
export const ColumnOpSchema = z.discriminatedUnion('kind', [
 z.object({
  kind: z.literal('email-enrichment'),
  dataProvider: DataProviderSchema.default('monid'),
  name: z.string().trim().max(300).default(''),
  company: z.string().max(300).default(''),
  domain: z.string().trim().max(500).default(''),
  profileUrl: z.string().max(500).default(''),
  providers: z.array(z.enum(STORED_EMAIL_PROVIDERS)).min(1).max(5).default([...EMAIL_PROVIDERS]).refine(items => new Set(items).size === items.length, 'Each provider can appear only once.'),
  tregRouteWaterfall: z.boolean().optional(),
  tregRouteMaxCostUsd: z.number().finite().min(0.001).max(1).optional(),
 }),
 z.object({
  kind: z.literal('phone-enrichment'),
  dataProvider: DataProviderSchema.default('monid'),
  name: z.string().trim().max(300).default(''),
  company: z.string().max(300).default(''),
  domain: z.string().trim().max(500).default(''),
  profileUrl: z.string().max(500).default(''),
  email: z.string().max(320).default(''),
  providers: z.array(PhoneLookupProviderSchema).min(1).max(5).default(['ai_ark', 'reversecontact']).refine(items => new Set(items).size === items.length, 'Each provider can appear only once.'),
  tregRouteWaterfall: z.boolean().optional(),
  tregRouteMaxCostUsd: z.number().finite().min(0.001).max(1).optional(),
 }),
 z.object({
  kind: z.literal('social-enrichment'),
  dataProvider: DataProviderSchema.default('monid'),
  name: z.string().trim().max(300).default(''),
  company: z.string().max(300).default(''),
  domain: z.string().trim().max(500).default(''),
  profileUrl: z.string().max(500).default(''),
  email: z.string().max(320).default(''),
  platform: SocialPlatformSchema.default('linkedin'),
  providers: z.array(SocialProviderSchema).min(1).max(5).default(['people_enrich', 'web_search']).refine(items => new Set(items).size === items.length, 'Each provider can appear only once.'),
  tregRouteWaterfall: z.boolean().optional(),
  tregRouteMaxCostUsd: z.number().finite().min(0.001).max(1).optional(),
 }),
 z.object({
  kind: z.literal('email-draft'),
  mode: z.enum(['ai', 'template']).default('ai'),
  prompt: z.string().max(4000).default('Draft a personalized email using this row.'),
  to: z.string().max(2000).default(''),
  cc: z.string().max(2000).default(''),
  bcc: z.string().max(2000).default(''),
  subject: z.string().max(2000).default(''),
  body: z.string().max(20000).default(''),
 }),
	/** OpenAI answers a question about the row; optionally researching the web with the selected data provider first. */
	z.object({
		kind: z.literal('ai'),
		dataProvider: DataProviderSchema.default('monid'),
		prompt: z.string().min(1).max(4000),
		output: z.enum(OUTPUT_TYPES).default('text'),
		research: z.enum(['none', 'web']).default('web'),
		page: pageField,
	}),
	/** A true/false question decided by TypeSafe Jev (calibrated probability) or OpenAI, optionally after reading a page. */
	z.object({
		kind: z.literal('check'),
		dataProvider: DataProviderSchema.default('monid'),
		question: z.string().min(1).max(2000),
		page: pageField,
		decider: deciderField,
		/** Probability above which the answer counts as true. */
		threshold: z.number().min(0.05).max(0.95).default(0.5),
		/** Exact-text mode: the answer is true when the page contains this text (case-insensitive). No model needed. */
		literal: z.string().max(200).optional(),
	}),
	/** Pick one option from a list (Jev choice). */
	z.object({
		kind: z.literal('classify'),
		dataProvider: DataProviderSchema.default('monid'),
		question: z.string().min(1).max(2000),
		options: z.array(z.object({ label: z.string().min(1).max(80), description: z.string().max(300).optional() })).min(2).max(20),
		page: pageField,
		decider: deciderField,
	}),
	/** Rate on an ordered rubric (Jev score). */
	z.object({
		kind: z.literal('score'),
		dataProvider: DataProviderSchema.default('monid'),
		question: z.string().min(1).max(2000),
		levels: z.array(z.string().min(1).max(120)).min(2).max(10),
		page: pageField,
		decider: deciderField,
	}),
	/** Read a page with the selected data provider and keep its text, relevant passages, or extracted fields. */
	z.object({
		kind: z.literal('scrape'),
		dataProvider: DataProviderSchema.default('monid'),
		page: PageSourceSchema,
		mode: z.enum(['markdown', 'highlights', 'extract', 'title', 'url', 'links', 'map', 'html', 'images', 'emails', 'phone-numbers']).default('highlights'),
		query: z.string().max(500).optional(),
		fields: z.array(z.object({ name: z.string().min(1).max(60), description: z.string().max(300).optional() })).max(20).optional(),
		maxChars: z.number().int().min(100).max(20000).default(2000),
	}),
	/** Web search through the selected data provider; keep the first URL, title, snippet or a list. */
	z.object({
		kind: z.literal('search'),
		dataProvider: DataProviderSchema.default('monid'),
		query: z.string().min(1).max(500),
		pick: z.enum(['url', 'title', 'snippet', 'list']).default('url'),
		numResults: z.number().int().min(1).max(10).default(3),
		includeDomains: z.array(z.string()).max(20).optional(),
	}),
	/** Company facts from the selected data provider. */
	z.object({
		kind: z.literal('company'),
		dataProvider: DataProviderSchema.default('monid'),
		domain: z.string().min(1).max(500),
		field: z.enum(['description', 'title', 'slogan', 'industry', 'employees', 'city', 'country', 'address', 'email', 'phone', 'ticker', 'linkedin', 'twitter', 'pricing_url', 'careers_url', 'blog_url', 'contact_url', 'logo_url', 'primary_color', 'language', 'funding_total', 'funding_stage', 'funding_latest_round', 'funding_latest_date', 'funding_latest_amount', 'funding_round_count']),
	}),
	/** Person facts from the selected data provider. */
	z.object({
		kind: z.literal('person'),
		dataProvider: DataProviderSchema.default('monid'),
		name: z.string().max(300).optional(),
		company: z.string().max(300).optional(),
		email: z.string().max(300).optional(),
		profileUrl: z.string().max(500).optional(),
		field: z.enum(['title', 'company', 'company_domain', 'location', 'bio', 'linkedin', 'email', 'mobile', 'skills', 'schools', 'degrees', 'experience', 'years_at_company', 'full_name']),
		/** Snapshot of the member's preferred strategy when this mobile column is saved. */
		phoneStrategy: PhoneProviderStrategySchema.optional(),
	}),
	z.object({
		kind: z.literal('hunter'),
		dataProvider: DataProviderSchema.default('monid'),
		action: z.enum(['find', 'verify']),
		name: z.string().max(300).optional(),
		domain: z.string().max(500).optional(),
		email: z.string().max(300).optional(),
	}).refine((op) => op.action === 'find' ? Boolean(op.name?.trim() && op.domain?.trim()) : Boolean(op.email?.trim()), { message: 'Provide a name and domain to find an email, or an email to verify.' }),
	z.object({
		kind: z.literal('prospeo'),
		dataProvider: DataProviderSchema.default('monid'),
		name: z.string().max(300).optional(),
		domain: z.string().max(500).optional(),
		email: z.string().max(300).optional(),
		profileUrl: z.string().max(500).optional(),
		field: z.enum(PROSPEO_FIELDS),
		/** Snapshot of the member's preferred strategy when this mobile column is saved. */
		phoneStrategy: PhoneProviderStrategySchema.optional(),
		onlyVerifiedEmail: z.boolean().default(true),
	}).refine((op) => Boolean(op.email?.trim() || op.profileUrl?.trim() || op.name?.trim() && op.domain?.trim()), { message: 'Provide an email, LinkedIn URL, or name and company domain.' }),
	/** Deep research with web answers from the selected data provider. */
	z.object({
		kind: z.literal('answer'),
		dataProvider: DataProviderSchema.default('monid'),
		task: z.string().min(1).max(4000),
		output: z.enum(OUTPUT_TYPES).default('text'),
		mode: z.enum(['fast', 'ultra']).default('fast'),
	}),
	/** A plain template over other columns; no network. */
	z.object({ kind: z.literal('template'), template: z.string().min(1).max(2000) }),
]);
type ParsedColumnOp = z.infer<typeof ColumnOpSchema>;
type OptionalDataProvider<T> = T extends { dataProvider: DataProvider }
	? Omit<T, 'dataProvider'> & { dataProvider?: DataProvider }
	: T;
export type ColumnOp = OptionalDataProvider<ParsedColumnOp>;
export type OpKind = ColumnOp['kind'];

/* ───────────────────────────── Sheet data model ───────────────────────────── */

export type ColumnType = 'source' | 'enriched';

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	op?: ColumnOp;
	/** A saved AgentWeb or outreach action setup. It is not executed when the column is created. */
	action?: ActionColumnDefinition;
	width: number;
	hidden?: boolean;
	/** Column-wide value display and input format. */
	format?: ColumnFormat;
	/** Allowed values for a single-choice Category column. */
	categoryOptions?: string[];
	/** Background colors keyed by category label. */
	categoryColors?: Record<string, string>;
	currency?: string;
	unit?: string;
	useGrouping?: boolean;
	decimalPlaces?: number;
	dateFormat?: DateFormat;
	createdAt: number;
}

export type CellStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';
export type CellValue = string | number | boolean | null | string[];

export interface CellMeta {
	inputFingerprint?: string;
	/** Photo returned for this exact person name by enrichment. */
	person?: { name: string; avatarUrl: string | null };
	/** Full result retained from an already completed company lookup. Previewing never refetches it. */
	companyIntel?: { domain: string; input?: string; source: 'brand' | 'company-search' | 'treg-company-enrich' | 'treg-funding'; data: Record<string, unknown> };
	/** Explicit company selected while editing; kept with its name to prevent stale logos. */
	organization?: { name: string; domain: string };
	sources?: string[];
	/** 0–1 probability (check) or confidence (classify/score). */
	probability?: number;
	confidence?: number;
	probabilities?: Record<string, number>;
	reasoning?: string;
	model?: string;
	credits?: number;
	/** Provider-specific usage; Monid and Treg records are kept separate. */
	provider?: EmailProvider | PhoneLookupProvider;
	/** Explicit data provider selected for this operation; separate from any waterfall's internal source. */
	dataProvider?: DataProvider;
	enrichment?: { verified?: boolean; verificationStatus?: string; costUsd: number; attempts: Array<{ provider: EmailProvider; source: 'own-key' | 'included' | 'monid-workspace'; status: string; costUsd: number }> };
	providerCredits?: number;
	providerCreditUnit?: string;
	/** Monid's receipt IDs and run statuses for data-provider calls made for this cell. */
	monidRuns?: Array<{ runId?: string; provider: string; endpoint: string; status: string; costUsd?: number; billedUnits?: number; price?: { type?: string; amount?: number; currency?: string }; resultCount?: number; completedAt?: string }>;
	monidCostUsd?: number;
	/** Treg call receipts and spend, kept separate from Monid workspace runs and wallet totals. */
	tregRuns?: Array<{ callId?: string; operation: string; endpoint: string; status: string; costUsd?: number; costMicroUsd?: number; servedVia?: string; servedBy?: string; tried?: Array<{ provider: string; status?: string; costUsd?: number }>; completedAt?: string }>;
	tregCostUsd?: number;
	/** Reused only for an explicit retry of an uncertain Treg request, within Treg's idempotency window. */
	tregIdempotencyKey?: string;
	tregIdempotencyCreatedAt?: number;
	durationMs?: number;
	pageUrl?: string;
	raw?: unknown;
}

export interface Cell {
	v: CellValue;
	/** Spreadsheet expression, including its leading '='. v is the cached result. */
	f?: string;
	s: CellStatus;
	e?: string;
	m?: CellMeta;
	/** Who is running it: a browser tab or an MCP request (see `startCell`). Only running cells carry one. */
	owner?: string;
	t: number;
}

export interface Row {
	id: string;
	sheetId: string;
	order: number;
	cells: Record<string, Cell>;
	createdAt: number;
}

export type FilterOp = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'empty' | 'not_empty' | 'true' | 'false' | 'gt' | 'lt' | 'error';
export interface Filter {
	id: string;
	columnId: string;
	op: FilterOp;
	value?: string;
}
export interface Sort {
	columnId: string;
	dir: 'asc' | 'desc';
}

export interface Sheet {
	/** Local-only list summary from the live metadata subscription; never persisted by the API. */
	cloudSummary?: { revision: number; rowCount: number; rows: Row[] };
	id: string;
	revision?: number;
	name: string;
	columns: Column[];
	/** The view saved before filters and sort became each viewer's own (sheet-view.ts). It starts a viewer's view; the
	    browser only drops a deleted column's entries from it. */
	filters: Filter[];
	sort: Sort | null;
	/** The last populate request, so "find more rows" can continue it. */
	populate?: PopulateRequest;
	/** `SHEET_DATA_VERSION` when created or upgraded; older sheets are upgraded once when they load. */
	dataVersion?: number;
	createdAt: number;
	updatedAt: number;
}

/* ───────────────────────────── Populate ───────────────────────────── */

export const ENTITY_KINDS = ['companies', 'people', 'websites'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const PopulateRequestSchema = z.object({
	query: z.string().min(3).max(2000),
	entity: z.enum(ENTITY_KINDS),
	dataProvider: DataProviderSchema.default('monid'),
	/** For Treg people searches, retrieve education, skills and work history from the selected LinkedIn full-profile route. */
	enrichFullProfiles: z.boolean().default(false),
	/** Stable only for retries of this Find rows submission. */
	idempotencyKey: z.string().min(8).max(128).optional(),
	// Persisted sheets may contain a request created before the temporary test cap was lowered.
	target: z.number().int().min(1).max(1000).default(5),
	countries: z.array(z.string().length(2)).max(20).optional(),
	/** Remaining sheet capacity. Explicit people lists use this rather than the discovery target. */
	availableRows: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
	/** Keys (domains, profile URLs, URLs) already in the sheet, so results are appended without duplicates. */
	existingKeys: z.array(z.string()).max(20000).optional(),
});
/** The temporary per-request limit applies only when starting a new Find rows search. */
export const FindRowsRequestSchema = PopulateRequestSchema.extend({
	target: z.number().int().min(1).max(5, 'A single Find rows request can return up to 5 rows while testing.').default(5),
});
export type PopulateRequest = Omit<z.infer<typeof PopulateRequestSchema>, 'dataProvider' | 'enrichFullProfiles'> & {
	dataProvider?: DataProvider;
	enrichFullProfiles?: boolean;
};

/** One row found by the populate agent: field name → value; `found-rows.ts` places it in a sheet. */
export type FoundRow = Record<string, CellValue>;

export type PopulateEvent =
	| { type: 'status'; message: string }
	/** `key` is only read by tabs loaded before the found-rows Module; drop it after one release. */
	| { type: 'rows'; rows: FoundRow[]; key?: string; meta?: CellMeta; updateExisting?: boolean }
	| { type: 'done'; total: number; message?: string }
	| { type: 'error'; message: string; failure?: EnrichFailure };

/** Column layouts the populate agent writes into. */
export const ENTITY_COLUMNS: Record<EntityKind, Array<{ name: string; format?: ColumnFormat; width?: number }>> = {
	companies: [
		{ name: 'Company', width: 200 },
		{ name: 'Website', format: 'website', width: 170 },
		{ name: 'Description', width: 320 },
		{ name: 'Industry', width: 160 },
		{ name: 'Headquarters', width: 170 },
		{ name: 'Employees', format: 'number', width: 110 },
		{ name: 'Founded', format: 'year', width: 90 },
		{ name: 'Funding', format: 'currency', width: 160 },
		{ name: 'Stage', width: 110 },
	],
	people: [
		{ name: 'Name', width: 180 },
		{ name: 'Title', width: 200 },
		{ name: 'Company', width: 170 },
		{ name: 'Company website', format: 'website', width: 160 },
		{ name: 'Location', width: 170 },
		{ name: 'LinkedIn', format: 'url', width: 220 },
		{ name: 'Schools', width: 200 },
		{ name: 'Skills', width: 220 },
		{ name: 'Years of experience', format: 'number', width: 120 },
		{ name: 'Summary', width: 320 },
	],
	websites: [
		{ name: 'Webpage', format: 'webpage', width: 260 },
		{ name: 'Title', width: 260 },
		{ name: 'Description', width: 400 },
	],
};

/* ───────────────────────────── API contracts ───────────────────────────── */

export const EnrichRequestSchema = z.object({
	op: ColumnOpSchema,
	/** Column name → current cell value for the row. */
	row: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])),
	model: z.string().max(100).optional(),
	/** Stable per-cell retry key for providers that support idempotent execution. */
	idempotencyKey: z.string().min(8).max(128).optional(),
});

/** Why an enrichment failed. Set where the failure is understood; code branches on this, never on `error` text. */
export const FAILURE_REASONS = ['rate_limited', 'credits_exhausted', 'credential_missing', 'credential_invalid', 'timeout', 'provider_error', 'input_invalid'] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];
export type FailureProvider = 'openai' | 'monid' | 'treg' | 'context' | 'typesafe' | 'email';
export interface EnrichFailure {
	reason: FailureReason;
	/** The same request may succeed if repeated later without user action. */
	retryable: boolean;
	provider?: FailureProvider;
}

export interface EnrichResponse {
	value: CellValue;
	meta?: CellMeta;
	/** Human-readable explanation; presentation only. */
	error?: string;
	failure?: EnrichFailure;
}

export const ComposeColumnRequestSchema = z.object({
	ask: z.string().min(1).max(2000),
	dataProvider: DataProviderSchema.default('monid'),
	columns: z.array(z.object({ name: z.string(), type: z.enum(['source', 'enriched']), sample: z.string().optional() })).max(100),
	entity: z.enum(ENTITY_KINDS).optional(),
	hasJev: z.boolean().optional(),
	excludeFormula: z.boolean().optional(),
	model: z.string().max(100).optional(),
});
export type ComposeColumnRequest = z.input<typeof ComposeColumnRequestSchema>;

export type FormulaSuggestion = { kind: 'formula'; request: string };

export interface ComposeColumnResponse {
	name: string;
	op: ColumnOp | FormulaSuggestion;
	rationale?: string;
}

export interface KeyVerification {
	hunter?: { ok: boolean; configured: boolean; message?: string };
	prospeo?: { ok: boolean; configured: boolean; message?: string };
	openai: { ok: boolean; message?: string; issue?: 'key' | 'billing' | 'model' | 'rate-limit' | 'connection'; inference?: boolean };
	context: { ok: boolean; message?: string; credits?: number; issue?: 'key' | 'credits' };
	monid?: { ok: boolean; message?: string; balanceUsd?: number; issue?: 'key' | 'balance' };
	treg?: { ok: boolean; message?: string; balanceUsd?: number; issue?: 'key' | 'balance' | 'connection' };
	typesafe: { ok: boolean; message?: string; configured: boolean };
}

export const DEFAULT_MODEL = 'gpt-6-luna';
export const SUGGESTED_MODELS = [DEFAULT_MODEL, 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-4.1-mini', 'gpt-4.1'];
