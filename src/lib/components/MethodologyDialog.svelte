<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { latestAnnualInflation, realAnnualRate } from '../../backtest.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { ConstantRateHoldingPeriods } from '../types';
  import { date, percent } from '../services/formatters';

  let { controller, onOpenReady }: { controller: BacktestController; onOpenReady?: (open: () => void) => void } = $props();
  let methodologyDialog = $state<HTMLDialogElement>();
  let scrollLock: { document: Document; documentOverflow: string; bodyOverflow: string } | undefined;
  let holdingPeriods = $derived<ConstantRateHoldingPeriods | undefined>(controller.benchmark?.holdingPeriods[controller.settings.applyReyndersTax ? 'reynders' : 'cgt']);
  let annualInflation = $derived(holdingPeriods && controller.cpiData ? latestAnnualInflation(controller.cpiData.indices, holdingPeriods.valuationDate) : undefined);
  const shownRate = (nominal: number | undefined, inflation: number | undefined) => nominal === undefined ? undefined : controller.settings.returnMode === 'real' ? realAnnualRate(nominal, inflation) : nominal;
  let shownCsh2Rate = $derived(shownRate(holdingPeriods?.csh2AnnualRatePercent, annualInflation));
  let shownCurrentOvernightRate = $derived(shownRate(holdingPeriods?.currentOvernightAnnualRatePercent, annualInflation));
  const unlockPageScroll = () => {
    if (!scrollLock) return;
    scrollLock.document.documentElement.style.overflow = scrollLock.documentOverflow;
    scrollLock.document.body.style.overflow = scrollLock.bodyOverflow;
    scrollLock = undefined;
  };
  const openMethodology = () => {
    if (!methodologyDialog?.isConnected || methodologyDialog.open) return;
    methodologyDialog.showModal();
    const document = methodologyDialog.ownerDocument;
    scrollLock = { document, documentOverflow: document.documentElement.style.overflow, bodyOverflow: document.body.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };
  const closeMethodology = () => methodologyDialog?.close();
  onMount(() => {
    onOpenReady?.(openMethodology);
  });
  onDestroy(unlockPageScroll);
  const precisePercent = (value: number) => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const indexedValue = (value: number) => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${percent(value)}%`;
  const longDate = (value: string) => date.format(new Date(`${value}T00:00:00Z`));
  const shortDate = (value: string) => new Intl.DateTimeFormat('en-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
</script>

{#if holdingPeriods}
  <dialog class="methodology-dialog" bind:this={methodologyDialog} aria-labelledby="methodology-title" aria-describedby="methodology-intro" onclick={(event) => { if (event.target === methodologyDialog) closeMethodology(); }} oncancel={(event) => { event.preventDefault(); closeMethodology(); }} onclose={unlockPageScroll}>
    <div class="methodology-dialog-header"><div><p class="eyebrow">Current-rate estimate</p><h3 id="methodology-title">How we estimate today’s CSH2 return</h3></div><button type="button" class="methodology-close" aria-label="Close methodology" onclick={closeMethodology}>×</button></div>
    <div class="methodology-dialog-content">
      <p id="methodology-intro">CSH2 generally follows the euro overnight rate, but its return also reflects the fund’s costs and tracking performance. We estimate its current annual return by combining today’s €STR with how CSH2 has recently performed relative to that rate.</p>
      <ol class="methodology-steps">
      <li><strong>Compare CSH2 with the overnight rate.</strong><span>We use every available CSH2 closing price from the previous 180 calendar days. For an easy comparison, both CSH2 and the compounded overnight benchmark start at 100.</span>
        {#if holdingPeriods.trendExamples.length}
          <div class="methodology-example-table-wrap"><table class="methodology-example-table"><thead><tr><th scope="col">Date</th><th scope="col">CSH2</th><th scope="col">Overnight benchmark</th><th scope="col">Gap</th></tr></thead><tbody>{#each holdingPeriods.trendExamples as row, index}{#if holdingPeriods.trendExamplesOmitted && index === 2}<tr class="methodology-example-gap"><td colspan="4"><span aria-hidden="true">…</span><span class="sr-only">Additional daily observations</span></td></tr>{/if}<tr><th scope="row">{shortDate(row.date)}</th><td>{indexedValue(row.csh2Index)}</td><td>{indexedValue(row.overnightBenchmarkIndex)}</td><td>{signedPercent(row.gapPercent)}</td></tr>{/each}</tbody></table></div>
        {/if}
      </li>
      <li><strong>Measure the recent difference.</strong><span>We find the best-fit trend through the gap between CSH2 and the overnight benchmark. This makes the estimate less sensitive to an unusually high or low closing price on a single day.</span></li>
      <li><strong>Apply it to today’s rate.</strong><span>We combine that recent difference with today’s €STR to estimate CSH2’s current annual return.</span></li>
      </ol>
      <dl class="methodology-result">{#if shownCurrentOvernightRate !== undefined && shownCsh2Rate !== undefined}<div><dt>Today’s compounded €STR</dt><dd>{precisePercent(shownCurrentOvernightRate)}%</dd></div><div><dt>Recent CSH2 difference</dt><dd>{shownCsh2Rate - shownCurrentOvernightRate > 0 ? '+' : ''}{precisePercent(shownCsh2Rate - shownCurrentOvernightRate)} pp</dd></div><div class="methodology-result-total"><dt>Estimated CSH2 return</dt><dd>{precisePercent(shownCsh2Rate)}%</dd></div>{:else}<div><dt>Current rates</dt><dd>Unavailable</dd></div>{/if}</dl>
      {#if holdingPeriods.errorWindows.length}
        <section class="methodology-accuracy" aria-labelledby="methodology-accuracy-title">
        <h4 id="methodology-accuracy-title">How accurate is this methodology when applying it to past data?</h4>
        <p>Mean absolute error (MAE) is the average size of the difference between an estimate and what CSH2 actually delivered over the following {Math.round(holdingPeriods.errorEvaluationDays / 30)} months. Lower is better.</p>
        <table><thead><tr><th scope="col">Evaluation period</th><th scope="col">MAE</th></tr></thead><tbody>{#each holdingPeriods.errorWindows.filter((window) => window.rollingYears || window.fullHistory) as window}<tr><th scope="row">{window.rollingYears ? `Last ${window.rollingYears} ${window.rollingYears === 1 ? 'year' : 'years'}` : 'Full history'}</th><td>{percent(window.maeAnnualRatePercent)} pp</td></tr>{/each}</tbody></table>
        {#if holdingPeriods.errorWindows.some((window) => !window.rollingYears && !window.fullHistory)}
          <details class="methodology-yearly"><summary>Year-by-year accuracy</summary><table><thead><tr><th scope="col">Evaluation period</th><th scope="col">MAE</th></tr></thead><tbody>{#each holdingPeriods.errorWindows.filter((window) => !window.rollingYears && !window.fullHistory) as window}<tr><th scope="row">{longDate(window.from)} – {longDate(window.to)}</th><td>{percent(window.maeAnnualRatePercent)} pp</td></tr>{/each}</tbody></table></details>
        {/if}
        {#if holdingPeriods.errorValidationFrom && holdingPeriods.errorValidationTo && holdingPeriods.modelErrorAnnualRatePercent !== undefined}<p>The ±{percent(holdingPeriods.modelErrorAnnualRatePercent)} pp shown beside the current estimate is the model’s typical error from {longDate(holdingPeriods.errorValidationFrom)} through {longDate(holdingPeriods.errorValidationTo)}. It measures this estimation method, not Amundi’s tracking error. Newer estimates cannot be checked until the following {Math.round(holdingPeriods.errorEvaluationDays / 30)} months have elapsed.</p>{/if}
        </section>
      {/if}
      <p class="methodology-caveat">This is an estimate, not a guaranteed return. The holding-time ranges assume today’s rates remain unchanged.</p>
    </div>
  </dialog>
{/if}
