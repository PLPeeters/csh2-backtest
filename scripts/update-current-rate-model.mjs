import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCalculatedCurrentRateModelHealthy, calculateCurrentRateModel } from '../src/backtest.mjs';
import { publishCurrentRateModel } from '../src/lib/services/current-rate-model-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pricePath = resolve(root, 'src/assets/data/csh2-prices.json');
const benchmarkPath = resolve(root, 'src/assets/data/overnight-rates.json');
const publicationPath = resolve(root, 'src/assets/data/current-rate-model.json');

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

const [priceEnvelope, benchmarkEnvelope] = await Promise.all([
  readFile(pricePath, 'utf8').then(JSON.parse),
  readFile(benchmarkPath, 'utf8').then(JSON.parse)
]);
const valuationDate = Object.entries(priceEnvelope.prices)
  .filter(([, record]) => !record?.isFallback && Number.isFinite(record?.close))
  .map(([date]) => date)
  .sort()
  .at(-1);

if (!valuationDate) throw new Error('The current-rate model update found no real CSH2 closes.');
const model = assertCalculatedCurrentRateModelHealthy(
  calculateCurrentRateModel(priceEnvelope.prices, benchmarkEnvelope.rates, valuationDate)
);
const publication = publishCurrentRateModel(model, priceEnvelope.prices, benchmarkEnvelope.rates);
await writeJson(publicationPath, publication);

console.log(`Updated the current-rate model as of ${model.valuationDate}.`);
