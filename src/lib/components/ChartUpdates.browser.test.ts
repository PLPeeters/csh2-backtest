import { render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chartApi = vi.hoisted(() => {
  const timeScale = {
    fitContent: vi.fn(),
    setVisibleRange: vi.fn()
  };
  return {
    addSeries: vi.fn(),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    timeScale: vi.fn(() => timeScale),
    timeScaleApi: timeScale
  };
});

const markersApi = vi.hoisted(() => ({
  detach: vi.fn(),
  setMarkers: vi.fn()
}));

vi.mock('lightweight-charts', () => ({
  BaselineSeries: Symbol('BaselineSeries'),
  ColorType: { Solid: 'Solid' },
  LineSeries: Symbol('LineSeries'),
  LineStyle: { Solid: 0, Dashed: 2 },
  LineType: { Simple: 0, WithSteps: 1 },
  createChart: vi.fn(() => chartApi),
  createSeriesMarkers: vi.fn(() => markersApi)
}));

import HoldingPeriodEvolutionChart from './HoldingPeriodEvolutionChart.svelte';
import LineChart from './LineChart.svelte';
import ComparisonResults from './ComparisonResults.svelte';
import FutureOutlookSection from './FutureOutlookSection.svelte';
import type { CalculationView } from '../types';

interface SeriesApiSpy {
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  setData: ReturnType<typeof vi.fn>;
}

class ResizeObserverSpy {
  static instances: ResizeObserverSpy[] = [];
  readonly callback: ResizeObserverCallback;
  disconnect = vi.fn();
  observe = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverSpy.instances.push(this);
  }

  emit(width: number, height: number) {
    this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const seriesSpy = (): SeriesApiSpy => ({
  applyOptions: vi.fn(),
  createPriceLine: vi.fn(),
  setData: vi.fn()
});

const flushFrames = async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const clearChartCalls = (series: SeriesApiSpy[]) => {
  chartApi.resize.mockClear();
  chartApi.timeScaleApi.fitContent.mockClear();
  chartApi.timeScaleApi.setVisibleRange.mockClear();
  markersApi.setMarkers.mockClear();
  series.forEach((item) => {
    item.applyOptions.mockClear();
    item.setData.mockClear();
  });
};

describe('chart update paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ResizeObserverSpy.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverSpy);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('updates the visible range without reloading line-series data', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const data = {
      csh2: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-03', value: 2 }],
      overnight: [{ date: '2026-01-01', value: 0.5 }]
    };
    const result = await render(LineChart, { data, ariaLabel: 'Returns' });
    await flushFrames();
    clearChartCalls(series);

    await result.rerender({ data, ariaLabel: 'Returns', from: '2026-01-02', to: '2026-01-03' });

    expect(series.every((item) => item.setData.mock.calls.length === 0)).toBe(true);
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledOnce();
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: '2026-01-02', to: '2026-01-03' });
    expect(chartApi.timeScaleApi.fitContent).not.toHaveBeenCalled();
  });

  it('replaces all line-series data and preserves account and projected presentation', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const initialData = { csh2: [], overnight: [] };
    const result = await render(LineChart, { data: initialData, ariaLabel: 'Returns' });
    await flushFrames();
    clearChartCalls(series);
    const replacement = {
      csh2: [{ date: '2026-01-01', value: 1 }],
      overnight: [{ date: '2026-01-01', value: 2 }],
      account: [{ date: '2026-01-01', value: 3 }],
      projected: {
        csh2: [{ date: '2026-01-02', value: 4 }],
        overnight: [{ date: '2026-01-02', value: 5 }],
        account: [{ date: '2026-01-02', value: 6 }],
        throughDate: '2026-01-02',
        csh2AnnualRatePercent: 1,
        overnightRatePercent: 2,
        baseAnnualRatePercent: 3
      }
    };

    await result.rerender({ data: replacement, ariaLabel: 'Returns' });

    expect(series.map((item) => item.setData.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(series[2].setData).toHaveBeenCalledWith([{ time: '2026-01-01', value: 3 }]);
    expect(series[3].setData).toHaveBeenCalledWith([{ time: '2026-01-02', value: 4 }]);
    expect(series[4].setData).toHaveBeenCalledWith([{ time: '2026-01-02', value: 5 }]);
    expect(series[5].setData).toHaveBeenCalledWith([{ time: '2026-01-02', value: 6 }]);
    expect(series[0].applyOptions).toHaveBeenCalledWith({ lastValueVisible: false, priceLineVisible: false });
    expect(series[5].applyOptions).toHaveBeenCalledWith({ lastValueVisible: true, priceLineVisible: true, lineType: 0 });
    expect(chartApi.timeScaleApi.fitContent).toHaveBeenCalledOnce();

    clearChartCalls(series);
    await result.rerender({ data: { csh2: [], overnight: [] }, ariaLabel: 'Returns' });
    expect(series.map((item) => item.setData.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(series[2].setData).toHaveBeenCalledWith([]);
    expect(series[3].setData).toHaveBeenCalledWith([]);
    expect(series[4].setData).toHaveBeenCalledWith([]);
    expect(series[5].setData).toHaveBeenCalledWith([]);
  });

  it('labels a projected portfolio crossover on the chart and in its accessible name', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const result = await render(LineChart, {
      data: {
        csh2: [{ date: '2026-01-01', value: 100 }],
        overnight: [],
        account: [{ date: '2026-01-01', value: 110 }],
        projected: {
          csh2: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 111 }],
          overnight: [],
          account: [{ date: '2026-01-01', value: 110 }, { date: '2026-01-02', value: 110.1 }],
          throughDate: '2026-01-02',
          csh2AnnualRatePercent: 3,
          overnightRatePercent: 1
        }
      },
      ariaLabel: 'Portfolio value',
      crossoverDate: '2026-01-02',
      from: '2026-01-01',
      to: '2026-01-02'
    });
    await flushFrames();

    expect(markersApi.setMarkers).toHaveBeenCalledWith([expect.objectContaining({
      time: '2026-01-02',
      text: 'Crossover · 2 Jan 2026'
    })]);
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-02' });
    await expect.element(result.getByRole('img', { name: 'Portfolio value. Projected crossover on 2 Jan 2026.' })).toBeInTheDocument();
  });

  it('keeps Outcome chart modes extended through their projected dates', async () => {
    const series = Array.from({ length: 28 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const seriesFor = (projected?: boolean, throughDate = '2026-01-05') => ({
      csh2: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 101 }],
      overnight: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-03', value: 1.1 }],
      account: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 102 }],
      ...(projected ? {
        projected: {
          csh2: [{ date: '2026-01-03', value: 101 }, { date: throughDate, value: 103 }],
          overnight: [{ date: '2026-01-03', value: 1.1 }, { date: throughDate, value: 1.2 }],
          account: [{ date: '2026-01-03', value: 102 }, { date: throughDate, value: 104 }],
          throughDate,
          csh2AnnualRatePercent: 3,
          overnightRatePercent: 1
        }
      } : {})
    });
    const viewFor = (projected = false): CalculationView => ({
      result: {
        valuation: { date: '2026-01-03', price: 100 },
        netLiquidationValue: 100,
        grossValue: 100,
        units: 1,
        availableCash: 0,
        paidTob: 0,
        paidCgt: 0,
        paidReyndersTax: 0,
        terminalTob: 0,
        terminalCgt: 0,
        terminalReyndersTax: 0,
        paidBrokerFees: 0,
        terminalBrokerFee: 0,
        missedAmount: 0,
        csh2MoneyWeightedReturn: 0,
        accountMoneyWeightedReturn: 0,
        csh2TimeWeightedReturn: 0,
        accountTimeWeightedReturn: 0,
        entries: [],
        observedHoldingPeriods: {},
        fidelityPremiumAssessments: []
      },
      metadata: { cachedAt: '2026-01-03T00:00:00.000Z', prices: {} },
      rateMetadata: { cachedAt: '2026-01-03T00:00:00.000Z', rates: {} },
      cpiMetadata: {
        source: 'test', dataSourceId: 'test', backfillViewId: 'test', currentViewId: 'test', license: 'test',
        adaptations: 'test', cachedAt: '2026-01-03T00:00:00.000Z', base: 'test', indices: {}
      },
      settings: {
        applyCapitalGainsExemption: false,
        applyReyndersTax: false,
        buyWholeSharesOnly: false,
        accruedBaseInterest: '0',
        fidelityPremiums: [],
        brokerTransactionFee: '0',
        accountBaseInterestRate: '0',
        accountFidelityPremium: '0',
        bestSavingsBaseInterestRate: '0',
        bestSavingsFidelityPremium: '0',
        totalSavingsAmount: '100',
        csh2RateScenario: 'base',
        returnMode: 'nominal'
      },
      returnSeries: {
        ...seriesFor(projected),
        timeWeighted: seriesFor(projected, '2026-01-06'),
        portfolioValue: seriesFor(projected, '2026-01-05')
      },
      from: '2026-01-01',
      to: '2026-01-03'
    });

    const result = await render(ComparisonResults, { comparisonView: viewFor(), initialReturnChartMode: 'portfolio-value' });
    await flushFrames();
    clearChartCalls(series);

    await result.rerender({ comparisonView: viewFor(true), initialReturnChartMode: 'portfolio-value' });
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-05' });
    expect(series[3].setData).toHaveBeenCalledWith([{ time: '2026-01-03', value: 101 }, { time: '2026-01-05', value: 103 }]);
    await expect.element(result.getByText(/Dashed through/)).toBeVisible();

    clearChartCalls(series);
    await result.getByRole('button', { name: 'Performance' }).click();
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-06' });

    clearChartCalls(series);
    const futureView = viewFor(true);
    const future = await render(FutureOutlookSection, { controller: { view: futureView, settings: futureView.settings, benchmark: undefined, benchmarkStatus: { kind: 'idle', message: '' }, cpiData: undefined } as unknown as import('../state/backtest.svelte').BacktestController, setupTab: 'current' });
    await flushFrames();
    expect(chartApi.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: '2026-01-03', to: '2026-01-06' });
    await expect.element(future.getByRole('heading', { name: 'Projected performance' })).toBeVisible();
  });

  it('coalesces line-chart resizes without touching data or range', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    await render(LineChart, { data: { csh2: [], overnight: [] }, ariaLabel: 'Returns' });
    await flushFrames();
    clearChartCalls(series);
    const observer = ResizeObserverSpy.instances.at(-1)!;

    observer.emit(480, 290);
    observer.emit(640, 290);
    await flushFrames();

    expect(chartApi.resize).toHaveBeenCalledOnce();
    expect(chartApi.resize).toHaveBeenCalledWith(640, 290);
    expect(series.every((item) => item.setData.mock.calls.length === 0)).toBe(true);
    expect(chartApi.timeScaleApi.fitContent).not.toHaveBeenCalled();
    expect(chartApi.timeScaleApi.setVisibleRange).not.toHaveBeenCalled();

    chartApi.resize.mockClear();
    observer.emit(640, 290);
    await flushFrames();
    expect(chartApi.resize).not.toHaveBeenCalled();
  });

  it('keeps benchmark observations sparse while reserving daily calendar space', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const result = await render(LineChart, {
      data: {
        csh2: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-03', value: 2 }],
        overnight: [{ date: '2026-01-01', value: 0.5 }, { date: '2026-01-03', value: 0.6 }],
        projected: {
          csh2: [{ date: '2026-01-01', value: 3 }, { date: '2026-01-03', value: 4 }],
          overnight: [{ date: '2026-01-01', value: 0.7 }, { date: '2026-01-03', value: 0.8 }],
          account: [],
          throughDate: '2026-01-03',
          csh2AnnualRatePercent: 3,
          overnightRatePercent: 1
        }
      },
      cpiIndices: { '2025-01': 100, '2026-01': 102 },
      ariaLabel: 'Returns'
    });
    await flushFrames();

    expect(series[6].setData).toHaveBeenCalledWith([
      { time: '2026-01-01' },
      { time: '2026-01-02' },
      { time: '2026-01-03' }
    ]);
    expect(series[0].setData).toHaveBeenCalledWith([
      { time: '2026-01-01', value: 1 },
      { time: '2026-01-03', value: 2 }
    ]);
    expect(series[1].setData).toHaveBeenCalledWith([
      { time: '2026-01-01', value: 0.5 },
      { time: '2026-01-03', value: 0.6 }
    ]);
    expect(series[3].setData).toHaveBeenCalledWith([
      { time: '2026-01-01', value: 3 },
      { time: '2026-01-03', value: 4 }
    ]);
    expect(series[4].setData).toHaveBeenCalledWith([
      { time: '2026-01-01', value: 0.7 },
      { time: '2026-01-03', value: 0.8 }
    ]);

    const handler = chartApi.subscribeCrosshairMove.mock.calls[0]?.[0];
    handler({
      time: '2026-01-02',
      point: { x: 100, y: 100 },
      seriesData: new Map()
    });
    await expect.element(result.getByText('CSH2 (1.00%)', { exact: true })).toHaveLength(0);
    await expect.element(result.getByText('€STR (0.50%)', { exact: true })).toHaveLength(0);
  });

  it('updates the chart legend with every series value at the crosshair', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const result = await render(LineChart, {
      data: {
        csh2: [{ date: '2026-01-01', value: 1.23 }],
        overnight: [{ date: '2026-01-01', value: 0.45 }],
        account: [{ date: '2026-01-01', value: 0.67 }]
      },
      ariaLabel: 'Returns'
    });
    await flushFrames();

    const handler = chartApi.subscribeCrosshairMove.mock.calls[0]?.[0];
    expect(handler).toBeTypeOf('function');
    handler({
      time: '2026-01-01',
      point: { x: 100, y: 100 },
      seriesData: new Map([
        [series[0], { value: 1.23 }],
        [series[1], { value: 0.45 }],
        [series[2], { value: 0.67 }]
      ])
    });

    await expect.element(result.getByText('CSH2 1.23%', { exact: true })).toBeVisible();
    await expect.element(result.getByText('€STR 0.45%', { exact: true })).toBeVisible();
    await expect.element(result.getByText('Your account 0.67%', { exact: true })).toBeVisible();
    await expect.element(result.getByText('1 Jan 2026', { exact: true })).toBeVisible();
    expect(document.querySelector('.chart-legend')).toHaveStyle({ zIndex: '4' });

    handler({
      time: '2026-01-02',
      point: { x: 100, y: 100 },
      seriesData: new Map([
        [series[0], { value: 1.24 }],
        [series[1], { value: 0.46 }]
      ])
    });

    await expect.element(result.getByText('Your account (0.67%)', { exact: true })).toBeVisible();
  });

  it('keeps holding-period data, marker, and resize updates independent', async () => {
    const series = [seriesSpy()];
    chartApi.addSeries.mockImplementation(() => series[0]);
    const points = [{ day: 0, csh2: 100, account: 100 }, { day: 1, csh2: 101, account: 100 }];
    const markers = [{ day: 1, label: 'Break even', kind: 'break-even' as const }];
    const result = await render(HoldingPeriodEvolutionChart, { points, markers, maximumDays: 30, valuationDate: '2026-01-01' });
    await flushFrames();
    clearChartCalls(series);

    await result.rerender({ points, markers, maximumDays: 60, valuationDate: '2026-01-01' });
    expect(series[0].setData).not.toHaveBeenCalled();
    expect(markersApi.setMarkers).not.toHaveBeenCalled();

    const replacement = [...points, { day: 2, csh2: 102, account: 100 }];
    await result.rerender({ points: replacement, markers, maximumDays: 60, valuationDate: '2026-01-01' });
    expect(series[0].setData).toHaveBeenCalledOnce();
    expect(markersApi.setMarkers).not.toHaveBeenCalled();
    await flushFrames();
    clearChartCalls(series);

    const replacementMarkers = [...markers, { day: 2, label: 'Match overnight', kind: 'overnight' as const }];
    await result.rerender({ points: replacement, markers: replacementMarkers, maximumDays: 60, valuationDate: '2026-01-01' });
    expect(series[0].setData).not.toHaveBeenCalled();
    expect(markersApi.setMarkers).toHaveBeenCalledOnce();
    await flushFrames();
    clearChartCalls(series);

    const observer = ResizeObserverSpy.instances.at(-1)!;
    observer.emit(480, 240);
    observer.emit(600, 260);
    await flushFrames();
    expect(chartApi.resize).toHaveBeenCalledOnce();
    expect(chartApi.resize).toHaveBeenCalledWith(600, 260);
    expect(series[0].setData).not.toHaveBeenCalled();
    expect(markersApi.setMarkers).not.toHaveBeenCalled();
    expect(chartApi.timeScaleApi.fitContent).not.toHaveBeenCalled();
  });
});
