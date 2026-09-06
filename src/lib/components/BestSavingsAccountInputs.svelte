<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';

  let { controller }: { controller: BacktestController } = $props();
</script>

<section class="input-section best-savings-account-inputs" aria-labelledby="best-savings-account-heading">
  <div class="section-title">
    <div><p class="eyebrow">Comparison input</p><h3 id="best-savings-account-heading">Best available savings account</h3></div>
  </div>
  <div class="benchmark-account-rate">
    <div class="benchmark-account-rate-fields">
      <label class="account-interest-rate">Best available base annual rate (%)<input type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" value={controller.settings.bestSavingsBaseInterestRate} oninput={(event) => controller.updateSetting('bestSavingsBaseInterestRate', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsBaseInterestRate', event.currentTarget.value)} /></label>
      <label class="account-interest-rate">Best available fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.bestSavingsFidelityPremium} oninput={(event) => controller.updateSetting('bestSavingsFidelityPremium', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsFidelityPremium', event.currentTarget.value)} /></label>
    </div>
  </div>
</section>
