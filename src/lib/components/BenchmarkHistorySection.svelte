<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  import LineChart from './LineChart.svelte';

  let { controller }: { controller: BacktestController } = $props();
  const periods = { '1m': { label: '1M', description: '1 month' }, '3m': { label: '3M', description: '3 months' }, '6m': { label: '6M', description: '6 months' }, '1y': { label: '1Y', description: '1 year' }, '2y': { label: '2Y', description: '2 years' }, '5y': { label: '5Y', description: '5 years' } } as const;
  let period = $derived(controller.direction === 'backward' ? controller.backwardPeriod : controller.forwardPeriod);
  let benchmarkUsesReyndersTax = $derived(controller.settings.applyReyndersTax);
  let selectedSeries = $derived(controller.benchmark?.[controller.benchmarkAfterTax ? benchmarkUsesReyndersTax ? 'reynders' : 'cgt' : 'gross']?.[controller.direction === 'backward' ? 'lookback' : 'forward']?.[period as '1y']);
</script>

<section class="benchmark-history-section" aria-labelledby="benchmark-heading">
  <section class="panel chart-panel benchmark-chart-panel">
    <div class="section-title"><div class="benchmark-title"><p class="eyebrow">Underlying benchmark</p><h2 id="benchmark-heading">{controller.direction === 'forward' ? 'Forward' : 'Backward'} annualized returns · {periods[period].label}</h2></div>
      <div class="benchmark-control"><div class="benchmark-mode-picker" role="group" aria-label="Return direction"><button type="button" aria-pressed={controller.direction === 'backward'} onclick={() => controller.setDirection('backward')}>Backward</button><button type="button" aria-pressed={controller.direction === 'forward'} onclick={() => controller.setDirection('forward')}>Forward</button></div><div class="benchmark-period-picker" role="group" aria-label={`${controller.direction === 'forward' ? 'Forward' : 'Backward'} comparison period`}>{#each (controller.direction === 'backward' ? ['1m','3m','6m','1y','2y','5y'] : ['1m','3m','6m','1y']) as value}<button type="button" aria-pressed={period === value} onclick={() => controller.setPeriod(value as '1y')}>{periods[value as keyof typeof periods].label}</button>{/each}</div><div class="benchmark-tax-picker" role="group" aria-label="Tax treatment"><button type="button" aria-pressed={!controller.benchmarkAfterTax} onclick={() => controller.setBenchmarkAfterTax(false)}>Gross</button><button type="button" aria-pressed={controller.benchmarkAfterTax} onclick={() => controller.setBenchmarkAfterTax(true)}>After tax</button></div></div>
    </div>
    <p class="chart-key"><span class="chart-key-csh2">CSH2</span><span class="chart-key-estr">Euro overnight benchmark</span></p>
    <p class="chart-explanation benchmark-explanation">{controller.direction === 'forward' ? `Each point shows how CSH2 and the euro overnight benchmark performed over the following ${periods[period].description}. Use the date to compare a savings-account rate available then with what actually followed.` : `Each point compares its value with the value ${periods[period].description} earlier and annualizes the return.`}</p>
    {#if controller.benchmarkAfterTax}<p class="chart-explanation tax-explanation">CSH2 includes buy and sell TOB plus {benchmarkUsesReyndersTax ? '30% Reynders Tax' : '10% CGT from 2026'}, ignoring the annual CGT exemption. The euro overnight benchmark is unchanged.</p>{/if}
    {#if selectedSeries}<LineChart data={selectedSeries} from={controller.view?.from} to={controller.view?.to} ariaLabel={`${controller.direction === 'forward' ? 'Forward' : 'Backward'} annualized CSH2 return compared with the Euro overnight benchmark over ${periods[period].description}`} />{:else}<p class="chart-loading">{controller.benchmarkStatus.message || 'Preparing benchmark history…'}</p>{/if}
  </section>
</section>
