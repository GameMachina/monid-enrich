import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { exportValue } from './cell-admission';
import { formatValue } from './template';
import type { Column, Row } from './types';

/* A minimal .xlsx writer: one worksheet with inline strings, numbers and booleans. No dependency on SheetJS. */

function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnLetter(index: number): string {
	let letters = '';
	let n = index + 1;
	while (n > 0) {
		const remainder = (n - 1) % 26;
		letters = String.fromCharCode(65 + remainder) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters;
}

export function toXlsx(sheetName: string, columns: Column[], rows: Row[]): Blob {
	const visible = columns.filter((column) => !column.hidden);
	const cellXml = (ref: string, value: unknown): string => {
		if (value === null || value === undefined || value === '') return '';
		if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
		if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
		return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(formatValue(value as string).slice(0, 32_000))}</t></is></c>`;
	};
	const lines: string[] = [];
	lines.push(`<row r="1">${visible.map((column, index) => `<c r="${columnLetter(index)}1" t="inlineStr" s="1"><is><t>${escapeXml(column.name)}</t></is></c>`).join('')}</row>`);
	rows.forEach((row, rowIndex) => {
		const r = rowIndex + 2;
		const cells = visible.map((column, index) => {
			const cell = row.cells[column.id];
			return cellXml(`${columnLetter(index)}${r}`, exportValue(column, cell));
		});
		lines.push(`<row r="${r}">${cells.join('')}</row>`);
	});
	const widths = visible.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(10, Math.min(60, Math.round(column.width / 7)))}" customWidth="1"/>`).join('');
	const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${lines.join('')}</sheetData></worksheet>`;
	const safeName = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
	const files: Record<string, Uint8Array> = {
		'[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
		'_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
		'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
		'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
		'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs></styleSheet>`),
		'xl/worksheets/sheet1.xml': strToU8(sheet),
	};
	const zipped = zipSync(files, { level: 6 });
	return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlElements = (parent: Document | Element, name: string) => Array.from(parent.getElementsByTagNameNS('*', name));

function normalizeZipPath(value: string) {
	const parts: string[] = [];
	for (const part of value.replace(/^\//, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop(); else parts.push(part);
	}
	return parts.join('/');
}

function parseXml(bytes: Uint8Array, label: string): Document {
	const parsed = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
	if (parsed.querySelector('parsererror')) throw new Error(`This workbook has invalid ${label} XML.`);
	return parsed;
}

function excelColumnIndex(reference: string) {
	const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
	if (!letters) return -1;
	let value = 0;
	for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
	return value - 1;
}

/** Reads the first worksheet of standard .xlsx files and values written by this app. */
export function fromXlsx(bytes: Uint8Array): { headers: string[]; records: Record<string, string | number | boolean | null>[] } {
	if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('Choose an XLSX file smaller than 25 MB.');
	let archive: Record<string, Uint8Array>;
	try { archive = unzipSync(bytes); } catch { throw new Error('This XLSX file could not be opened.'); }
	const workbookBytes = archive['xl/workbook.xml'];
	const relsBytes = archive['xl/_rels/workbook.xml.rels'];
	if (!workbookBytes || !relsBytes) throw new Error('This file is missing workbook metadata.');
	const workbook = parseXml(workbookBytes, 'workbook');
	const relations = parseXml(relsBytes, 'workbook relationship');
	const firstSheet = xmlElements(workbook, 'sheet')[0];
	const relationId = firstSheet?.getAttributeNS(REL_NS, 'id') ?? firstSheet?.getAttribute('r:id');
	if (!relationId) throw new Error('This workbook does not contain a worksheet.');
	const target = xmlElements(relations, 'Relationship').find((entry) => entry.getAttribute('Id') === relationId)?.getAttribute('Target');
	if (!target) throw new Error('This workbook does not contain a worksheet.');
	const sheetPath = normalizeZipPath(target.startsWith('/') ? target : `xl/${target}`);
	const sheetBytes = archive[sheetPath];
	if (!sheetBytes) throw new Error('The first worksheet is missing from this workbook.');
	const strings = archive['xl/sharedStrings.xml'] ? xmlElements(parseXml(archive['xl/sharedStrings.xml'], 'shared strings'), 'si').map((entry) => entry.textContent ?? '') : [];
	const worksheet = parseXml(sheetBytes, 'worksheet');
	const matrix: Array<Array<string | number | boolean | null>> = [];
	for (const row of xmlElements(worksheet, 'row')) {
		const number = Number(row.getAttribute('r')) || matrix.length + 1;
		const values: Array<string | number | boolean | null> = matrix[number - 1] ?? [];
		for (const cell of xmlElements(row, 'c')) {
			const index = excelColumnIndex(cell.getAttribute('r') ?? '');
			if (index < 0) continue;
			const type = cell.getAttribute('t');
			const value = xmlElements(cell, 'v')[0]?.textContent ?? '';
			if (type === 'inlineStr') values[index] = xmlElements(cell, 't').map((part) => part.textContent ?? '').join('');
			else if (type === 's') values[index] = strings[Number(value)] ?? '';
			else if (type === 'b') values[index] = value === '1';
			else if (type === 'e' || value === '') values[index] = null;
			else if (type === 'str') values[index] = value;
			else { const numeric = Number(value); values[index] = Number.isFinite(numeric) ? numeric : value; }
		}
		matrix[number - 1] = values;
	}
	const headerIndex = matrix.findIndex((row) => row?.some((value) => value !== null && String(value).trim() !== ''));
	if (headerIndex < 0) return { headers: [], records: [] };
	const rawHeaders = matrix[headerIndex] ?? [];
	const headers: string[] = [];
	for (let index = 0; index < rawHeaders.length; index++) headers.push(String(rawHeaders[index] ?? '').trim() || `Column ${index + 1}`);
	const uniqueHeaders: string[] = [];
	for (const header of headers) {
		let candidate = header, suffix = 2;
		while (uniqueHeaders.some((item) => item.toLocaleLowerCase() === candidate.toLocaleLowerCase())) candidate = `${header} (${suffix++})`;
		uniqueHeaders.push(candidate);
	}
	const records = matrix.slice(headerIndex + 1).filter((row) => row?.some((value) => value !== null && String(value).trim() !== '')).map((row) => Object.fromEntries(uniqueHeaders.map((header, index) => [header, row[index] ?? null])));
	return { headers: uniqueHeaders, records };
}
