import { describe, expect, it } from 'vitest';
import type { BenchmarkHistoryRequest } from '../types';
import { benchmarkHistoryRequestKey } from './benchmark-history';

function request(overrides: Partial<BenchmarkHistoryRequest> = {}): BenchmarkHistoryRequest {
  return {
    prices: { '2026-08-20': { close: 100 } },
    rates: { '2026-08-20': 2 },
    to: '2026-08-20',
    ...overrides
  };
}

describe('benchmark history request identity', () => {
  it('is stable for equivalent requests', () => {
    expect(benchmarkHistoryRequestKey(request())).toBe(benchmarkHistoryRequestKey(request()));
  });

  it('invalidates when same-sized price or rate records are corrected', () => {
    const original = benchmarkHistoryRequestKey(request());
    const correctedPrice = benchmarkHistoryRequestKey(request({ prices: { '2026-08-20': { close: 100.01 } } }));
    const correctedRate = benchmarkHistoryRequestKey(request({ rates: { '2026-08-20': 2.01 } }));

    expect(correctedPrice).not.toBe(original);
    expect(correctedRate).not.toBe(original);
  });

  it('invalidates when the requested valuation date changes', () => {
    expect(benchmarkHistoryRequestKey(request({ to: '2026-08-19' }))).not.toBe(benchmarkHistoryRequestKey(request()));
  });
});
