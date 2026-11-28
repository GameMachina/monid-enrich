import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { foundRowKey } from '../found-rows';
import type { CellValue, FoundRow, PopulateEvent, PopulateRequest, TableTypeDefinition } from '../types';
import { TABLE_TYPE_ADAPTERS, tableTypeInputError, tableTypeRowLimit, tableTypeRunnableError } from '../table-types';
import type { ProviderAccess } from './provider-access';
import { runMonidOperation, type MonidInput, type MonidOperationName, type MonidRun } from './monid';

const positiveInt = (max = 10000) => z.number().int().min(0).max(max);
const operationSchemas: Partial<Record<MonidOperationName, z.ZodType<MonidInput>>> = {
	'table.1688.search': z.object({ body: z.object({ query: z.string().trim().min(1).max(500), beginPage: z.number().int().min(1), pageSize: z.number().int().min(1).max(60), language: z.literal('en'), currency: z.literal('USD'), exactMatch: z.boolean().optional() }).strict() }).strict(),
	'table.channel3.search': z.object({ body: z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(30), page_token: z.string().max(1000).optional() }).strict() }).strict(),
	'table.shopify.products': z.object({ queryParams: z.object({ store: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/), page: z.number().int().min(1).max(1000), limit: z.number().int().min(1).max(250) }).strict() }).strict(),
	'table.yelp.search': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(500), location: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(50) }).strict() }).strict(),
	'table.yelp.reviews': z.object({ body: z.object({ url: z.string().url().refine((value) => { const parsed = new URL(value); return ['yelp.com', 'www.yelp.com'].includes(parsed.hostname) && parsed.pathname.startsWith('/biz/'); }), limit: z.number().int().min(1).max(10), page_token: z.string().max(1000).optional() }).strict() }).strict(),
	'table.google.maps': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(500), depth: z.number().int().min(1).max(700), location_name: z.string().trim().min(1).max(200).optional(), location_code: z.number().int().positive().optional(), location_coordinate: z.string().trim().min(1).max(120).optional(), language_name: z.string().trim().min(1).max(80).optional(), language_code: z.string().trim().min(2).max(8).optional() }).strict() }).strict(),
	'table.greenhouse.jobs': z.object({ queryParams: z.object({ board: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), q: z.string().trim().min(1).max(300).optional(), location: z.string().trim().min(1).max(200).optional(), page: z.number().int().min(1).max(1000), limit: z.number().int().min(1).max(100), include_content: z.boolean() }).strict() }).strict(),
	'table.lever.jobs': z.object({ queryParams: z.object({ company: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), skip: z.number().int().min(0).max(100000), limit: z.number().int().min(1).max(100) }).strict() }).strict(),
	'table.homes.agents': z.object({ queryParams: z.object({ location: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.googleplay.search': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(300), depth: z.number().int().min(1).max(200), location_name: z.string().trim().min(1).max(100).optional(), language_name: z.string().trim().min(1).max(80).optional() }).strict() }).strict(),
	'table.appstore.search': z.object({ queryParams: z.object({ term: z.string().trim().min(1).max(300), country: z.string().regex(/^[a-z]{2}$/), num: z.number().int().min(1).max(200), device: z.literal('mobile') }).strict() }).strict(),
	'table.googleplay.reviews': z.object({ body: z.object({ app_id: z.string().trim().min(3).max(200), depth: z.number().int().min(1).max(1000), location_name: z.string().trim().min(1).max(100), language_name: z.string().trim().min(1).max(80), sort_by: z.enum(['newest', 'most_relevant']) }).strict() }).strict(),
	'table.appstore.reviews': z.object({ queryParams: z.object({ product_id: z.string().regex(/^\d{5,20}$/), country: z.string().regex(/^[a-z]{2}$/), sort: z.enum(['mostrecent', 'mosthelpful']), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.fundable.companies': z.object({ body: z.object({ company: z.object({ search_query: z.string().trim().min(1).max(500), min_relevance: z.number().min(0).max(1).optional() }).strict(), page: z.number().int().min(0).max(1000), page_size: z.number().int().min(1).max(50), sort_by: z.enum(['most_recent_raise', 'oldest_raise', 'most_recent_founded', 'oldest_founded', 'largest_valuation', 'smallest_valuation', 'largest_total_raise', 'smallest_total_raise', 'most_funding_rounds', 'most_investors']) }).strict() }).strict(),
	'table.fundable.investors': z.object({ body: z.object({ company_investments: z.object({ search_query: z.string().trim().min(1).max(500), min_relevance: z.number().min(0).max(1).optional() }).strict(), page: z.number().int().min(0).max(1000), page_size: z.number().int().min(1).max(50), sort_by: z.enum(['most_recent_deal', 'recent_deals', 'deals_led_ltm', 'total_deals', 'matching_deals']) }).strict() }).strict(),
	'table.thomasnet.search': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(200) }).strict() }).strict(),
	'table.tendata.importers': z.object({ body: z.object({ pageNo: z.number().int().min(1), pageSize: z.number().int().min(1).max(100), catalog: z.enum(['imports', 'exports']), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), productDesc: z.string().trim().min(1).max(500), hsCode: z.string().regex(/^\d{2,10}$/).optional(), countryOfOriginCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional(), countryOfDestinationCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional(), filterBlankFields: z.array(z.enum(['importer', 'exporter'])).optional(), filterLogisticFields: z.array(z.enum(['importer', 'exporter'])).optional() }).strict() }).strict(),
	'table.tendata.exporters': z.object({ body: z.object({ pageNo: z.number().int().min(1), pageSize: z.number().int().min(1).max(100), catalog: z.enum(['imports', 'exports']), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), productDesc: z.string().trim().min(1).max(500), hsCode: z.string().regex(/^\d{2,10}$/).optional(), countryOfOriginCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional(), countryOfDestinationCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional(), filterBlankFields: z.array(z.enum(['importer', 'exporter'])).optional(), filterLogisticFields: z.array(z.enum(['importer', 'exporter'])).optional() }).strict() }).strict(),
	'table.tendata.hs-code': z.object({ body: z.object({ pageNo: z.number().int().min(1), pageSize: z.number().int().min(1).max(100), catalog: z.enum(['imports', 'exports']), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), productDesc: z.string().trim().min(1).max(500), countryOfOriginCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional(), countryOfDestinationCode: z.string().regex(/^[A-Z]{3}(?:;[A-Z]{3})*$/).optional() }).strict() }).strict(),
	'table.tiktok.search': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(500) }).strict() }).strict(),
	'table.g2.search-software': z.object({ queryParams: z.object({ query: z.string().trim().min(1).max(300) }).strict() }).strict(),
	'table.g2.reviews': z.object({ queryParams: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/i), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.capterra.search-software': z.object({ queryParams: z.object({ query: z.string().trim().min(1).max(300) }).strict() }).strict(),
	'table.capterra.reviews': z.object({ queryParams: z.object({ product_id: z.string().regex(/^\d{1,12}$/), product_name: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.amazon.products': z.object({ body: z.object({ keyword: z.string().trim().min(1).max(500), depth: z.number().int().min(1).max(336), max_crawl_pages: z.number().int().min(1).max(7), location_name: z.literal('United States'), language_name: z.literal('English (United States)') }).strict() }).strict(),
	'table.amazon.sellers': z.object({ body: z.object({ asin: z.string().regex(/^[A-Z0-9]{10}$/i), location_name: z.literal('United States'), language_name: z.literal('English (United States)') }).strict() }).strict(),
	'table.fundable.investor-deals': z.object({ queryParams: z.object({ domain: z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i), page: z.number().int().min(0).max(1000), page_size: z.number().int().min(1).max(50) }).strict() }).strict(),
	'table.fundable.deals': z.object({ body: z.object({ deal: z.object({ financing_types: z.array(z.object({ type: z.enum(['SERIES_A', 'SERIES_B', 'SERIES_C', 'SEED']), pre: z.boolean().optional(), extension: z.boolean().optional() }).strict()).min(1).max(4), date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), size_min: z.number().nonnegative().optional() }).strict(), company: z.object({ locations: z.array(z.string().trim().min(1).max(120)).min(1).max(10).optional(), industries: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(), employee_count: z.array(z.enum(['1-10', '11-50', '51-100', '101-250', '251-500', '501-1000', '1001-5000', '5001-10000', '10001+'])).min(1).max(9).optional() }).strict().optional(), page: z.number().int().min(0).max(1000), page_size: z.number().int().min(1).max(50), sort_by: z.enum(['most_recent_deal', 'oldest_deal', 'largest_raise', 'smallest_raise']) }).strict() }).strict(),
	'table.tripadvisor.search': z.object({ queryParams: z.object({ q: z.string().trim().min(1).max(500), num: z.number().int().min(1).max(30), start: positiveInt(10000) }).strict() }).strict(),
	'table.tripadvisor.reviews': z.object({ queryParams: z.object({ place_id: z.string().regex(/^\d+$/), num: z.number().int().min(1).max(50), start: positiveInt(10000) }).strict() }).strict(),
	'table.idealist.organizations': z.object({ queryParams: z.object({ q: z.string().trim().min(1).max(500), page: z.number().int().min(0).max(49), location: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/).optional(), org_type: z.enum(['NONPROFIT', 'SOCIAL_ENTERPRISE', 'B_CORP']).optional() }).strict() }).strict(),
	'table.zillow.sale': z.object({ queryParams: z.object({ location: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.zillow.rent': z.object({ queryParams: z.object({ location: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(1000) }).strict() }).strict(),
	'table.fundmomentum.funds': z.object({ queryParams: z.object({ stage: z.enum(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'late_stage', 'growth']).optional(), country: z.string().trim().min(1).max(100).optional(), industry: z.string().trim().min(1).max(80).optional(), limit: z.number().int().min(1).max(50), offset: positiveInt(1000) }).strict() }).strict(),
};

/** Validate every app-built argument against the schema inspected from Monid before endpoint dispatch. */
export function validateTableOperationInput(operation: string, input: unknown): MonidInput {
	const schema = operationSchemas[operation as MonidOperationName];
	if (!schema) throw new Error('This Monid table operation has no inspected input schema in the trusted runner.');
	const result = schema.safeParse(input);
	if (!result.success) throw new Error(`Invalid inputs for ${operation}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
	return result.data;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const first = (source: Obj, ...keys: string[]) => { for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key]; return undefined; };
const str = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const stringArray = (value: unknown): string[] | null => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : typeof item === 'number' ? String(item) : null).filter((item): item is string => item !== null) : null;
const cell = (value: unknown): CellValue => {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
	if (Array.isArray(value)) return stringArray(value) ?? JSON.stringify(value);
	if (value && typeof value === 'object') return JSON.stringify(value);
	return null;
};
function listAt(output: unknown, ...keys: string[]): Obj[] {
	const visit = (value: unknown, depth: number): Obj[] | null => {
		if (depth > 7 || !value || typeof value !== 'object') return null;
		if (Array.isArray(value)) {
			for (const item of value) { const nested = visit(item, depth + 1); if (nested) return nested; }
			return null;
		}
		const record = value as Obj;
		for (const key of keys) if (Array.isArray(record[key])) return (record[key] as unknown[]).map(obj);
		for (const nestedValue of Object.values(record)) { const nested = visit(nestedValue, depth + 1); if (nested) return nested; }
		return null;
	};
	return visit(output, 0) ?? [];
}

function stableKey(...values: unknown[]) {
	return createHash('sha256').update(values.map((value) => String(value ?? '').trim().toLocaleLowerCase()).join('\u0000')).digest('hex').slice(0, 32);
}

function countryName(value?: string) {
	const code = value?.trim().toUpperCase() || 'US';
	return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
}

function map1688(offer: Obj): FoundRow {
	const price = obj(offer.price);
	const offerId = str(first(offer, 'offerId', 'offer_id', 'id'));
	const productUrl = str(first(offer, 'landingUrl', 'productUrl', 'product_url', 'url'));
	const supplier = str(first(offer, 'companyName', 'supplier', 'supplierName'));
	const sku = str(first(offer, 'skuId', 'sku', 'sku_id'));
	const title = str(first(offer, 'title', 'name'));
	const priceText = str(first(price, 'formatted', 'range', 'text') ?? first(offer, 'priceRange', 'price_range', 'price'));
	const offerKey = offerId ? `1688:${offerId}` : productUrl ? `1688:${productUrl}` : [supplier, sku, title].some(Boolean) ? `1688:${stableKey(supplier, sku, title, priceText)}` : null;
	return {
		'Offer key': offerKey,
		'Offer ID': offerId,
		Title: title,
		Supplier: supplier,
		'Offer type': str(first(offer, 'offerType', 'type')),
		SKU: sku,
		'Minimum order quantity': cell(first(offer, 'moq', 'minimumOrderQuantity', 'minimum_order_quantity')),
		'Units sold': str(first(offer, 'sales', 'unitsSold')),
		Rating: num(first(offer, 'starLevel', 'rating')),
		'Review count': num(first(offer, 'reviewCount', 'review_count', 'reviewsCount', 'reviews_count')),
		Price: priceText,
		'Price range': str(first(offer, 'priceRange', 'price_range') ?? first(price, 'range')),
		'Price in CNY': num(first(offer, 'priceInYuan', 'price_in_yuan')),
		Stock: cell(first(offer, 'stock', 'stockQuantity', 'stock_quantity', 'inventory', 'availability')),
		'Supplier location': str(first(offer, 'supplierLocation', 'supplier_location', 'companyAddress', 'location', 'address')),
		Image: str(first(offer, 'image', 'imageUrl')),
		'Product URL': productUrl,
		'Supplier URL': str(first(offer, 'winportUrl', 'supplierUrl', 'supplier_url')),
	};
}
function mapYelpBusiness(item: Obj): FoundRow {
	const address = obj(item.address);
	const displayAddress = first(item, 'display_address', 'address1') ?? (typeof item.address === 'string' ? item.address : undefined) ?? first(address, 'formatted', 'address1');
	return {
		'Business ID': str(first(item, 'id', 'business_id')),
		Business: str(first(item, 'name', 'business_name')),
		'Business URL': str(first(item, 'url', 'business_url')),
		Rating: num(item.rating),
		'Review count': num(first(item, 'review_count', 'reviewCount')),
		'Price range': str(first(item, 'price_range', 'price')),
		Categories: cell(first(item, 'categories', 'category')),
		Image: str(first(item, 'image_url', 'image')),
		Phone: str(item.phone),
		Website: str(item.website),
		Cuisine: str(item.cuisine),
		Description: str(item.description),
		Address: str(displayAddress),
		City: str(item.city),
		Region: str(first(item, 'region', 'state')),
		'Postal code': str(first(item, 'postal_code', 'zip_code')),
		Country: str(item.country),
		Verified: bool(first(item, 'is_verified', 'verified')),
	};
}
function mapLocalBusiness(item: Obj, provider: 'yelp' | 'google-maps'): FoundRow {
	if (provider === 'yelp') {
		const row = mapYelpBusiness(item);
		const id = str(row['Business ID']);
	const url = str(row['Business URL']);
	return { 'Business key': id ? `yelp:${id}` : url ? `yelp:${url}` : null, Provider: 'Yelp', 'Provider ID': id, Business: row.Business, Category: row.Categories, Address: row.Address, Phone: row.Phone, Website: row.Website, 'Business URL': url, Rating: row.Rating, 'Review count': row['Review count'], 'Price level': row['Price range'], Hours: null, Latitude: null, Longitude: null, Image: row.Image, 'Price range': row['Price range'], Categories: row.Categories, Cuisine: row.Cuisine, Description: row.Description, City: row.City, Region: row.Region, 'Postal code': row['Postal code'], Country: row.Country, Verified: row.Verified };
	}
	const id = str(first(item, 'place_id', 'placeId', 'cid', 'data_id', 'id'));
	const url = str(first(item, 'url', 'place_url'));
	const location = obj(first(item, 'gps_coordinates', 'coordinates'));
	return {
		'Business key': id ? `google-maps:${id}` : url ? `google-maps:${url}` : null, Provider: 'Google Maps', 'Provider ID': id,
		Business: str(first(item, 'title', 'name')), Category: str(first(item, 'category', 'type')),
		Address: str(first(item, 'address', 'address_raw')), Phone: str(first(item, 'phone', 'phone_number')),
		Website: str(first(item, 'website', 'domain')), 'Business URL': url,
		Rating: num(first(item, 'rating', 'stars')), 'Review count': num(first(item, 'reviews_count', 'review_count')),
		'Price level': str(first(item, 'price', 'price_level')), Hours: cell(first(item, 'work_hours', 'hours')),
		Latitude: num(first(location, 'latitude') ?? item.latitude), Longitude: num(first(location, 'longitude') ?? item.longitude),
		Image: str(first(item, 'thumbnail', 'image')), 'Price range': null, Categories: cell(first(item, 'categories', 'category')),
		Cuisine: null, Description: str(first(item, 'description', 'snippet')), City: str(first(item, 'city')),
		Region: str(first(item, 'state', 'region')), 'Postal code': str(first(item, 'postal_code', 'zip')),
		Country: str(first(item, 'country')), Verified: bool(first(item, 'verified', 'is_verified')),
	};
}
function mapYelpReview(item: Obj, business: { name?: string; url?: string }): FoundRow {
	const review = str(first(item, 'text', 'review'));
	const date = str(first(item, 'posted_at', 'date', 'time_created'));
	const reviewer = str(first(item, 'author_name', 'reviewer_name', 'user_name'));
	const reviewId = str(first(item, 'id', 'review_id')) ?? ([review, date, reviewer].some(Boolean) ? stableKey(business.url, reviewer, date, review) : null);
	return { 'Review ID': reviewId, Rating: num(item.rating), Review: review, Date: date, Reviewer: reviewer, Business: str(first(item, 'business_name') ?? business.name), 'Business URL': str(first(item, 'business_url') ?? business.url), 'Helpful votes': num(first(item, 'useful_count', 'helpful_count')), 'Photo count': num(first(item, 'photo_count', 'photos_count')) };
}
function mapTripadvisorReview(item: Obj, place: { id?: string; name?: string; url?: string }): FoundRow {
	const title = str(first(item, 'title', 'headline'));
	const review = str(first(item, 'text', 'review', 'snippet'));
	const date = str(first(item, 'published_date', 'date', 'published_at'));
	const reviewer = str(first(item, 'user', 'username', 'reviewer', 'author'));
	const reviewKey = [review, date, title, reviewer].some(Boolean) ? stableKey(place.id, reviewer, date, title, review) : null;
	return { 'Review key': reviewKey, Title: title, Review: review, Rating: num(first(item, 'rating', 'bubble_rating')), Date: date, 'Trip type': str(first(item, 'trip_type', 'tripType')), Reviewer: reviewer, Place: str(first(item, 'place_name', 'business_name') ?? place.name), 'Place ID': str(first(item, 'place_id', 'location_id') ?? place.id), 'Place URL': str(first(item, 'place_url', 'url') ?? place.url) };
}
function mapProduct(item: Obj): FoundRow {
	const offers = Array.isArray(item.offers) ? item.offers.map(obj) : [];
	const offer = offers[0] ?? {};
	return {
		'Product ID': str(first(item, 'id', 'product_id')),
		Title: str(first(item, 'title', 'name')),
		Description: str(item.description),
		Brand: str(first(item, 'brand', 'brand_name')),
		Category: str(first(item, 'category', 'category_name')),
		'Product URL': str(first(item, 'url', 'product_url', 'canonical_url') ?? first(offer, 'url', 'buy_url')),
		Image: str(first(item, 'image_url', 'image') ?? (Array.isArray(item.images) ? item.images[0] : undefined)),
		Price: str(first(offer, 'price', 'formatted_price') ?? first(item, 'price')),
		Availability: str(offer.availability) ?? (typeof offer.in_stock === 'boolean' ? (offer.in_stock ? 'In stock' : 'Out of stock') : null),
		Condition: str(offer.condition),
		Rating: num(first(item, 'rating', 'average_rating')),
		'Review count': num(first(item, 'review_count', 'reviews_count')),
		Variants: cell(first(item, 'variants', 'variant_count')),
		Retailer: str(first(offer, 'website_name', 'retailer', 'merchant')),
	};
}
function mapShopifyProduct(item: Obj): FoundRow {
	const variants = Array.isArray(item.variants) ? item.variants.map(obj) : [];
	const firstVariant = variants[0] ?? {};
	const images = Array.isArray(item.images) ? item.images.map((image) => typeof image === 'string' ? image : str(first(obj(image), 'src', 'url'))).filter((value): value is string => Boolean(value)) : [];
	return { 'Product URL': str(first(item, 'url', 'online_store_url') ?? (typeof item.handle === 'string' ? `https://${String(item.__store ?? '')}/products/${item.handle}` : undefined)), 'Product ID': str(item.id), Title: str(item.title), Description: str(item.description), Vendor: str(item.vendor), 'Product type': str(first(item, 'product_type', 'type')), Handle: str(item.handle), Images: images, Variants: variants.map((variant) => [str(variant.title), str(variant.price)].filter(Boolean).join(' · ')), Price: str(first(firstVariant, 'price') ?? item.price), Availability: str(first(firstVariant, 'available', 'inventory_quantity')) };
}
function mapTripadvisorPlace(item: Obj): FoundRow {
	const loc = obj(first(item, 'location', 'address'));
	return { 'Place ID': str(first(item, 'place_id', 'id')), Place: str(first(item, 'name', 'title')), Type: str(first(item, 'place_type', 'type')), Rating: num(item.rating), 'Review count': num(first(item, 'review_count', 'reviews_count')), Location: str(first(item, 'location_string', 'location') ?? first(loc, 'name', 'formatted_address')), Address: str(first(item, 'address', 'address_string') ?? first(loc, 'address')), 'Place URL': str(first(item, 'url', 'web_url')) };
}
function mapNonprofit(item: Obj): FoundRow {
	return { 'Organization ID': str(first(item, 'objectID', 'id')), Organization: str(first(item, 'name', 'organization_name')), City: str(item.city), Type: str(first(item, 'orgType', 'org_type')), Description: str(item.description), Hiring: bool(first(item, 'hiring', 'is_hiring')) };
}
function mapProperty(item: Obj, rental: boolean): FoundRow {
	const address = obj(item.address);
	return { 'Property ID': str(first(item, 'zpid', 'id')), 'Property URL': str(first(item, 'detailUrl', 'url', 'homeUrl')), Address: str(first(item, 'address', 'streetAddress') ?? first(address, 'streetAddress', 'formatted')), Price: cell(first(item, 'price', 'priceLabel')), Beds: num(first(item, 'beds', 'bedrooms')), Baths: num(first(item, 'baths', 'bathrooms')), Area: num(first(item, 'area', 'livingArea', 'sqft')), Estimate: cell(first(item, 'zestimate', 'rentZestimate')), Availability: str(first(item, 'availabilityDate', 'availability')), Building: bool(first(item, 'isBuilding')), Units: cell(item.units), 'Listing type': rental ? 'Rental' : 'For sale' };
}
function mapFund(item: Obj): FoundRow {
	return { 'Fund URL': str(first(item, 'url', 'profileUrl') ?? (typeof item.slug === 'string' ? `https://fundmomentum.vc/funds/${item.slug}` : undefined)), Fund: str(item.name), Country: str(item.country), Stages: cell(first(item, 'fundingStages', 'fundingStage')), 'Fund size': str(item.fundSize), Website: str(item.website), 'Last close date': str(item.lastCloseDate), 'Last close type': str(item.lastCloseType), Industries: cell(item.industries) };
}

function mapApp(item: Obj, store: 'Apple App Store' | 'Google Play'): FoundRow {
	const id = str(first(item, 'trackId', 'app_id', 'appId', 'id'));
	const url = str(first(item, 'trackViewUrl', 'url', 'app_url', 'link'));
	return { 'App ID': id, App: str(first(item, 'trackName', 'title', 'name')), Store: store, Developer: str(first(item, 'artistName', 'developer', 'developer_name')), Category: str(first(item, 'primaryGenreName', 'category', 'genre')), Rating: num(first(item, 'averageUserRating', 'rating')), 'Rating count': num(first(item, 'userRatingCount', 'rating_count', 'ratings_count')), Price: str(first(item, 'formattedPrice', 'price')), Icon: str(first(item, 'artworkUrl512', 'icon', 'image')), Description: str(first(item, 'description', 'snippet')), 'App URL': url };
}
function mapAppReview(item: Obj, app: { id: string; store: 'Apple App Store' | 'Google Play' }): FoundRow {
	const review = str(first(item, 'content', 'text', 'review'));
	const date = str(first(item, 'at', 'date', 'review_date', 'published_at'));
	const reviewer = str(first(item, 'userName', 'author', 'reviewer', 'user_name'));
	const reviewKey = review || reviewer || date ? stableKey(app.store, app.id, reviewer, date, review) : null;
	return { 'Review key': reviewKey, 'App ID': app.id, Store: app.store, Rating: num(first(item, 'score', 'rating')), Title: str(first(item, 'title', 'review_title')), Review: review, Date: date, Reviewer: reviewer, 'App version': str(first(item, 'version', 'app_version')), 'Helpful votes': num(first(item, 'thumbsUpCount', 'helpful_count')), 'Developer reply': str(first(item, 'replyContent', 'developer_reply')) };
}
function mapJob(item: Obj, board: string): FoundRow {
	const id = str(first(item, 'id', 'job_id', 'requisition_id'));
	const location = first(item, 'location', 'location_name');
	return { 'Job ID': id, Title: str(first(item, 'title', 'text')), 'Job URL': str(first(item, 'absolute_url', 'hostedUrl', 'url', 'apply_url')), Company: str(first(item, 'company_name', 'company', 'organization')), 'Company board': board, Location: str(location) ?? str(first(obj(location), 'name')), Department: str(first(item, 'department', 'department_name')), Team: str(first(item, 'team', 'team_name')), 'Workplace type': str(first(item, 'workplace_type', 'workplaceType')), 'Job type': str(first(item, 'employment_type', 'commitment')), Salary: str(first(item, 'salary', 'compensation')), 'First published': str(first(item, 'first_published', 'created_at', 'createdAt')), Updated: str(first(item, 'updated_at', 'updatedAt')), Description: str(first(item, 'content', 'description')) };
}
function mapAgent(item: Obj): FoundRow {
	return { 'Agent ID': str(first(item, 'id', 'agent_id')), 'Agent URL': str(first(item, 'profile_url', 'url', 'agent_url')), Agent: str(first(item, 'name', 'agent_name')), Brokerage: str(first(item, 'brokerage', 'brokerage_name', 'company')), Location: str(first(item, 'location', 'service_area')), Phone: str(item.phone), Email: str(item.email), Rating: num(item.rating), Sales: num(first(item, 'sales_count', 'sales')) };
}
function mapFundableCompany(item: Obj): FoundRow {
	const latest = obj(item.latest_deal);
	return { 'Company ID': str(first(item, 'id', 'company_id')), Company: str(first(item, 'name', 'company_name')), Domain: str(first(item, 'domain', 'website')), Description: str(first(item, 'description', 'descriptions')), Headcount: str(first(item, 'headcount', 'employee_count')), Location: str(first(item, 'location', 'headquarters')), Industries: cell(first(item, 'industries', 'industry')), 'Total raised': cell(first(item, 'total_raised', 'total_funding')), 'Latest valuation': cell(first(item, 'latest_valuation', 'valuation')), 'Latest round': str(first(latest, 'round_type', 'round', 'financing_type') ?? first(item, 'latest_round', 'funding_stage')), 'Latest round date': str(first(latest, 'date') ?? first(item, 'latest_round_date', 'last_funding_date')), Investors: cell(first(latest, 'investors', 'investor_ids') ?? item.investors), 'Source URLs': cell(first(latest, 'source_articles', 'source_urls') ?? first(item, 'source_urls', 'sources')) };
}
function mapFundableDeal(item: Obj): FoundRow {
	return { 'Deal ID': str(first(item, 'id', 'deal_id')), 'Company ID': str(first(item, 'company_id', 'companyId')), Company: str(first(item, 'company_name', 'company')), Round: str(first(item, 'round_type', 'financing_type', 'round')), Date: str(first(item, 'date', 'announced_at', 'date_announced')), Amount: cell(first(item, 'total_round_raised', 'amount', 'raised_amount', 'size')), Valuation: cell(item.valuation), Description: str(first(item, 'deal_description', 'description')), Investors: cell(first(item, 'investor_ids', 'investors')), 'Source URLs': cell(first(item, 'source_articles', 'source_urls', 'sources')) };
}
function mapInvestor(item: Obj): FoundRow {
	return { 'Investor ID': str(first(item, 'id', 'investor_id')), Investor: str(first(item, 'name', 'investor_name')), Domain: str(first(item, 'domain', 'website')), Website: str(first(item, 'website', 'url')), LinkedIn: str(first(item, 'linkedin_url', 'linkedin')), Description: str(item.description), Stage: cell(first(item, 'investment_stage', 'stages', 'stage')), Location: str(first(item, 'location', 'headquarters')), 'Total deals': num(first(item, 'total_deal_count', 'total_deals', 'deal_count')), 'Lead deals': num(first(item, 'lead_deal_count', 'lead_deals', 'lead_count')), 'Recent deal date': str(first(item, 'most_recent_deal_date', 'recent_deal_date', 'last_deal_date')), Industries: cell(first(item, 'top_industries', 'industries')), 'Top locations': cell(first(item, 'top_locations', 'locations')) };
}

function mapThomasNet(item: Obj): FoundRow {
	const id = str(first(item, 'id', 'manufacturer_id'));
	const url = str(first(item, 'url', 'profile_url'));
	const name = str(first(item, 'name', 'company_name'));
	const key = id ? `thomasnet:${id}` : url ? `thomasnet:${url}` : name ? `thomasnet:${stableKey(name, item.address)}` : null;
	return { 'Manufacturer key': key, 'Manufacturer ID': id, Manufacturer: name, 'Profile URL': url, Description: str(item.text), Address: str(item.address), Email: str(item.email ?? (Array.isArray(item.emails) ? item.emails[0] : undefined)), Phone: str(item.phone), 'Annual sales': cell(item.annual_sales), Employees: cell(item.employees_count), Brands: cell(item.brands), Categories: cell(item.categories), 'Location types': cell(item.location_types), Claimed: bool(item.is_claimed), 'Multi-location': bool(item.is_multi_location), Image: str(item.image_url) };
}

function mapTendataCompany(item: Obj, role: 'importer' | 'exporter'): FoundRow {
	const name = str(first(item, role, 'name', 'company', 'companyName'));
	const country = str(first(item, 'country', 'countryName', 'country_name'));
	return { 'Company key': name ? `tendata:${stableKey(role, name, country)}` : null, Company: name, 'Trade role': role === 'importer' ? 'Importer' : 'Exporter', Country: country, 'Total weight': num(first(item, 'totalWeight', 'weight', 'sumWeight')), Quantity: num(first(item, 'totalQuantity', 'quantity', 'sumQuantity')), 'USD value': num(first(item, 'sumOfUSD', 'totalUSD', 'usdValue', 'valueUSD')), 'Average price per kg': num(first(item, 'weightUnitPriceUSD', 'averageWeightUnitPriceUSD', 'avgPricePerKg')), 'Average price per unit': num(first(item, 'quantityUnitPriceUSD', 'averageQuantityUnitPriceUSD', 'avgPricePerUnit')), 'Trade count': num(first(item, 'tradeCount', 'trade_count', 'count')) };
}

function mapHsCode(item: Obj): FoundRow {
	return { 'HS code': str(first(item, 'hsCode', 'hs_code', 'code')), Description: str(first(item, 'descriptionEn', 'description_en', 'englishDescription', 'description')), 'Chinese description': str(first(item, 'descriptionCn', 'description_cn', 'chineseDescription')), Weight: num(first(item, 'weight', 'sumOfWeight')), Quantity: num(first(item, 'quantity', 'sumOfQuantity')), 'USD value': num(first(item, 'sumOfUSD', 'usdValue', 'totalUSD')), 'Average price per kg': num(first(item, 'weightUnitPriceUSD', 'averageWeightUnitPriceUSD')), 'Average price per unit': num(first(item, 'quantityUnitPriceUSD', 'averageQuantityUnitPriceUSD')), 'Trade count': num(first(item, 'tradeCount', 'trade_count')), 'Value share': num(first(item, 'amountSharePct', 'valueShare', 'value_share')) };
}

function mapTikTokCreator(item: Obj): FoundRow {
	const username = str(first(item, 'username', 'handle', 'unique_id'));
	const profileUrl = str(first(item, 'url', 'profile_url')) ?? (username ? `https://www.tiktok.com/@${username.replace(/^@/, '')}` : null);
	return { 'Creator URL': profileUrl, 'TikTok user ID': str(first(item, 'user_id', 'userId', 'sec_uid', 'secUid')), Handle: username ? `@${username.replace(/^@/, '')}` : null, Creator: str(first(item, 'display_name', 'nickname', 'name')), Bio: str(first(item, 'bio', 'signature')), Region: str(first(item, 'region', 'country')), Followers: num(first(item, 'follower_count', 'followers')), Following: num(first(item, 'following_count', 'following')), Likes: num(first(item, 'like_count', 'likes')), Videos: num(first(item, 'video_count', 'videos')), Verified: bool(first(item, 'is_verified', 'verified')), Avatar: str(first(item, 'avatar_url', 'avatarUrl')), Instagram: str(first(item, 'instagram_url', 'instagramUrl')), YouTube: str(first(item, 'youtube_url', 'youtubeUrl')) };
}

type SoftwareProduct = { provider: 'g2' | 'capterra'; id?: string; slug?: string; name?: string; url?: string };
function mapSoftwareReview(item: Obj, product: SoftwareProduct): FoundRow {
	const feedback = obj(first(item, 'detailed_feedback', 'feedback'));
	const title = str(first(item, 'title', 'review_title'));
	const review = str(first(item, 'review', 'text', 'content'));
	const pros = str(first(item, 'pros', 'likes') ?? feedback.likes);
	const cons = str(first(item, 'cons', 'dislikes') ?? feedback.dislikes);
	const reviewer = str(first(item, 'author', 'reviewer', 'reviewer_name', 'name'));
	const date = str(first(item, 'date', 'published_at', 'created_at'));
	const rating = num(first(item, 'rating', 'overall_rating', 'stars'));
	const identityParts = [product.id ?? product.slug, reviewer, date, title, review, pros, cons].filter(Boolean);
	return { 'Review key': identityParts.length > 1 ? `review:${stableKey(product.provider, ...identityParts)}` : null, Provider: product.provider === 'g2' ? 'G2' : 'Capterra', Product: product.name ?? str(first(item, 'product_name', 'product')), 'Product ID': product.id ?? str(item.product_id), 'Product slug': product.slug ?? str(item.product_name), 'Product URL': product.url ?? str(first(item, 'product_url', 'url')), Rating: rating, Title: title, Review: review, Pros: pros, Cons: cons, Date: date, Reviewer: reviewer, Role: str(first(item, 'designation', 'job_title', 'role')), Company: str(first(item, 'company_name', 'company')), Location: str(item.location), Industry: str(item.industry), 'Employee range': str(first(item, 'employee_count_range', 'segment')), Likes: str(feedback.likes), Dislikes: str(feedback.dislikes), 'Problems solved': str(feedback.problems_solved) };
}

function mapAmazonProduct(item: Obj): FoundRow {
	return { ASIN: str(first(item, 'asin', 'ASIN', 'product_id', 'id')), Product: str(first(item, 'title', 'name')), 'Product URL': str(first(item, 'url', 'link', 'product_url')), Price: str(first(item, 'price', 'price_str', 'price_string')), Currency: str(first(item, 'currency', 'currency_code')), Rating: num(first(item, 'rating', 'stars')), 'Review count': num(first(item, 'reviews_count', 'review_count')), Rank: num(first(item, 'rank', 'position')), Prime: bool(first(item, 'is_prime', 'prime')), Sponsored: bool(first(item, 'is_sponsored', 'sponsored')), 'Best seller': bool(first(item, 'is_best_seller', 'best_seller')), 'Amazon choice': bool(first(item, 'is_amazons_choice', 'amazon_choice')), Image: str(first(item, 'image', 'image_url', 'thumbnail')), Delivery: str(first(item, 'delivery', 'delivery_info')) };
}

function mapAmazonSeller(item: Obj, asin: string): FoundRow {
	const sellerId = str(first(item, 'seller_id', 'sellerId', 'id'));
	const seller = str(first(item, 'seller_name', 'seller', 'name'));
	const condition = str(item.condition);
	const price = str(first(item, 'price', 'price_string'));
	const key = sellerId ? `amazon:${asin}:${sellerId}:${condition ?? ''}` : seller ? `amazon:${stableKey(asin, seller, condition, price)}` : null;
	return { 'Offer key': key, ASIN: asin, 'Seller ID': sellerId, Seller: seller, Price: price, Currency: str(item.currency), Condition: condition, 'Shipping cost': str(first(item, 'shipping_cost', 'shipping_price')), 'Shipping time': str(first(item, 'shipping_time', 'delivery')), Prime: bool(first(item, 'is_prime', 'prime')), 'Seller rating': num(first(item, 'seller_rating', 'rating')), 'Buy box': bool(first(item, 'is_buy_box_winner', 'buy_box')) };
}

function jsonOutput(run: MonidRun): Obj { return obj(run.output); }
function identityOf(row: FoundRow, tableType: TableTypeDefinition) {
	return foundRowKey(typeof row[tableType.identity.sourceField] === 'string' || typeof row[tableType.identity.sourceField] === 'number' ? row[tableType.identity.sourceField] as string | number : null);
}

async function runCall(access: ProviderAccess, operation: MonidOperationName, input: MonidInput, signal: AbortSignal) {
	const validated = validateTableOperationInput(operation, input);
	const apiKey = access.key('monid');
	if (!apiKey) throw new Error('Connect Monid in Configuration to run this table type.');
	return runMonidOperation(apiKey, operation, validated as never, { signal, spend: access.spend, actor: access.account });
}

type TableRowContext = { id?: string; name?: string; url?: string; store?: 'Apple App Store' | 'Google Play'; provider?: 'yelp' | 'google-maps' | 'g2' | 'capterra'; board?: string; tradeRole?: 'importer' | 'exporter'; asin?: string; product?: SoftwareProduct };
export function mapMonidTableRows(typeId: string, output: unknown, context: TableRowContext = {}) {
	switch (typeId) {
		case '1688-wholesale-offers': return listAt(output, 'offers').map(map1688);
		case 'product-search': return listAt(output, 'products', 'results').map(mapProduct);
		case 'shopify-catalog': return listAt(output, 'products').map(mapShopifyProduct);
		case 'local-business-search': return listAt(output, 'local_results', 'results', 'items').map((item) => mapLocalBusiness(item, context.provider === 'yelp' ? 'yelp' : 'google-maps'));
		case 'yelp-reviews': return listAt(output, 'results', 'reviews').map((item) => mapYelpReview(item, context));
		case 'tripadvisor-places': return listAt(output, 'search_results', 'results').map(mapTripadvisorPlace);
		case 'tripadvisor-reviews': return listAt(output, 'reviews', 'results').map((item) => mapTripadvisorReview(item, context));
		case 'employer-career-jobs': return listAt(output, 'jobs', 'results', 'data').map((item) => mapJob(item, context.board ?? ''));
		case 'real-estate-agents': return listAt(output, 'agents', 'results').map(mapAgent);
		case 'mobile-app-search': return listAt(output, 'results', 'apps', 'items').map((item) => mapApp(item, context.store ?? 'Apple App Store'));
		case 'mobile-app-reviews': return listAt(output, 'reviews', 'results', 'items').map((item) => mapAppReview(item, { id: context.id ?? '', store: context.store ?? 'Apple App Store' }));
		case 'nonprofit-organizations': return listAt(output, 'hits', 'results').map(mapNonprofit);
		case 'properties-for-sale': return listAt(output, 'listings', 'results', 'homes').map((item) => mapProperty(item, false));
		case 'rental-listings': return listAt(output, 'listings', 'results', 'homes').map((item) => mapProperty(item, true));
		case 'funded-companies': return listAt(output, 'companies', 'results').map(mapFundableCompany);
		case 'funding-rounds':
		case 'investor-deals': return listAt(output, 'deals', 'results').map(mapFundableDeal);
		case 'venture-investors': return listAt(output, 'investors', 'results').map(mapInvestor);
		case 'venture-funds': return listAt(output, 'funds', 'results').map(mapFund);
		case 'suppliers-manufacturers': return listAt(output, 'results', 'companies', 'manufacturers').map(mapThomasNet);
		case 'creator-influencers': return listAt(output, 'users', 'results', 'accounts').map(mapTikTokCreator);
		case 'software-reviews': return listAt(output, 'reviews', 'results', 'items').map((item) => mapSoftwareReview(item, context.product ?? { provider: context.provider === 'capterra' ? 'capterra' : 'g2' }));
		case 'import-export-companies': return listAt(output, 'results', 'importers', 'exporters', 'companies').map((item) => mapTendataCompany(item, context.tradeRole ?? 'importer'));
		case 'hs-code-activity': return listAt(output, 'results', 'hsCodes', 'hs_codes', 'items').map(mapHsCode);
		case 'amazon-product-search': return listAt(output, 'organic_results', 'products', 'results').map(mapAmazonProduct);
		case 'amazon-seller-offers': return listAt(output, 'sellers', 'offers', 'results').map((item) => mapAmazonSeller(item, context.asin ?? ''));
		default: return [];
	}
}

/** Generic bounded runner for table-generator adapters. Provider names, endpoints, schemas, row mapping and identities
 * stay in trusted code; the registry only contributes prompt guidance and column labels. */
export type TableOperationExecutor = (access: ProviderAccess, operation: MonidOperationName, input: MonidInput, signal: AbortSignal) => Promise<MonidRun>;

export async function runMonidTableSearch(access: ProviderAccess, request: PopulateRequest & { tableType: TableTypeDefinition }, emit: (event: PopulateEvent) => void, signal: AbortSignal, executeOperation: TableOperationExecutor = runCall) {
	const type = request.tableType, adapter = TABLE_TYPE_ADAPTERS[type.id];
	if (!adapter || adapter.entity !== 'records' || type.entity !== 'records' || type.status !== 'published') throw new Error('This table type has no published, trusted Monid table adapter.');
	const readinessError = tableTypeRunnableError(type);
	if (readinessError) throw new Error(`This table type is not runnable: ${readinessError}`);
	const query = request.query.trim();
	const inputs = request.inputs ?? {};
	const inputError = tableTypeInputError(type, { query, countries: request.countries, inputs });
	if (inputError) throw new Error(inputError);
	const requestedTarget = Math.min(1000, request.target, request.availableRows ?? 1000);
	const target = Math.min(requestedTarget, adapter.maxRows ?? 1000, tableTypeRowLimit(type.id, inputs));
	if (target < 1) throw new Error('The requested table result limit is empty.');
	const seen = new Set((request.existingKeys ?? []).map(foundRowKey).filter(Boolean));
	let added = 0, calls = 0, cursor = 0, cursorToken: string | undefined, providerRowsSeen = 0;
	const monidRunStart = access.spend.monidRuns.length;
	const call = async (operation: MonidOperationName, input: MonidInput) => {
		if (!adapter.operations.includes(operation)) throw new Error('The selected Monid operation is not allowed for this table type.');
		const validated = validateTableOperationInput(operation, input);
		return executeOperation(access, operation, validated, signal);
	};
	const emitRows = async (rows: FoundRow[]) => {
		const unique: FoundRow[] = [];
		for (const row of rows) {
			const identity = identityOf(row, type);
			if (!identity || seen.has(identity)) continue;
			seen.add(identity);
			unique.push(row);
			if (unique.length >= target - added) break;
		}
		if (!unique.length) return 0;
		added += unique.length;
		const monidRuns = access.spend.monidRuns.slice(monidRunStart);
		await emit({ type: 'rows', rows: unique, key: type.identity.sourceField, meta: monidRuns.length ? { monidRuns } : undefined });
		return unique.length;
	};
	const status = async () => emit({ type: 'status', message: `${type.name}: ${added.toLocaleString()} of ${target.toLocaleString()} rows · ${calls} Monid ${calls === 1 ? 'call' : 'calls'}` });
	const done = async (zeroMessage?: string) => emit({ type: 'done', total: added, message: added ? `Added ${added.toLocaleString()} ${type.name.toLowerCase()}.` : zeroMessage ?? `No ${type.name.toLowerCase()} matched. Try a broader or more specific description.` });
	await emit({ type: 'status', message: `Searching Monid for ${type.name}…` });

	if (type.id === 'yelp-reviews') {
		let business: { name?: string; url?: string } = {};
		const directUrl = inputs['business-url']?.trim();
		if (directUrl) business.url = directUrl;
		else {
			const search = await call('table.yelp.search', { body: { keyword: query, location: inputs.location!.trim(), limit: 5 } });
			calls++;
			const found = listAt(search.output, 'results')[0];
			if (!found) return done('No Yelp business matched. Try a more specific business name, city, or Yelp URL.');
			business = { name: str(first(found, 'name', 'business_name')) ?? undefined, url: str(first(found, 'url', 'business_url')) ?? undefined };
			if (!business.url) throw new Error('The Yelp business search did not return a Yelp business URL, so reviews cannot be linked safely.');
			await status();
		}
		while (added < target && calls < Math.min(type.pagination.maxCalls, adapter.maxCalls)) {
			signal.throwIfAborted();
			const pageSize = Math.min(10, target - added);
			const run = await call('table.yelp.reviews', { body: { url: business.url!, limit: pageSize, ...(cursorToken ? { page_token: cursorToken } : {}) } });
			calls++;
			const output = jsonOutput(run), items = listAt(output, 'results', 'reviews');
			await emitRows(mapMonidTableRows(type.id, output, business));
			cursorToken = str(first(output, 'next_page_token', 'nextPageToken')) ?? undefined;
			await status();
			if (!items.length || !cursorToken) break;
		}
		return done(added ? undefined : 'No Yelp reviews were returned for this business.');
	}

	if (type.id === 'tripadvisor-reviews') {
		let place: { id?: string; name?: string; url?: string } = {};
		const directId = inputs['place-id']?.trim();
		if (directId) place.id = directId;
		else {
			const search = await call('table.tripadvisor.search', { queryParams: { q: query, num: 1, start: 0 } });
			calls++;
			const found = listAt(search.output, 'search_results', 'results')[0];
			if (!found) return done('No Tripadvisor place matched. Try adding the city or entering a place ID.');
			place = { id: str(first(found, 'place_id', 'location_id', 'id')) ?? undefined, name: str(first(found, 'name', 'title')) ?? undefined, url: str(first(found, 'url', 'web_url')) ?? undefined };
			if (!place.id || !/^\d+$/.test(place.id)) throw new Error('The Tripadvisor place search did not return a numeric place ID, so review lookup cannot continue.');
			await status();
		}
		while (added < target && calls < Math.min(type.pagination.maxCalls, adapter.maxCalls)) {
			signal.throwIfAborted();
			const pageSize = Math.min(50, target - added);
			const run = await call('table.tripadvisor.reviews', { queryParams: { place_id: place.id!, num: pageSize, start: cursor } });
			calls++;
			const output = jsonOutput(run), items = listAt(output, 'reviews', 'results');
			await emitRows(mapMonidTableRows(type.id, output, place));
			cursor += pageSize;
			await status();
			if (items.length < pageSize) break;
		}
		return done();
	}

	if (type.id === 'mobile-app-reviews') {
		const apple = inputs.storefront === 'apple';
		const store = apple ? 'Apple App Store' : 'Google Play';
		let appId: string | undefined = inputs['app-id']?.trim();
		if (!appId) {
			const search = apple
				? await call('table.appstore.search', { queryParams: { term: query, country: (inputs.country?.trim() || 'us').toLowerCase(), num: 1, device: 'mobile' } })
				: await call('table.googleplay.search', { body: { keyword: query, depth: 1, location_name: countryName(inputs.country), language_name: 'English' } });
			calls++;
			const found = listAt(search.output, 'organic_results', 'results', 'apps', 'items')[0];
			if (!found) return done(`No app matched in ${store}. Enter its app ID or try a different title.`);
			appId = str(first(found, 'trackId', 'app_id', 'appId', 'id')) ?? undefined;
			if (!appId) throw new Error(`The ${store} result did not contain a stable app ID.`);
			await status();
		}
		if (apple) {
			while (added < target && calls < Math.min(type.pagination.maxCalls, adapter.maxCalls)) {
				signal.throwIfAborted();
				const run = await call('table.appstore.reviews', { queryParams: { product_id: appId, country: (inputs.country?.trim() || 'us').toLowerCase(), sort: 'mostrecent', page: cursor + 1 } });
				calls++;
				const output = jsonOutput(run), items = listAt(output, 'reviews', 'results', 'items');
				await emitRows(mapMonidTableRows(type.id, output, { id: appId, store }));
				cursor++;
				await status();
				if (items.length < 25) break;
			}
		} else {
			const run = await call('table.googleplay.reviews', { body: { app_id: appId, depth: Math.min(1000, target), location_name: countryName(inputs.country), language_name: 'English', sort_by: 'newest' } });
			calls++;
			const output = jsonOutput(run);
			await emitRows(mapMonidTableRows(type.id, output, { id: appId, store }));
			await status();
		}
		return done();
	}

	if (type.id === 'software-reviews') {
		const source = inputs.source === 'capterra' ? 'capterra' : 'g2';
		const suppliedSlug = inputs['product-slug']?.trim();
		const suppliedId = inputs['product-id']?.trim();
		const suppliedName = inputs['product-name']?.trim();
		let product: SoftwareProduct = { provider: source, ...(suppliedSlug ? { slug: suppliedSlug } : {}), ...(suppliedId ? { id: suppliedId } : {}), ...(suppliedName ? { name: suppliedName } : {}) };
		if (source === 'g2' ? !product.slug : !product.id || !product.name) {
			const search = source === 'g2'
				? await call('table.g2.search-software', { queryParams: { query } })
				: await call('table.capterra.search-software', { queryParams: { query } });
			calls++;
			const candidate = listAt(search.output, 'products', 'results', 'items')[0];
			if (!candidate) return done(`No ${source === 'g2' ? 'G2' : 'Capterra'} product matched. Try a more exact product name or provide its product identifier.`);
			const foundProduct: SoftwareProduct = { provider: source, ...(str(first(candidate, 'product_id', 'id')) ? { id: str(first(candidate, 'product_id', 'id'))! } : {}), ...(str(first(candidate, 'slug', 'url_slug', 'product_slug')) ? { slug: str(first(candidate, 'slug', 'url_slug', 'product_slug'))! } : {}), ...(str(first(candidate, 'name', 'product_name', 'title')) ? { name: str(first(candidate, 'name', 'product_name', 'title'))! } : {}), ...(str(first(candidate, 'url', 'product_url', 'full_url')) ? { url: str(first(candidate, 'url', 'product_url', 'full_url'))! } : {}) };
			if (source === 'g2' ? !foundProduct.slug : !foundProduct.id || !foundProduct.name) throw new Error(`${source === 'g2' ? 'G2' : 'Capterra'} product search did not return the stable product identifier required for review lookup.`);
			product = foundProduct;
			await status();
		} else {
			product.name = suppliedName ?? suppliedSlug;
		}
		while (added < target && calls < Math.min(type.pagination.maxCalls, adapter.maxCalls)) {
			signal.throwIfAborted();
			const page = cursor + 1;
			const run = source === 'g2'
				? await call('table.g2.reviews', { queryParams: { slug: product.slug!, page } })
				: await call('table.capterra.reviews', { queryParams: { product_id: product.id!, product_name: product.name!, page } });
			calls++;
			const output = jsonOutput(run), items = listAt(output, 'reviews', 'results', 'items');
			await emitRows(mapMonidTableRows(type.id, output, { provider: source, product }));
			cursor++;
			await status();
			const pageSize = source === 'g2' ? 10 : 25;
			if (items.length < pageSize) break;
		}
		return done();
	}

	while (added < target && calls < Math.min(type.pagination.maxCalls, adapter.maxCalls)) {
		signal.throwIfAborted();
		const remaining = target - added;
		let operation: MonidOperationName, input: MonidInput, pageSize = remaining;
		let context: Parameters<typeof mapMonidTableRows>[2] = {};
		let listKeys: string[] = ['results', 'items'];
		switch (type.id) {
			case '1688-wholesale-offers':
				operation = 'table.1688.search'; pageSize = Math.min(60, remaining); input = { body: { query, beginPage: cursor + 1, pageSize, language: 'en', currency: 'USD', ...(inputs['exact-match'] ? { exactMatch: inputs['exact-match'] === 'true' } : {}) } }; listKeys = ['offers']; break;
			case 'product-search':
				operation = 'table.channel3.search'; pageSize = Math.min(30, remaining); input = { body: { query, limit: pageSize, ...(cursorToken ? { page_token: cursorToken } : {}) } }; listKeys = ['products', 'results']; break;
			case 'shopify-catalog':
				operation = 'table.shopify.products'; pageSize = Math.min(250, remaining); input = { queryParams: { store: inputs.store?.trim() ?? '', page: cursor + 1, limit: pageSize } }; listKeys = ['products']; break;
			case 'local-business-search':
				if (inputs.source === 'yelp') {
				operation = 'table.yelp.search'; pageSize = Math.min(50, remaining); input = { body: { keyword: query, location: inputs.location!.trim(), limit: pageSize } }; context = { provider: 'yelp' }; listKeys = ['results'];
				} else {
					operation = 'table.google.maps'; pageSize = Math.min(700, remaining); input = { body: { keyword: query, depth: pageSize, ...(inputs.location?.trim() ? { location_name: inputs.location.trim() } : {}) } }; context = { provider: 'google-maps' }; listKeys = ['local_results', 'results', 'items'];
				}
				break;
			case 'tripadvisor-places':
				operation = 'table.tripadvisor.search'; pageSize = Math.min(30, remaining); input = { queryParams: { q: query, num: pageSize, start: cursor } }; listKeys = ['search_results', 'results']; break;
			case 'nonprofit-organizations':
				operation = 'table.idealist.organizations'; pageSize = 20; input = { queryParams: { q: query, page: cursor, ...(inputs.coordinates?.trim() ? { location: inputs.coordinates.trim() } : {}), ...(inputs['organization-type'] ? { org_type: inputs['organization-type'] } : {}) } }; listKeys = ['hits', 'results']; break;
			case 'properties-for-sale':
				operation = 'table.zillow.sale'; input = { queryParams: { location: inputs.location?.trim() ?? query, page: cursor + 1 } }; listKeys = ['listings', 'results', 'homes']; break;
			case 'rental-listings':
				operation = 'table.zillow.rent'; input = { queryParams: { location: inputs.location?.trim() ?? query, page: cursor + 1 } }; listKeys = ['listings', 'results', 'homes']; break;
			case 'real-estate-agents':
				operation = 'table.homes.agents'; input = { queryParams: { location: inputs.location?.trim() ?? query, page: cursor + 1 } }; listKeys = ['agents', 'results']; break;
			case 'employer-career-jobs':
				pageSize = Math.min(100, remaining); context = { board: inputs.board?.trim() ?? '' };
				if (inputs.ats === 'greenhouse') {
					operation = 'table.greenhouse.jobs'; input = { queryParams: { board: context.board!, q: query, page: cursor + 1, limit: pageSize, include_content: true, ...(inputs.location?.trim() ? { location: inputs.location.trim() } : {}) } };
				} else {
					operation = 'table.lever.jobs'; input = { queryParams: { company: context.board!, skip: cursor * 100, limit: pageSize } };
				}
				listKeys = ['jobs', 'results']; break;
			case 'mobile-app-search':
				context = { store: inputs.storefront === 'google' ? 'Google Play' : 'Apple App Store' };
				if (inputs.storefront === 'google') {
					operation = 'table.googleplay.search'; input = { body: { keyword: query, depth: Math.min(200, remaining), location_name: countryName(inputs.country), language_name: 'English' } };
				} else {
					operation = 'table.appstore.search'; input = { queryParams: { term: query, country: (inputs.country?.trim() || 'us').toLowerCase(), num: Math.min(200, remaining), device: 'mobile' } };
				}
				listKeys = ['organic_results', 'results', 'apps', 'items']; break;
			case 'funded-companies':
				operation = 'table.fundable.companies'; pageSize = Math.min(50, remaining); input = { body: { company: { search_query: query }, page: 0, page_size: pageSize, sort_by: 'most_recent_raise' } }; listKeys = ['companies', 'results']; break;
			case 'funding-rounds': {
				operation = 'table.fundable.deals'; pageSize = Math.min(50, remaining);
				const value = inputs['round-type'] ?? 'seed';
				const roundType: Record<string, string> = { pre_seed: 'SEED', seed: 'SEED', series_a: 'SERIES_A', series_b: 'SERIES_B', series_c: 'SERIES_C' };
				const deal: Record<string, unknown> = { financing_types: [{ type: roundType[value] ?? 'SEED', ...(value === 'pre_seed' ? { pre: true } : {}) }] };
				if (inputs['date-start']?.trim()) deal.date_start = inputs['date-start'].trim();
				if (inputs['date-end']?.trim()) deal.date_end = inputs['date-end'].trim();
				if (inputs['min-size']?.trim()) deal.size_min = Number(inputs['min-size']);
				const company: Record<string, unknown> = {};
				if (inputs['location-permalink']?.trim()) company.locations = [inputs['location-permalink'].trim()];
				if (inputs['industry-permalink']?.trim()) company.industries = [inputs['industry-permalink'].trim()];
				if (inputs['employee-count']) company.employee_count = [inputs['employee-count']];
				input = { body: { deal, ...(Object.keys(company).length ? { company } : {}), page: 0, page_size: pageSize, sort_by: 'most_recent_deal' } }; listKeys = ['deals', 'results']; break;
			}
			case 'venture-investors':
				operation = 'table.fundable.investors'; pageSize = Math.min(50, remaining); input = { body: { company_investments: { search_query: query }, page: 0, page_size: pageSize, sort_by: 'matching_deals' } }; listKeys = ['investors', 'results']; break;
			case 'investor-deals':
				operation = 'table.fundable.investor-deals'; pageSize = Math.min(50, remaining); input = { queryParams: { domain: inputs['investor-domain']!.trim(), page: cursor, page_size: pageSize } }; listKeys = ['deals', 'results']; break;
			case 'venture-funds':
				operation = 'table.fundmomentum.funds'; pageSize = Math.min(50, remaining);
				input = { queryParams: { ...(inputs.stage ? { stage: inputs.stage } : {}), ...(inputs.country?.trim() ? { country: inputs.country.trim() } : {}), ...(inputs.industry?.trim() ? { industry: inputs.industry.trim() } : {}), limit: pageSize, offset: cursor } }; listKeys = ['funds', 'results']; break;
			case 'suppliers-manufacturers':
				operation = 'table.thomasnet.search'; pageSize = Math.min(200, remaining); input = { body: { keyword: query, limit: pageSize } }; listKeys = ['results', 'companies', 'manufacturers']; break;
			case 'creator-influencers':
				operation = 'table.tiktok.search'; pageSize = Math.min(20, remaining); input = { body: { keyword: query } }; listKeys = ['users', 'results', 'accounts']; break;
			case 'import-export-companies': {
				const role = inputs['trade-direction'] === 'exports' ? 'exporter' : 'importer';
				context = { tradeRole: role };
				operation = role === 'importer' ? 'table.tendata.importers' : 'table.tendata.exporters';
				pageSize = Math.min(100, remaining);
				const body: Record<string, unknown> = { pageNo: cursor + 1, pageSize, catalog: inputs['trade-direction'], startDate: inputs['date-start'], endDate: inputs['date-end'], productDesc: query, filterBlankFields: [role] };
				if (inputs['hs-code']?.trim()) body.hsCode = inputs['hs-code'].trim();
				if (inputs['country-origin']?.trim()) body.countryOfOriginCode = inputs['country-origin'].trim().toUpperCase();
				if (inputs['country-destination']?.trim()) body.countryOfDestinationCode = inputs['country-destination'].trim().toUpperCase();
				input = { body }; listKeys = ['results', 'importers', 'exporters', 'companies', 'data']; break;
			}
			case 'hs-code-activity': {
				operation = 'table.tendata.hs-code'; pageSize = Math.min(100, remaining);
				const body: Record<string, unknown> = { pageNo: cursor + 1, pageSize, catalog: inputs['trade-direction'], startDate: inputs['date-start'], endDate: inputs['date-end'], productDesc: query };
				if (inputs['country-origin']?.trim()) body.countryOfOriginCode = inputs['country-origin'].trim().toUpperCase();
				if (inputs['country-destination']?.trim()) body.countryOfDestinationCode = inputs['country-destination'].trim().toUpperCase();
				input = { body }; listKeys = ['results', 'hsCodes', 'hs_codes', 'items', 'data']; break;
			}
			case 'amazon-product-search':
				operation = 'table.amazon.products'; pageSize = Math.min(336, remaining);
				input = { body: { keyword: query, depth: pageSize, max_crawl_pages: Math.max(1, Math.min(7, Math.ceil(pageSize / 48))), location_name: 'United States', language_name: 'English (United States)' } };
				listKeys = ['organic_results', 'products', 'results']; break;
			case 'amazon-seller-offers':
				operation = 'table.amazon.sellers'; context = { asin: inputs.asin?.trim().toUpperCase() };
				input = { body: { asin: context.asin!, location_name: 'United States', language_name: 'English (United States)' } };
				listKeys = ['sellers', 'offers', 'results']; break;
			default: throw new Error('This table type has no server implementation yet.');
		}
		const run = await call(operation, input);
		calls++;
		const output = jsonOutput(run), items = listAt(output, ...listKeys);
		const pageRows = mapMonidTableRows(type.id, output, context);
		await emitRows(pageRows);
		await status();
		if (type.id === '1688-wholesale-offers') providerRowsSeen += items.length;
		if (!items.length || calls >= adapter.maxCalls) break;
		if (type.id === '1688-wholesale-offers') {
			cursor++;
			const hasMore = output.hasMore === true || output.has_more === true;
			const total = num(output.totalCount ?? output.total_count);
			if (!hasMore || total !== null && providerRowsSeen >= total) break;
		} else if (type.id === 'product-search') {
			cursorToken = str(output.next_page_token) ?? undefined;
			if (!cursorToken) break;
		} else if (type.id === 'shopify-catalog' || type.id === 'real-estate-agents') {
			cursor++;
			const limit = type.id === 'shopify-catalog' ? pageSize : 48;
			if (items.length < limit) break;
		} else if (type.id === 'local-business-search' || type.id === 'mobile-app-search' || type.id === 'funded-companies' || type.id === 'funding-rounds' || type.id === 'venture-investors' || type.id === 'suppliers-manufacturers' || type.id === 'creator-influencers' || type.id === 'amazon-product-search' || type.id === 'amazon-seller-offers') break;
		else if (type.id === 'tripadvisor-places') {
			cursor += pageSize;
			if (items.length < pageSize) break;
		} else if (type.id === 'nonprofit-organizations') {
			cursor++;
			if (items.length < 20 || cursor >= 50) break;
		} else if (type.id === 'properties-for-sale' || type.id === 'rental-listings') {
			cursor++;
			if (items.length < 41) break;
		} else if (type.id === 'import-export-companies' || type.id === 'hs-code-activity') {
			cursor++;
			if (items.length < pageSize) break;
		} else if (type.id === 'employer-career-jobs') {
			cursor++;
			if (items.length < pageSize) break;
		} else if (type.id === 'investor-deals') {
			cursor++;
			if (items.length < pageSize) break;
		} else if (type.id === 'venture-funds') {
			const nextOffset = num(output.next_offset);
			if (nextOffset === null || nextOffset <= cursor) break;
			cursor = nextOffset;
		}
	}
	return done();
}
