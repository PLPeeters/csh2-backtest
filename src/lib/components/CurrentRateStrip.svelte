<script lang="ts">
  import { estimateAnnualizedAfterTaxCsh2Rate } from '../../backtest.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { ConstantRateHoldingPeriods } from '../types';

  let { controller, onEditRate, onOpenMethodology }: { controller: BacktestController; onEditRate?: () => void; onOpenMethodology?: () => void } = $props();

  let holdingPeriods = $derived<ConstantRateHoldingPeriods | undefined>(controller.benchmark?.holdingPeriods[controller.settings.applyReyndersTax ? 'reynders' : 'cgt']);
  let csh2Rate = $derived(holdingPeriods?.csh2AnnualRatePercent);
  let csh2ModelError = $derived(holdingPeriods?.modelErrorAnnualRatePercent);
  let totalSavingsAmount = $derived(Number(controller.settings.totalSavingsAmount || '10000'));
  let hasTotalSavingsAmount = $derived(Number.isFinite(totalSavingsAmount) && totalSavingsAmount > 0);
  let taxEstimateOptions = $derived({
    applyReyndersTax: controller.settings.applyReyndersTax,
    applyCapitalGainsExemption: controller.settings.applyCapitalGainsExemption && hasTotalSavingsAmount,
    investmentAmount: hasTotalSavingsAmount ? totalSavingsAmount : undefined
  });
  let afterTaxRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRatePercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let afterTaxLowRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRateLowPercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let afterTaxHighRate = $derived(holdingPeriods ? estimateAnnualizedAfterTaxCsh2Rate(holdingPeriods.csh2AnnualRateHighPercent, holdingPeriods.valuationDate, taxEstimateOptions) : undefined);
  let afterTaxModelError = $derived(afterTaxLowRate !== undefined && afterTaxHighRate !== undefined ? Math.abs(afterTaxHighRate - afterTaxLowRate) / 2 : undefined);
  let savingsBaseRate = $derived(Number(controller.settings.accountBaseInterestRate));
  let savingsPremium = $derived(Number(controller.settings.accountFidelityPremium || 0));
  let hasSavingsBaseRate = $derived(controller.settings.accountBaseInterestRate.trim() !== '');
  let savingsRate = $derived(hasSavingsBaseRate && Number.isFinite(savingsBaseRate) && savingsBaseRate > -100 && Number.isFinite(savingsPremium) && savingsPremium >= 0 ? savingsBaseRate + savingsPremium : undefined);
  const number = new Intl.NumberFormat('en-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const longDate = (value?: string) => value ? new Intl.DateTimeFormat('en-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Waiting for data';
  const rate = (value?: number) => value === undefined || !Number.isFinite(value) ? '—' : `${number.format(value)}%`;
</script>

<section class="rate-strip grid grid-cols-[repeat(3,_1fr)] mt-0 mb-3.5 bg-surface mx-0 border border-solid border-line rounded-[5px] [@media(width<=600px)]:grid-cols-[1fr]" aria-labelledby="rate-strip-heading">
  <h2 id="rate-strip-heading" class="sr-only m-0">Current rates</h2>
  <div class="rate-strip-item rate-strip-csh2 relative flex flex-col justify-center min-w-0 min-h-23 px-[clamp(15px,_2.4vw,_34px)] py-[15px] [@media(width<=600px)]:min-h-0 [@media(width<=600px)]:px-[15px] [@media(width<=600px)]:py-3">
    <div class="rate-strip-label relative inline-block [align-self:flex-start] text-ink text-[0.76rem] font-[750] tracking-[0.01em] normal-case">Estimated CSH2<span class="methodology-trigger relative inline-flex"><button type="button" class="methodology-info inline-grid w-5 min-h-5 place-items-center bg-white text-accent-dark [font-family:Georgia,_serif] text-[0.76rem] font-bold leading-[1] p-0 border border-solid border-[#6e857a] rounded-[50%]" aria-label="How estimated CSH2 is calculated" aria-haspopup="dialog" onclick={onOpenMethodology}>i</button></span></div>
    <div class="rate-strip-value mt-1 text-accent-dark text-[clamp(1.45rem,_2.3vw,_2rem)] tabular-nums font-[750] tracking-[-0.045em] leading-[1.1]">{rate(csh2Rate)} <small>p.a.</small>{#if csh2ModelError !== undefined && Number.isFinite(csh2ModelError)} <small class="rate-strip-error">± {number.format(csh2ModelError)} p.p.</small>{/if}</div>
    {#if afterTaxRate !== undefined}<div class="rate-strip-after-tax flex items-baseline flex-wrap gap-y-[3px] gap-x-[7px] mt-[7px] text-accent-dark text-[0.92rem] leading-[1.1]"><span class="rate-strip-after-tax-label text-muted text-[0.68rem] font-[650] tracking-[0.02em]">After tax</span><strong class="rate-strip-after-tax-value tabular-nums font-bold">{rate(afterTaxRate)} <small>p.a.</small>{#if afterTaxModelError !== undefined && Number.isFinite(afterTaxModelError)} <small class="rate-strip-error">± {number.format(afterTaxModelError)} p.p.</small>{/if}</strong></div>{/if}
    <div class="rate-strip-meta mt-[7px] text-muted text-[0.7rem] leading-[1.35]">Effective {longDate(holdingPeriods?.valuationDate)}</div>
  </div>
  <div class="rate-strip-item rate-strip-savings relative flex flex-col justify-center min-w-0 min-h-23 px-[clamp(15px,_2.4vw,_34px)] py-[15px] [@media(width<=600px)]:min-h-0 [@media(width<=600px)]:px-[15px] [@media(width<=600px)]:py-3">
    <div class="rate-strip-label relative inline-block [align-self:flex-start] text-ink text-[0.76rem] font-[750] tracking-[0.01em] normal-case">Your savings</div>
    <div class="rate-strip-value mt-1 text-accent-dark text-[clamp(1.45rem,_2.3vw,_2rem)] tabular-nums font-[750] tracking-[-0.045em] leading-[1.1]">{rate(savingsRate)} <small>p.a.</small> <button class="rate-strip-edit inline-grid size-9 min-h-9 place-items-center ml-[7px] border border-solid border-transparent rounded-[4px] bg-transparent text-ink cursor-pointer p-1 align-middle" type="button" onclick={onEditRate} aria-label="Edit rate"><svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.932Zm0 0L19.5 7.125" /></svg></button></div>
    <div class="rate-strip-meta mt-[7px] text-muted text-[0.7rem] leading-[1.35]">User-provided base rate + fidelity premium</div>
  </div>
  <div class="rate-strip-item rate-strip-estr relative flex flex-col justify-center min-w-0 min-h-23 px-[clamp(15px,_2.4vw,_34px)] py-[15px] [@media(width<=600px)]:min-h-0 [@media(width<=600px)]:px-[15px] [@media(width<=600px)]:py-3">
    <div class="rate-strip-label relative inline-block [align-self:flex-start] text-ink text-[0.76rem] font-[750] tracking-[0.01em] normal-case">€STR</div>
    <div class="rate-strip-value mt-1 text-accent-dark text-[clamp(1.45rem,_2.3vw,_2rem)] tabular-nums font-[750] tracking-[-0.045em] leading-[1.1]">{rate(holdingPeriods?.overnightRatePercent)} <small>p.a.</small></div>
    <div class="rate-strip-meta mt-[7px] text-muted text-[0.7rem] leading-[1.35]">Effective {longDate(holdingPeriods?.valuationDate)} · gross overnight benchmark</div>
  </div>
</section>
