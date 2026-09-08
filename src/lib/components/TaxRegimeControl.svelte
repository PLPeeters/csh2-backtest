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

<aside class="tax-regime-bar static z-[auto] top-3 flex items-stretch justify-center mt-0 mb-3.5 bg-surface [box-shadow:none] mx-0 px-3.5 py-3 border border-solid border-line rounded-[5px] gap-3.5 [@media(width<=760px)]:top-2" aria-label="Global assumptions">
  <div class="global-assumption-pickers flex grow shrink [flex-basis:0%] flex-wrap items-end justify-center min-w-0 gap-3.5 [@media(width<=760px)]:w-full [@media(width<=760px)]:gap-2.5">
    <div class="global-assumption-picker grid min-w-0 gap-1.5 [@media(width<=760px)]:w-full">
      <p class="global-assumption-title text-ink text-[0.72rem] font-bold tracking-[0.04em] m-0">Gain tax regime</p>
      <div class="tax-regime-picker flex overflow-x-hidden overflow-y-hidden bg-white border border-solid border-[#aebdb5] rounded-[7px] [@media(width<=760px)]:overflow-x-auto [@media(width<=760px)]:w-fit [@media(width<=760px)]:max-w-full" role="group" aria-label="CSH2 gain tax regime">
        <button type="button" aria-pressed={!controller.settings.applyReyndersTax && controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-exempt')}>10% CGT</button>
        <button type="button" aria-pressed={!controller.settings.applyReyndersTax && !controller.settings.applyCapitalGainsExemption} onclick={() => controller.setTaxRegime('cgt-no-exemption')}>10% CGT (no exemption)</button>
        <button type="button" aria-pressed={controller.settings.applyReyndersTax} onclick={() => controller.setTaxRegime('reynders')}>30% Reynders Tax</button>
      </div>
    </div>
    <div class="global-assumption-picker grid min-w-0 gap-1.5 [@media(width<=760px)]:w-full">
      <p class="global-assumption-title text-ink text-[0.72rem] font-bold tracking-[0.04em] m-0">CSH2 rate</p>
      <div class="rate-estimate-picker flex overflow-x-hidden overflow-y-hidden bg-white border border-solid border-[#aebdb5] rounded-[7px] [@media(width<=760px)]:w-full" role="group" aria-label="CSH2 rate">
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'cautious'} onclick={() => controller.setCsh2RateScenario('cautious')}>Cautious</button>
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'base'} onclick={() => controller.setCsh2RateScenario('base')}>Base</button>
        <button type="button" aria-pressed={controller.settings.csh2RateScenario === 'optimistic'} onclick={() => controller.setCsh2RateScenario('optimistic')}>Optimistic</button>
      </div>
    </div>
    <div class="global-assumption-picker grid min-w-0 gap-1.5 [@media(width<=760px)]:w-full">
      <p class="global-assumption-title text-ink text-[0.72rem] font-bold tracking-[0.04em] m-0">Returns</p>
      <div class="return-mode-picker flex overflow-x-auto bg-white border border-solid border-[#cbd7d0] rounded-[7px] [@media(width<=760px)]:w-full" role="group" aria-label="Global return presentation">
        <button type="button" aria-pressed={controller.settings.returnMode === 'nominal'} onclick={() => controller.setReturnMode('nominal')}>Nominal</button>
        <button type="button" aria-pressed={controller.settings.returnMode === 'real'} onclick={() => controller.setReturnMode('real')}>Real</button>
      </div>
    </div>
    <div class="global-assumption-picker global-savings-picker grid min-w-0 relative gap-1.5 [@media(width<=760px)]:w-full">
      <div class="global-savings-label-row flex items-center min-w-0 pr-6.5">
        <label class="global-savings-label min-w-0 text-ink text-[0.72rem] font-bold" for="total-savings-amount">Total savings amount (€)</label>
        <details class="global-savings-help-popover static grow-0 shrink-0 basis-auto" open={helpOpen} onmouseenter={showHelp} onmouseleave={hideUnpinnedHelp}>
          <summary aria-controls="total-savings-help" aria-label="Why total savings amount matters" onclick={toggleHelp}><span aria-hidden="true">i</span></summary>
          <p id="total-savings-help" class="global-savings-help absolute z-8 top-[calc(100%_+_8px)] right-0 w-[min(320px,_-40px_+_100vw)] bg-surface [box-shadow:rgba(16,_35,_61,_0.12)_0px_10px_24px] text-muted text-[0.72rem] font-medium leading-[1.4] m-0 px-3 py-2.5 border border-solid border-line rounded-[4px]">Affects CGT-exemption calculations, minimum holding periods, account comparison, and benchmark returns.</p>
        </details>
      </div>
      <input id="total-savings-amount" type="number" min="0.01" step="0.01" placeholder="Default: 10000" value={controller.settings.totalSavingsAmount} oninput={(event) => controller.setTotalSavingsAmount(event.currentTarget.value)} />
    </div>
  </div>
</aside>
