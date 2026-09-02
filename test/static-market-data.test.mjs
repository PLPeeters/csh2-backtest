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

test('publishes contiguous monthly Statbel CPI history from February 2015', async () => {
  const publication = JSON.parse(await readFile(new URL('../src/assets/data/cpi.json', import.meta.url), 'utf8'));
  assert.equal(publication.dataSourceId, '314984ea-123f-4c42-93e5-4942cb877795');
  assert.equal(publication.backfillViewId, '942375c9-71d5-4d0c-9120-e051bd58b9d5');
  assert.equal(publication.currentViewId, '86586e27-90ac-47c6-87ce-64b63194e605');
  assert.equal(publication.license, 'https://statbel.fgov.be/en/cc-40');
  assert.equal(publication.base, '2025 = 100');
  assert.match(publication.adaptations, /selected.*deduplicated.*normalized/i);
  const months = Object.keys(publication.indices);
  assert.equal(months[0], '2015-02');
  assert.deepEqual(months, months.toSorted());
  for (let index = 1; index < months.length; index += 1) {
    const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() + 1);
    assert.equal(months[index], previous.toISOString().slice(0, 7));
  }
  assert.ok(Object.values(publication.indices).every((value) => Number.isFinite(value) && value > 0));
});
