import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentRateModelHealthy } from '../src/backtest/current-rate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const priceEnvelope = JSON.parse(await readFile(resolve(root, 'src/assets/data/csh2-prices.json'), 'utf8'));
const rateEnvelope = JSON.parse(await readFile(resolve(root, 'src/assets/data/overnight-rates.json'), 'utf8'));
const valuationDate = Object.entries(priceEnvelope.prices)
  .filter(([, record]) => !record?.isFallback && Number.isFinite(record?.close))
  .map(([date]) => date)
  .sort()
  .at(-1);

if (!valuationDate) throw new Error('The current-rate model health check found no real CSH2 closes.');
const model = assertCurrentRateModelHealthy(priceEnvelope.prices, rateEnvelope.rates, valuationDate);
console.log(
  `Current-rate model healthy as of ${model.valuationDate}: ` +
  `validation MAE ${model.modelErrorAnnualRatePercent.toFixed(4)} pp, ` +
  `latest annual-period MAE ${model.recentMaeAnnualRatePercent.toFixed(4)} pp, ` +
  `${model.errorValidationObservations} validation observations.`
);
