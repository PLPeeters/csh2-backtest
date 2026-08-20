<script lang="ts">
  import { BaselineSeries, ColorType, createChart, createSeriesMarkers } from 'lightweight-charts';
  import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time } from 'lightweight-charts';
  import { onMount } from 'svelte';

  interface EvolutionPoint { day: number; csh2: number; account?: number }
  interface EvolutionMarker { day: number; label: string; markerText?: string; kind: 'break-even' | 'overnight' }

  let { points, markers, maximumDays, valuationDate }: { points: EvolutionPoint[]; markers: EvolutionMarker[]; maximumDays: number; valuationDate: string } = $props();
  let host: HTMLDivElement;
  let chart: IChartApi | undefined;
  let advantageSeries: ISeriesApi<'Baseline'> | undefined;
  let markersPlugin: ISeriesMarkersPluginApi<Time> | undefined;

  const dateForDay = (day: number) => new Date(Date.parse(`${valuationDate}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
  const advantageData = () => points.flatMap((point) =>
    point.account === undefined || point.account === 0
      ? []
      : [{ time: dateForDay(point.day) as Time, value: (point.csh2 / point.account - 1) * 100 }]
  );
  const chartMarkers = (): SeriesMarker<Time>[] => markers
    .toSorted((left, right) => left.day - right.day)
    .map((marker, index) => ({
      time: dateForDay(marker.day) as Time,
      position: 'belowBar',
      shape: 'arrowUp',
      color: marker.kind === 'break-even' ? '#1d6a54' : '#3867a8',
      text: marker.markerText ?? marker.label,
      id: `${marker.kind}-${marker.day}-${index}`,
      size: 0.8
    }));

  function updateChart() {
    if (!chart || !advantageSeries || !markersPlugin) return;
    chart.applyOptions({ width: Math.floor(host.clientWidth), height: Math.floor(host.clientHeight) });
    advantageSeries.setData(advantageData());
    markersPlugin.setMarkers(chartMarkers());
    chart.timeScale().fitContent();
    requestAnimationFrame(() => chart?.timeScale().fitContent());
  }

  let ariaLabel = $derived(`Net CSH2 advantage compared with your account in percent over ${maximumDays} days. ${markers.map((marker) => `${marker.label} after ${marker.day} days`).join('. ') || 'No markers within the projection'}.`);

  $effect(() => {
    const inputs = { points, markers, maximumDays, valuationDate };
    void inputs;
    updateChart();
  });

  onMount(() => {
    chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5b746c' },
      grid: { vertLines: { color: '#edf1ed' }, horzLines: { color: '#edf1ed' } },
      rightPriceScale: { borderColor: '#cbd8d1', scaleMargins: { top: 0.18, bottom: 0.18 } },
      localization: { priceFormatter: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%` },
      timeScale: { borderColor: '#cbd8d1', timeVisible: false, minBarSpacing: 0.2, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
    });
    advantageSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      relativeGradient: true,
      topFillColor1: 'rgba(29, 106, 84, 0.32)',
      topFillColor2: 'rgba(29, 106, 84, 0.05)',
      topLineColor: '#1d6a54',
      bottomFillColor1: 'rgba(177, 91, 70, 0.05)',
      bottomFillColor2: 'rgba(177, 91, 70, 0.28)',
      bottomLineColor: '#a95743',
      lineWidth: 3,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'custom', formatter: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%` }
    });
    markersPlugin = createSeriesMarkers(advantageSeries, [], { autoScale: true, zOrder: 'top' });
    updateChart();
    const observer = new ResizeObserver(() => requestAnimationFrame(updateChart));
    observer.observe(host);
    return () => {
      observer.disconnect();
      markersPlugin?.detach();
      chart?.remove();
      chart = undefined;
      advantageSeries = undefined;
      markersPlugin = undefined;
    };
  });
</script>

<div class="holding-advantage-chart">
  <p class="holding-advantage-measure">Relative advantage versus your account (%)</p>
  <div bind:this={host} class="holding-advantage-chart-host" role="img" aria-label={ariaLabel}></div>
</div>
