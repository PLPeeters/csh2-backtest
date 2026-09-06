<script lang="ts">
  import CashFlowEditor from './lib/components/CashFlowEditor.svelte';
  import CalculationSettings from './lib/components/CalculationSettings.svelte';
  import BenchmarkHistorySection from './lib/components/BenchmarkHistorySection.svelte';
  import CurrentRateStrip from './lib/components/CurrentRateStrip.svelte';
  import FreshnessSummary from './lib/components/FreshnessSummary.svelte';
  import MethodologyDialog from './lib/components/MethodologyDialog.svelte';
  import ResultsSection from './lib/components/ResultsSection.svelte';
  import HistoricalSavingsSection, { type HistoricalSavingsDisplay } from './lib/components/HistoricalSavingsSection.svelte';
  import HistoricalSavingsResults from './lib/components/HistoricalSavingsResults.svelte';
  import FutureOutlookSection from './lib/components/FutureOutlookSection.svelte';
  import TaxRegimeControl from './lib/components/TaxRegimeControl.svelte';
  import { calculateBacktest } from './lib/services/backtest';
  import { createBenchmarkHistoryClient } from './lib/services/benchmark-history';
  import { loadMarketData } from './lib/services/market-data';
  import { createBacktestController } from './lib/state/backtest.svelte';
  import { onDestroy } from 'svelte';
  let setupTab = $state<'current' | 'historical'>('current');
  let historicalDisplay = $state<HistoricalSavingsDisplay>();
  let historicalScenario = $state<'monthly' | 'lumpSum'>('monthly');
  let historicalLoading = $state(false);
  let historicalSubmit = $state<(() => Promise<void>)>();
  let historicalEndDate = $state('');
  let historicalSetEndDate = $state<(value: string) => void>();
  let resultTab = $state<'outcome' | 'future'>('outcome');
  let openMethodology = $state<() => void>(() => {});
  const chooseSetupTab = (tab: 'current' | 'historical') => { setupTab = tab; };
  const focusCurrentAccountRate = () => {
    const target = document.getElementById('current-account-base-rate') as HTMLInputElement | null;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
  };
  const handleSetupTabKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' || (event.key === 'ArrowLeft' && setupTab === 'historical') || (event.key === 'End' && setupTab === 'current') ? 'current' : 'historical';
    chooseSetupTab(next);
    document.getElementById(`${next}-backtest-tab`)?.focus();
  };
  const chooseResultTab = (tab: 'outcome' | 'future') => { resultTab = tab; };
  const handleResultTabKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' || (event.key === 'ArrowLeft' && resultTab === 'future') || (event.key === 'End' && resultTab === 'outcome') ? 'outcome' : 'future';
    chooseResultTab(next);
    document.getElementById(`${next}-result-tab`)?.focus();
  };
  const benchmarkClient = createBenchmarkHistoryClient();
  const controller = createBacktestController({ storage: localStorage, today: () => new Date().toISOString().slice(0, 10), loadMarketData, calculate: calculateBacktest, prepareBenchmark: (request) => benchmarkClient.prepare(request) });
  void controller.loadBenchmark();
  if (controller.valid) void controller.calculate();
  onDestroy(() => benchmarkClient.dispose());
</script>
<svelte:head><script async defer src="https://buttons.github.io/buttons.js"></script></svelte:head>
<main class="app-shell">
  <header class="app-header">
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">↗</span><div><p class="brand-kicker">Local analysis workspace</p><h1>CSH2 backtester</h1></div></div>
    <div class="header-utility"><div class="header-context"><span class="privacy-note">Your data stays in this browser</span><span class="header-dot" aria-hidden="true">•</span><span class="privacy-note">Calculations run locally</span></div>{#if controller.view}<FreshnessSummary view={controller.view} />{/if}</div>
    <details class="header-details"><summary>Data and model notes</summary><div><p class="header-assumption">By default, the backtest uses FIFO lots and assumes 10% CGT on positive realised gains from 2026 onward. For purchases before 2026, the tax basis is the higher of the original price and the 31 December 2025 CSH2 close.</p><p class="refresh-note">Market data refreshes automatically: CSH2 after midnight Tuesday–Saturday, €STR at 09:15 Monday–Friday, and Belgian CPI at 10:30 each Monday (Brussels time).</p></div></details>
  </header>
  <CurrentRateStrip {controller} onEditRate={focusCurrentAccountRate} onOpenMethodology={() => openMethodology()} />
  <TaxRegimeControl {controller} />
  <section class="secondary-analysis" aria-label="Supporting analysis"><details class="analysis-disclosure"><summary><span id="benchmark-context-heading">02 · Benchmark context</span><span class="disclosure-hint">Historical benchmark returns</span></summary><div class="analysis-disclosure-content"><BenchmarkHistorySection {controller} /></div></details></section>
  <div class="primary-workspace">
    <section class="configuration-column" aria-labelledby="backtest-setup-heading">
      <div class="section-title config-title"><div><p class="eyebrow">03 · Configuration</p><h2 id="backtest-setup-heading">Set up your comparison</h2></div></div>
      <section class="input-section-container">
        <div class="setup-tabs" role="tablist" aria-label="Backtest type"><button id="current-backtest-tab" type="button" role="tab" tabindex={setupTab === 'current' ? 0 : -1} aria-selected={setupTab === 'current'} aria-controls="current-backtest-panel" onclick={() => chooseSetupTab('current')} onkeydown={handleSetupTabKeydown}>Current account backtest</button><button id="historical-backtest-tab" type="button" role="tab" tabindex={setupTab === 'historical' ? 0 : -1} aria-selected={setupTab === 'historical'} aria-controls="historical-backtest-panel" onclick={() => chooseSetupTab('historical')} onkeydown={handleSetupTabKeydown}>Historical savings rates</button></div>
      {#if setupTab === 'current'}<div id="current-backtest-panel" role="tabpanel" aria-labelledby="current-backtest-tab" class="panel input-panel"><CashFlowEditor {controller} /><CalculationSettings {controller} /><div class="controls action-row"><button type="button" disabled={!controller.valid || controller.status.kind === 'loading'} onclick={() => controller.calculate()}>Calculate with latest data</button></div><p class:success={controller.status.kind === 'success'} class:error={controller.status.kind === 'error'} class="status" aria-live="polite">{controller.status.message}</p>{#if controller.resultIsStale}<p class="stale-results" role="status">Inputs have changed. The results below still reflect your last calculation. Calculate again to update them.</p>{/if}</div>{:else}<div id="historical-backtest-panel" role="tabpanel" aria-labelledby="historical-backtest-tab" class="panel input-panel"><HistoricalSavingsSection controller={controller} active={setupTab === 'historical'} selectedScenario={historicalScenario} onResult={(display) => historicalDisplay = display} onSubmitReady={(submit) => historicalSubmit = submit} onLoadingChange={(loading) => historicalLoading = loading} onEndDateChangeReady={(setEndDate) => historicalSetEndDate = setEndDate} onEndDateChange={(value) => historicalEndDate = value} /><CalculationSettings controller={controller} historicalEndDate={historicalEndDate} onHistoricalEndDateChange={(value) => historicalSetEndDate?.(value)} /><div class="controls action-row"><button type="button" disabled={historicalLoading} onclick={() => void historicalSubmit?.()}>{historicalLoading ? 'Calculating…' : 'Calculate historical savings'}</button></div></div>{/if}
      </section>
    </section>
    <section class="result-column" aria-labelledby="result-workspace-heading"><div class="section-title result-column-title"><div><p class="eyebrow">04 · Analysis</p><h2 id="result-workspace-heading">Your comparison</h2></div></div>{#if setupTab === 'current'}<div class="result-tabs" role="tablist" aria-label="Analysis view"><button id="outcome-result-tab" type="button" role="tab" tabindex={resultTab === 'outcome' ? 0 : -1} aria-selected={resultTab === 'outcome'} aria-controls="outcome-result-panel" onclick={() => chooseResultTab('outcome')} onkeydown={handleResultTabKeydown}>Outcome</button><button id="future-result-tab" type="button" role="tab" tabindex={resultTab === 'future' ? 0 : -1} aria-selected={resultTab === 'future'} aria-controls="future-result-panel" onclick={() => chooseResultTab('future')} onkeydown={handleResultTabKeydown}>Future outlook</button></div>{#if resultTab === 'outcome'}<div id="outcome-result-panel" role="tabpanel" aria-labelledby="outcome-result-tab"><ResultsSection {controller} /></div>{:else}<div id="future-result-panel" role="tabpanel" aria-labelledby="future-result-tab"><FutureOutlookSection {controller} setupTab="current" onOpenMethodology={() => openMethodology()} /></div>{/if}{:else}<HistoricalSavingsResults display={historicalDisplay} selectedScenario={historicalScenario} onScenarioChange={(scenario) => historicalScenario = scenario} />{/if}</section>
  </div>
  <MethodologyDialog {controller} onOpenReady={(open) => openMethodology = open} />
  <aside class="notice"><strong>Educational estimate, not tax advice.</strong> CSH2 prices are daily closes for Euronext Paris and may differ from your broker’s execution price. The backtest does not model spreads, variable commissions, fund-specific treatment, or other tax-law exceptions.</aside>
  <footer class="support"><p class="statbel-notice">Belgian CPI: <a href="https://bestat.statbel.fgov.be/bestat/api/views/86586e27-90ac-47c6-87ce-64b63194e605" target="_blank" rel="noopener noreferrer">Source Statbel</a> (Directorate-General Statistics – Statistics Belgium), <a href="https://statbel.fgov.be/en/cc-40" target="_blank" rel="license noopener noreferrer">CC BY 4.0</a>; adapted by selecting the all-items series, deduplicating, and normalizing monthly observations.</p><a href="https://www.buymeacoffee.com/plpeeters" target="_blank" rel="noopener noreferrer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60" /></a><a class="github-button" href="https://github.com/PLPeeters/csh2-backtest" data-size="large" aria-label="View PLPeeters/csh2-backtest on GitHub">View on GitHub</a><p class="license-notice"><a href="https://github.com/PLPeeters/csh2-backtest">CSH2 Backtest</a> by <a href="https://linkedin.com/in/plpeeters" target="_blank" rel="noopener noreferrer">Pierre-Louis Peeters</a> is licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/?ref=chooser-v1" target="_blank" rel="license noopener noreferrer">CC BY-NC 4.0</a></p><a class="license-icons" href="https://creativecommons.org/licenses/by-nc/4.0/?ref=chooser-v1" target="_blank" rel="noopener noreferrer" aria-label="CC BY-NC 4.0 licence"><img src="https://mirrors.creativecommons.org/presskit/icons/cc.svg?ref=chooser-v1" alt="Creative Commons" /><img src="https://mirrors.creativecommons.org/presskit/icons/by.svg" alt="Attribution" /><img src="https://mirrors.creativecommons.org/presskit/icons/nc.svg" alt="NonCommercial" /></a></footer>
</main>
