import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithBackoff, retryAfterMilliseconds } from '../scripts/fetch-with-backoff.mjs';

function response(status, retryAfter) {
  return { status, headers: new Headers(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }) };
}

test('parses Retry-After seconds and HTTP dates', () => {
  const now = Date.parse('2026-08-11T12:00:00Z');
  assert.equal(retryAfterMilliseconds('12', now), 12_000);
  assert.equal(retryAfterMilliseconds('Tue, 11 Aug 2026 12:00:20 GMT', now), 20_000);
  assert.equal(retryAfterMilliseconds('invalid', now), undefined);
});

test('uses Retry-After when Yahoo responds with 429', async () => {
  const responses = [response(429, '23'), response(200)];
  const delays = [];
  const result = await fetchWithBackoff('https://example.test', {}, {
    retryStatuses: [429],
    retryDelaysMilliseconds: [10_000],
    request: async () => responses.shift(),
    sleep: async (delay) => delays.push(delay)
  });

  assert.equal(result.status, 200);
  assert.deepEqual(delays, [23_000]);
});

test('falls back to exponential delays and stops after the configured retries', async () => {
  const delays = [];
  let requestCount = 0;
  const result = await fetchWithBackoff('https://example.test', {}, {
    retryStatuses: [429],
    retryDelaysMilliseconds: [10_000, 20_000],
    request: async () => { requestCount += 1; return response(429); },
    sleep: async (delay) => delays.push(delay)
  });

  assert.equal(result.status, 429);
  assert.equal(requestCount, 3);
  assert.deepEqual(delays, [10_000, 20_000]);
});

test('retries configured errors with fresh request options', async () => {
  const delays = [];
  const requestOptions = [];
  let requestCount = 0;
  const result = await fetchWithBackoff('https://example.test', () => ({ attempt: requestOptions.length + 1 }), {
    retryStatuses: [429],
    retryDelaysMilliseconds: [10_000],
    retryError: (error) => error.name === 'TimeoutError',
    request: async (_input, init) => {
      requestOptions.push(init);
      requestCount += 1;
      if (requestCount === 1) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return response(200);
    },
    sleep: async (delay) => delays.push(delay)
  });

  assert.equal(result.status, 200);
  assert.deepEqual(requestOptions, [{ attempt: 1 }, { attempt: 2 }]);
  assert.deepEqual(delays, [10_000]);
});
