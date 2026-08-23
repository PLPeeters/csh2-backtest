<script lang="ts">
  import { ColorType, createChart, LineSeries, LineStyle, LineType } from 'lightweight-charts';
  import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
  import { onMount, untrack } from 'svelte';
  import type { BacktestSeries, BenchmarkSeries, ChartPoint } from '../types';
  type ChartSeries = BenchmarkSeries | BacktestSeries;
  let { data, ariaLabel, from, to }: { data: ChartSeries; ariaLabel: string; from?: string; to?: string } = $props();
  let host: HTMLDivElement;
  let chart: IChartApi | undefined;
  let csh2Series: ISeriesApi<'Line'> | undefined;
  let overnightSeries: ISeriesApi<'Line'> | undefined;
  let accountSeries: ISeriesApi<'Line'> | undefined;
  let projectedCsh2Series: ISeriesApi<'Line'> | undefined;
  let projectedOvernightSeries: ISeriesApi<'Line'> | undefined;
  let projectedAccountSeries: ISeriesApi<'Line'> | undefined;
  let resizeFrame: number | undefined;
  let pendingWidth = 0;
  let chartWidth = 0;
  let loadedData: ChartSeries | undefined;
  let appliedFrom: string | undefined;
  let appliedTo: string | undefined;

  function chartData(points: ChartPoint[]) {
    return points.map(({ date, value }) => ({ time: date as Time, value }));
  }

  function updateData(nextData: ChartSeries) {
    if (nextData === loadedData || !csh2Series || !overnightSeries || !accountSeries || !projectedCsh2Series || !projectedOvernightSeries || !projectedAccountSeries) return false;
    csh2Series.setData(chartData(nextData.csh2));
    overnightSeries.setData(chartData(nextData.overnight));
    const account = 'account' in nextData ? nextData.account : [];
    accountSeries.setData(chartData(account));
    const projected = 'projected' in nextData ? nextData.projected : undefined;
    projectedCsh2Series.setData(chartData(projected?.csh2 ?? []));
    projectedOvernightSeries.setData(chartData(projected?.overnight ?? []));
    projectedAccountSeries.setData(chartData(projected?.account ?? []));
    csh2Series.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    overnightSeries.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    accountSeries.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    projectedCsh2Series.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected });
    projectedOvernightSeries.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected });
    projectedAccountSeries.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected, lineType: projected?.baseAnnualRatePercent === undefined ? LineType.WithSteps : LineType.Simple });
    loadedData = nextData;
    return true;
  }

  function updateRange(nextData: ChartSeries, visibleFrom?: string, visibleTo?: string, force = false) {
    if (!chart || (!force && visibleFrom === appliedFrom && visibleTo === appliedTo)) return;
    const account = 'account' in nextData ? nextData.account : [];
    const projected = 'projected' in nextData ? nextData.projected : undefined;
    const all = [...nextData.csh2, ...nextData.overnight, ...account, ...(projected?.csh2 ?? []), ...(projected?.overnight ?? []), ...(projected?.account ?? [])];
    if (visibleFrom && visibleTo && all.some((point) => point.date >= visibleFrom && point.date <= visibleTo)) chart.timeScale().setVisibleRange({ from: visibleFrom as Time, to: visibleTo as Time });
    else chart.timeScale().fitContent();
    appliedFrom = visibleFrom;
    appliedTo = visibleTo;
  }

  function scheduleResize(width: number) {
    pendingWidth = Math.floor(width);
    if (pendingWidth <= 0 || pendingWidth === chartWidth || resizeFrame !== undefined) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (!chart || pendingWidth === chartWidth) return;
      chartWidth = pendingWidth;
      chart.resize(chartWidth, 290);
    });
  }

  $effect(() => {
    const nextData = data;
    if (updateData(nextData)) untrack(() => updateRange(nextData, from, to, true));
  });

  $effect(() => {
    const visibleFrom = from;
    const visibleTo = to;
    untrack(() => updateRange(data, visibleFrom, visibleTo));
  });

  onMount(() => {
    chartWidth = Math.floor(host.clientWidth);
    chart = createChart(host, { width: chartWidth, height: 290, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5b746c' }, grid: { vertLines: { color: '#edf1ed' }, horzLines: { color: '#edf1ed' } }, rightPriceScale: { borderColor: '#cbd8d1' }, timeScale: { borderColor: '#cbd8d1', timeVisible: false, fixLeftEdge: true, fixRightEdge: true }, handleScale: { axisPressedMouseMove: { time: true, price: false } } });
    csh2Series = chart.addSeries(LineSeries, { color: '#1d6a54', lineWidth: 2, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    overnightSeries = chart.addSeries(LineSeries, { color: '#c7943c', lineWidth: 2, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    accountSeries = chart.addSeries(LineSeries, { color: '#3867a8', lineWidth: 2, lineType: LineType.WithSteps, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    projectedCsh2Series = chart.addSeries(LineSeries, { color: '#1d6a54', lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    projectedOvernightSeries = chart.addSeries(LineSeries, { color: '#c7943c', lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    projectedAccountSeries = chart.addSeries(LineSeries, { color: '#3867a8', lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.WithSteps, lastValueVisible: false, priceFormat: { type: 'custom', formatter: (value: number) => `${value.toFixed(2)}%` } });
    updateData(data);
    updateRange(data, from, to, true);
    const observer = new ResizeObserver(([entry]) => scheduleResize(entry.contentRect.width));
    observer.observe(host);
    return () => { observer.disconnect(); if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame); resizeFrame = undefined; chart?.remove(); chart = undefined; csh2Series = undefined; overnightSeries = undefined; accountSeries = undefined; projectedCsh2Series = undefined; projectedOvernightSeries = undefined; projectedAccountSeries = undefined; loadedData = undefined; appliedFrom = undefined; appliedTo = undefined; };
  });
</script>
<div bind:this={host} class="chart" aria-label={ariaLabel}></div>
