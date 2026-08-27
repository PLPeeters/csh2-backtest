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

  it('reserves daily calendar space between sparse chart observations', async () => {
    const series = Array.from({ length: 7 }, seriesSpy);
    let nextSeries = 0;
    chartApi.addSeries.mockImplementation(() => series[nextSeries++]);
    const result = await render(LineChart, {
      data: {
        csh2: [{ date: '2026-01-01', value: 1 }, { date: '2026-01-03', value: 2 }],
        overnight: [{ date: '2026-01-01', value: 0.5 }, { date: '2026-01-03', value: 0.6 }]
      },
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
      { time: '2026-01-02', value: 1 },
      { time: '2026-01-03', value: 2 }
    ]);
    expect(series[1].setData).toHaveBeenCalledWith([
      { time: '2026-01-01', value: 0.5 },
      { time: '2026-01-02', value: 0.5 },
      { time: '2026-01-03', value: 0.6 }
    ]);

    const handler = chartApi.subscribeCrosshairMove.mock.calls[0]?.[0];
    handler({
      time: '2026-01-02',
      point: { x: 100, y: 100 },
      seriesData: new Map([
        [series[0], { value: 1 }],
        [series[1], { value: 0.5 }]
      ])
    });
    await expect.element(result.getByText('CSH2 (1.00%)', { exact: true })).toBeVisible();
    await expect.element(result.getByText('€STR (0.50%)', { exact: true })).toBeVisible();
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
