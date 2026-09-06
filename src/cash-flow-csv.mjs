function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseImportedDate(value, format) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!match) return null;
  const [, first, second, third] = match;
  let year;
  let month;
  let day;
  if (format === 'iso') [year, month, day] = [Number(first), Number(second), Number(third)];
  if (format === 'dmy') [day, month, year] = [Number(first), Number(second), Number(third)];
  if (format === 'mdy') [month, day, year] = [Number(first), Number(second), Number(third)];
  if (third.length === 2 && format !== 'iso') year += 2000;
  if (!Number.isInteger(year) || String(year).length !== 4 || !validDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumericAmount(value) {
  let text = String(value ?? '').trim().replace(/[€$£\s\u00a0]/g, '');
  if (!text) return Number.NaN;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replaceAll('.', '').replace(',', '.') : text.replaceAll(',', '');
  } else if (lastComma >= 0) {
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replaceAll(',', '') : text.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replaceAll('.', '');
  }
  return Number(text);
}

export function parseImportedAmount(value) {
  const amount = parseNumericAmount(value);
  return Number.isFinite(amount) && amount !== 0 ? amount : null;
}

function normalizeDescription(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function headerMatch(headers, patterns) {
  return headers.find((header) => patterns.some((pattern) => pattern.test(normalizeDescription(header))));
}

const descriptionHeaderPatterns = [
  /description/, /\bdesc\b/, /libell/, /communication/, /omschrijving/, /beschrijving/, /mededeling/, /verrichting/, /motif/,
  /memo/, /details?/, /notes?/, /message/, /comment/, /referen[ct]/
];

const interestDescriptionPatterns = [
  /\binterest(?:s)?\b/, /\binteret(?:s)?\b/, /\brente(?:s)?\b/, /\brentevergoeding\b/, /\brentebetaling\b/, /\bbasisrente\b/,
  /\bprimes? (?:de )?fidelite\b/, /\bbonus(?: de)? fidelite\b/, /\bfidelity premium\b/, /\bfidelity bonus\b/, /\bloyalty premium\b/, /\bloyalty bonus\b/,
  /\bgetrouwheids? ?premies?\b/, /\bgetrouwheids? ?bonus\b/, /\bloyaliteits? ?premies?\b/, /\btrouwpremies?\b/
];

const liquidationActionPatterns = [
  /\bliquidat(?:ion|ie)\b/, /\bvereffen(?:ing|en)\b/, /\bsettlement\b/, /\bafloss(?:ing|en)\b/, /\bterugbetal(?:ing|en)\b/, /\bterugstorting\b/,
  /\brembours(?:ement|er)?\b/, /\bremboursement\b/, /\brembourse\b/, /\bdeblocage\b/, /\bliberation\b/, /\bdenouement\b/,
  /\bmatur(?:ity|ed)\b/, /\becheance\b/, /\bvervaldag\b/, /\bvervallen\b/, /\bcloture\b/, /\bclosing\b/, /\bclosure\b/, /\bclosed\b/, /\bsluiting\b/, /\bafsluiting\b/,
  /\bbeeindiging\b/, /\btermination\b/, /\bredemption\b/, /\bvrijgave\b/
];

const liquidationInstrumentPatterns = [
  /\bemprunt\b/, /\bpret\b/, /\bcompte a terme\b/, /\bdepot a terme\b/, /\bplacement a terme\b/, /\blening\b/, /\btermijnrekening\b/,
  /\btermijndeposito\b/, /\bdeposito\b/, /\bloan\b/, /\bdeposit(?:s)?\b/, /\bterm account\b/, /\bterm deposit\b/, /\bfixed term\b/, /\btime deposit\b/
];

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function isInterestDescription(value) {
  const text = normalizeDescription(value);
  if (!text) return false;
  return matchesAny(text, interestDescriptionPatterns)
    || (matchesAny(text, liquidationActionPatterns) && matchesAny(text, liquidationInstrumentPatterns));
}

function formatForDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!match) return null;
  const [, first, second, third] = match;
  if (first.length === 4 && parseImportedDate(text, 'iso')) return 'iso';
  const dmy = parseImportedDate(text, 'dmy');
  const mdy = parseImportedDate(text, 'mdy');
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  if (dmy && mdy) return 'ambiguous';
  return null;
}

function columnValues(rows, column) {
  return rows.slice(0, 50).map((row) => row[column]).filter((value) => String(value ?? '').trim());
}

export function detectCsvMapping(rows, headers) {
  const dateHeader = headerMatch(headers, [/date/, /datum/]);
  const amountHeader = headerMatch(headers, [/amount/, /bedrag/, /value/, /mutatie/]);
  const descriptionHeader = headerMatch(headers, descriptionHeaderPatterns);
  const dateCandidates = headers.filter((header) => {
    const values = columnValues(rows, header);
    return values.length && values.every((value) => formatForDate(value));
  });
  const amountCandidates = headers.filter((header) => {
    const values = columnValues(rows, header);
    return values.length && values.every((value) => Number.isFinite(parseNumericAmount(value)));
  });
  const dateColumn = dateHeader ?? (dateCandidates.length === 1 ? dateCandidates[0] : headers[0]);
  const amountColumn = amountHeader ?? (amountCandidates.length === 1 ? amountCandidates[0] : headers[0]);
  const formats = columnValues(rows, dateColumn).map(formatForDate);
  const isoCount = formats.filter((format) => format === 'iso').length;
  const dmyCount = formats.filter((format) => format === 'dmy').length;
  const mdyCount = formats.filter((format) => format === 'mdy').length;
  const dateFormat = isoCount ? 'iso' : mdyCount > dmyCount ? 'mdy' : 'dmy';
  return { dateColumn, amountColumn, descriptionColumn: descriptionHeader ?? '', dateFormat };
}

export function mapImportedRows(rows, { dateColumn, amountColumn, descriptionColumn = '', dateFormat }) {
  const flows = [];
  const invalidRows = [];
  rows.forEach((row, index) => {
    const date = parseImportedDate(row[dateColumn], dateFormat);
    const signedAmount = parseImportedAmount(row[amountColumn]);
    if (!date || signedAmount === null) {
      invalidRows.push(index + 2);
      return;
    }
    const type = signedAmount < 0 ? 'outflow' : 'inflow';
    flows.push({ date, type, amount: Math.abs(signedAmount), interestPayment: type === 'inflow' && isInterestDescription(descriptionColumn ? row[descriptionColumn] : '') });
  });
  return { flows: flows.toSorted((first, second) => first.date.localeCompare(second.date)), invalidRows };
}
