import priceUrl from '../../assets/data/csh2-prices.json?url';
import rateUrl from '../../assets/data/overnight-rates.json?url';
import currentRateModelUrl from '../../assets/data/current-rate-model.json?url';
import type { MarketDataBundle, PriceEnvelope, RateEnvelope } from '../types';
import { assertValidCurrentRateModelPublication, CURRENT_RATE_MODEL_PUBLICATION_SCHEMA } from './current-rate-model-publication.mjs';

let cached: Promise<MarketDataBundle> | undefined;

function validPrices(value: unknown): value is PriceEnvelope {
  return !!value && typeof value === 'object' && typeof (value as PriceEnvelope).cachedAt === 'string' &&
    !!(value as PriceEnvelope).prices && typeof (value as PriceEnvelope).prices === 'object';
}

function validRates(value: unknown): value is RateEnvelope {
  return !!value && typeof value === 'object' && !!(value as RateEnvelope).rates && typeof (value as RateEnvelope).rates === 'object';
}

export async function loadOptionalCurrentRateModel(response: Response) {
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The published current-rate model could not be loaded (HTTP ${response.status}).`);
  const publication = assertValidCurrentRateModelPublication(await response.json());
  return publication.schemaVersion === CURRENT_RATE_MODEL_PUBLICATION_SCHEMA ? publication : undefined;
}

export function loadMarketData(): Promise<MarketDataBundle> {
  cached ??= Promise.all([fetch(priceUrl), fetch(rateUrl), fetch(currentRateModelUrl)]).then(async ([priceResponse, rateResponse, modelResponse]) => {
    const priceValue: unknown = await priceResponse.json();
    if (!priceResponse.ok || !validPrices(priceValue)) throw new Error('The published CSH2 price data could not be loaded.');
    let rateData: RateEnvelope = { rates: {} };
    if (rateResponse.ok) {
      const rateValue: unknown = await rateResponse.json();
      if (!validRates(rateValue)) throw new Error('The published overnight benchmark data is invalid.');
      rateData = rateValue;
    }
    const currentRateModel = await loadOptionalCurrentRateModel(modelResponse);
    return { data: priceValue, rateData, currentRateModel, version: `${priceUrl}|${rateUrl}|${currentRateModelUrl}` };
  }).catch((error) => { cached = undefined; throw error; });
  return cached;
}
