<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  import type { FidelityPremiumAssessment } from '../types';
  import { date, euro, percent } from '../services/formatters';
  import { nextYearComparisonValues } from '../services/fidelity-timing.mjs';
  import BenchmarkSection from './BenchmarkSection.svelte';
  import BestSavingsAccountInputs from './BestSavingsAccountInputs.svelte';
  import LineChart from './LineChart.svelte';

  let { controller, setupTab, onOpenMethodology }: { controller: BacktestController; setupTab: 'current' | 'historical'; onOpenMethodology?: () => void } = $props();
  let view = $derived(controller.view);
  let result = $derived(view?.result);
  let projectionMode = $state<'portfolio-value' | 'time-weighted'>('time-weighted');
  let projection = $derived(projectionMode === 'portfolio-value' ? view?.returnSeries.portfolioValue.projected : view?.returnSeries.timeWeighted.projected);
  let nextAssessment = $derived(result?.fidelityPremiumAssessments[0]);

  type NextYearComparison = { primary: string; otherAlternative?: string };

  const nextYearComparison = (assessment: FidelityPremiumAssessment) => {
    const comparison = nextYearComparisonValues({ csh2Value: assessment.nextYearCsh2Value, currentAccountValue: assessment.nextYearAccountValue, bestAccountValue: assessment.nextYearBestAccountValue });
    if (!comparison) return { primary: assessment.currentPeriodPreferred === 'wait' ? 'Enter rates' : '—' } satisfies NextYearComparison;
    const formatDifference = (label: string, difference: number) => difference <= 0.005 && difference >= -0.005 ? `${label} effectively equal` : `${label} ${difference > 0 ? '+' : '−'}${euro.format(Math.abs(difference))}`;
    return { primary: formatDifference(comparison.label, comparison.difference), otherAlternative: comparison.otherAlternative && formatDifference(comparison.otherAlternative.label, comparison.otherAlternative.difference) } satisfies NextYearComparison;
  };

  const recommendation = (assessment: FidelityPremiumAssessment) => {
    if (assessment.recommendation === 'move now') return 'Transfer to CSH2 now';
    if (assessment.recommendation === 'move to best account') return 'Transfer to best savings account now';
    if (assessment.recommendation === 'move after payout') return `Transfer to CSH2 on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}`;
    if (assessment.recommendation === 'move to best account after payout') return `Transfer to best savings account on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}`;
    if (assessment.recommendation === 'keep in account') return 'Keep in current account';
    if (assessment.recommendation === 'wait, then reassess') return `Reassess on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}`;
    return 'Either';
  };

  const suggestedNextMove = (assessment: FidelityPremiumAssessment | undefined, count: number) => {
    if (!assessment) return 'No unpaid fidelity premiums are entered. Review the minimum holding periods below to compare staying invested with moving today.';
    const prefix = count > 1 ? `Next of ${count} premium decisions: ` : '';
    const action = assessment.recommendation === 'move after payout' && assessment.transferDate ? `transfer to CSH2 on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}.` : assessment.recommendation === 'move to best account after payout' && assessment.transferDate ? `transfer to the best savings account on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}.` : assessment.recommendation === 'wait, then reassess' && assessment.transferDate ? `wait until ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}, then reassess.` : assessment.recommendation === 'move now' ? 'transfer this amount to CSH2 now.' : assessment.recommendation === 'move to best account' ? 'transfer this amount to the best savings account now.' : assessment.recommendation === 'keep in account' ? 'keep this amount in the current account.' : 'either option is effectively equal; use the minimum holding periods below as the broader guide.';
    return count > 1 ? `${prefix}${action}` : `${prefix}${action.charAt(0).toUpperCase()}${action.slice(1)}`;
  };
</script>

{#if setupTab === 'historical'}
  <section class="future-empty" aria-labelledby="future-outlook-heading">
    <p class="eyebrow">Forward guidance</p>
    <h2 id="future-outlook-heading">Future outlook is for current-account backtests</h2>
    <p>The historical savings view shows what happened over the selected rate schedule. Switch to <b>Current account backtest</b> in Configuration to compare today’s CSH2 scenario, minimum holding periods, and transfer timing.</p>
  </section>
{:else}
  <section class="future-outlook" aria-labelledby="future-outlook-heading">
    <div class="future-intro">
      <p class="eyebrow">Forward guidance</p>
      <h2 id="future-outlook-heading">What about the future?</h2>
      <p>Use today’s estimated CSH2 return and the best available savings rate to decide whether to move now, wait for a fidelity premium, or keep your money where it is.</p>
    </div>
    <section class="suggested-next-move" aria-labelledby="suggested-next-move-heading">
      <p class="eyebrow">Suggested next move</p>
      <h3 id="suggested-next-move-heading">{suggestedNextMove(nextAssessment, result?.fidelityPremiumAssessments.length ?? 0)}</h3>
      <p>This is an estimate under the selected rate, tax, and transaction-cost assumptions. Review the detailed timing decisions below before acting.</p>
    </section>

    <BestSavingsAccountInputs {controller} />

    {#if view && projection}
      <section class="panel projection-panel" aria-labelledby="projection-heading">
        <div class="section-title">
          <div><p class="eyebrow">Selected scenario</p><h3 id="projection-heading">Projected performance</h3></div>
          <div class="return-mode-picker" role="group" aria-label="Projection view">
            <button type="button" aria-pressed={projectionMode === 'portfolio-value'} onclick={() => projectionMode = 'portfolio-value'}>Portfolio value</button>
            <button type="button" aria-pressed={projectionMode === 'time-weighted'} onclick={() => projectionMode = 'time-weighted'}>Performance</button>
          </div>
        </div>
        <p class="chart-key"><span class="chart-key-csh2">CSH2</span><span class="chart-key-estr">Gross €STR</span><span class="chart-key-account">Your account</span><span class="chart-key-projected">Projection</span></p>
        <p class="chart-explanation">Dashed through {date.format(new Date(`${projection.throughDate}T00:00:00Z`))}: {projectionMode === 'portfolio-value' ? `assumes no further cash flows, the selected CSH2 rate scenario of ${percent(projection.csh2AnnualRatePercent)}%, and each entered fidelity premium is paid on its earned date.` : `extends each observed TWR endpoint with no further cash flows, the selected CSH2 rate scenario of ${percent(projection.csh2AnnualRatePercent)}%, the latest €STR rate of ${percent(projection.overnightRatePercent)}%, and ${projection.baseAnnualRatePercent !== undefined ? `the entered account base rate of ${percent(projection.baseAnnualRatePercent)}%` : 'the account’s observed interest assumptions'}; future fidelity premiums are credited on their earned dates and included as internal account returns.`}</p>
        <LineChart accountLabel="Your account" crossoverDate={projectionMode === 'portfolio-value' ? result?.projectedCrossover?.date : undefined} data={projectionMode === 'portfolio-value' ? view.returnSeries.portfolioValue : view.returnSeries.timeWeighted} unit={projectionMode === 'portfolio-value' ? 'euro' : 'percent'} from={view.to} to={projection.throughDate} ariaLabel={`${projectionMode === 'portfolio-value' ? 'Projected portfolio value' : 'Projected time-weighted performance'} of CSH2, €STR, and your account`} />
      </section>
    {/if}

    <BenchmarkSection {controller} {onOpenMethodology} />

    {#if result?.fidelityPremiumAssessments.length}
      <section class="panel fidelity-outlook" aria-labelledby="fidelity-outlook-heading">
        <div class="section-title"><div><p class="eyebrow">Transfer timing</p><h3 id="fidelity-outlook-heading">Fidelity premium timing</h3></div></div>
        <div class="table-wrap"><table class="fidelity-timing-table"><thead><tr><th>Base amount</th><th>Earned</th><th>Payout</th><th>Until payout</th><th>Next full year</th><th>Recommendation</th></tr></thead><tbody>
          {#each result.fidelityPremiumAssessments as assessment (assessment.id)}
            {@const nextYear = nextYearComparison(assessment)}
            <tr><td><span class="fidelity-mobile-label" aria-hidden="true">Base amount</span>{euro.format(assessment.baseAmount)}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Earned</span>{date.format(new Date(`${assessment.earnedDate}T00:00:00Z`))}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Payout</span>{euro.format(assessment.finalPayoutAmount)}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Until payout</span>{assessment.currentPeriodPreferred === 'move now' ? `CSH2 +${euro.format(Math.abs(assessment.currentPeriodDifference))}` : assessment.currentPeriodPreferred === 'move to best account' ? 'Best savings account' : assessment.currentPeriodPreferred === 'wait' ? `Current account +${euro.format(Math.abs(assessment.currentPeriodDifference))}` : 'Effectively equal'}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Next full year</span>{nextYear.primary}{#if nextYear.otherAlternative}<span class="next-year-alternative">{nextYear.otherAlternative}</span>{/if}</td><td class="timing-recommendation"><span class="fidelity-mobile-label" aria-hidden="true">Recommendation</span>{recommendation(assessment)}</td></tr>
          {/each}
        </tbody></table></div>
        <small class="timing-notes"><span>Ordered by the recommended transfer or reassessment date, with keep decisions last. Each row is one cash-transfer recommendation; legal tranche allocation is handled internally.</span><span><b>Until payout</b> compares moving now to CSH2 or the best available savings account with keeping the money in your current account until the entered payout.<br /><b>Next full year</b> compares CSH2 and the best available savings account with your current savings account after the current premium is earned.</span><span>Uses the selected CSH2 rate scenario and the selected transaction and tax settings.</span></small>
      </section>
    {:else if view}
      <p class="future-note">No unpaid fidelity premiums are entered, so there is no transfer timing recommendation to show.</p>
    {:else}
      <p class="future-note">Calculate a current-account backtest to see projected performance and transfer timing.</p>
    {/if}
  </section>
{/if}
