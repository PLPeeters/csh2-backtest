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

function headerMatch(headers, patterns) {
  return headers.find((header) => patterns.some((pattern) => pattern.test(header.toLowerCase())));
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
  return { dateColumn, amountColumn, dateFormat };
}

export function mapImportedRows(rows, { dateColumn, amountColumn, dateFormat }) {
  const flows = [];
  const invalidRows = [];
  rows.forEach((row, index) => {
    const date = parseImportedDate(row[dateColumn], dateFormat);
    const signedAmount = parseImportedAmount(row[amountColumn]);
    if (!date || signedAmount === null) {
      invalidRows.push(index + 2);
      return;
    }
    flows.push({ date, type: signedAmount < 0 ? 'outflow' : 'inflow', amount: Math.abs(signedAmount) });
  });
  return { flows, invalidRows };
}
