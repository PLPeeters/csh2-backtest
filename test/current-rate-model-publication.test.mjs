import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCurrentRateModel } from '../src/backtest.mjs';
import { createCurrentRateModelCache } from '../src/lib/services/current-rate-model-cache.mjs';
import {
  assertValidCurrentRateModelPublication,
  compatiblePublishedCurrentRateModel,
  publishCurrentRateModel
} from '../src/lib/services/current-rate-model-publication.mjs';

const priceEnvelope = JSON.parse(await readFile(new URL('../src/assets/data/csh2-prices.json', import.meta.url), 'utf8'));
const rateEnvelope = JSON.parse(await readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8'));
const storedPublication = JSON.parse(await readFile(new URL('../src/assets/data/current-rate-model.json', import.meta.url), 'utf8'));
const valuationDate = Object.entries(priceEnvelope.prices)
  .filter(([, record]) => !record?.isFallback && Number.isFinite(record?.close))
  .map(([date]) => date)
  .sort()
  .at(-1);

test('publishes a validated model tied to its valuation date, configuration, and source records', () => {
  const calculated = calculateCurrentRateModel(priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  const publication = publishCurrentRateModel(calculated, priceEnvelope.prices, rateEnvelope.rates);

  assert.deepEqual(assertValidCurrentRateModelPublication(publication), publication);
  assert.equal(publication.valuationDate, valuationDate);
  assert.deepEqual(compatiblePublishedCurrentRateModel(publication, priceEnvelope.prices, rateEnvelope.rates, valuationDate), calculated);
});

test('the checked-in published model has parity with a fresh calculation', () => {
  const calculated = calculateCurrentRateModel(priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  const published = compatiblePublishedCurrentRateModel(storedPublication, priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  assert.deepEqual(published, calculated);
});

test('the browser cache consumes a compatible publication without recalculating', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache(() => { calculations += 1; return undefined; });

  const model = cache.get('market-v1', priceEnvelope.prices, rateEnvelope.rates, valuationDate, undefined, storedPublication);

  assert.deepEqual(model, storedPublication.model);
  assert.equal(calculations, 0);
});

test('missing, stale, and unknown-schema publications fall back to runtime calculation', () => {
  const expected = { calculated: true };
  let calculations = 0;
  const calculate = () => { calculations += 1; return expected; };
  const changedPrices = { ...priceEnvelope.prices, [valuationDate]: { ...priceEnvelope.prices[valuationDate], close: priceEnvelope.prices[valuationDate].close + 0.01 } };

  assert.equal(createCurrentRateModelCache(calculate).get('missing', priceEnvelope.prices, rateEnvelope.rates, valuationDate), expected);
  assert.equal(createCurrentRateModelCache(calculate).get('stale', changedPrices, rateEnvelope.rates, valuationDate, undefined, storedPublication), expected);
  assert.equal(createCurrentRateModelCache(calculate).get('future', priceEnvelope.prices, rateEnvelope.rates, valuationDate, undefined, { schemaVersion: 2 }), expected);
  assert.equal(calculations, 3);
});

test('current-schema malformed data is rejected with a field-level diagnostic', () => {
  const malformed = structuredClone(storedPublication);
  malformed.model.errorWindows[0].maeAnnualRatePercent = 'not-a-number';

  assert.throws(
    () => assertValidCurrentRateModelPublication(malformed),
    /model\.errorWindows\[0\]\.maeAnnualRatePercent must be a finite number/
  );
  assert.throws(
    () => compatiblePublishedCurrentRateModel({ model: {} }, priceEnvelope.prices, rateEnvelope.rates, valuationDate),
    /schemaVersion must be a positive integer/
  );
});
