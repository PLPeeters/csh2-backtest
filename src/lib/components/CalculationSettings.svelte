<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  let { controller, historicalEndDate, onHistoricalEndDateChange }: { controller: BacktestController; historicalEndDate?: string; onHistoricalEndDateChange?: (value: string) => void } = $props();
</script>
<section class="input-section assumptions [border-top-width:1px] [border-top-style:solid] [border-top-color:#e3e8e5] px-0 py-5.5" aria-labelledby="assumptions-heading">
  <div><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Assumptions</p><h3 id="assumptions-heading">Calculation settings</h3></div>
  <div class="settings-grid grid grid-cols-2 [align-items:start] mt-4 gap-4 [@media(width<=760px)]:grid-cols-[1fr]">
    {#if historicalEndDate !== undefined}<label class="account-interest-rate historical-end-date w-[min(100%,_220px)] block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase" for="historical-backtest-end-date">End date<input id="historical-backtest-end-date" aria-label="End date" type="date" value={historicalEndDate} onchange={(event) => onHistoricalEndDateChange?.((event.currentTarget as HTMLInputElement).value)} /></label>{/if}
    <div class="setting-field min-w-0"><label class="broker-transaction-fee block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Broker transaction fee per trade (€)<input type="number" min="0" step="0.01" value={controller.settings.brokerTransactionFee} onchange={(event) => controller.updateSetting('brokerTransactionFee', event.currentTarget.value)} /></label></div>
    <div class="setting-card whole-shares-setting min-w-0 [grid-column:1_/_-1] bg-[#f7faf8] p-4 border border-solid border-line rounded-[4px]"><label class="tax-exemption flex items-center text-accent-dark text-[0.875rem] font-semibold leading-[1.4] gap-[9px]"><input type="checkbox" checked={controller.settings.buyWholeSharesOnly} onchange={(event) => controller.updateSetting('buyWholeSharesOnly', event.currentTarget.checked)} />Buy whole shares only</label><p class="setting-description mt-[9px] mb-0 text-[#617169] text-[0.8rem] leading-[1.45] mx-0">Limit purchases to whole CSH2 shares.<br />When buying, unspent cash carries forward and is used for subsequent buys. When selling, unspent cash is consumed before selling shares.</p></div>
  </div>
</section>
