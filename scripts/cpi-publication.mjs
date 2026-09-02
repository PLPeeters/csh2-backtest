export const CPI_DATA_SOURCE_ID = '314984ea-123f-4c42-93e5-4942cb877795';
export const CPI_BACKFILL_VIEW_ID = '942375c9-71d5-4d0c-9120-e051bd58b9d5';
export const CPI_CURRENT_VIEW_ID = '86586e27-90ac-47c6-87ce-64b63194e605';
export const CPI_LICENSE_URL = 'https://statbel.fgov.be/en/cc-40';
export const CPI_BASE = '2025 = 100';
export const CPI_SOURCE_URL = `https://bestat.statbel.fgov.be/bestat/api/views/${CPI_CURRENT_VIEW_ID}`;
export const CPI_ADAPTATIONS = 'Selected the all-items rows, deduplicated observations, and normalized the result into one monthly series.';

export const frenchMonths = Object.freeze({
  janvier: '01', février: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', août: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12'
});

export const englishMonths = Object.freeze({
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
});

function factsFrom(response) {
  const facts = Array.isArray(response) ? response : response?.facts;
  if (!Array.isArray(facts)) throw new Error('Statbel CPI response does not contain a facts array.');
  return facts;
}

function monthKey(year, label, monthMap) {
  if (label === null || label === undefined) return undefined;
  if (typeof year !== 'string' && typeof year !== 'number') throw new Error('Statbel CPI row has no valid year.');
  if (typeof label !== 'string') throw new Error(`Statbel CPI row for ${year} has no valid month label.`);
  const month = monthMap[label.trim().split(/\s+/)[0].toLocaleLowerCase('fr-BE')];
  if (!month) throw new Error(`Statbel CPI row has an unknown month label: ${label}.`);
  const normalizedYear = String(year);
  if (!/^\d{4}$/.test(normalizedYear)) throw new Error(`Statbel CPI row has an invalid year: ${year}.`);
  return `${normalizedYear}-${month}`;
}

function addObservation(indices, month, rawValue) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) throw new Error(`Statbel CPI observation for ${month} must be a positive finite number.`);
  const value = Math.round((numericValue + Number.EPSILON) * 100_000_000) / 100_000_000;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Statbel CPI observation for ${month} must be a positive finite number.`);
  if (Object.hasOwn(indices, month) && indices[month] !== value) {
    throw new Error(`Statbel CPI contains conflicting observations for ${month}: ${indices[month]} and ${value}.`);
  }
  indices[month] = value;
}

function sorted(indices) {
  return Object.fromEntries(Object.entries(indices).sort(([left], [right]) => left.localeCompare(right)));
}

export function parseBackfillCpiFacts(response) {
  const indices = {};
  for (const row of factsFrom(response)) {
    const month = monthKey(row['Année'], row['Mois'], frenchMonths);
    if (!month) continue;
    if (row['Année de base'] !== CPI_BASE) throw new Error(`Statbel CPI backfill has unexpected base year ${row['Année de base'] ?? 'unknown'}; expected ${CPI_BASE}.`);
    addObservation(indices, month, row['Indice des prix à la consommation']);
  }
  if (!Object.keys(indices).length) throw new Error('Statbel CPI backfill contains no monthly observations.');
  return sorted(indices);
}

export function parseCurrentCpiFacts(response) {
  const indices = {};
  for (const row of factsFrom(response)) {
    if (row['Global Index'] !== 'Global Index' || row['Level 1'] !== null) continue;
    const month = monthKey(row.Year, row.Month, englishMonths);
    if (!month) continue;
    if (row['Base year'] !== CPI_BASE) throw new Error(`Statbel current CPI view has unexpected base year ${row['Base year'] ?? 'unknown'}; expected ${CPI_BASE}.`);
    addObservation(indices, month, row['Consumer price index']);
  }
  if (!Object.keys(indices).length) throw new Error('Statbel current CPI view contains no monthly all-items observations.');
  return sorted(indices);
}

export function mergeCpiIndices(reference, current) {
  const merged = sorted({ ...current, ...reference });
  assertValidIndices(merged, 'merged output');
  return merged;
}

function assertValidIndices(indices, label) {
  if (!indices || typeof indices !== 'object' || Array.isArray(indices) || !Object.keys(indices).length) {
    throw new Error(`Statbel CPI ${label} indices must be a non-empty monthly record.`);
  }
  for (const [month, value] of Object.entries(indices)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Statbel CPI ${label} observation for ${month} must be a positive finite number.`);
    }
  }
}

function assertCompleteHistory(indices, label) {
  const months = Object.keys(indices).sort();
  if (months[0] !== '2015-02') {
    throw new Error(`Statbel CPI ${label} history must begin at 2015-02; found ${months[0] ?? 'no observations'}.`);
  }
  for (let index = 1; index < months.length; index += 1) {
    const [year, month] = months[index - 1].split('-').map(Number);
    const expected = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    if (months[index] !== expected) throw new Error(`Statbel CPI ${label} history is missing monthly observation ${expected}.`);
  }
}

export function publishCpi(existingEnvelope, backfillResponse, currentResponse, timestamp) {
  const hasExistingIndices = existingEnvelope?.indices && typeof existingEnvelope.indices === 'object' && Object.keys(existingEnvelope.indices).length;
  if (hasExistingIndices && !backfillResponse && existingEnvelope.base !== CPI_BASE) {
    throw new Error(`Stored Statbel CPI publication has unexpected base ${existingEnvelope.base ?? 'unknown'}; expected ${CPI_BASE}.`);
  }
  const reference = backfillResponse
    ? parseBackfillCpiFacts(backfillResponse)
    : hasExistingIndices
      ? (assertValidIndices(existingEnvelope.indices, 'stored reference'), sorted(existingEnvelope.indices))
      : undefined;
  if (!reference) throw new Error('Statbel CPI publication requires a backfill response or stored reference indices.');
  assertCompleteHistory(reference, backfillResponse ? 'backfill' : 'stored reference');
  const current = parseCurrentCpiFacts(currentResponse);
  const merged = mergeCpiIndices(reference, current);
  assertCompleteHistory(merged, 'published output');
  return {
    source: 'Statbel (Directorate-General Statistics – Statistics Belgium)',
    dataSourceId: CPI_DATA_SOURCE_ID,
    backfillViewId: CPI_BACKFILL_VIEW_ID,
    currentViewId: CPI_CURRENT_VIEW_ID,
    license: CPI_LICENSE_URL,
    adaptations: CPI_ADAPTATIONS,
    cachedAt: timestamp,
    base: CPI_BASE,
    indices: merged
  };
}
