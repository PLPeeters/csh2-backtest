import { describe, expect, it } from 'vitest';
import { defaultSettings } from './storage';
import { loadMarketData } from './market-data';
import { calculateHistoricalComparison } from './historical-comparison';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';

describe('historical comparison', () => {
  it('reports observed CSH2 holding periods from the executed historical purchase', async () => {
    const market = await loadMarketData();
    const comparison = calculateHistoricalComparison({
      rates: [{ id: 'rate', date: '2020-01-02', baseRate: 1, fidelityPremium: 0 }],
      endDate: '2021-01-04'
    }, defaultSettings(), market);
    const { view } = comparison.monthly;
    const firstPurchase = view.result.entries.find((entry) => entry.type === 'inflow' && entry.units > 0);
    expect(firstPurchase).toBeDefined();
    expect(view.result.observedHoldingPeriods.from).toBe(firstPurchase?.date);
    expect(view.result.observedHoldingPeriods.breakEven).toBeDefined();
  });

  it('projects CSH2, €STR, and savings values through a future end date', async () => {
    const market = await loadMarketData();
    const latest = latestAvailablePriceDate(market.data.prices, '9999-12-31')!;
    const future = `${Number(latest.slice(0, 4)) + 1}${latest.slice(4)}`;
    const comparison = calculateHistoricalComparison({
      rates: [{ id: 'rate', date: '2020-01-02', baseRate: 1, fidelityPremium: 0.5 }],
      endDate: future
    }, defaultSettings(), market);

    const { view, savings } = comparison.monthly;
    expect(view.result.valuation.date).toBe(future);
    expect(view.returnSeries.projected?.throughDate).toBe(future);
    expect(view.returnSeries.projected?.csh2.at(-1)?.date).toBe(future);
    expect(view.returnSeries.projected?.overnight.at(-1)?.date).toBe(future);
    expect(view.returnSeries.projected?.account.at(-1)?.date).toBe(future);
    expect(view.returnSeries.account.at(-1)?.date).toBe(latest);
    expect(view.returnSeries.account.some((point) => point.date > latest)).toBe(false);
    expect(view.returnSeries.projected?.account[0]?.date).toBe(latest);
    expect(view.returnSeries.portfolioValue.account.at(-1)?.date).toBe(latest);
    expect(view.returnSeries.portfolioValue.projected?.account.at(-1)?.date).toBe(future);
    expect(view.result.accountMoneyWeightedReturn).toBeTypeOf('number');
    expect(view.result.entries.some((entry) => entry.date > latest)).toBe(true);
    expect(view.result.netLiquidationValue).toBeGreaterThan(0);
    expect(savings.series.at(-1)?.date).toBe(future);

    const projectedCsh2 = view.returnSeries.timeWeighted.projected?.csh2.at(-1);
    const days = (Date.parse(`${future}T00:00:00Z`) - Date.parse(`${comparison.from}T00:00:00Z`)) / 86_400_000;
    const expectedAnnualized = ((1 + projectedCsh2!.value / 100) ** (365 / days) - 1) * 100;
    expect(view.result.csh2TimeWeightedReturn).toBeCloseTo(expectedAnnualized, 10);

    const futureRateDate = `${Number(latest.slice(0, 4)) + 1}-03-01`;
    const changedRates = calculateHistoricalComparison({
      rates: [
        { id: 'rate', date: '2020-01-02', baseRate: 1, fidelityPremium: 0.5 },
        { id: 'future-rate', date: futureRateDate, baseRate: 5, fidelityPremium: 0.5 }
      ],
      endDate: future
    }, defaultSettings(), market);
    expect(changedRates.monthly.savings.baseInterestEarned).toBeGreaterThan(savings.baseInterestEarned);
  });

  it('uses CPI extrapolation for real future projections', async () => {
    const market = await loadMarketData();
    const latest = latestAvailablePriceDate(market.data.prices, '9999-12-31')!;
    const future = `${Number(latest.slice(0, 4)) + 1}${latest.slice(4)}`;
    const comparison = calculateHistoricalComparison({
      rates: [{ id: 'rate', date: '2020-01-02', baseRate: 1, fidelityPremium: 0.5 }],
      endDate: future
    }, { ...defaultSettings(), returnMode: 'real' }, market);

    const projected = comparison.lumpSum.view.returnSeries.timeWeighted.projected;
    expect(projected?.throughDate).toBe(future);
    expect(projected?.csh2.at(-1)?.cpiStatus).toBe('extrapolated');
    expect(projected?.account.at(-1)?.cpiStatus).toBe('extrapolated');
    expect(comparison.lumpSum.view.result.csh2MoneyWeightedReturn).toBeTypeOf('number');
  });
});
