import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { calculateCurrentRateModel } from '../src/backtest.mjs';
import { createCurrentRateModelCache } from '../src/lib/services/current-rate-model-cache.mjs';

test('reuses the current-rate model for the same market version, valuation date, and configuration', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache((_prices, _rates, valuationDate, configuration) => ({
    calculation: ++calculations,
    valuationDate,
    configuration
  }));

  const first = cache.get('market-v1', {}, {}, '2026-08-20');
  const repeated = cache.get('market-v1', {}, {}, '2026-08-20', {});

  assert.strictEqual(repeated, first);
  assert.equal(calculations, 1);
});

test('invalidates the current-rate model when its market version, valuation date, or configuration changes', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache(() => ({ calculation: ++calculations }));

  cache.get('market-v1', {}, {}, '2026-08-20');
  cache.get('market-v2', {}, {}, '2026-08-20');
  cache.get('market-v2', {}, {}, '2026-08-21');
  cache.get('market-v2', {}, {}, '2026-08-21', { lookbackDays: 90 });
  cache.get('market-v2', {}, {}, '2026-08-21', { lookbackDays: 90, evaluationDays: 30 });
  cache.get('market-v2', {}, {}, '2026-08-21', { lookbackDays: 90, evaluationDays: 30, validationStartDate: '2025-01-01' });

  assert.equal(calculations, 6);
});

test('invalidates when source prices or rates change under an unchanged market key', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache(() => ({ calculation: ++calculations }));
  const prices = { '2026-08-20': { close: 100 } };
  const rates = { '2026-08-20': 2 };

  const first = cache.get('market-v1', prices, rates, '2026-08-20');
  const changedPrices = cache.get('market-v1', { ...prices, '2026-08-20': { close: 101 } }, rates, '2026-08-20');
  const changedRates = cache.get('market-v1', prices, { ...rates, '2026-08-20': 2.1 }, '2026-08-20');

  assert.deepEqual([first.calculation, changedPrices.calculation, changedRates.calculation], [1, 2, 3]);
});

test('invalidates when source prices or rates are mutated in place', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache(() => ({ calculation: ++calculations }));
  const prices = { '2026-08-20': { close: 100 } };
  const rates = { '2026-08-20': 2 };

  const first = cache.get('market-v1', prices, rates, '2026-08-20');
  prices['2026-08-20'].close = 101;
  const changedPrices = cache.get('market-v1', prices, rates, '2026-08-20');
  rates['2026-08-20'] = 2.1;
  const changedRates = cache.get('market-v1', prices, rates, '2026-08-20');

  assert.deepEqual([first.calculation, changedPrices.calculation, changedRates.calculation], [1, 2, 3]);
});

test('does not cache unavailable or failed current-rate model calculations', () => {
  let calculations = 0;
  const cache = createCurrentRateModelCache(() => {
    calculations += 1;
    if (calculations === 1) return undefined;
    if (calculations === 2) throw new Error('temporary model failure');
    return { calculation: calculations };
  });

  assert.equal(cache.get('market-v1', {}, {}, '2026-08-20'), undefined);
  assert.throws(() => cache.get('market-v1', {}, {}, '2026-08-20'), /temporary model failure/);
  const recovered = cache.get('market-v1', {}, {}, '2026-08-20');
  assert.deepEqual(recovered, { calculation: 3 });
  assert.strictEqual(cache.get('market-v1', {}, {}, '2026-08-20'), recovered);
  assert.equal(calculations, 3);
});

test('cached and uncached current-rate calculations are equivalent for published market data', async () => {
  const [priceEnvelope, rateEnvelope] = await Promise.all([
    readFile(new URL('../src/assets/data/csh2-prices.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const valuationDate = Object.keys(priceEnvelope.prices).sort().at(-1);
  const uncached = calculateCurrentRateModel(priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  const cache = createCurrentRateModelCache(calculateCurrentRateModel);

  const cached = cache.get('published-v1', priceEnvelope.prices, rateEnvelope.rates, valuationDate);

  assert.ok(uncached);
  assert.deepEqual(cached, uncached);
});

test('published-history repeat benchmark makes cache lookup cheaper than one model construction', async (t) => {
  const [priceEnvelope, rateEnvelope] = await Promise.all([
    readFile(new URL('../src/assets/data/csh2-prices.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const valuationDate = Object.keys(priceEnvelope.prices).sort().at(-1);
  const buildStarted = performance.now();
  const model = calculateCurrentRateModel(priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  const buildMilliseconds = performance.now() - buildStarted;
  assert.ok(model);

  const cache = createCurrentRateModelCache(calculateCurrentRateModel);
  const cached = cache.get('published-v1', priceEnvelope.prices, rateEnvelope.rates, valuationDate);
  assert.deepEqual(cached, model);
  const repeatCount = 10;
  let checksum = 0;
  const repeatsStarted = performance.now();
  for (let calculation = 0; calculation < repeatCount; calculation += 1) {
    checksum += cache.get('published-v1', priceEnvelope.prices, rateEnvelope.rates, valuationDate).csh2AnnualRatePercent;
  }
  const repeatMilliseconds = performance.now() - repeatsStarted;
  const averageRepeatMilliseconds = repeatMilliseconds / repeatCount;

  assert.ok(Number.isFinite(checksum));
  assert.ok(
    averageRepeatMilliseconds < buildMilliseconds / 2,
    `cached recalculation average (${averageRepeatMilliseconds.toFixed(2)} ms) should not be dominated by historical model construction (${buildMilliseconds.toFixed(2)} ms)`
  );
  t.diagnostic(
    `historical build ${buildMilliseconds.toFixed(2)} ms; ${repeatCount} cached repeats ${repeatMilliseconds.toFixed(2)} ms ` +
    `(${averageRepeatMilliseconds.toFixed(2)} ms/repeat, ${(buildMilliseconds / averageRepeatMilliseconds).toFixed(1)}x faster)`
  );
});
