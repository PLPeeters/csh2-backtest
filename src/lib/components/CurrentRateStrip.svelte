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

<section class="rate-strip" aria-labelledby="rate-strip-heading">
  <h2 id="rate-strip-heading" class="sr-only">Current rates</h2>
  <div class="rate-strip-item rate-strip-csh2">
    <div class="rate-strip-label">Estimated CSH2<span class="methodology-trigger"><button type="button" class="methodology-info" aria-label="How estimated CSH2 is calculated" aria-haspopup="dialog" onclick={onOpenMethodology}>i</button></span></div>
    <div class="rate-strip-value">{rate(csh2Rate)} <small>p.a.</small>{#if csh2ModelError !== undefined && Number.isFinite(csh2ModelError)} <small class="rate-strip-error">± {number.format(csh2ModelError)} p.p.</small>{/if}</div>
    {#if afterTaxRate !== undefined}<div class="rate-strip-after-tax"><span class="rate-strip-after-tax-label">After tax</span><strong class="rate-strip-after-tax-value">{rate(afterTaxRate)} <small>p.a.</small>{#if afterTaxModelError !== undefined && Number.isFinite(afterTaxModelError)} <small class="rate-strip-error">± {number.format(afterTaxModelError)} p.p.</small>{/if}</strong></div>{/if}
    <div class="rate-strip-meta">Effective {longDate(holdingPeriods?.valuationDate)}</div>
  </div>
  <div class="rate-strip-item rate-strip-savings">
    <div class="rate-strip-label">Your savings</div>
    <div class="rate-strip-value">{rate(savingsRate)} <small>p.a.</small> <button class="rate-strip-edit" type="button" onclick={onEditRate} aria-label="Edit rate">Edit rate</button></div>
    <div class="rate-strip-meta">User-provided base rate + fidelity premium</div>
  </div>
  <div class="rate-strip-item rate-strip-estr">
    <div class="rate-strip-label">€STR</div>
    <div class="rate-strip-value">{rate(holdingPeriods?.overnightRatePercent)} <small>p.a.</small></div>
    <div class="rate-strip-meta">Effective {longDate(holdingPeriods?.valuationDate)} · gross overnight benchmark</div>
  </div>
</section>
