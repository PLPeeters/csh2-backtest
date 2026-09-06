<script lang="ts">
  import { euro } from '../services/formatters';
  import type { HistoricalSavingsDisplay } from './HistoricalSavingsSection.svelte';
  import ComparisonResults from './ComparisonResults.svelte';

  let { display, selectedScenario = 'monthly', onScenarioChange }: { display?: HistoricalSavingsDisplay; selectedScenario?: 'monthly' | 'lumpSum'; onScenarioChange?: (scenario: 'monthly' | 'lumpSum') => void } = $props();
</script>

<section id="results" aria-live="polite">
  {#if display}
    <div class="historical-results">
      <p class="historical-result-range">From {display.from} through {display.to}. The two scenarios use the current CSH2 calculation settings.</p>
      <div class="scenario-picker return-mode-picker" role="group" aria-label="Historical deposit scenario">
        <button type="button" aria-pressed={selectedScenario === 'monthly'} onclick={() => onScenarioChange?.('monthly')}>€600 monthly deposits</button>
        <button type="button" aria-pressed={selectedScenario === 'lumpSum'} onclick={() => onScenarioChange?.('lumpSum')}>€10,000 initial deposit</button>
      </div>
      <ComparisonResults comparisonView={display.scenario.view} accountLabel="Historical savings" chartAccountLabel="Historical savings" portfolioChartLabel="historical savings value" portfolioChartAriaLabel="CSH2, gross Euro short-term rate, and historical savings value in euro" timeWeightedChartLabel="historical savings">
        {#snippet beforeLedger()}
          <div class="historical-savings-details" aria-labelledby="historical-details-heading">
            <h3 id="historical-details-heading">Historical savings interest details</h3>
            <div class="metric-row metric-row-details">
              <article class="metric"><p>Deposited</p><strong>{euro.format(display.scenario.savings.totalDeposited)}</strong></article>
              <article class="metric"><p>Base interest earned</p><strong>{euro.format(display.scenario.savings.baseInterestEarned)}</strong></article>
              <article class="metric"><p>Fidelity premiums credited</p><strong>{euro.format(display.scenario.savings.fidelityPremiumCredited)}</strong></article>
              <article class="metric"><p>Fidelity premiums acquired, pending credit</p><strong>{euro.format(display.scenario.savings.fidelityPremiumPending)}</strong></article>
              <article class="metric"><p>Economic end value</p><strong>{euro.format(display.scenario.savings.economicValue)}</strong></article>
            </div>
          </div>
        {/snippet}
      </ComparisonResults>
    </div>
  {:else}
    <div class="historical-results-empty" aria-labelledby="historical-results-empty-heading">
      <p class="eyebrow">Ready for a comparison</p>
      <h3 id="historical-results-empty-heading">Run a historical savings calculation</h3>
      <p>Configure the historical rates and settings, then use <strong>Calculate historical savings</strong> in Configuration to compare the account with CSH2 and €STR.</p>
    </div>
  {/if}
</section>

<style>
  .historical-results { display: grid; width: 100%; min-width: 0; max-width: 100%; gap: 24px; overflow: hidden; border-top: 1px solid #e3e8e5; padding-top: 20px; }.historical-results > * { min-width: 0; max-width: 100%; }.historical-result-range { margin: 0; color: #617169; font-size: .82rem; line-height: 1.5; overflow-wrap: anywhere; }.scenario-picker { width: fit-content; max-width: 100%; }.historical-savings-details { display: grid; min-width: 0; max-width: 100%; gap: 12px; margin: 20px 0; }.historical-savings-details h3 { margin: 0; color: #285747; }
  .historical-results-empty { display: grid; min-width: 0; gap: 7px; margin: 0; border: 1px dashed var(--v2-border, #d8e1db); border-radius: 5px; padding: 22px 18px; background: #fbfdfc; }
  .historical-results-empty .eyebrow { margin: 0; color: var(--v2-muted, #647169); }
  .historical-results-empty h3 { margin: 2px 0 0; color: var(--v2-navy, #10233d); font-size: clamp(1rem, 2vw, 1.2rem); letter-spacing: -.02em; }
  .historical-results-empty p:last-child { max-width: 54ch; margin: 0; color: var(--v2-muted, #647169); font-size: .8rem; line-height: 1.55; }
  .historical-results-empty strong { color: var(--v2-navy, #10233d); font-weight: 700; }
  @media (max-width: 760px) { .scenario-picker { width: 100%; }.scenario-picker button { flex: 1; min-width: 0; } }
</style>
