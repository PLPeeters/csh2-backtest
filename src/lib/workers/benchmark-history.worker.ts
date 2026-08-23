/// <reference lib="webworker" />
import { buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, calculateCurrentRateModel, estimateConstantRateHoldingPeriods } from '../../backtest.mjs';
import type { BenchmarkHistoryRequest, BenchmarkPeriod, BenchmarkSeries } from '../types';
import { compatiblePublishedCurrentRateModel } from '../services/current-rate-model-publication.mjs';

const lookbackPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365, '2y': 730, '5y': 1825 } as const;
const forwardPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365 } as const;

type SeriesBuilder = (data: Record<string, unknown>, from: string, to: string, options: { lookbackDays: number; afterTax: boolean; applyReyndersTax?: boolean }) => BenchmarkSeries['csh2'];

function buildSeries(periods: Record<string, number>, buildCsh2: SeriesBuilder, buildOvernight: SeriesBuilder, request: BenchmarkHistoryRequest, afterTax: boolean, applyReyndersTax = false) {
  return Object.fromEntries(Object.entries(periods).map(([period, lookbackDays]) => [period, {
    csh2: buildCsh2(request.prices, '', request.to, { lookbackDays, afterTax, applyReyndersTax }),
    overnight: buildOvernight(request.rates, '', request.to, { lookbackDays, afterTax })
  }])) as Record<BenchmarkPeriod, BenchmarkSeries>;
}

function buildHistory(request: BenchmarkHistoryRequest, afterTax: boolean, applyReyndersTax = false) {
  return {
    lookback: buildSeries(lookbackPeriods, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, request, afterTax, applyReyndersTax),
    forward: buildSeries(forwardPeriods, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, request, afterTax, applyReyndersTax)
  };
}

self.onmessage = ({ data }: MessageEvent<BenchmarkHistoryRequest>) => {
  try {
    const currentRateModel = compatiblePublishedCurrentRateModel(data.currentRateModel, data.prices, data.rates, data.to) ??
      calculateCurrentRateModel(data.prices, data.rates, data.to);
    self.postMessage({ ok: true, history: {
      gross: buildHistory(data, false),
      cgt: buildHistory(data, true),
      reynders: buildHistory(data, true, true),
      holdingPeriods: {
        cgt: estimateConstantRateHoldingPeriods(data.prices, data.rates, data.to, { currentRateModel }),
        reynders: estimateConstantRateHoldingPeriods(data.prices, data.rates, data.to, { applyReyndersTax: true, currentRateModel })
      }
    } });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
