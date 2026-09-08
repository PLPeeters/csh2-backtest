<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';

  let { controller }: { controller: BacktestController } = $props();
</script>

<section class="input-section best-savings-account-inputs [border-top-width:1px] [border-top-style:solid] [border-top-color:#e3e8e5] px-0 py-5.5" aria-labelledby="best-savings-account-heading">
  <div class="section-title flex items-center justify-between pb-5 gap-5 [@media(width<=760px)]:items-start [@media(width<=760px)]:flex-col [@media(width<=760px)]:gap-3">
    <div><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Comparison input</p><h3 id="best-savings-account-heading">Best available savings account</h3></div>
  </div>
  <div class="benchmark-account-rate w-[min(100%,_440px)] [@media(width<=760px)]:w-full">
    <div class="benchmark-account-rate-fields grid grid-cols-2 gap-3 [@media(width<=760px)]:w-full">
      <label class="account-interest-rate block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Best available base annual rate (%)<input type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" value={controller.settings.bestSavingsBaseInterestRate} oninput={(event) => controller.updateSetting('bestSavingsBaseInterestRate', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsBaseInterestRate', event.currentTarget.value)} /></label>
      <label class="account-interest-rate block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Best available fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.bestSavingsFidelityPremium} oninput={(event) => controller.updateSetting('bestSavingsFidelityPremium', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('bestSavingsFidelityPremium', event.currentTarget.value)} /></label>
    </div>
  </div>
</section>
