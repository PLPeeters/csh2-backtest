import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { latestAvailablePriceDate } from '../src/static-market-data.mjs';

test('uses the latest stored closing price no later than today', () => {
  assert.equal(latestAvailablePriceDate({
    '2026-08-01': { open: 100, close: 101 },
    '2026-08-03': { open: 102, close: 103 },
    '2026-08-31': { close: 110, period: 'monthly' }
  }, '2026-08-03'), '2026-08-03');
});

test('does not treat a fallback price as the latest published close', () => {
  assert.equal(latestAvailablePriceDate({
    '2026-08-03': { open: 100, close: 101 },
    '2026-08-04': { close: 101, isFallback: true, fallbackSource: '2026-08-03' }
  }, '2026-08-04'), '2026-08-03');
});

test('publishes the full euro overnight benchmark history', async () => {
  const benchmark = JSON.parse(await readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8'));
  assert.deepEqual(benchmark.segments, [
    { id: 'eonia', label: 'EONIA', start: '2015-03-13', end: '2018-08-31', series: 'EON/D.EONIA_TO.RATE' },
    { id: 'pre-estr', label: 'Pre-Euro Short-Term Rate', start: '2018-09-03', end: '2019-09-30', series: 'MMSR/B.U2._X._Z.S12._Z.U.BO.WT.D76.MA._Z._Z.EUR._Z' },
    { id: 'estr', label: '€STR', start: '2019-10-01', series: 'EST/B.EU000A2X2A25.WT' }
  ]);
  assert.equal(benchmark.rates['2015-03-13'], -0.04);
  assert.equal(benchmark.rates['2018-09-03'], -0.45);
  assert.equal(benchmark.rates['2019-09-30'], -0.549);
  assert.equal(benchmark.rates['2019-10-01'], -0.549);
});

test('publishes a current-rate model for the latest real CSH2 close', async () => {
  const [prices, publication] = await Promise.all([
    readFile(new URL('../src/assets/data/csh2-prices.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/assets/data/current-rate-model.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const latestRealClose = Object.entries(prices.prices)
    .filter(([, record]) => !record.isFallback && Number.isFinite(record.close))
    .map(([date]) => date)
    .sort()
    .at(-1);
  assert.equal(publication.valuationDate, latestRealClose);
  assert.equal(publication.model.valuationDate, latestRealClose);
});
