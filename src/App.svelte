<script lang="ts">
  import CashFlowEditor from './lib/components/CashFlowEditor.svelte';
  import CalculationSettings from './lib/components/CalculationSettings.svelte';
  import BenchmarkHistorySection from './lib/components/BenchmarkHistorySection.svelte';
  import BenchmarkSection from './lib/components/BenchmarkSection.svelte';
  import ResultsSection from './lib/components/ResultsSection.svelte';
  import TaxRegimeControl from './lib/components/TaxRegimeControl.svelte';
  import { calculateBacktest } from './lib/services/backtest';
  import { createBenchmarkHistoryClient } from './lib/services/benchmark-history';
  import { loadMarketData } from './lib/services/market-data';
  import { createBacktestController } from './lib/state/backtest.svelte';
  import { onDestroy } from 'svelte';
  const benchmarkClient = createBenchmarkHistoryClient();
  const controller = createBacktestController({ storage: localStorage, today: () => new Date().toISOString().slice(0, 10), loadMarketData, calculate: calculateBacktest, prepareBenchmark: (request) => benchmarkClient.prepare(request) });
  void controller.loadBenchmark();
  if (controller.valid) void controller.calculate();
  onDestroy(() => benchmarkClient.dispose());
</script>
<svelte:head><script async defer src="https://buttons.github.io/buttons.js"></script></svelte:head>
<main class="app-shell">
  <header class="app-header"><h1>CSH2 backtester</h1><p class="lede">Model dated deposits and withdrawals against CSH2, including transaction costs and taxes.</p><p class="header-assumption">By default, the backtest uses FIFO lots and assumes 10% CGT on positive realised gains from 2026 onward.<br />For purchases before 2026, the tax basis is the higher of the original price and the 31 December 2025 CSH2 close.</p><p class="privacy-note">Everything is processed locally on your device; your cash flows and files never leave this machine.</p><p class="refresh-note">Market data refreshes automatically: CSH2 after midnight Tuesday–Saturday, and €STR at 09:15 Monday–Friday (Brussels time).</p></header>
  <TaxRegimeControl {controller} />
  <BenchmarkHistorySection {controller} />
  <BenchmarkSection {controller} />
  <section class="input-section-container" aria-labelledby="backtest-setup-heading"><div class="section-title"><div><p class="eyebrow">Input</p><h2 id="backtest-setup-heading">Configure your backtest</h2></div></div><div class="panel input-panel"><CashFlowEditor {controller} /><CalculationSettings {controller} /><div class="controls action-row"><button type="button" disabled={!controller.valid || controller.status.kind === 'loading'} onclick={() => controller.calculate()}>Calculate with latest data</button></div><p class:success={controller.status.kind === 'success'} class:error={controller.status.kind === 'error'} class="status" aria-live="polite">{controller.status.message}</p>{#if controller.resultIsStale}<p class="stale-results" role="status">Inputs have changed. The results below still reflect your last calculation. Calculate again to update them.</p>{/if}</div></section>
  <ResultsSection {controller} />
  <aside class="notice"><strong>Educational estimate, not tax advice.</strong> CSH2 prices are daily closes for Euronext Paris and may differ from your broker’s execution price. The backtest does not model spreads, variable commissions, fund-specific treatment, or other tax-law exceptions.</aside>
  <footer class="support"><a href="https://www.buymeacoffee.com/plpeeters" target="_blank" rel="noopener noreferrer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60" /></a><a class="github-button" href="https://github.com/PLPeeters/csh2-backtest" data-size="large" aria-label="View PLPeeters/csh2-backtest on GitHub">View on GitHub</a><p class="license-notice"><a href="https://github.com/PLPeeters/csh2-backtest">CSH2 Backtest</a> by <a href="https://linkedin.com/in/plpeeters" target="_blank" rel="noopener noreferrer">Pierre-Louis Peeters</a> is licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/?ref=chooser-v1" target="_blank" rel="license noopener noreferrer">CC BY-NC 4.0</a></p><a class="license-icons" href="https://creativecommons.org/licenses/by-nc/4.0/?ref=chooser-v1" target="_blank" rel="license noopener noreferrer" aria-label="CC BY-NC 4.0 licence"><img src="https://mirrors.creativecommons.org/presskit/icons/cc.svg?ref=chooser-v1" alt="Creative Commons" /><img src="https://mirrors.creativecommons.org/presskit/icons/by.svg?ref=chooser-v1" alt="Attribution" /><img src="https://mirrors.creativecommons.org/presskit/icons/nc.svg?ref=chooser-v1" alt="NonCommercial" /></a></footer>
</main>
