<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';

  let { controller }: { controller: BacktestController } = $props();
</script>

<aside class="tax-regime-bar" aria-label="Global tax regime">
  <div><p class="eyebrow">Global assumption</p><strong>CSH2 gain tax</strong></div>
  <div class="tax-regime-picker" role="group" aria-label="CSH2 gain tax regime">
    <button type="button" aria-pressed={!controller.settings.applyReyndersTax} onclick={() => controller.setTaxRegime(false)}>10% CGT</button>
    <button type="button" aria-pressed={controller.settings.applyReyndersTax} onclick={() => controller.setTaxRegime(true)}>30% Reynders Tax</button>
  </div>
</aside>
