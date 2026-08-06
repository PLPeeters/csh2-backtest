import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRefreshMode } from '../scripts/refresh-data-mode.mjs';

test('refreshes both datasets when no mode is selected', () => {
  assert.deepEqual(parseRefreshMode([]), { csh2: true, overnightRates: true });
});

test('selects only the requested dataset', () => {
  assert.deepEqual(parseRefreshMode(['--csh2']), { csh2: true, overnightRates: false });
  assert.deepEqual(parseRefreshMode(['--overnight-rates']), { csh2: false, overnightRates: true });
});

test('rejects unsupported refresh modes', () => {
  assert.throws(() => parseRefreshMode(['--everything']), /Unknown refresh mode/);
});
