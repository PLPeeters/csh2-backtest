<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';

  let { controller }: { controller: BacktestController } = $props();
  let helpOpen = $state(false);
  let helpPinned = $state(false);

  const toggleHelp = (event: MouseEvent) => {
    event.preventDefault();
    helpPinned = !helpPinned;
    helpOpen = helpPinned;
  };
  const showHelp = () => { helpOpen = true; };
  const hideUnpinnedHelp = () => { if (!helpPinned) helpOpen = false; };
</script>

<aside class="tax-regime-bar" aria-label="Global assumptions">
  <div class="global-assumption-pickers">
    <div class="global-assumption-picker">
      <p class="global-assumption-title">Gain tax regime</p>
      <div class="tax-regime-picker" role="group" aria-label="CSH2 gain tax regime">
        <button type="button" aria-pressed={!controller.settings.applyReyndersTax && controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-exempt')}>10% CGT</button>
        <button type="button" aria-pressed={!controller.settings.applyReyndersTax && !controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-no-exemption')}>10% CGT (no exemption)</button>
        <button type="button" aria-pressed={controller.settings.applyReyndersTax} onclick={() => controller.setTaxRegime('reynders')}>30% Reynders Tax</button>
      </div>
    </div>
    <div class="global-assumption-picker">
      <p class="global-assumption-title">CSH2 rate</p>
      <div class="rate-estimate-picker" role="group" aria-label="CSH2 rate">
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'cautious'} onclick={() => controller.setCsh2RateScenario('cautious')}>Cautious</button>
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'base'} onclick={() => controller.setCsh2RateScenario('base')}>Base</button>
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'optimistic'} onclick={() => controller.setCsh2RateScenario('optimistic')}>Optimistic</button>
      </div>
    </div>
    <div class="global-assumption-picker">
      <p class="global-assumption-title">Returns</p>
      <div class="return-mode-picker" role="group" aria-label="Global return presentation">
        <button type="button" aria-pressed={controller.settings.returnMode === 'nominal'} onclick={() => controller.setReturnMode('nominal')}>Nominal</button>
        <button type="button" aria-pressed={controller.settings.returnMode === 'real'} onclick={() => controller.setReturnMode('real')}>Real</button>
      </div>
    </div>
    <div class="global-assumption-picker global-savings-picker">
      <div class="global-savings-label-row">
        <label class="global-savings-label" for="total-savings-amount">Total savings amount (€)</label>
        <details class="global-savings-help-popover" open={helpOpen} onmouseenter={showHelp} onmouseleave={hideUnpinnedHelp}>
          <summary aria-controls="total-savings-help" aria-label="Why total savings amount matters" onclick={toggleHelp}><span aria-hidden="true">i</span></summary>
          <p id="total-savings-help" class="global-savings-help">Affects CGT-exemption calculations, minimum holding periods, account comparison, and benchmark returns.</p>
        </details>
      </div>
      <input id="total-savings-amount" type="number" min="0.01" step="0.01" placeholder="Default: 10000" value={controller.settings.totalSavingsAmount} oninput={(event) => controller.setTotalSavingsAmount(event.currentTarget.value)} />
    </div>
  </div>
</aside>
