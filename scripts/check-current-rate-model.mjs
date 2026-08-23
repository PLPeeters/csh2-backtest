import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCalculatedCurrentRateModelHealthy } from '../src/backtest/current-rate.mjs';
import { assertValidCurrentRateModelPublication, compatiblePublishedCurrentRateModel } from '../src/lib/services/current-rate-model-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const priceEnvelope = JSON.parse(await readFile(resolve(root, 'src/assets/data/csh2-prices.json'), 'utf8'));
const rateEnvelope = JSON.parse(await readFile(resolve(root, 'src/assets/data/overnight-rates.json'), 'utf8'));
const publication = assertValidCurrentRateModelPublication(JSON.parse(await readFile(resolve(root, 'src/assets/data/current-rate-model.json'), 'utf8')));
const valuationDate = Object.entries(priceEnvelope.prices)
  .filter(([, record]) => !record?.isFallback && Number.isFinite(record?.close))
  .map(([date]) => date)
  .sort()
  .at(-1);

if (!valuationDate) throw new Error('The current-rate model health check found no real CSH2 closes.');
const publishedModel = compatiblePublishedCurrentRateModel(publication, priceEnvelope.prices, rateEnvelope.rates, valuationDate);
if (!publishedModel) throw new Error('The published current-rate model is stale or incompatible with the current market data.');
const model = assertCalculatedCurrentRateModelHealthy(publishedModel);
console.log(
  `Current-rate model healthy as of ${model.valuationDate}: ` +
  `validation MAE ${model.modelErrorAnnualRatePercent.toFixed(4)} pp, ` +
  `latest annual-period MAE ${model.recentMaeAnnualRatePercent.toFixed(4)} pp, ` +
  `${model.errorValidationObservations} validation observations.`
);
