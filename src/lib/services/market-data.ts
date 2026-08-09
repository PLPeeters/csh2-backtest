import priceUrl from '../../assets/data/csh2-prices.json?url';
import rateUrl from '../../assets/data/overnight-rates.json?url';
import type { MarketDataBundle, PriceEnvelope, RateEnvelope } from '../types';

let cached: Promise<MarketDataBundle> | undefined;

function validPrices(value: unknown): value is PriceEnvelope {
  return !!value && typeof value === 'object' && typeof (value as PriceEnvelope).cachedAt === 'string' &&
    !!(value as PriceEnvelope).prices && typeof (value as PriceEnvelope).prices === 'object';
}

function validRates(value: unknown): value is RateEnvelope {
  return !!value && typeof value === 'object' && !!(value as RateEnvelope).rates && typeof (value as RateEnvelope).rates === 'object';
}

export function loadMarketData(): Promise<MarketDataBundle> {
  cached ??= Promise.all([fetch(priceUrl), fetch(rateUrl)]).then(async ([priceResponse, rateResponse]) => {
    const priceValue: unknown = await priceResponse.json();
    if (!priceResponse.ok || !validPrices(priceValue)) throw new Error('The published CSH2 price data could not be loaded.');
    let rateData: RateEnvelope = { rates: {} };
    if (rateResponse.ok) {
      const rateValue: unknown = await rateResponse.json();
      if (!validRates(rateValue)) throw new Error('The published overnight benchmark data is invalid.');
      rateData = rateValue;
    }
    return { data: priceValue, rateData, version: `${priceUrl}|${rateUrl}` };
  }).catch((error) => { cached = undefined; throw error; });
  return cached;
}
