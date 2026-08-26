<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';

  let { controller }: { controller: BacktestController } = $props();
</script>

<aside class="tax-regime-bar" aria-label="Global tax regime">
  <div><p class="eyebrow">Global assumptions</p><strong>CSH2 gain tax and rate scenario</strong></div>
  <div class="global-assumption-pickers">
    <div class="tax-regime-picker" role="group" aria-label="CSH2 gain tax regime">
      <button type="button" aria-pressed={!controller.settings.applyReyndersTax && controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-exempt')}>10% CGT</button>
      <button type="button" aria-pressed={!controller.settings.applyReyndersTax && !controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-no-exemption')}>10% CGT (no exemption)</button>
      <button type="button" aria-pressed={controller.settings.applyReyndersTax} onclick={() => controller.setTaxRegime('reynders')}>30% Reynders Tax</button>
    </div>
    <div class="rate-estimate-picker" role="group" aria-label="CSH2 rate scenario">
      <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'cautious'} onclick={() => controller.setCsh2RateScenario('cautious')}>Cautious</button>
      <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'base'} onclick={() => controller.setCsh2RateScenario('base')}>Base</button>
      <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'optimistic'} onclick={() => controller.setCsh2RateScenario('optimistic')}>Optimistic</button>
    </div>
  </div>
</aside>
