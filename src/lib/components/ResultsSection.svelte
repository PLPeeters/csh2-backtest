<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  import type { FidelityPremiumAssessment } from '../types';
  import { date, duration, euro, number, percent, relativeUpdatedAt, updatedAt } from '../services/formatters';
  import { nextYearComparisonValues } from '../services/fidelity-timing.mjs';
  import LineChart from './LineChart.svelte';
  import { cpiPointForDate } from '../../backtest.mjs';
  let { controller }: { controller: BacktestController } = $props();
  let returnChartMode = $state<'portfolio-value' | 'time-weighted'>('time-weighted');

  const formatNextYearDifference = (label: string, difference: number) => difference <= 0.005 && difference >= -0.005
    ? `${label} effectively equal`
    : `${label} ${difference > 0 ? '+' : '−'}${euro.format(Math.abs(difference))}`;

  const nextYearComparison = (assessment: FidelityPremiumAssessment) => {
    const comparison = nextYearComparisonValues({
      csh2Value: assessment.nextYearCsh2Value,
      currentAccountValue: assessment.nextYearAccountValue,
      bestAccountValue: assessment.nextYearBestAccountValue
    });
    if (!comparison) return { primary: assessment.currentPeriodPreferred === 'wait' ? 'Enter rates' : '—' };
    return {
      primary: formatNextYearDifference(comparison.label, comparison.difference),
      otherAlternative: comparison.otherAlternative && formatNextYearDifference(comparison.otherAlternative.label, comparison.otherAlternative.difference)
    };
  };

  const isSecondaryReturn = (value: number | undefined, other: number | undefined) => {
    if (value === undefined || other === undefined || value === other) return false;
    const bothPositive = value > 0 && other > 0;
    const bothNegative = value < 0 && other < 0;
    return (bothPositive && value < other) || (bothNegative && value > other);
  };
</script>
<section id="results" aria-live="polite">
{#if controller.view}
  {@const result = controller.view.result}
  {@const settings = controller.view.settings}
  {@const negative = result.missedAmount < -0.005}
  {@const valuesAreEqual = Math.abs(result.missedAmount) < 0.005}
  {@const returnDifference = result.csh2MoneyWeightedReturn !== undefined && result.accountMoneyWeightedReturn !== undefined ? result.csh2MoneyWeightedReturn - result.accountMoneyWeightedReturn : undefined}
  {@const csh2UpdatedAt = new Date(controller.view.metadata.cachedAt)}
  {@const estrUpdatedAt = controller.view.rateMetadata.cachedAt ? new Date(controller.view.rateMetadata.cachedAt) : undefined}
  {@const cpiUpdatedAt = new Date(controller.view.cpiMetadata.cachedAt)}
  {@const returnMode = settings.returnMode}
  {@const valuationCpi = cpiPointForDate(controller.view.cpiMetadata.indices, controller.view.to)}
  {@const latestCpiMonth = Object.keys(controller.view.cpiMetadata.indices).sort().at(-1)}
    <div class="result-heading">
      <div>
        <p class="eyebrow">As of {result.valuation.date}</p>
        <h2>Backtest result</h2>
      </div>
      <p class="source">
        CSH2 data last updated
        <time class="timestamp" datetime={controller.view.metadata.cachedAt} title={updatedAt.format(csh2UpdatedAt)} data-tooltip={updatedAt.format(csh2UpdatedAt)}>{relativeUpdatedAt(csh2UpdatedAt)}</time>
        <br />
        {#if estrUpdatedAt}
          €STR rate last updated
          <time class="timestamp" datetime={controller.view.rateMetadata.cachedAt} title={updatedAt.format(estrUpdatedAt)} data-tooltip={updatedAt.format(estrUpdatedAt)}>{relativeUpdatedAt(estrUpdatedAt)}</time>
          (source: ECB statistics)
        {:else}
          €STR rate last update unavailable (source: ECB statistics)
        {/if}
        <br />
        Belgian CPI last updated
        <time class="timestamp" datetime={controller.view.cpiMetadata.cachedAt} title={updatedAt.format(cpiUpdatedAt)} data-tooltip={updatedAt.format(cpiUpdatedAt)}>{relativeUpdatedAt(cpiUpdatedAt)}</time>
        (latest observed month: {latestCpiMonth}; source: Statbel)
      </p>
    </div>
    {#if returnMode === 'real'}
      <p class="real-coverage-note">
        Inflation-adjusted returns use Belgian CPI. A metric is shown as — when its full measurement interval begins before CPI coverage in January 2016; historical charts show only fully covered intervals.
        {#if valuationCpi?.status === 'extrapolated'}
          &#32;The latest portion is provisional and extrapolated from trailing 12-month observed inflation after {valuationCpi.lowerMonth}.
        {/if}
      </p>
    {/if}
    <div class="metrics">
      <div class="metric-row metric-row-values outcome-returns"><article class:negative={result.csh2MoneyWeightedReturn !== undefined && result.csh2MoneyWeightedReturn < 0} class:comparison-secondary={isSecondaryReturn(result.csh2MoneyWeightedReturn, result.accountMoneyWeightedReturn)} class="metric main"><p>CSH2 annualized money-weighted return</p><strong>{result.csh2MoneyWeightedReturn === undefined ? '—' : `${percent(result.csh2MoneyWeightedReturn)}%`}</strong><small>Your annualized outcome from the dated deposits and withdrawals, after transaction costs and the selected taxes.</small></article><article class:negative={result.accountMoneyWeightedReturn !== undefined && result.accountMoneyWeightedReturn < 0} class:comparison-secondary={isSecondaryReturn(result.accountMoneyWeightedReturn, result.csh2MoneyWeightedReturn)} class="metric main"><p>Account annualized money-weighted return</p><strong>{result.accountMoneyWeightedReturn === undefined ? '—' : `${percent(result.accountMoneyWeightedReturn)}%`}</strong><small>Your annualized account outcome from the same external cash flows, credited interest, and entered accrued base interest.</small></article></div>
      <article class:negative class="metric missed-result"><p>{valuesAreEqual ? 'CSH2 and your account have the same value' : negative ? 'CSH2 is behind your account balance by' : 'CSH2 is ahead of your account balance by'}</p><strong>{euro.format(Math.abs(result.missedAmount))}</strong><small>{returnDifference === undefined ? 'A unique annualized money-weighted return is not available for these cash flows.' : Math.abs(returnDifference) < 0.005 ? 'The annualized money-weighted returns are effectively equal.' : `The annualized money-weighted return difference is ${percent(Math.abs(returnDifference))} percentage points in ${returnDifference >= 0 ? 'CSH2’s' : 'your account’s'} favour.`}</small>
        {#if negative && result.breakEvenEstimate}<small>Estimated catch-up with your account in <b>{duration(result.valuation.date, result.breakEvenEstimate.date)}</b></small><small>(using the selected CSH2 rate scenario of {percent(result.breakEvenEstimate.csh2AnnualRatePercent)}%)</small>{:else if negative}<small>Catch-up with your account can’t be estimated from the selected CSH2 rate scenario.</small>{/if}
      </article>
      <div class="metric-row metric-row-values"><article class="metric"><p>CSH2 annualized time-weighted return</p><strong>{result.csh2TimeWeightedReturn === undefined ? '—' : `${percent(result.csh2TimeWeightedReturn)}%`}</strong><small>Geometrically linked portfolio performance that removes the external cash flows themselves while retaining the transaction costs and selected taxes they trigger. The CGT exemption follows the entered portfolio’s tax history.</small></article><article class="metric"><p>Account annualized time-weighted return</p><strong>{result.accountTimeWeightedReturn === undefined ? '—' : `${percent(result.accountTimeWeightedReturn)}%`}</strong><small>Geometrically linked interest performance, with deposits and withdrawals removed from the return.</small></article></div>
      <div class="metric-row metric-row-values"><article class="metric"><p>CSH2 backtest first broke even after</p><strong>{result.observedHoldingPeriods.breakEven && result.observedHoldingPeriods.from ? duration(result.observedHoldingPeriods.from, result.observedHoldingPeriods.breakEven.date) : 'Not yet'}</strong><small>{result.observedHoldingPeriods.breakEven ? `First observed on ${date.format(new Date(`${result.observedHoldingPeriods.breakEven.date}T00:00:00Z`))}.` : result.observedHoldingPeriods.from ? 'The CSH2 backtest has not broken even yet.' : 'No CSH2 purchase was executed.'} Net CSH2 liquidation value versus external capital, excluding account interest; includes transaction costs and selected taxes.</small></article><article class="metric"><p>CSH2 backtest first matched €STR after</p><strong>{result.observedHoldingPeriods.matchOvernight && result.observedHoldingPeriods.from ? duration(result.observedHoldingPeriods.from, result.observedHoldingPeriods.matchOvernight.date) : 'Not yet'}</strong><small>{result.observedHoldingPeriods.matchOvernight ? `First observed on ${date.format(new Date(`${result.observedHoldingPeriods.matchOvernight.date}T00:00:00Z`))}.` : result.observedHoldingPeriods.from ? 'The CSH2 backtest has not matched €STR yet.' : 'No CSH2 purchase was executed.'} Compares the same external cash flows, excluding account interest.</small></article></div>
      <div class="metric-row metric-row-values"><article class="metric"><p>Net value if sold today</p><strong>{euro.format(result.netLiquidationValue)}</strong><small>After estimated final TOB and applicable tax</small></article><article class="metric"><p>Gross CSH2 value</p><strong>{euro.format(result.grossValue)}</strong><small>{number.format(result.units)} CSH2 units{result.availableCash ? ` · ${euro.format(result.availableCash)} cash` : ''}</small></article></div>
      <div class="metric-row metric-row-details"><article class="metric"><p>Taxes already paid</p><strong>{euro.format(result.paidTob + result.paidCgt + result.paidReyndersTax)}</strong><small>TOB {euro.format(result.paidTob)} · {settings.applyReyndersTax ? `Reynders Tax ${euro.format(result.paidReyndersTax)}` : `CGT ${euro.format(result.paidCgt)}`}</small></article><article class="metric"><p>Taxes if sold today</p><strong>{euro.format(result.terminalTob + result.terminalCgt + result.terminalReyndersTax)}</strong><small>TOB {euro.format(result.terminalTob)} · {settings.applyReyndersTax ? `Reynders Tax ${euro.format(result.terminalReyndersTax)}` : `CGT ${euro.format(result.terminalCgt)}`}</small></article><article class="metric"><p>Broker fees</p><strong>{euro.format(result.paidBrokerFees + result.terminalBrokerFee)}</strong><small>Paid {euro.format(result.paidBrokerFees)} · if sold today {euro.format(result.terminalBrokerFee)}</small></article></div>
      <section class="panel" aria-labelledby="return-heading">
        <div class="section-title">
          <div><p class="eyebrow">Two views, two different questions</p><h3 id="return-heading">{returnChartMode === 'portfolio-value' ? 'Euro portfolio value over time' : 'Cash-flow-neutral performance'}</h3></div>
          <div class="return-mode-picker" role="group" aria-label="Performance chart view">
            <button type="button" aria-pressed={returnChartMode === 'portfolio-value'} onclick={() => returnChartMode = 'portfolio-value'}>Portfolio value</button>
            <button type="button" aria-pressed={returnChartMode === 'time-weighted'} onclick={() => returnChartMode = 'time-weighted'}>Performance</button>
          </div>
        </div>
        <p class="chart-key"><span class="chart-key-csh2">CSH2 backtest</span>{#if returnChartMode === 'time-weighted'}<span class="chart-key-estr">Gross €STR</span>{/if}<span class="chart-key-account">Your account</span>{#if (returnChartMode === 'portfolio-value' && controller.view.returnSeries.portfolioValue.projected) || (returnChartMode === 'time-weighted' && controller.view.returnSeries.timeWeighted.projected)}<span class="chart-key-projected">Projection</span>{/if}</p>
        {#if returnChartMode === 'portfolio-value'}
          <p class="chart-explanation">Actual CSH2 net liquidation value and account balance after the same deposits and withdrawals. Values are shown in current euros and are not investment returns.</p>
          {#if controller.view.returnSeries.portfolioValue.projected}
            {@const projection = controller.view.returnSeries.portfolioValue.projected}
            <p class="chart-explanation projection-explanation">
              Dashed through {date.format(new Date(`${projection.throughDate}T00:00:00Z`))}: assumes no further cash flows, the selected CSH2 rate scenario of {percent(projection.csh2AnnualRatePercent)}%, and each entered fidelity premium is paid on its earned date.
              {#if projection.baseAnnualRatePercent !== undefined}
                &#32;The full account balance compounds at the entered {percent(projection.baseAnnualRatePercent)}% annual base rate, and each paid premium joins that balance for subsequent accrual.
              {/if}
            </p>
          {/if}
          {#if controller.view.returnSeries.portfolioValue.csh2.length || controller.view.returnSeries.portfolioValue.account.length}<LineChart data={controller.view.returnSeries.portfolioValue} unit="euro" ariaLabel="Portfolio value in euro for CSH2 and your account using the same external cash flows" />{:else}<p class="chart-empty">There isn’t enough history yet to plot portfolio values.</p>{/if}
        {:else}
          <p class="chart-explanation">
            Geometric linking removes the deposits and withdrawals themselves from performance. CSH2 still includes the broker fees, transaction taxes, and selected gain taxes those trades trigger; the account includes entered credited and accrued interest; €STR is a gross, untaxed market benchmark.
            {#if returnMode === 'real'}
              &#32;The chart begins only once both CPI endpoints are available.
            {/if}
          </p>
          {#if controller.view.returnSeries.timeWeighted.projected}
            {@const projection = controller.view.returnSeries.timeWeighted.projected}
            <p class="chart-explanation projection-explanation">
              Dashed through {date.format(new Date(`${projection.throughDate}T00:00:00Z`))}: extends each observed TWR endpoint with no further cash flows, the selected CSH2 rate scenario of {percent(projection.csh2AnnualRatePercent)}%, the latest €STR rate of {percent(projection.overnightRatePercent)}%, and
              {#if projection.baseAnnualRatePercent !== undefined}
                &#32;the entered account base rate of {percent(projection.baseAnnualRatePercent)}%
              {:else}
                &#32;the account’s observed interest assumptions
              {/if}; future fidelity premiums are credited on their earned dates and included as internal account returns.
              {#if returnMode === 'real'}
                &#32;This forward section is provisional and inflation-adjusted using trailing 12-month observed CPI extrapolation.
              {/if}
            </p>
          {/if}
          {#if controller.view.returnSeries.timeWeighted.csh2.length || controller.view.returnSeries.timeWeighted.overnight.length || controller.view.returnSeries.timeWeighted.account.length}<LineChart data={controller.view.returnSeries.timeWeighted} cpiIndices={returnMode === 'real' ? controller.view.cpiMetadata.indices : undefined} ariaLabel="Time-weighted performance of CSH2, gross Euro overnight rates, and your account, excluding external cash flows" />{:else}<p class="chart-empty">There isn’t enough CPI-covered history yet to plot time-weighted performance.</p>{/if}
        {/if}
      </section>
      {#if result.fidelityPremiumAssessments.length}
        <section class="metric fidelity-assessments" aria-labelledby="fidelity-timing-heading"><div class="section-title fidelity-assessments-heading"><div><p class="eyebrow">Savings account comparison</p><h3 id="fidelity-timing-heading">Fidelity premium timing</h3></div></div><div class="table-wrap"><table class="fidelity-timing-table"><thead><tr><th>Base amount</th><th>Earned</th><th>Payout</th><th>Until payout</th><th>Next full year</th><th>Recommendation</th></tr></thead><tbody>
          {#each result.fidelityPremiumAssessments as assessment (assessment.id)}
            {@const nextYear = nextYearComparison(assessment)}
            <tr><td><span class="fidelity-mobile-label" aria-hidden="true">Base amount</span>{euro.format(assessment.baseAmount)}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Earned</span>{date.format(new Date(`${assessment.earnedDate}T00:00:00Z`))}</td><td><span class="fidelity-mobile-label" aria-hidden="true">Payout</span>{euro.format(assessment.finalPayoutAmount)}</td><td class:comparison-winner={assessment.currentPeriodPreferred !== 'either'}><span class="fidelity-mobile-label" aria-hidden="true">Until payout</span>{assessment.currentPeriodPreferred === 'move now' ? `CSH2 +${euro.format(Math.abs(assessment.currentPeriodDifference))}` : assessment.currentPeriodPreferred === 'move to best account' ? 'Best savings account' : assessment.currentPeriodPreferred === 'wait' ? `Current account +${euro.format(Math.abs(assessment.currentPeriodDifference))}` : 'Effectively equal'}</td><td class:comparison-winner={assessment.nextYearCsh2Value !== undefined && assessment.nextYearAccountValue !== undefined}><span class="fidelity-mobile-label" aria-hidden="true">Next full year</span>{nextYear.primary}{#if nextYear.otherAlternative}<span class="next-year-alternative">{nextYear.otherAlternative}</span>{/if}</td><td class="timing-recommendation"><span class="fidelity-mobile-label" aria-hidden="true">Recommendation</span>{assessment.recommendation === 'move now' ? 'Transfer to CSH2 now' : assessment.recommendation === 'move to best account' ? 'Transfer to best savings account now' : assessment.recommendation === 'move after payout' ? `Transfer to CSH2 on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}` : assessment.recommendation === 'move to best account after payout' ? `Transfer to best savings account on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}` : assessment.recommendation === 'keep in account' ? 'Keep in current account' : assessment.recommendation === 'wait, then reassess' ? `Reassess on ${date.format(new Date(`${assessment.transferDate}T00:00:00Z`))}` : 'Either'}</td></tr>
          {/each}
        </tbody></table></div><small class="timing-notes"><span>Ordered by the recommended transfer or reassessment date, with keep decisions last. Each row is one cash-transfer recommendation; legal tranche allocation is handled internally.</span><span><b>Until payout</b> compares moving now to CSH2 or the best available savings account with keeping the money in your current account until the entered payout.<br><b>Next full year</b> compares CSH2 and the best available savings account with your current savings account after the current premium is earned.</span><span>Withdrawal priority is recalculated after each premium is acquired. Timing calculations use fractional shares, and amounts transferred on the same date are combined into one CSH2 purchase.</span><span>Uses the selected CSH2 rate scenario of {percent(result.fidelityPremiumAssessments[0].csh2AnnualRatePercent)}% and the selected transaction and tax settings.</span></small></section>
      {/if}
    </div>
{/if}
{#if controller.view}
    {@const result = controller.view.result}
    {@const settings = controller.view.settings}
    <section class="panel ledger"><h3>Transaction ledger</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Price used</th><th>Units</th><th>Cash remaining</th><th>Broker fee</th><th>TOB</th>{#if !settings.applyReyndersTax}<th>CGT</th>{/if}{#if settings.applyReyndersTax}<th>Reynders Tax</th>{/if}{#if settings.applyCapitalGainsExemption && !settings.applyReyndersTax}<th>Exonerated CGT</th>{/if}</tr></thead><tbody>{#each result.entries as entry}<tr><td>{entry.date}</td><td>{entry.interestPayment ? 'Interest payment' : entry.type === 'inflow' ? 'Inflow / buy' : 'Outflow / sell'}</td><td>{euro.format(entry.amount)}</td><td>{entry.price === undefined ? '—' : euro.format(entry.price)}{entry.priceKind && entry.priceKind !== 'close' ? ` (${entry.priceKind})` : ''}</td><td>{entry.interestPayment ? '—' : number.format(entry.units)}</td><td>{euro.format(entry.remainingCash)}</td><td>{euro.format(entry.brokerFee)}</td><td>{euro.format(entry.tob)}</td>{#if !settings.applyReyndersTax}<td>{entry.cgt ? euro.format(entry.cgt) : '—'}</td>{/if}{#if settings.applyReyndersTax}<td>{entry.reyndersTax ? euro.format(entry.reyndersTax) : '—'}</td>{/if}{#if settings.applyCapitalGainsExemption && !settings.applyReyndersTax}<td>{entry.exoneratedCgt ? euro.format(entry.exoneratedCgt) : '—'}</td>{/if}</tr>{/each}</tbody></table></div></section>
{/if}
</section>
