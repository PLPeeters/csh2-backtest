<script lang="ts">
  import { euro } from '../services/formatters';
  import type { HistoricalSavingsDisplay } from './HistoricalSavingsSection.svelte';
  import ComparisonResults from './ComparisonResults.svelte';

  let { display, selectedScenario = 'monthly', onScenarioChange }: { display?: HistoricalSavingsDisplay; selectedScenario?: 'monthly' | 'lumpSum'; onScenarioChange?: (scenario: 'monthly' | 'lumpSum') => void } = $props();
</script>

<section id="results" aria-live="polite">
  {#if display}
    <div class="historical-results grid w-full min-w-0 max-w-full overflow-x-hidden overflow-y-hidden [border-top-width:1px] [border-top-style:solid] [border-top-color:#e3e8e5] pt-5 gap-6">
      <p class="historical-result-range text-[#617169] text-[0.82rem] leading-[1.5] [overflow-wrap:anywhere] m-0">From {display.from} through {display.to}. The two scenarios use the current CSH2 calculation settings.</p>
      <div class="scenario-picker return-mode-picker flex overflow-x-auto bg-white w-fit max-w-full border border-solid border-[#cbd7d0] rounded-[7px] [@media(width<=760px)]:w-full" role="group" aria-label="Historical deposit scenario">
        <button type="button" aria-pressed={selectedScenario === 'monthly'} onclick={() => onScenarioChange?.('monthly')}>€600 monthly deposits</button>
        <button type="button" aria-pressed={selectedScenario === 'lumpSum'} onclick={() => onScenarioChange?.('lumpSum')}>€10,000 initial deposit</button>
      </div>
      <ComparisonResults comparisonView={display.scenario.view} accountLabel="Historical savings" chartAccountLabel="Historical savings" portfolioChartLabel="historical savings value" portfolioChartAriaLabel="CSH2, gross Euro short-term rate, and historical savings value in euro" timeWeightedChartLabel="historical savings">
        {#snippet beforeLedger()}
          <div class="historical-savings-details grid min-w-0 max-w-full mx-0 my-5 gap-3" aria-labelledby="historical-details-heading">
            <h3 id="historical-details-heading">Historical savings interest details</h3>
            <div class="metric-row metric-row-details grid grid-cols-3 gap-3 [@media(width<=760px)]:grid-cols-[1fr]">
              <article class="metric bg-[#f7faf8] p-4.5 border border-solid border-[#d8e1db] rounded-[8px]"><p>Deposited</p><strong>{euro.format(display.scenario.savings.totalDeposited)}</strong></article>
              <article class="metric bg-[#f7faf8] p-4.5 border border-solid border-[#d8e1db] rounded-[8px]"><p>Base interest earned</p><strong>{euro.format(display.scenario.savings.baseInterestEarned)}</strong></article>
              <article class="metric bg-[#f7faf8] p-4.5 border border-solid border-[#d8e1db] rounded-[8px]"><p>Fidelity premiums credited</p><strong>{euro.format(display.scenario.savings.fidelityPremiumCredited)}</strong></article>
              <article class="metric bg-[#f7faf8] p-4.5 border border-solid border-[#d8e1db] rounded-[8px]"><p>Fidelity premiums acquired, pending credit</p><strong>{euro.format(display.scenario.savings.fidelityPremiumPending)}</strong></article>
              <article class="metric bg-[#f7faf8] p-4.5 border border-solid border-[#d8e1db] rounded-[8px]"><p>Economic end value</p><strong>{euro.format(display.scenario.savings.economicValue)}</strong></article>
            </div>
          </div>
        {/snippet}
      </ComparisonResults>
    </div>
  {:else}
    <div class="historical-results-empty grid min-w-0 bg-[#fbfdfc] m-0 px-4.5 py-5.5 border border-dashed [border-color:var(--v2-border,_#d8e1db)] rounded-[5px] gap-[7px]" aria-labelledby="historical-results-empty-heading">
      <p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Ready for a comparison</p>
      <h3 id="historical-results-empty-heading">Run a historical savings calculation</h3>
      <p>Configure the historical rates and settings, then use <strong>Calculate historical savings</strong> in Configuration to compare the account with CSH2 and €STR.</p>
    </div>
  {/if}
</section>

<style>

  .historical-results > * { min-width: 0; max-width: 100%; }.historical-savings-details h3 { margin: 0; color: #285747; }
  .historical-results-empty .eyebrow { margin: 0; color: var(--v2-muted, #647169); }
  .historical-results-empty h3 { margin: 2px 0 0; color: var(--v2-navy, #10233d); font-size: clamp(1rem, 2vw, 1.2rem); letter-spacing: -.02em; }
  .historical-results-empty p:last-child { max-width: 54ch; margin: 0; color: var(--v2-muted, #647169); font-size: .8rem; line-height: 1.55; }
  .historical-results-empty strong { color: var(--v2-navy, #10233d); font-weight: 700; }
  @media (max-width: 760px) {.scenario-picker button { flex: 1; min-width: 0; } }

</style>
