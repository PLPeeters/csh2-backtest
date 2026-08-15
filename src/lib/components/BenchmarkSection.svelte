<script lang="ts">
  import { estimateSavingsAccountRateMatch } from '../../backtest.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import { date, duration, percent } from '../services/formatters';
  import LineChart from './LineChart.svelte';

  let { controller }: { controller: BacktestController } = $props();
  let methodologyDialog = $state<HTMLDialogElement>();
  const precisePercent = (value: number) => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const longDate = (value: string) => date.format(new Date(`${value}T00:00:00Z`));
  const periods = { '1m': { label: '1M', description: '1 month' }, '3m': { label: '3M', description: '3 months' }, '6m': { label: '6M', description: '6 months' }, '1y': { label: '1Y', description: '1 year' }, '2y': { label: '2Y', description: '2 years' }, '5y': { label: '5Y', description: '5 years' } } as const;
  let period = $derived(controller.direction === 'backward' ? controller.backwardPeriod : controller.forwardPeriod);
  let benchmarkUsesReyndersTax = $derived(controller.settings.applyReyndersTax);
  let holdingPeriods = $derived(controller.benchmark?.holdingPeriods[controller.settings.applyReyndersTax ? 'reynders' : 'cgt']);
  let accountRateIsEntered = $derived(controller.settings.accountBaseInterestRate !== '' || controller.settings.accountFidelityPremium !== '');
  let accountBaseRate = $derived(Number(controller.settings.accountBaseInterestRate || 0));
  let accountFidelityPremium = $derived(Number(controller.settings.accountFidelityPremium || 0));
  let accountRateIsValid = $derived(Number.isFinite(accountBaseRate) && accountBaseRate > -100 && Number.isFinite(accountFidelityPremium) && accountFidelityPremium >= 0 && accountBaseRate + accountFidelityPremium > -100);
  let matchAccount = $derived(holdingPeriods && accountRateIsValid
    ? estimateSavingsAccountRateMatch(holdingPeriods.csh2AnnualRatePercent, accountBaseRate, accountFidelityPremium, holdingPeriods.valuationDate, { applyReyndersTax: controller.settings.applyReyndersTax })
    : undefined);
  let selectedSeries = $derived(controller.benchmark?.[controller.benchmarkAfterTax ? benchmarkUsesReyndersTax ? 'reynders' : 'cgt' : 'gross']?.[controller.direction === 'backward' ? 'lookback' : 'forward']?.[period as '1y']);
</script>

<section class="benchmark-section" aria-labelledby="holding-period-heading">
  <div class="section-title current-rate-heading">
    <div><p class="eyebrow">Current-rate estimate</p><h2 id="holding-period-heading">Minimum holding periods</h2>{#if holdingPeriods}<p class="current-rate-summary" aria-label="Current rates used"><span>Current €STR <strong>{percent(holdingPeriods.overnightRatePercent)}%</strong></span><span class="estimated-rate">Estimated CSH2 <strong>{percent(holdingPeriods.csh2AnnualRatePercent)}%</strong><span class="methodology-trigger"><button type="button" class="methodology-info" aria-label="How estimated CSH2 is calculated" aria-haspopup="dialog" onclick={() => methodologyDialog?.showModal()}>i</button><span class="methodology-tooltip" role="tooltip">Click for methodology</span></span></span></p>{/if}</div>
    <div class="benchmark-account-rate"><div class="benchmark-account-rate-fields"><label class="account-interest-rate">Base annual rate (%)<input type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" value={controller.settings.accountBaseInterestRate} oninput={(event) => controller.updateSetting('accountBaseInterestRate', event.currentTarget.value)} /></label><label class="account-interest-rate">Fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.accountFidelityPremium} oninput={(event) => controller.updateSetting('accountFidelityPremium', event.currentTarget.value)} /></label></div>
    </div>
  </div>
  {#if holdingPeriods}
    <div class="metric-row metric-row-details benchmark-holding-periods"><article class="metric"><p>Time to break even at current rates</p><strong>{holdingPeriods.breakEven ? duration(holdingPeriods.valuationDate, holdingPeriods.breakEven.date) : 'More than 100 years'}</strong><small>Assumes CSH2 stays at its estimated current rate of {percent(holdingPeriods.csh2AnnualRatePercent)}%.</small></article><article class="metric"><p>Time to match your account rate at current rates</p><strong>{!accountRateIsEntered ? 'Enter your account rate' : !accountRateIsValid ? 'Enter valid rates' : matchAccount ? duration(holdingPeriods.valuationDate, matchAccount.date) : 'More than 100 years'}</strong><small>{!accountRateIsEntered ? 'Add the base rate and fidelity premium above.' : !accountRateIsValid ? 'The base rate must exceed -100% and the fidelity premium cannot be negative.' : `Assumes a ${percent(accountBaseRate)}% base rate and ${percent(accountFidelityPremium)}% fidelity premium after each uninterrupted year.`}</small></article><article class="metric"><p>Time to match €STR at current rates</p><strong>{holdingPeriods.matchOvernight ? duration(holdingPeriods.valuationDate, holdingPeriods.matchOvernight.date) : 'More than 100 years'}</strong><small>Assumes estimated CSH2 stays at {percent(holdingPeriods.csh2AnnualRatePercent)}% and published €STR stays at {percent(holdingPeriods.overnightRatePercent)}%.</small></article></div>
    <p class="chart-explanation holding-period-explanation">Investment-agnostic estimate with fractional shares, buy and sell TOB, and {controller.settings.applyReyndersTax ? '30% Reynders Tax' : '10% CGT'}. It ignores fixed broker fees and the annual CGT exemption; the savings-account estimate assumes one untouched deposit and no separate account-tax adjustment.</p>
  {:else if controller.benchmarkStatus.kind === 'success'}
    <p class="chart-explanation holding-period-explanation">Current-rate holding periods are unavailable because comparable recent CSH2 or overnight-rate data is missing.</p>
  {/if}

  {#if holdingPeriods}
    <dialog class="methodology-dialog" bind:this={methodologyDialog} aria-labelledby="methodology-title" aria-describedby="methodology-intro" onclick={(event) => { if (event.target === methodologyDialog) methodologyDialog?.close(); }} oncancel={(event) => { event.preventDefault(); methodologyDialog?.close(); }}>
      <div class="methodology-dialog-header"><div><p class="eyebrow">Current-rate estimate</p><h3 id="methodology-title">How the estimated CSH2 rate is calculated</h3></div><button type="button" class="methodology-close" aria-label="Close methodology" onclick={() => methodologyDialog?.close()}>×</button></div>
      <p id="methodology-intro">The estimate keeps today’s published €STR rate, while using recent market data only to estimate CSH2’s excess return over €STR. Both historical returns use the same dates, so past rate changes largely cancel.</p>
      <ol class="methodology-steps">
        <li><strong>Match the historical window.</strong><span>{longDate(holdingPeriods.trendStartDate)} to {longDate(holdingPeriods.valuationDate)} ({holdingPeriods.trendDays} calendar days).</span></li>
        <li><strong>Annualize CSH2’s price return.</strong><span>The observed closing-price return becomes <b>{precisePercent(holdingPeriods.observedCsh2AnnualRatePercent)}%</b> per year.</span></li>
        <li><strong>Compound €STR over those same dates.</strong><span>Using each published rate with Actual/360 produces <b>{precisePercent(holdingPeriods.observedOvernightAnnualRatePercent)}%</b> annualized.</span></li>
        <li><strong>Calculate CSH2’s relative excess.</strong><span class="methodology-equation"><span class="fraction" aria-hidden="true"><span>1 + {precisePercent(holdingPeriods.observedCsh2AnnualRatePercent)}%</span><span>1 + {precisePercent(holdingPeriods.observedOvernightAnnualRatePercent)}%</span></span><span aria-hidden="true"> − 1 = <b>{precisePercent(holdingPeriods.csh2ExcessAnnualRatePercent)}%</b></span><span class="sr-only">(1 plus {precisePercent(holdingPeriods.observedCsh2AnnualRatePercent)} percent) divided by (1 plus {precisePercent(holdingPeriods.observedOvernightAnnualRatePercent)} percent), minus 1, equals {precisePercent(holdingPeriods.csh2ExcessAnnualRatePercent)} percent.</span></span></li>
        <li><strong>Apply that excess to current €STR.</strong><span>The published rate on {longDate(holdingPeriods.rateDate)} is <b>{precisePercent(holdingPeriods.overnightRatePercent)}%</b>. Daily Actual/360 compounding makes that <b>{precisePercent(holdingPeriods.currentOvernightAnnualRatePercent)}%</b> effective annually.</span></li>
      </ol>
      <p class="methodology-result"><span>Estimated current CSH2</span><strong>(1 + {precisePercent(holdingPeriods.currentOvernightAnnualRatePercent)}%) × (1 + {precisePercent(holdingPeriods.csh2ExcessAnnualRatePercent)}%) − 1 = {precisePercent(holdingPeriods.csh2AnnualRatePercent)}%</strong></p>
      <p class="methodology-caveat">This is a mechanical estimate, not a forecast. It assumes the observed CSH2 excess persists and remains sensitive to market closing-price noise.</p>
    </dialog>
  {/if}

  <section class="panel chart-panel benchmark-chart-panel" aria-labelledby="benchmark-heading">
    <div class="section-title"><div class="benchmark-title"><p class="eyebrow">Underlying benchmark</p><h3 id="benchmark-heading">{controller.direction === 'forward' ? 'Forward' : 'Backward'} annualized returns · {periods[period].label}</h3></div>
      <div class="benchmark-control"><div class="benchmark-mode-picker" role="group" aria-label="Return direction"><button type="button" aria-pressed={controller.direction === 'backward'} onclick={() => controller.setDirection('backward')}>Backward</button><button type="button" aria-pressed={controller.direction === 'forward'} onclick={() => controller.setDirection('forward')}>Forward</button></div><div class="benchmark-period-picker" role="group" aria-label={`${controller.direction === 'forward' ? 'Forward' : 'Backward'} comparison period`}>{#each (controller.direction === 'backward' ? ['1m','3m','6m','1y','2y','5y'] : ['1m','3m','6m','1y']) as value}<button type="button" aria-pressed={period === value} onclick={() => controller.setPeriod(value as '1y')}>{periods[value as keyof typeof periods].label}</button>{/each}</div><div class="benchmark-tax-picker" role="group" aria-label="Tax treatment"><button type="button" aria-pressed={!controller.benchmarkAfterTax} onclick={() => controller.setBenchmarkAfterTax(false)}>Gross</button><button type="button" aria-pressed={controller.benchmarkAfterTax} onclick={() => controller.setBenchmarkAfterTax(true)}>After tax</button></div></div>
    </div>
    <p class="chart-key"><span class="chart-key-csh2">CSH2</span><span class="chart-key-estr">Euro overnight benchmark</span></p>
    <p class="chart-explanation benchmark-explanation">{controller.direction === 'forward' ? `Each point shows how CSH2 and the euro overnight benchmark performed over the following ${periods[period].description}. Use the date to compare a savings-account rate available then with what actually followed.` : `Each point compares its value with the value ${periods[period].description} earlier and annualizes the return.`}</p>
    {#if controller.benchmarkAfterTax}<p class="chart-explanation tax-explanation">CSH2 includes buy and sell TOB plus {benchmarkUsesReyndersTax ? '30% Reynders Tax' : '10% CGT from 2026'}, ignoring the annual CGT exemption. The euro overnight benchmark is unchanged.</p>{/if}
    {#if selectedSeries}<LineChart data={selectedSeries} from={controller.view?.from} to={controller.view?.to} ariaLabel={`${controller.direction === 'forward' ? 'Forward' : 'Backward'} annualized CSH2 return compared with the Euro overnight benchmark over ${periods[period].description}`} />{:else}<p class="chart-loading">{controller.benchmarkStatus.message || 'Preparing benchmark history…'}</p>{/if}
  </section>
</section>
