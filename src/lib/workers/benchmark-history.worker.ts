/// <reference lib="webworker" />
import { buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries } from '../../backtest.mjs';
import type { BenchmarkHistoryRequest, BenchmarkPeriod, BenchmarkSeries } from '../types';

const lookbackPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365, '2y': 730, '5y': 1825 } as const;
const forwardPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365 } as const;

type SeriesBuilder = (data: Record<string, unknown>, from: string, to: string, options: { lookbackDays: number }) => BenchmarkSeries['csh2'];

function buildSeries(periods: Record<string, number>, buildCsh2: SeriesBuilder, buildOvernight: SeriesBuilder, request: BenchmarkHistoryRequest) {
  return Object.fromEntries(Object.entries(periods).map(([period, lookbackDays]) => [period, {
    csh2: buildCsh2(request.prices, '', request.to, { lookbackDays }),
    overnight: buildOvernight(request.rates, '', request.to, { lookbackDays })
  }])) as Record<BenchmarkPeriod, BenchmarkSeries>;
}

self.onmessage = ({ data }: MessageEvent<BenchmarkHistoryRequest>) => {
  try {
    self.postMessage({ ok: true, history: {
      lookback: buildSeries(lookbackPeriods, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, data),
      forward: buildSeries(forwardPeriods, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, data)
    } });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
