/// <reference lib="webworker" />
import { buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, calculateCurrentRateModel, estimateConstantRateHoldingPeriods } from '../../backtest.mjs';
import type { BenchmarkHistoryRequest, BenchmarkPeriod, BenchmarkSeries } from '../types';
import { compatiblePublishedCurrentRateModel, currentRateModelSourceData } from '../services/current-rate-model-publication.mjs';

const lookbackPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365, '2y': 730, '5y': 1825 } as const;
const forwardPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365 } as const;
const MAX_CACHED_VARIANTS = 8;

type SeriesBuilder = (data: Record<string, unknown>, from: string, to: string, options: { lookbackDays: number; afterTax: boolean; applyReyndersTax?: boolean; applyCapitalGainsExemption?: boolean; investmentAmount?: number; cpiIndices?: Record<string, number> }) => BenchmarkSeries['csh2'];

function buildSeries(periods: Record<string, number>, buildCsh2: SeriesBuilder, buildOvernight: SeriesBuilder, request: BenchmarkHistoryRequest, afterTax: boolean, applyReyndersTax = false) {
  const applyCapitalGainsExemption = afterTax && !applyReyndersTax && request.applyCapitalGainsExemption === true && Number.isFinite(request.totalSavingsAmount) && request.totalSavingsAmount! > 0;
  return Object.fromEntries(Object.entries(periods).map(([period, lookbackDays]) => [period, {
    csh2: buildCsh2(request.prices, '', request.to, { lookbackDays, afterTax, applyReyndersTax, applyCapitalGainsExemption, investmentAmount: request.totalSavingsAmount, ...(request.returnMode === 'real' ? { cpiIndices: request.cpiIndices } : {}) }),
    overnight: buildOvernight(request.rates, '', request.to, { lookbackDays, afterTax, ...(request.returnMode === 'real' ? { cpiIndices: request.cpiIndices } : {}) })
  }])) as Record<BenchmarkPeriod, BenchmarkSeries>;
}

function buildHistory(request: BenchmarkHistoryRequest, afterTax: boolean, applyReyndersTax = false) {
  return {
    lookback: buildSeries(lookbackPeriods, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, request, afterTax, applyReyndersTax),
    forward: buildSeries(forwardPeriods, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, request, afterTax, applyReyndersTax)
  };
}

let marketKey = '';
let modelKey = '';
let currentRateModel: ReturnType<typeof calculateCurrentRateModel> | undefined;
const grossHistories = new Map<BenchmarkHistoryRequest['returnMode'], ReturnType<typeof buildHistory>>();
const reyndersHistories = new Map<BenchmarkHistoryRequest['returnMode'], ReturnType<typeof buildHistory>>();
const cgtHistories = new Map<string, ReturnType<typeof buildHistory>>();
const cgtHoldingPeriods = new Map<string, ReturnType<typeof estimateConstantRateHoldingPeriods>>();
const reyndersHoldingPeriods = new Map<BenchmarkHistoryRequest['returnMode'], ReturnType<typeof estimateConstantRateHoldingPeriods>>();

function cachedValue<K, V>(cache: Map<K, V>, key: K, build: () => V) {
  if (cache.has(key)) {
    const value = cache.get(key)!;
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const value = build();
  cache.set(key, value);
  if (cache.size > MAX_CACHED_VARIANTS) cache.delete(cache.keys().next().value!);
  return value;
}

function requestKey(request: BenchmarkHistoryRequest) {
  const sourceData = currentRateModelSourceData(request.prices, request.rates);
  return JSON.stringify([request.to, sourceData.prices, sourceData.rates, request.cpiPublicationIdentity, request.cpiIndices]);
}

function modelIdentity(request: BenchmarkHistoryRequest) {
  return JSON.stringify(request.currentRateModel ?? null);
}

self.onmessage = ({ data }: MessageEvent<{ id: number; request: BenchmarkHistoryRequest }>) => {
  const id = data.id;
  const request = data.request;
  try {
    const nextMarketKey = requestKey(request);
    if (nextMarketKey !== marketKey) {
      marketKey = nextMarketKey;
      modelKey = '';
      grossHistories.clear();
      reyndersHistories.clear();
      cgtHistories.clear();
      cgtHoldingPeriods.clear();
      reyndersHoldingPeriods.clear();
    }
    const nextModelKey = modelIdentity(request);
    if (nextModelKey !== modelKey) {
      modelKey = nextModelKey;
      currentRateModel = compatiblePublishedCurrentRateModel(request.currentRateModel, request.prices, request.rates, request.to) ??
        calculateCurrentRateModel(request.prices, request.rates, request.to);
      cgtHoldingPeriods.clear();
      reyndersHoldingPeriods.clear();
    }
    const gross = cachedValue(grossHistories, request.returnMode, () => buildHistory(request, false));
    const reynders = cachedValue(reyndersHistories, request.returnMode, () => buildHistory(request, true, true));
    const cgtKey = `${request.returnMode}:${request.applyCapitalGainsExemption === true}:${request.totalSavingsAmount ?? ''}`;
    const cgt = cachedValue(cgtHistories, cgtKey, () => buildHistory(request, true));
    const cgtHolding = cachedValue(cgtHoldingPeriods, cgtKey, () => estimateConstantRateHoldingPeriods(request.prices, request.rates, request.to, {
      currentRateModel,
      applyCapitalGainsExemption: request.applyCapitalGainsExemption,
      investmentAmount: request.totalSavingsAmount
    }));
    const reyndersHolding = cachedValue(reyndersHoldingPeriods, request.returnMode, () => estimateConstantRateHoldingPeriods(request.prices, request.rates, request.to, { applyReyndersTax: true, currentRateModel }));
    self.postMessage({ ok: true, history: {
      gross,
      cgt,
      reynders,
      holdingPeriods: {
        cgt: cgtHolding,
        reynders: reyndersHolding
      }
    }, id });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error), id });
  }
};
