<script lang="ts">
  import { ColorType, createChart, LineSeries, LineStyle, LineType } from 'lightweight-charts';
  import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
  import { onMount, untrack } from 'svelte';
  import type { BenchmarkSeries, ChartPoint, ComparisonSeries } from '../types';
  type ChartSeries = BenchmarkSeries | ComparisonSeries;
  let { data, ariaLabel, from, to, unit = 'percent' }: { data: ChartSeries; ariaLabel: string; from?: string; to?: string; unit?: 'percent' | 'euro' } = $props();
  let host: HTMLDivElement;
  let chart: IChartApi | undefined;
  let csh2Series: ISeriesApi<'Line'> | undefined;
  let overnightSeries: ISeriesApi<'Line'> | undefined;
  let accountSeries: ISeriesApi<'Line'> | undefined;
  let projectedCsh2Series: ISeriesApi<'Line'> | undefined;
  let projectedOvernightSeries: ISeriesApi<'Line'> | undefined;
  let projectedAccountSeries: ISeriesApi<'Line'> | undefined;
  let calendarSeries: ISeriesApi<'Line'> | undefined;
  let resizeFrame: number | undefined;
  let pendingWidth = 0;
  let chartWidth = 0;
  let loadedData: ChartSeries | undefined;
  let appliedFrom: string | undefined;
  let appliedTo: string | undefined;
  let legendDate = $state('');
  let legendValues = $state<{ color: string; label: string; parenthesize: boolean; value: string }[]>([]);
  const euroValue = new Intl.NumberFormat('en-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

  function formattedValue(value: number) {
    return unit === 'euro' ? euroValue.format(value) : `${value.toFixed(2)}%`;
  }

  function chartData(points: ChartPoint[]) {
    return points.map(({ date, value }) => ({ time: date as Time, value }));
  }

  function calendarData(data: ChartSeries) {
    const account = 'account' in data ? data.account : [];
    const projected = 'projected' in data ? data.projected : undefined;
    const dates = [...data.csh2, ...data.overnight, ...account, ...(projected?.csh2 ?? []), ...(projected?.overnight ?? []), ...(projected?.account ?? [])].map((point) => point.date).toSorted();
    if (!dates.length) return [];
    const end = Date.parse(`${dates.at(-1)!}T00:00:00Z`);
    const start = Date.parse(`${dates[0]}T00:00:00Z`);
    const points = [];
    for (let timestamp = start; timestamp <= end; timestamp += 86_400_000) {
      points.push({ time: new Date(timestamp).toISOString().slice(0, 10) as Time });
    }
    return points;
  }

  function fillForwardData(points: ChartPoint[], calendar: { time: Time }[]) {
    if (!points.length) return [];
    const values = new Map(points.map((point) => [point.date, point.value]));
    const dates = [...values.keys()].toSorted();
    let latestValue: number | undefined;
    return calendar.flatMap(({ time }) => {
      const date = time as string;
      if (date < dates[0] || date > dates.at(-1)!) return [];
      latestValue = values.get(date) ?? latestValue;
      return latestValue === undefined ? [] : [{ time, value: latestValue }];
    });
  }

  function latestPoint(...pointSets: ChartPoint[][]) {
    return pointSets.flat().toSorted((left, right) => right.date.localeCompare(left.date))[0];
  }

  function latestPointAtOrBefore(time: string, ...pointSets: ChartPoint[][]) {
    return pointSets.flat().filter((point) => point.date <= time).toSorted((left, right) => right.date.localeCompare(left.date))[0];
  }

  function valueFromChartPoint(point: unknown) {
    return typeof point === 'object' && point !== null && 'value' in point && typeof point.value === 'number' ? point.value : undefined;
  }

  function formatLegendDate(time: Time | undefined) {
    if (typeof time !== 'string') return '';
    return new Intl.DateTimeFormat('en-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${time}T00:00:00Z`));
  }

  function updateLegend(param?: MouseEventParams<Time>) {
    if (!loadedData || !csh2Series || !overnightSeries || !accountSeries || !projectedCsh2Series || !projectedOvernightSeries || !projectedAccountSeries) return;
    const projected = 'projected' in loadedData ? loadedData.projected : undefined;
    const series = [
      { color: '#1d6a54', label: 'CSH2', points: [loadedData.csh2, projected?.csh2 ?? []], chartSeries: [csh2Series, projectedCsh2Series] },
      { color: '#c7943c', label: '€STR', points: [loadedData.overnight, projected?.overnight ?? []], chartSeries: [overnightSeries, projectedOvernightSeries] },
      { color: '#3867a8', label: 'Your account', points: ['account' in loadedData ? loadedData.account : [], projected?.account ?? []], chartSeries: [accountSeries, projectedAccountSeries] }
    ];
    const hasCrosshair = param?.time !== undefined && param.point !== undefined && param.point.x >= 0 && param.point.y >= 0;
    const latest = latestPoint(...series.flatMap((item) => item.points));
    legendDate = formatLegendDate(hasCrosshair ? param?.time : latest?.date as Time | undefined);
    legendValues = series.flatMap(({ color, label, points, chartSeries }) => {
      const crosshairValue = hasCrosshair
        ? chartSeries.map((item) => valueFromChartPoint(param?.seriesData.get(item))).find((item): item is number => item !== undefined)
        : undefined;
      const carriedAccountValue = crosshairValue === undefined && label === 'Your account' && typeof param?.time === 'string'
        ? latestPointAtOrBefore(param.time, ...points)?.value
        : undefined;
      const value = crosshairValue ?? carriedAccountValue ?? (!hasCrosshair ? latestPoint(...points)?.value : undefined);
      const parenthesize = hasCrosshair && typeof param?.time === 'string' && !points.some((items) => items.some((point) => point.date === param.time));
      return value === undefined ? [] : [{ color, label, parenthesize, value: formattedValue(value) }];
    });
  }

  function updateData(nextData: ChartSeries) {
    if (Object.is(nextData, loadedData) || !csh2Series || !overnightSeries || !accountSeries || !projectedCsh2Series || !projectedOvernightSeries || !projectedAccountSeries || !calendarSeries) return false;
    const calendar = calendarData(nextData);
    csh2Series.setData(fillForwardData(nextData.csh2, calendar));
    overnightSeries.setData(fillForwardData(nextData.overnight, calendar));
    const account = 'account' in nextData ? nextData.account : [];
    accountSeries.setData(chartData(account));
    const projected = 'projected' in nextData ? nextData.projected : undefined;
    projectedCsh2Series.setData(fillForwardData(projected?.csh2 ?? [], calendar));
    projectedOvernightSeries.setData(fillForwardData(projected?.overnight ?? [], calendar));
    projectedAccountSeries.setData(chartData(projected?.account ?? []));
    calendarSeries.setData(calendar);
    csh2Series.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    overnightSeries.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    accountSeries.applyOptions({ lastValueVisible: !projected, priceLineVisible: !projected});
    projectedCsh2Series.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected });
    projectedOvernightSeries.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected });
    projectedAccountSeries.applyOptions({ lastValueVisible: !!projected, priceLineVisible: !!projected, lineType: projected?.baseAnnualRatePercent === undefined ? LineType.WithSteps : LineType.Simple });
    loadedData = nextData;
    updateLegend();
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
    chart = createChart(host, { width: chartWidth, height: 290, layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5b746c' }, grid: { vertLines: { visible: false }, horzLines: { visible: false } }, rightPriceScale: { borderColor: '#cbd8d1' }, timeScale: { borderColor: '#cbd8d1', timeVisible: false, fixLeftEdge: true, fixRightEdge: true }, handleScale: { axisPressedMouseMove: { time: true, price: false } } });
    csh2Series = chart.addSeries(LineSeries, { color: '#1d6a54', lineWidth: 2, lastValueVisible: true, priceFormat: { type: 'custom', formatter: formattedValue } });
    csh2Series.createPriceLine({ price: 0, color: '#cbd8d1', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false });
    overnightSeries = chart.addSeries(LineSeries, { color: '#c7943c', lineWidth: 2, lastValueVisible: true, priceFormat: { type: 'custom', formatter: formattedValue } });
    accountSeries = chart.addSeries(LineSeries, { color: '#3867a8', lineWidth: 2, lineType: LineType.WithSteps, lastValueVisible: true, priceFormat: { type: 'custom', formatter: formattedValue } });
    projectedCsh2Series = chart.addSeries(LineSeries, { color: '#1d6a54', lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceFormat: { type: 'custom', formatter: formattedValue } });
    projectedOvernightSeries = chart.addSeries(LineSeries, { color: '#c7943c', lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceFormat: { type: 'custom', formatter: formattedValue } });
    projectedAccountSeries = chart.addSeries(LineSeries, { color: '#3867a8', lineWidth: 2, lineStyle: LineStyle.Dashed, lineType: LineType.WithSteps, lastValueVisible: false, priceFormat: { type: 'custom', formatter: formattedValue } });
    calendarSeries = chart.addSeries(LineSeries, { lineVisible: false, lastValueVisible: false, priceLineVisible: false });
    updateData(data);
    updateRange(data, from, to, true);
    chart.subscribeCrosshairMove(updateLegend);
    const observer = new ResizeObserver(([entry]) => scheduleResize(entry.contentRect.width));
    observer.observe(host);
    return () => { observer.disconnect(); if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame); resizeFrame = undefined; chart?.unsubscribeCrosshairMove(updateLegend); chart?.remove(); chart = undefined; csh2Series = undefined; overnightSeries = undefined; accountSeries = undefined; projectedCsh2Series = undefined; projectedOvernightSeries = undefined; projectedAccountSeries = undefined; calendarSeries = undefined; loadedData = undefined; appliedFrom = undefined; appliedTo = undefined; legendValues = []; };
  });
</script>
<div bind:this={host} class="chart" aria-label={ariaLabel}>
  <div class="chart-legend" aria-hidden="true">
    {#if legendDate}<span class="chart-legend-entry chart-legend-date">{legendDate}</span>{/if}
    {#each legendValues as item}
      <span class="chart-legend-entry" style={`color: ${item.color}`}>{item.label} {item.parenthesize ? `(${item.value})` : item.value}</span>
    {/each}
  </div>
</div>

<style>
  .chart { position: relative; }
  .chart-legend { position: absolute; z-index: 4; top: 8px; left: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; font-size: 0.8rem; font-weight: 600; pointer-events: none; }
  .chart-legend-entry { padding: 2px 4px; background: white; }
  .chart-legend-date { color: #5b746c; }
</style>
