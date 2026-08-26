<script lang="ts">
  import { onDestroy } from 'svelte';
  import { buildCurrentRateEvolution, estimateAnnualizedAfterTaxCsh2Rate, estimateSavingsAccountRateMatch, estimateSavingsAccountRateMatches } from '../../backtest.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { MinimumHoldingPeriodRange } from '../types';
  import { date, duration, percent } from '../services/formatters';
  import HoldingPeriodChart from './HoldingPeriodChart.svelte';
  import HoldingPeriodEvolutionChart from './HoldingPeriodEvolutionChart.svelte';

  let { controller }: { controller: BacktestController } = $props();
  let methodologyDialog = $state<HTMLDialogElement>();
  let scrollLock: { document: Document; documentOverflow: string; bodyOverflow: string } | undefined;
  let rateEstimateLabel = $derived(controller.settings.csh2RateScenario);
  const unlockPageScroll = () => {
    if (!scrollLock) return;
    scrollLock.document.documentElement.style.overflow = scrollLock.documentOverflow;
    scrollLock.document.body.style.overflow = scrollLock.bodyOverflow;
    scrollLock = undefined;
  };
  const openMethodology = () => {
    methodologyDialog?.showModal();
    const document = methodologyDialog?.ownerDocument;
    if (!document) return;
    scrollLock = { document, documentOverflow: document.documentElement.style.overflow, bodyOverflow: document.body.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };
  const closeMethodology = () => methodologyDialog?.close();
  onDestroy(unlockPageScroll);
  const precisePercent = (value: number) => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const indexedValue = (value: number) => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${percent(value)}%`;
  const longDate = (value: string) => date.format(new Date(`${value}T00:00:00Z`));
  const shortDate = (value: string) => new Intl.DateTimeFormat('en-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const roundedProjectionHorizon = (latestMilestoneDays: number) => {
    const paddedDays = Math.max(365, Math.ceil(latestMilestoneDays * 1.15));
    const roughStep = paddedDays / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalized = roughStep / magnitude;
    const tickStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    return Math.min(36525, Math.ceil(paddedDays / tickStep) * tickStep);
  };
  const selectedHoldingPeriod = (range?: MinimumHoldingPeriodRange) => range?.[controller.settings.csh2RateScenario === 'cautious' ? 'latest' : controller.settings.csh2RateScenario === 'optimistic' ? 'earliest' : 'central'];
  const holdingPeriodText = (valuationDate: string, range?: MinimumHoldingPeriodRange) => {
    const selected = selectedHoldingPeriod(range);
    return selected ? duration(valuationDate, selected.date) : 'More than 100 years';
  };
  let holdingPeriods = $derived(controller.benchmark?.holdingPeriods[controller.settings.applyReyndersTax ? 'reynders' : 'cgt']);
  let accountRateIsEntered = $derived(controller.settings.bestSavingsBaseInterestRate !== '' || controller.settings.bestSavingsFidelityPremium !== '');
  let accountBaseRate = $derived(Number(controller.settings.bestSavingsBaseInterestRate || 0));
  let accountFidelityPremium = $derived(Number(controller.settings.bestSavingsFidelityPremium || 0));
  let totalSavingsAmount = $derived(Number(controller.settings.totalSavingsAmount || '10000'));
  let hasTotalSavingsAmount = $derived(Number.isFinite(totalSavingsAmount) && totalSavingsAmount > 0);
  let taxEstimateOptions = $derived({ applyReyndersTax: controller.settings.applyReyndersTax, applyCapitalGainsExemption: controller.settings.applyCapitalGainsExemption && hasTotalSavingsAmount, investmentAmount: hasTotalSavingsAmount ? totalSavingsAmount : undefined });
  let estimatedAfterTaxRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRatePercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let estimatedAfterTaxLowRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRateLowPercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let estimatedAfterTaxHighRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRateHighPercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let estimatedAfterTaxError = $derived(estimatedAfterTaxLowRate !== undefined && estimatedAfterTaxHighRate !== undefined ? Math.abs(estimatedAfterTaxHighRate - estimatedAfterTaxLowRate) / 2 : undefined);
  let accountRateIsValid = $derived(Number.isFinite(accountBaseRate) && accountBaseRate > -100 && Number.isFinite(accountFidelityPremium) && accountFidelityPremium >= 0 && accountBaseRate + accountFidelityPremium > -100);
  let selectedCsh2Rate = $derived(holdingPeriods?.[controller.settings.csh2RateScenario === 'cautious' ? 'csh2AnnualRateLowPercent' : controller.settings.csh2RateScenario === 'optimistic' ? 'csh2AnnualRateHighPercent' : 'csh2AnnualRatePercent']);
  let accountMatches = $derived(holdingPeriods && accountRateIsValid && accountFidelityPremium > 0
    ? estimateSavingsAccountRateMatches(selectedCsh2Rate!, accountBaseRate, accountFidelityPremium, holdingPeriods.valuationDate, taxEstimateOptions)
    : undefined);
  let matchAccount = $derived(accountMatches
    ? accountMatches.beforeFidelity ?? accountMatches.afterFidelity
    : holdingPeriods && accountRateIsValid
      ? estimateSavingsAccountRateMatch(selectedCsh2Rate!, accountBaseRate, accountFidelityPremium, holdingPeriods.valuationDate, taxEstimateOptions)
      : undefined);
  let breakEvenPeriod = $derived(selectedHoldingPeriod(holdingPeriods?.breakEvenRange));
  let overnightMatchPeriod = $derived(selectedHoldingPeriod(holdingPeriods?.matchOvernightRange));
  let breakEvenLabel = $derived(holdingPeriods ? holdingPeriodText(holdingPeriods.valuationDate, holdingPeriods.breakEvenRange) : 'Unavailable');
  let accountMatchLabel = $derived(!accountRateIsEntered ? 'Enter the best available rate' : !accountRateIsValid ? 'Enter valid rates' : matchAccount && holdingPeriods ? duration(holdingPeriods.valuationDate, matchAccount.date) : 'More than 100 years');
  let overnightMatchLabel = $derived(holdingPeriods ? holdingPeriodText(holdingPeriods.valuationDate, holdingPeriods.matchOvernightRange) : 'Unavailable');
  let projectionHorizonDays = $derived(roundedProjectionHorizon(Math.max(
    breakEvenPeriod?.days ?? 0,
    overnightMatchPeriod?.days ?? 0,
    matchAccount?.days ?? 0,
    accountMatches?.afterFidelity?.days ?? 0
  )));
  let currentRateEvolution = $derived(holdingPeriods && selectedCsh2Rate !== undefined
    ? buildCurrentRateEvolution(selectedCsh2Rate, holdingPeriods.overnightRatePercent, holdingPeriods.valuationDate, {
      baseAnnualRatePercent: accountRateIsEntered && accountRateIsValid ? accountBaseRate : undefined,
      fidelityPremiumPercent: accountRateIsEntered && accountRateIsValid ? accountFidelityPremium : undefined,
      maximumProjectionDays: projectionHorizonDays,
      ...taxEstimateOptions
    })
    : undefined);
  let breakEvenMatches = $derived(currentRateEvolution && holdingPeriods ? currentRateEvolution.matches.breakEven.map((match: { date: string; day: number }) => ({ days: match.day, label: duration(holdingPeriods.valuationDate, match.date) })) : []);
  let accountEvolutionMatches = $derived(currentRateEvolution && holdingPeriods ? currentRateEvolution.matches.account.map((match: { date: string; day: number }) => ({ days: match.day, label: duration(holdingPeriods.valuationDate, match.date) })) : []);
  let overnightMatches = $derived(currentRateEvolution && holdingPeriods ? currentRateEvolution.matches.overnight.map((match: { date: string; day: number }) => ({ days: match.day, label: duration(holdingPeriods.valuationDate, match.date) })) : []);
  let holdingPeriodMilestones = $derived([
    { name: 'Break even', label: breakEvenLabel, matches: breakEvenMatches, matchingIntervals: currentRateEvolution?.matchingIntervals.breakEven, kind: 'break-even' as const },
    { name: 'Match best savings account', label: accountMatchLabel, matches: accountEvolutionMatches, matchingIntervals: currentRateEvolution?.matchingIntervals.account, kind: 'account' as const },
    { name: 'Match €STR', label: overnightMatchLabel, matches: overnightMatches, matchingIntervals: currentRateEvolution?.matchingIntervals.overnight, kind: 'overnight' as const }
  ]);
  let evolutionMarkers = $derived(currentRateEvolution ? [
    ...currentRateEvolution.matches.breakEven.map((match: { date: string; day: number }) => ({ day: match.day, label: 'Break even', kind: 'break-even' as const })),
    ...currentRateEvolution.matches.overnight.map((match: { date: string; day: number }, index: number) => ({ day: match.day, label: duration(holdingPeriods!.valuationDate, match.date), markerText: index ? 'Re-match €STR' : 'Match €STR', kind: 'overnight' as const })),
  ] : []);
</script>

<section class="benchmark-section" aria-labelledby="holding-period-heading">
  <div class="section-title current-rate-heading">
    <div><p class="eyebrow">Current-rate estimate</p><h2 id="holding-period-heading">Minimum holding periods</h2>{#if holdingPeriods}<p class="current-rate-summary" aria-label="Current rates used"><span>Current €STR <strong>{percent(holdingPeriods.overnightRatePercent)}%</strong></span><span class="estimated-rate">Estimated CSH2 <strong class="estimated-rate-value"><span class="estimated-rate-point">{percent(holdingPeriods.csh2AnnualRatePercent)}%</span>{#if holdingPeriods.modelErrorAnnualRatePercent !== undefined}<span class="estimated-rate-error">±{percent(holdingPeriods.modelErrorAnnualRatePercent)} pp</span>{/if}</strong><span class="methodology-trigger"><button type="button" class="methodology-info" aria-label="How estimated CSH2 is calculated" aria-haspopup="dialog" onclick={openMethodology}>i</button><span class="methodology-tooltip" role="tooltip">Click for methodology</span></span></span>{#if estimatedAfterTaxRate !== undefined}<span class="estimated-rate">Post-tax estimated CSH2 rate <strong class="estimated-rate-value"><span class="estimated-rate-point">{percent(estimatedAfterTaxRate)}%</span>{#if estimatedAfterTaxError !== undefined && estimatedAfterTaxError > 0}<span class="estimated-rate-error">±{percent(estimatedAfterTaxError)} pp</span>{/if}</strong></span>{/if}</p>{/if}</div>
    <div class="benchmark-account-rate"><p class="eyebrow">Best available savings account</p><div class="benchmark-account-rate-fields"><label class="account-interest-rate">Best available base annual rate (%)<input type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" value={controller.settings.bestSavingsBaseInterestRate} oninput={(event) => controller.updateSetting('bestSavingsBaseInterestRate', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsBaseInterestRate', event.currentTarget.value)} /></label><label class="account-interest-rate">Best available fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.bestSavingsFidelityPremium} oninput={(event) => controller.updateSetting('bestSavingsFidelityPremium', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsFidelityPremium', event.currentTarget.value)} /></label></div>
    </div>
  </div>
  {#if holdingPeriods}
    <div class="chart-update-container"><div class="holding-period-summary"><HoldingPeriodChart milestones={holdingPeriodMilestones} maximumDays={currentRateEvolution?.maximumProjectionDays ?? projectionHorizonDays} /></div>{#if controller.benchmarkStatus.kind === 'loading'}<div class="chart-update-overlay" role="status">Updating minimum holding periods…</div>{/if}</div>
    <p class="chart-explanation holding-period-explanation">
      At the {rateEstimateLabel} estimated CSH2 rate. The post-tax rate assumes a one-year buy-and-sell holding period and includes buy and sell TOB plus {controller.settings.applyReyndersTax ? '30% Reynders Tax' : '10% CGT'}, with no fixed broker fees.
      {#if controller.settings.applyCapitalGainsExemption && !controller.settings.applyReyndersTax} 
        It applies the annual CGT exemption to a €{totalSavingsAmount.toLocaleString('nl-BE')} savings amount.
      {/if} 
      The savings-account estimate assumes one untouched deposit and no separate account-tax adjustment.
      {#if accountRateIsEntered && accountRateIsValid}
        The best available account uses a {percent(accountBaseRate)}% base rate and {percent(accountFidelityPremium)}% fidelity premium after each uninterrupted year.
      {/if}
    </p>
  {:else if controller.benchmarkStatus.kind === 'success'}
    <p class="chart-explanation holding-period-explanation">Current-rate holding periods are unavailable because comparable recent CSH2 or overnight-rate data is missing.</p>
  {/if}

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
        <dl class="methodology-result"><div><dt>Today’s compounded €STR</dt><dd>{precisePercent(holdingPeriods.currentOvernightAnnualRatePercent)}%</dd></div><div><dt>Recent CSH2 difference</dt><dd>{holdingPeriods.csh2ExcessAnnualRatePercent > 0 ? '+' : ''}{precisePercent(holdingPeriods.csh2ExcessAnnualRatePercent)} pp</dd></div><div class="methodology-result-total"><dt>Estimated CSH2 return</dt><dd>{precisePercent(holdingPeriods.csh2AnnualRatePercent)}%</dd></div></dl>
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

  {#if holdingPeriods && currentRateEvolution}
  <section class="panel chart-panel holding-period-chart-panel" aria-labelledby="holding-period-chart-heading">
    <div class="section-title"><div><p class="eyebrow">Account comparison</p><h3 id="holding-period-chart-heading">CSH2 versus best savings account</h3></div></div>
    {#if accountRateIsEntered && accountRateIsValid}
      <div class="chart-update-container"><p class="chart-key holding-evolution-key"><span class="chart-key-csh2">Net CSH2 advantage</span><span class="chart-key-account">Best savings account</span></p>
      <p class="chart-explanation holding-evolution-explanation">Assuming today’s rates stay constant, the line shows how far net CSH2 is ahead of or behind the best available savings account after buy and sell TOB and the selected tax. Arrows mark break-even and Match €STR.</p>
      <HoldingPeriodEvolutionChart points={currentRateEvolution.points} markers={evolutionMarkers} maximumDays={currentRateEvolution.maximumProjectionDays} valuationDate={holdingPeriods.valuationDate} />{#if controller.benchmarkStatus.kind === 'loading'}<div class="chart-update-overlay" role="status">Updating account comparison…</div>{/if}</div>
    {:else}
      <p class="chart-empty">Enter valid best-available savings rates to compare them with the current CSH2 projection.</p>
    {/if}
  </section>
  {/if}
</section>
