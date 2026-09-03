<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  let { controller, historicalEndDate, onHistoricalEndDateChange }: { controller: BacktestController; historicalEndDate?: string; onHistoricalEndDateChange?: (value: string) => void } = $props();
</script>
<section class="input-section assumptions" aria-labelledby="assumptions-heading">
  <div><p class="eyebrow">Assumptions</p><h3 id="assumptions-heading">Calculation settings</h3></div>
  <div class="settings-grid">
    {#if historicalEndDate !== undefined}<label class="account-interest-rate historical-end-date" for="historical-backtest-end-date">End date<input id="historical-backtest-end-date" aria-label="End date" type="date" value={historicalEndDate} onchange={(event) => onHistoricalEndDateChange?.((event.currentTarget as HTMLInputElement).value)} /></label>{/if}
    <div class="setting-field"><label class="broker-transaction-fee">Broker transaction fee per trade (€)<input type="number" min="0" step="0.01" value={controller.settings.brokerTransactionFee} onchange={(event) => controller.updateSetting('brokerTransactionFee', event.currentTarget.value)} /></label></div>
    <div class="setting-card"><label class="tax-exemption"><input type="checkbox" checked={controller.settings.buyWholeSharesOnly} onchange={(event) => controller.updateSetting('buyWholeSharesOnly', event.currentTarget.checked)} />Buy whole shares only</label><p class="setting-description">Limit purchases to whole CSH2 shares.<br />When buying, unspent cash carries forward and is used for subsequent buys. When selling, unspent cash is consumed before selling shares.</p></div>
  </div>
</section>
