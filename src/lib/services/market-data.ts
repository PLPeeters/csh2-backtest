import priceUrl from '../../assets/data/csh2-prices.json?url';
import rateUrl from '../../assets/data/overnight-rates.json?url';
import currentRateModelUrl from '../../assets/data/current-rate-model.json?url';
import cpiUrl from '../../assets/data/cpi.json?url';
import type { CpiEnvelope, MarketDataBundle, PriceEnvelope, RateEnvelope } from '../types';
import { assertValidCurrentRateModelPublication, CURRENT_RATE_MODEL_PUBLICATION_SCHEMA } from './current-rate-model-publication.mjs';

let cached: Promise<MarketDataBundle> | undefined;

function validPrices(value: unknown): value is PriceEnvelope {
  return !!value && typeof value === 'object' && typeof (value as PriceEnvelope).cachedAt === 'string' &&
    !!(value as PriceEnvelope).prices && typeof (value as PriceEnvelope).prices === 'object';
}

function validRates(value: unknown): value is RateEnvelope {
  return !!value && typeof value === 'object' && !!(value as RateEnvelope).rates && typeof (value as RateEnvelope).rates === 'object';
}

const expectedCpiFields = {
  dataSourceId: '314984ea-123f-4c42-93e5-4942cb877795',
  backfillViewId: '942375c9-71d5-4d0c-9120-e051bd58b9d5',
  currentViewId: '86586e27-90ac-47c6-87ce-64b63194e605',
  license: 'https://statbel.fgov.be/en/cc-40'
} as const;

export function assertValidCpiEnvelope(value: unknown): CpiEnvelope {
  if (!value || typeof value !== 'object') throw new Error('The published Belgian CPI data is invalid: expected an object.');
  const candidate = value as Partial<CpiEnvelope>;
  for (const [field, expected] of Object.entries(expectedCpiFields)) {
    if (candidate[field as keyof CpiEnvelope] !== expected) throw new Error(`The published Belgian CPI data is invalid: ${field} has an unexpected value.`);
  }
  for (const field of ['source', 'adaptations', 'cachedAt', 'base'] as const) {
    if (typeof candidate[field] !== 'string' || !candidate[field]) throw new Error(`The published Belgian CPI data is invalid: ${field} is required.`);
  }
  if (!candidate.indices || typeof candidate.indices !== 'object' || !Object.keys(candidate.indices).length) throw new Error('The published Belgian CPI data is invalid: indices are required.');
  const months = Object.keys(candidate.indices).sort();
  if (months[0] !== '2015-02') throw new Error(`The published Belgian CPI data is invalid: coverage must begin at 2015-02, found ${months[0]}.`);
  for (const [index, month] of months.entries()) {
    const observation = candidate.indices[month];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(observation) || observation <= 0) throw new Error(`The published Belgian CPI data is invalid at ${month}.`);
    if (index > 0) {
      const [previousYear, previousMonth] = months[index - 1].split('-').map(Number);
      const expected = previousMonth === 12
        ? `${previousYear + 1}-01`
        : `${previousYear}-${String(previousMonth + 1).padStart(2, '0')}`;
      if (month !== expected) throw new Error(`The published Belgian CPI data is invalid: missing monthly observation ${expected}.`);
    }
  }
  return candidate as CpiEnvelope;
}

export async function loadCpi(response: Response) {
  if (!response.ok) throw new Error(`The published Belgian CPI data could not be loaded (HTTP ${response.status}).`);
  return assertValidCpiEnvelope(await response.json());
}

export async function loadOptionalCurrentRateModel(response: Response) {
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The published current-rate model could not be loaded (HTTP ${response.status}).`);
  const publication = assertValidCurrentRateModelPublication(await response.json());
  return publication.schemaVersion === CURRENT_RATE_MODEL_PUBLICATION_SCHEMA ? publication : undefined;
}

export function loadMarketData(): Promise<MarketDataBundle> {
  cached ??= Promise.all([fetch(priceUrl), fetch(rateUrl), fetch(currentRateModelUrl), fetch(cpiUrl)]).then(async ([priceResponse, rateResponse, modelResponse, cpiResponse]) => {
    const priceValue: unknown = await priceResponse.json();
    if (!priceResponse.ok || !validPrices(priceValue)) throw new Error('The published CSH2 price data could not be loaded.');
    let rateData: RateEnvelope = { rates: {} };
    if (rateResponse.ok) {
      const rateValue: unknown = await rateResponse.json();
      if (!validRates(rateValue)) throw new Error('The published overnight benchmark data is invalid.');
      rateData = rateValue;
    }
    const currentRateModel = await loadOptionalCurrentRateModel(modelResponse);
    const cpiData = await loadCpi(cpiResponse);
    return { data: priceValue, rateData, cpiData, currentRateModel, version: `${priceUrl}|${rateUrl}|${currentRateModelUrl}|${cpiUrl}|${cpiData.cachedAt}` };
  }).catch((error) => { cached = undefined; throw error; });
  return cached;
}
