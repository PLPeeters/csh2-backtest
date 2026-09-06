<script lang="ts">
  import { buildCurrentRateEvolution, cpiPointForDate, estimateAnnualizedAfterTaxCsh2Rate, estimateSavingsAccountRateMatch, estimateSavingsAccountRateMatches, latestAnnualInflation, realAnnualRate } from '../../backtest.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { MinimumHoldingPeriodRange } from '../types';
  import { duration, percent } from '../services/formatters';
  import HoldingPeriodChart from './HoldingPeriodChart.svelte';
  import HoldingPeriodEvolutionChart from './HoldingPeriodEvolutionChart.svelte';

  let { controller, onOpenMethodology }: { controller: BacktestController; onOpenMethodology?: () => void } = $props();
  let rateEstimateLabel = $derived(controller.settings.csh2RateScenario);
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
  let annualInflation = $derived(holdingPeriods && controller.cpiData ? latestAnnualInflation(controller.cpiData.indices, holdingPeriods.valuationDate) : undefined);
  let inflationObservation = $derived(holdingPeriods && controller.cpiData ? cpiPointForDate(controller.cpiData.indices, holdingPeriods.valuationDate) : undefined);
  const shownRate = (nominal: number | undefined, inflation: number | undefined, mode: 'nominal' | 'real') => nominal === undefined ? undefined : mode === 'real' ? realAnnualRate(nominal, inflation) : nominal;
  let shownOvernightRate = $derived(shownRate(holdingPeriods?.overnightRatePercent, annualInflation, controller.settings.returnMode));
  let shownCsh2Rate = $derived(shownRate(holdingPeriods?.csh2AnnualRatePercent, annualInflation, controller.settings.returnMode));
  let shownCsh2LowRate = $derived(shownRate(holdingPeriods?.csh2AnnualRateLowPercent, annualInflation, controller.settings.returnMode));
  let shownCsh2HighRate = $derived(shownRate(holdingPeriods?.csh2AnnualRateHighPercent, annualInflation, controller.settings.returnMode));
  let shownCsh2Error = $derived(shownCsh2LowRate !== undefined && shownCsh2HighRate !== undefined ? Math.abs(shownCsh2HighRate - shownCsh2LowRate) / 2 : undefined);
  let shownAfterTaxRate = $derived(shownRate(estimatedAfterTaxRate, annualInflation, controller.settings.returnMode));
  let shownAfterTaxLowRate = $derived(shownRate(estimatedAfterTaxLowRate, annualInflation, controller.settings.returnMode));
  let shownAfterTaxHighRate = $derived(shownRate(estimatedAfterTaxHighRate, annualInflation, controller.settings.returnMode));
  let shownAfterTaxError = $derived(shownAfterTaxLowRate !== undefined && shownAfterTaxHighRate !== undefined ? Math.abs(shownAfterTaxHighRate - shownAfterTaxLowRate) / 2 : undefined);
  let shownSavingsRate = $derived(accountRateIsValid ? shownRate(accountBaseRate + accountFidelityPremium, annualInflation, controller.settings.returnMode) : undefined);
</script>

<section class="benchmark-section" aria-labelledby="holding-period-heading">
  <div class="section-title current-rate-heading">
  <div><p class="eyebrow">Current-rate estimate</p><h2 id="holding-period-heading">Minimum holding periods</h2>{#if holdingPeriods}<p class="current-rate-summary" aria-label="Current rates used"><span>Current €STR <strong>{shownOvernightRate === undefined ? '—' : `${percent(shownOvernightRate)}%`}</strong></span><span class="estimated-rate">Estimated CSH2 <strong class="estimated-rate-value"><span class="estimated-rate-point">{shownCsh2Rate === undefined ? '—' : `${percent(shownCsh2Rate)}%`}</span>{#if shownCsh2Error !== undefined && shownCsh2Error > 0}<span class="estimated-rate-error">±{percent(shownCsh2Error)} pp</span>{/if}</strong><span class="methodology-trigger"><button type="button" class="methodology-info" aria-label="How estimated CSH2 is calculated" aria-haspopup="dialog" onclick={onOpenMethodology}>i</button><span class="methodology-tooltip" role="tooltip">Click for methodology</span></span></span>{#if estimatedAfterTaxRate !== undefined}<br><span class="estimated-rate">Post-tax estimated CSH2 rate <strong class="estimated-rate-value"><span class="estimated-rate-point">{shownAfterTaxRate === undefined ? '—' : `${percent(shownAfterTaxRate)}%`}</span>{#if shownAfterTaxError !== undefined && shownAfterTaxError > 0}<span class="estimated-rate-error">±{percent(shownAfterTaxError)} pp</span>{/if}</strong></span>{/if}{#if accountRateIsEntered && accountRateIsValid}<span>Best savings account <strong>{shownSavingsRate === undefined ? '—' : `${percent(shownSavingsRate)}%`}</strong></span>{/if}</p>{#if controller.settings.returnMode === 'real'}<p class="inflation-assumption">{#if annualInflation !== undefined && inflationObservation}Converted with {percent(annualInflation)}% observed Belgian inflation through {inflationObservation.lowerMonth}.{:else}Inflation-adjusted annual rates are unavailable because a full 12-month CPI comparison is not published.{/if} Holding periods and recommendation ordering continue to use the underlying cash amounts.</p>{/if}{/if}</div>
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
