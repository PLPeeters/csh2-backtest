import type { HistoricalRateRow } from './historical-savings';

export type HistoricalSavingsRateDraft = Omit<HistoricalRateRow, 'id'>;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  januari: 1, februari: 2, maart: 3, mei: 5, juni: 6, juli: 7, augustus: 8
};

const HEADER_ALIASES = {
  date: [
    'date of change', 'effective date', 'date effective', "date d'effet", 'date de prise effet', 'start date',
    'change date', 'validity date', 'date', 'datum', 'from', 'valid from', 'geldig vanaf', 'vanaf', 'ingangsdatum', 'begindatum'
  ],
  base: [
    'base annual interest rate', 'base annual rate', 'base interest rate', 'base interest',
    'interest rate', 'annual base rate', 'base rate', 'taux de base', 'taux base',
    'basisrente', 'basis interest', 'basis rate', 'base', 'basis', 'interest', 'rentevoet'
  ],
  premium: [
    'fidelity premium rate', 'fidelity interest', 'fidelity premium', 'fidelity bonus', 'fidelity reward',
    'loyalty premium', 'loyalty bonus', 'loyalty interest', 'bonus rate', 'prime de fidelite', 'bonus de fidelite',
    'taux de fidelite', 'getrouwheidspremie', 'getrouwheidsrente', 'getrouwheidsbonus',
    'premium', 'premie', 'prime', 'bonus', 'loyalty', 'fidelity'
  ]
} as const;

function plainText(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedHeader(value: string) {
  return plainText(value).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

type ColumnKind = keyof typeof HEADER_ALIASES;

function headerKinds(value: string): { kind: ColumnKind; score: number }[] {
  const normalized = normalizedHeader(value);
  return (Object.keys(HEADER_ALIASES) as ColumnKind[]).flatMap((kind) => HEADER_ALIASES[kind]
    .filter((alias) => {
      const normalizedAlias = normalizedHeader(alias);
      return normalized === normalizedAlias || normalized.includes(` ${normalizedAlias} `) || normalized.startsWith(`${normalizedAlias} `) || normalized.endsWith(` ${normalizedAlias}`);
    })
    .map((alias) => ({ kind, score: normalizedHeader(alias).length }))
  ).sort((left, right) => right.score - left.score);
}

export interface HistoricalSavingsColumnMapping {
  date: number;
  base: number;
  premium: number;
}

export interface HistoricalSavingsClipboardTable {
  columns: string[];
  rows: string[][];
  suggestedMapping: Partial<HistoricalSavingsColumnMapping>;
}

export type HistoricalSavingsClipboardResult = HistoricalSavingsRateDraft[] | {
  kind: 'ambiguous';
  table: HistoricalSavingsClipboardTable;
};

function findHeader(columns: string[]): HistoricalSavingsColumnMapping | undefined {
  const indexes: Partial<Record<keyof HistoricalSavingsColumnMapping, number>> = {};
  for (const kind of Object.keys(HEADER_ALIASES) as ColumnKind[]) {
    const matches = columns.map((column, index) => ({ index, match: headerKinds(column).find((candidate) => candidate.kind === kind) })).filter((candidate) => candidate.match);
    if (matches.length !== 1) return undefined;
    indexes[kind] = matches[0].index;
  }
  if (indexes.date === undefined || indexes.base === undefined || indexes.premium === undefined) return undefined;
  return { date: indexes.date, base: indexes.base, premium: indexes.premium };
}

function suggestedHeaderMapping(columns: string[]): Partial<HistoricalSavingsColumnMapping> {
  const result: Partial<HistoricalSavingsColumnMapping> = {};
  for (const kind of Object.keys(HEADER_ALIASES) as ColumnKind[]) {
    const matches = columns.map((column, index) => ({ index, match: headerKinds(column).find((candidate) => candidate.kind === kind) })).filter((candidate) => candidate.match);
    const best = matches.length ? Math.max(...matches.map((candidate) => candidate.match?.score ?? 0)) : 0;
    const bestMatches = matches.filter((candidate) => candidate.match?.score === best);
    if (best && bestMatches.length === 1) result[kind] = bestMatches[0].index;
  }
  return result;
}

function splitTextColumns(line: string) {
  if (line.includes('\t')) return line.split('\t').map(plainText);
  return line.trim().split(/\s{2,}/).map(plainText);
}

function textHeaderColumns(line: string) {
  const columns = splitTextColumns(line);
  return columns.length > 1 ? columns : line.trim().split(/\s+/).map(plainText);
}

function dateFromText(value: string) {
  const text = plainText(value).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const localized = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(text);
  if (localized) return validDate(Number(localized[3]), MONTHS[localized[2]] ?? 0, Number(localized[1]));
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (numeric) return validDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  return undefined;
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || day < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function percentageFromText(value: string) {
  const text = plainText(value).replace(/\s/g, '').replace(/%$/, '').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? String(number) : undefined;
}

function parseRow(dateText: string, baseText: string, premiumText: string, rowNumber: number): HistoricalSavingsRateDraft {
  const date = dateFromText(dateText);
  const baseRate = percentageFromText(baseText);
  const fidelityPremium = percentageFromText(premiumText);
  if (!date || baseRate === undefined || fidelityPremium === undefined) throw new Error(`Clipboard row ${rowNumber} has an invalid date, base rate, or fidelity premium.`);
  return { date, baseRate, fidelityPremium };
}

function ensureUnique(rows: HistoricalSavingsRateDraft[]) {
  if (!rows.length) throw new Error('Clipboard does not contain any historical savings rates.');
  if (new Set(rows.map((row) => row.date)).size !== rows.length) throw new Error('Clipboard contains duplicate historical rate dates.');
  return [...rows].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseHistoricalSavingsTable(table: HistoricalSavingsClipboardTable, mapping: HistoricalSavingsColumnMapping): HistoricalSavingsRateDraft[] {
  const parsed: HistoricalSavingsRateDraft[] = [];
  for (const row of table.rows) {
    if (row.every((cell) => !plainText(cell))) continue;
    parsed.push(parseRow(row[mapping.date] ?? '', row[mapping.base] ?? '', row[mapping.premium] ?? '', parsed.length + 1));
  }
  return ensureUnique(parsed);
}

function ambiguousTable(columns: string[], rows: string[][]): HistoricalSavingsClipboardResult {
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 0);
  const normalizedColumns = Array.from({ length: width }, (_, index) => plainText(columns[index] ?? '') || `Column ${index + 1}`);
  return { kind: 'ambiguous', table: { columns: normalizedColumns, rows: rows.map((row) => Array.from({ length: width }, (_, index) => plainText(row[index] ?? ''))), suggestedMapping: suggestedHeaderMapping(columns) } };
}

/** Parse a copied HTML table, asking the caller to map columns when headers are not conclusive. */
export function parseHistoricalSavingsRatesHtml(html: string): HistoricalSavingsClipboardResult {
  if (!plainText(html)) throw new Error('Clipboard does not contain a historical savings table.');
  if (typeof DOMParser === 'undefined') throw new Error('This browser cannot parse clipboard tables.');
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const matrix = Array.from(table.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => plainText(cell.textContent ?? '')));
    if (!matrix.length) continue;
    const headerIndex = matrix.findIndex((row) => Boolean(findHeader(row)) || Object.keys(suggestedHeaderMapping(row)).length > 0);
    if (headerIndex >= 0) {
      const indexes = findHeader(matrix[headerIndex]);
      if (indexes) return parseHistoricalSavingsTable({ columns: matrix[headerIndex], rows: matrix.slice(headerIndex + 1), suggestedMapping: indexes }, indexes);
      return ambiguousTable(matrix[headerIndex], matrix.slice(headerIndex + 1));
    }
    const firstRowLooksLikeData = matrix[0].some((cell) => dateFromText(cell) !== undefined) || matrix[0].filter((cell) => percentageFromText(cell) !== undefined).length >= 2;
    return firstRowLooksLikeData ? ambiguousTable([], matrix) : ambiguousTable(matrix[0], matrix.slice(1));
  }
  throw new Error('Clipboard does not contain a supported historical savings table.');
}

/** Parse browser clipboard text, including the line-per-cell format produced by some editors. */
export function parseHistoricalSavingsRatesText(text: string): HistoricalSavingsClipboardResult {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => {
    const columns = textHeaderColumns(line);
    return columns.length > 1 && (line.includes('\t') || Boolean(findHeader(columns)) || Object.keys(suggestedHeaderMapping(columns)).length > 0);
  });
  if (headerIndex < 0) throw new Error('Clipboard does not contain a supported historical savings table.');
  const columns = textHeaderColumns(lines[headerIndex]);
  const dataLines = lines.slice(headerIndex + 1);
  const nonEmpty = dataLines.map((line) => line.trim()).filter(Boolean);
  const hasDelimitedRows = dataLines.some((line) => splitTextColumns(line).filter(Boolean).length > 1);
  const rows = hasDelimitedRows
    ? dataLines.map(splitTextColumns).filter((row) => row.some(Boolean))
    : Array.from({ length: Math.ceil(nonEmpty.length / columns.length) }, (_, index) => nonEmpty.slice(index * columns.length, (index + 1) * columns.length));
  const table = { columns, rows, suggestedMapping: suggestedHeaderMapping(columns) };
  const indexes = findHeader(columns);
  return indexes ? parseHistoricalSavingsTable(table, indexes) : ambiguousTable(columns, rows);
}

interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<Blob>;
}

interface ClipboardLike {
  read?: () => Promise<ClipboardItemLike[]>;
  readText?: () => Promise<string>;
}

/** Prefer HTML clipboard data, falling back to the plain-text representation. */
export async function readHistoricalSavingsRatesFromClipboard(clipboard?: ClipboardLike): Promise<HistoricalSavingsClipboardResult> {
  const source = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  if (!source) throw new Error('Clipboard access is not available in this browser.');
  let htmlError: unknown;
  if (source.read) {
    try {
      const items = await source.read();
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        try {
          return parseHistoricalSavingsRatesHtml(await (await item.getType('text/html')).text());
        } catch (cause) {
          htmlError = cause;
        }
      }
    } catch (cause) {
      htmlError = cause;
    }
  }
  if (source.readText) {
    try {
      return parseHistoricalSavingsRatesText(await source.readText());
    } catch (cause) {
      if (!htmlError) htmlError = cause;
    }
  }
  if (htmlError instanceof Error) throw htmlError;
  throw new Error('Clipboard access is not available in this browser.');
}
