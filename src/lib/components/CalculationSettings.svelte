<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  let { controller }: { controller: BacktestController } = $props();
</script>
<section class="input-section assumptions" aria-labelledby="assumptions-heading">
  <div><p class="eyebrow">Assumptions</p><h3 id="assumptions-heading">Calculation settings</h3></div>
  <div class="setting-grid">
    <div class="setting-field"><label class="broker-transaction-fee">Broker transaction fee per trade (€)<input type="number" min="0" step="0.01" value={controller.settings.brokerTransactionFee} onchange={(event) => controller.updateSetting('brokerTransactionFee', event.currentTarget.value)} /></label></div>
    <div class="setting-card"><label class="tax-exemption"><input type="checkbox" checked={controller.settings.buyWholeSharesOnly} onchange={(event) => controller.updateSetting('buyWholeSharesOnly', event.currentTarget.checked)} />Buy whole shares only</label><p class="setting-description">Limit purchases to whole CSH2 shares.<br />When buying, unspent cash carries forward and is used for subsequent buys. When selling, unspent cash is consumed before selling shares.</p></div>
    <div class="setting-card"><label class="tax-exemption"><input type="checkbox" disabled={controller.settings.applyReyndersTax} checked={controller.settings.applyCapitalGainsExemption} onchange={(event) => controller.updateSetting('applyCapitalGainsExemption', event.currentTarget.checked)} />Apply the annual capital-gains exemption</label><p class="setting-description">Applies a €10.000 annual exemption and eligible carry-forward up-to €15.000, based only on gains in this backtest.</p></div>
  </div>
</section>
