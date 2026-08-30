import test from 'node:test';
import assert from 'node:assert/strict';
import { marketDate, publishCsh2Prices } from '../scripts/csh2-price-publication.mjs';

test('uses the Brussels market date rather than the UTC date', () => {
  assert.equal(marketDate(new Date('2026-08-29T23:49:36Z')), '2026-08-30');
});

test('uses the market date as the fallback cutoff and remains idempotent within that day', () => {
  const firstPublication = publishCsh2Prices({
    '2026-08-28': { open: 109.86, close: 109.88 },
    '2026-08-29': { close: 109.88, isFallback: true, fallbackSource: '2026-08-28' }
  }, {}, '2026-08-30');

  assert.deepEqual(firstPublication, {
    '2026-08-28': { open: 109.86, close: 109.88 },
    '2026-08-29': { close: 109.88, isFallback: true, fallbackSource: '2026-08-28' },
    '2026-08-30': { close: 109.88, isFallback: true, fallbackSource: '2026-08-28' }
  });
  assert.deepEqual(publishCsh2Prices(firstPublication, {}, '2026-08-30'), firstPublication);
});
