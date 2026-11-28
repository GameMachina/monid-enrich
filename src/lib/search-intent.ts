import type { EntityKind, TableTypeDefinition } from './types';
import { promptEntity } from './populate-limit';
import { COUNTRY_OPTIONS } from './countries';

const TABLE_TYPE_INTENTS: Array<[string, RegExp]> = [
	['hs-code-activity', /\b(?:hs[ -]?codes?|customs codes?|tariff codes?)\b/i],
	['import-export-companies', /\b(?:importers?|exporters?|importing|exporting|import companies|export companies)\b/i],
	['tripadvisor-reviews', /\btrip ?advisor\b.{0,35}\breviews?\b|\breviews?\b.{0,35}\btrip ?advisor\b|\b(?:hotel|restaurant|attraction|travel)\s+reviews?\b/i],
	['mobile-app-reviews', /\b(?:app store|google play|mobile app|iphone app|android app)\b.{0,35}\breviews?\b|\breviews?\b.{0,35}\b(?:app store|google play|mobile app)\b/i],
	['software-reviews', /\b(?:g2|capterra|software|saas|crm)\b.{0,45}\breviews?\b|\breviews?\b.{0,45}\b(?:g2|capterra|software|saas)\b/i],
	['yelp-reviews', /\byelp\b.{0,35}\breviews?\b|\breviews?\b.{0,35}\byelp\b|\b(?:get|show|find|list)\s+(?:the\s+)?reviews?\s+for\b|\bbusiness reviews?\b/i],
	['tripadvisor-places', /\btrip ?advisor\b|\b(?:hotels?|attractions?|things to do)\b/i],
	['mobile-app-search', /\b(?:mobile apps?|apps? for (?:iphone|ios|android)|app store search|google play apps?)\b/i],
	['1688-wholesale-offers', /\b1688\b|\bwholesale offers?\b|\b(?:minimum order quantity|\bmoq\b)\b/i],
	['amazon-seller-offers', /\b(?:amazon sellers?|seller offers?|buy box)\b|\b[A-Z0-9]{10}\b/i],
	['amazon-product-search', /\bamazon\b.{0,45}\b(?:products?|listings?|prices?)\b|\b(?:products?|listings?)\b.{0,45}\bon amazon\b/i],
	['shopify-catalog', /\bshopify\b.{0,45}\b(?:catalog|store|products?)\b|\b(?:catalog|products?)\b.{0,45}\bshopify\b/i],
	['product-search', /\b(?:product search|products to buy|retail products?|product catalog|shopping for)\b/i],
	['creator-influencers', /\b(?:tiktok|tik tok|creators?|influencers?)\b/i],
	['nonprofit-organizations', /\b(?:non ?profits?|charities|charitable organizations|social enterprises|b corps?)\b/i],
	['suppliers-manufacturers', /\b(?:manufacturers?|industrial suppliers?|factories|contract manufacturers?)\b/i],
	['funding-rounds', /\b(?:funding rounds?|financing rounds?|series [abc]|pre[ -]?seed rounds?|seed rounds?|recent raises?)\b/i],
	['investor-deals', /\b(?:portfolio deals?|deals by investors?|investments made by|portfolio companies of)\b/i],
	['venture-funds', /\b(?:venture funds?|vc funds?|venture capital funds?|funds by stage)\b/i],
	['venture-investors', /\b(?:venture investors?|vc firms?|venture capital firms?|investment firms?|angel investors?)\b/i],
	['funded-companies', /\b(?:funded companies|funded startups|recently funded|recently raised|raised funding|raised money|companies that raised)\b/i],
	['properties-for-sale', /\b(?:homes?|properties|real estate)\b.{0,35}\b(?:for sale|to buy|purchase)\b|\b(?:for sale|homes to buy)\b/i],
	['rental-listings', /\b(?:rentals?|rental listings?|apartments? for rent|homes? for rent|to rent)\b/i],
	['real-estate-agents', /\b(?:real estate agents?|realtors?|brokerages?|property agents?)\b/i],
	['employer-career-jobs', /\b(?:jobs? at|open roles? at|career page|careers at|job listings?|job openings?)\b/i],
	['local-business-search', /\b(?:local businesses?|restaurants?|cafes?|coffee shops?|hotels?|plumbers?|dentists?|businesses near|businesses in)\b/i],
];

/** Resolve clear natural-language intent only to a currently published type. The selected menus remain an explicit override. */
export function inferTableTypeFromPrompt(query: string, available: readonly TableTypeDefinition[]): TableTypeDefinition | null {
	const text = query.trim();
	if (!text) return null;
	const peopleAreTheRequestedRows = promptEntity(text) === 'people' && /\b(?:at|inside|within|working for|employed by)\b/i.test(text);
	for (const [id, pattern] of TABLE_TYPE_INTENTS) {
		if (peopleAreTheRequestedRows && ['funding-rounds', 'funded-companies'].includes(id)) continue;
		if (id === 'yelp-reviews' && !/\byelp\b/i.test(text) && /\b(?:google|trip ?advisor|g2|capterra|app store|google play|amazon|product reviews?)\b/i.test(text)) continue;
		const match = available.find((item) => item.id === id && item.status === 'published');
		if (match && pattern.test(text)) return match;
	}
	const implied = promptEntity(text);
	if (!implied) return null;
	return available.find((item) => item.id === implied && item.status === 'published') ?? null;
}

const COUNTRY_ISO3: Record<string, string> = {
	'us': 'USA', 'u.s.': 'USA', 'united states': 'USA', america: 'USA',
	'uk': 'GBR', 'u.k.': 'GBR', 'united kingdom': 'GBR', britain: 'GBR',
	china: 'CHN', 'prc': 'CHN', canada: 'CAN', mexico: 'MEX', brazil: 'BRA',
	'india': 'IND', japan: 'JPN', germany: 'DEU', france: 'FRA', italy: 'ITA',
	'spain': 'ESP', australia: 'AUS', singapore: 'SGP', 'south korea': 'KOR', korea: 'KOR',
	'netherlands': 'NLD', holland: 'NLD', switzerland: 'CHE', sweden: 'SWE', norway: 'NOR',
	'denmark': 'DNK', ireland: 'IRL', poland: 'POL', turkey: 'TUR', 'united arab emirates': 'ARE', uae: 'ARE',
	'saudi arabia': 'SAU', thailand: 'THA', vietnam: 'VNM', indonesia: 'IDN', malaysia: 'MYS',
	'philippines': 'PHL', taiwan: 'TWN', 'hong kong': 'HKG', russia: 'RUS', ukraine: 'UKR',
	'south africa': 'ZAF', 'new zealand': 'NZL', nigeria: 'NGA', egypt: 'EGY', argentina: 'ARG', chile: 'CHL',
};

function countryCode(value: string | undefined) {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase().replace(/^the\s+/, '').replace(/[,.]+$/g, '');
	return COUNTRY_ISO3[normalized];
}

function tradeCountries(query: string) {
	const between = query.match(/\bfrom\s+([a-z .'-]+?)\s+to\s+([a-z .'-]+?)(?=\s+(?:during|over|in the last|in the past|between)\b|[,.;]|$)/i);
	if (between) return { origin: countryCode(between[1]), destination: countryCode(between[2]) };
	const imports = query.match(/\b(?:importers?|import(?:ing|ed|s)?)\b[\s\S]{0,100}?\b(?:into|in)\s+(?:the\s+)?([a-z .'-]+?)\s+from\s+(?:the\s+)?([a-z .'-]+?)(?=\s+(?:during|over|in the last|in the past)\b|[,.;]|$)/i);
	if (imports) return { destination: countryCode(imports[1]), origin: countryCode(imports[2]) };
	const intoFrom = query.match(/\binto\s+(?:the\s+)?([a-z .'-]+?)\s+from\s+(?:the\s+)?([a-z .'-]+?)(?=\s+(?:during|over|in the last|in the past)\b|[,.;]|$)/i);
	if (intoFrom) return { destination: countryCode(intoFrom[1]), origin: countryCode(intoFrom[2]) };
	const origin = query.match(/\bfrom\s+(?:the\s+)?([a-z .'-]+?)(?=\s+(?:during|over|in the last|in the past|to)\b|[,.;]|$)/i);
	return { origin: countryCode(origin?.[1]) };
}

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }

function inferredTradeDates(query: string, now: Date) {
	const end = isoDate(now);
	const range = query.match(/\b(?:last|past)\s+(\d+)\s+(days?|months?|years?)\b/i);
	const duration = query.match(/\b(?:last|past)\s+(?:year|12 months)\b/i);
	const start = new Date(now);
	if (range) {
		const amount = Number(range[1]);
		const unit = range[2]!.toLowerCase();
		if (unit.startsWith('day')) start.setUTCDate(start.getUTCDate() - amount);
		else if (unit.startsWith('month')) start.setUTCMonth(start.getUTCMonth() - amount);
		else start.setUTCFullYear(start.getUTCFullYear() - amount);
	} else if (duration || /\b(?:last year|past year|year to date|this year)\b/i.test(query)) {
		if (/\byear to date|this year\b/i.test(query)) start.setUTCMonth(0, 1);
		else start.setUTCFullYear(start.getUTCFullYear() - 1);
	} else {
		start.setUTCFullYear(start.getUTCFullYear() - 1);
	}
	return { start: isoDate(start), end, assumed: !range && !duration && !/\b(?:last year|past year|year to date|this year)\b/i.test(query) };
}

function locationFromPrompt(query: string) {
	const match = query.match(/\b(?:located\s+in|based\s+in|in|near|around)\s+(?:the\s+)?(.+?)(?=\s+(?:with|from|under|over|between|during|since|who|that|which|using|offering|for|and)\b|[,.;]|$)/i);
	return match?.[1]?.trim();
}

const COUNTRY_ALIASES: Record<string, string> = {
	'us': 'US', 'u.s.': 'US', usa: 'US', america: 'US', 'united states of america': 'US',
	'uk': 'GB', 'u.k.': 'GB', britain: 'GB', england: 'GB',
	'uae': 'AE', 'u.a.e.': 'AE',
};

/** Only add a hard country filter when the location phrase is an unambiguous country name/code. */
function countriesFromPrompt(query: string) {
	const explicit = query.match(/\b(?:in|located\s+in|based\s+in)\s+(?:the\s+)?(u\.?s\.?|usa|united states(?: of america)?|u\.?k\.?|united kingdom|britain|england|uae|u\.a\.e\.)\b/i)?.[1]?.toLowerCase();
	if (explicit && COUNTRY_ALIASES[explicit]) return [COUNTRY_ALIASES[explicit]!];
	const location = locationFromPrompt(query)?.toLowerCase().replace(/[()]/g, '').trim();
	if (!location) return [];
	const alias = COUNTRY_ALIASES[location];
	if (alias) return [alias];
	const country = COUNTRY_OPTIONS.find((item) => item.label.toLowerCase() === location || item.value.toLowerCase() === location);
	return country ? [country.value] : [];
}

function numberValue(value: string | undefined) {
	if (!value) return undefined;
	const parsed = Number(value.replaceAll(',', ''));
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Extract only explicit numeric constraints with a clear unit; provider schemas still validate the result. */
export function inferPromptConstraints(query: string) {
	const employee: { min?: number; max?: number } = {};
	const experience: { min?: number; max?: number } = {};
	const employeeUnit = '(?:employees?|people|staff|team members?|headcount|person companies)';
	const employeeRange = query.match(new RegExp(`\\b(?:between\\s+)?(\\d[\\d,]*)\\s*(?:-|–|to|and)\\s*(\\d[\\d,]*)\\s+${employeeUnit}\\b`, 'i'));
	if (employeeRange) {
		employee.min = numberValue(employeeRange[1]);
		employee.max = numberValue(employeeRange[2]);
	} else {
		const max = query.match(new RegExp(`\\b(?:under|below|fewer than|less than|up to)\\s+(\\d[\\d,]*)\\s+${employeeUnit}\\b`, 'i'));
		const min = query.match(new RegExp(`\\b(?:over|above|more than|at least|minimum of)\\s+(\\d[\\d,]*)\\s+${employeeUnit}\\b`, 'i'));
		if (max) employee.max = numberValue(max[1]);
		if (min) employee.min = numberValue(min[1]);
	}
	const experienceRange = query.match(/\b(?:between\s+)?(\d{1,3})\s*(?:-|–|to|and)\s*(\d{1,3})\s+years?\s+(?:of\s+)?experience\b/i);
	if (experienceRange) {
		experience.min = numberValue(experienceRange[1]);
		experience.max = numberValue(experienceRange[2]);
	} else {
		const max = query.match(/\b(?:under|below|less than|up to)\s+(\d{1,3})\s+years?\s+(?:of\s+)?experience\b/i);
		const min = query.match(/\b(?:over|above|more than|at least|minimum of)\s+(\d{1,3})\s+years?\s+(?:of\s+)?experience\b/i);
		if (max) experience.max = numberValue(max[1]);
		if (min) experience.min = numberValue(min[1]);
	}
	return {
		employeesMin: employee.min,
		employeesMax: employee.max,
		yearsOfExperienceMin: experience.min,
		yearsOfExperienceMax: experience.max,
	};
}

function shopifyStoreFromPrompt(query: string) {
	const domain = query.match(/(?:https?:\/\/)?([a-z0-9-]+)\.myshopify\.com\b/i)?.[1];
	if (domain) return domain;
	return query.match(/\b(?:shopify\s+store|storefront|catalog)\s+(?:for|from|named|called)\s+([a-z0-9-]+)\b/i)?.[1];
}

function atsDetails(query: string) {
	const greenhouse = query.match(/(?:https?:\/\/)?boards\.greenhouse\.io\/([a-z0-9_-]+)/i);
	if (greenhouse) return { ats: 'greenhouse', board: greenhouse[1] };
	const lever = query.match(/(?:https?:\/\/)?jobs\.lever\.co\/([a-z0-9_-]+)/i);
	if (lever) return { ats: 'lever', board: lever[1] };
	const provider = /\bgreenhouse\b/i.test(query) ? 'greenhouse' : /\blever\b/i.test(query) ? 'lever' : undefined;
	const board = query.match(/\b(?:board|company)\s+(?:is\s+)?([a-z0-9_-]+)\b/i)?.[1];
	return { ats: provider, board };
}

/** Populate provider-required fields from the user's words; assumptions are surfaced beside the prompt. */
export function inferTableTypeInputs(definition: TableTypeDefinition, query: string, now = new Date()) {
	const inputs: Record<string, string> = {};
	const assumptions: string[] = [];
	const assign = (key: string, value: string | undefined, assumption?: string) => {
		if (value) { inputs[key] = value; if (assumption) assumptions.push(assumption); }
	};
	const text = query.trim();
	const constraints = inferPromptConstraints(text);
	if (definition.entity === 'companies' && (constraints.employeesMin !== undefined || constraints.employeesMax !== undefined)) {
		const range = constraints.employeesMin !== undefined && constraints.employeesMax !== undefined
			? `between ${constraints.employeesMin} and ${constraints.employeesMax}`
			: constraints.employeesMin !== undefined ? `at least ${constraints.employeesMin}` : `up to ${constraints.employeesMax}`;
		assumptions.push(`Applying the employee range ${range} from your prompt.`);
	}
	if (definition.entity === 'people' && (constraints.yearsOfExperienceMin !== undefined || constraints.yearsOfExperienceMax !== undefined)) {
		const range = constraints.yearsOfExperienceMin !== undefined && constraints.yearsOfExperienceMax !== undefined
			? `between ${constraints.yearsOfExperienceMin} and ${constraints.yearsOfExperienceMax}`
			: constraints.yearsOfExperienceMin !== undefined ? `at least ${constraints.yearsOfExperienceMin}` : `up to ${constraints.yearsOfExperienceMax}`;
		assumptions.push(`Applying ${range} years of experience stated in your prompt.`);
	}
	if (definition.entity === 'people' && (constraints.employeesMin !== undefined || constraints.employeesMax !== undefined)) assumptions.push('Company size remains in the natural-language search prompt; this people source has no separate company-size filter.');
	const countryCodes = countriesFromPrompt(text);
	if (countryCodes.length && ['companies', 'people', 'websites'].includes(definition.id)) {
		const countryName = COUNTRY_OPTIONS.find((country) => country.value === countryCodes[0])?.label ?? countryCodes[0];
		assumptions.push(`Applying a ${countryName} country filter from your prompt.`);
	}

	switch (definition.id) {
		case 'local-business-search':
			assign('source', /\byelp\b/i.test(text) ? 'yelp' : 'google-maps', /\byelp\b/i.test(text) ? undefined : 'Using Google Maps for local business results.');
			assign('location', locationFromPrompt(text));
			break;
		case 'yelp-reviews': {
			const url = text.match(/https?:\/\/www?\.?yelp\.com\/biz\/[^\s)]+/i)?.[0]?.replace(/[.,;]+$/, '');
			assign('business-url', url);
			assign('location', locationFromPrompt(text));
			if (!/\byelp\b/i.test(text)) assumptions.push('Using Yelp as the business-review source.');
			break;
		}
		case 'tripadvisor-reviews':
			assign('place-id', text.match(/\b(?:place\s*id|location\s*id)\s*[:#]?\s*(\d+)\b/i)?.[1]);
			if (!/\btrip ?advisor\b/i.test(text)) assumptions.push('Using Tripadvisor as the hospitality-review source.');
			break;
		case 'shopify-catalog':
			assign('store', shopifyStoreFromPrompt(text));
			break;
		case 'properties-for-sale':
		case 'rental-listings':
		case 'real-estate-agents':
			assign('location', locationFromPrompt(text));
			break;
		case 'import-export-companies':
		case 'hs-code-activity': {
			const direction = /\b(?:exporters?|export(?:ing|ed|s)?)\b/i.test(text) ? 'exports' : 'imports';
			assign('trade-direction', direction, /\b(?:importers?|import(?:ing|ed|s)?|exporters?|export(?:ing|ed|s)?)\b/i.test(text) ? undefined : 'Assuming imports; change this under Refine if you meant exports.');
			const dates = inferredTradeDates(text, now);
			assign('date-start', dates.start);
			assign('date-end', dates.end);
			if (dates.assumed) assumptions.push('Using the most recent 12 months because no date range was specified.');
			const countries = tradeCountries(text);
			assign('country-origin', countries.origin);
			assign('country-destination', countries.destination);
			assign('hs-code', text.match(/\b(?:hs[ -]?code)\s*[:#]?\s*(\d{2,10})\b/i)?.[1]);
			break;
		}
		case 'mobile-app-search':
		case 'mobile-app-reviews': {
			const storefront = /\b(?:google play|android)\b/i.test(text) ? 'google' : 'apple';
			assign('storefront', storefront, /\b(?:google play|android|app store|ios|iphone)\b/i.test(text) ? undefined : `Assuming the ${storefront === 'google' ? 'Google Play' : 'Apple App Store'}; change it under Refine if needed.`);
			assign('country', text.match(/\b(?:storefront|country)\s+(?:is\s+)?([a-z]{2})\b/i)?.[1]?.toLowerCase());
			assign('app-id', text.match(/\b(?:app\s*id|package\s*id)\s*[:#]?\s*([a-z0-9._-]{3,200})\b/i)?.[1]);
			break;
		}
		case 'amazon-product-search':
		case 'amazon-seller-offers': {
			const asksForOtherMarketplace = /\b(?:amazon\s+(?:uk|u\.k\.|ca|canada|de|germany|fr|japan|au|australia)|(?:uk|canada|germany|france|japan|australia)\s+amazon)\b/i.test(text);
			if (!asksForOtherMarketplace) assign('marketplace', 'us', 'Searching Amazon US, the currently supported marketplace.');
			assign('asin', text.match(/\b[A-Z0-9]{10}\b/i)?.[0]?.toUpperCase());
			break;
		}
		case 'software-reviews':
			assign('source', /\bcapterra\b/i.test(text) ? 'capterra' : 'g2', /\b(?:g2|capterra)\b/i.test(text) ? undefined : 'Using G2 for software reviews.');
			assign('product-slug', text.match(/\b(?:g2\s+slug|product\s+slug)\s*[:=]\s*([a-z0-9-]+)/i)?.[1]);
			assign('product-id', text.match(/\b(?:capterra\s+)?product\s*id\s*[:=#]?\s*(\d+)\b/i)?.[1]);
			break;
		case 'employer-career-jobs': {
			const ats = atsDetails(text);
			assign('ats', ats.ats);
			assign('board', ats.board);
			assign('location', locationFromPrompt(text));
			break;
		}
		case 'funding-rounds': {
			const round = text.match(/\b(pre[ -]?seed|seed|series\s*[abc])\b/i)?.[1]?.toLowerCase().replace(/\s+/g, '_').replace('-', '_');
			assign('round-type', round);
			assign('date-start', text.match(/\b(?:since|after)\s+(20\d{2}-\d{2}-\d{2})\b/i)?.[1]);
			assign('date-end', text.match(/\b(?:until|before)\s+(20\d{2}-\d{2}-\d{2})\b/i)?.[1]);
			{
				const size = text.match(/\b(?:over|above|at least)\s+\$?([\d,.]+)\s*(million|m|billion|b)?\b/i);
				if (size) {
					const amount = Number(size[1]!.replaceAll(',', ''));
					const multiplier = /^b/i.test(size[2] ?? '') ? 1_000_000_000 : /^m/i.test(size[2] ?? '') ? 1_000_000 : 1;
					assign('min-size', String(amount * multiplier));
				}
			}
			break;
		}
		case 'venture-funds':
			assign('stage', text.match(/\b(pre[ -]?seed|seed|series\s*[abc]|late[- ]stage|growth)\b/i)?.[1]?.toLowerCase().replace(/\s+/g, '_').replace('-', '_'));
			assign('country', locationFromPrompt(text));
			break;
		case 'investor-deals': {
			const domain = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})(?:\/[^\s]*)?/i)?.[1];
			assign('investor-domain', domain?.toLowerCase());
			break;
		}
	}

	return { inputs, assumptions: [...new Set(assumptions)] };
}

export function naturalSearchEntity(type: TableTypeDefinition | null, query: string, fallback: EntityKind): EntityKind {
	if (type) return type.entity as EntityKind;
	return promptEntity(query) ?? fallback;
}

export function inferredCountriesFromPrompt(query: string) {
	return countriesFromPrompt(query);
}
