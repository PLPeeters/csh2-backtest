import { closingQuoteOnOrBefore } from './quotes.mjs';
import { ANNUAL_CGT_EXEMPTION, CGT_EXEMPTION_CARRY_INCREMENT, CGT_EXEMPTION_START_YEAR, CGT_RATE, MAXIMUM_CGT_EXEMPTION, REYNDERS_TAX_RATE, TOB_RATE } from './shared.mjs';

export function createCapitalGainsExemption(enabled) {
  return { enabled, year: CGT_EXEMPTION_START_YEAR, baseUsed: 0, carry: 0 };
}

function advanceCapitalGainsExemption(exemption, year) {
  if (!exemption.enabled || year < CGT_EXEMPTION_START_YEAR) return;
  while (exemption.year < year) {
    exemption.carry = Math.min(MAXIMUM_CGT_EXEMPTION - ANNUAL_CGT_EXEMPTION, exemption.carry + Math.min(CGT_EXEMPTION_CARRY_INCREMENT, ANNUAL_CGT_EXEMPTION - exemption.baseUsed));
    exemption.year += 1;
    exemption.baseUsed = 0;
  }
}

function exemptGain(exemption, gain, year) {
  advanceCapitalGainsExemption(exemption, year);
  if (!exemption.enabled || year < CGT_EXEMPTION_START_YEAR) return 0;
  const baseExemption = Math.min(gain, ANNUAL_CGT_EXEMPTION - exemption.baseUsed);
  exemption.baseUsed += baseExemption;
  const carriedExemption = Math.min(gain - baseExemption, exemption.carry);
  exemption.carry -= carriedExemption;
  return baseExemption + carriedExemption;
}

/** Pre-2026 lots use the higher of their original price and the 2025 year-end close as their CGT basis. */
export function establishTaxPurchasePrice(lot, prices, year) {
  if (year >= CGT_EXEMPTION_START_YEAR && lot.purchaseDate < `${CGT_EXEMPTION_START_YEAR}-01-01` && lot.taxPurchasePrice === undefined) {
    lot.taxPurchasePrice = Math.max(lot.purchasePrice, closingQuoteOnOrBefore(prices, `${CGT_EXEMPTION_START_YEAR - 1}-12-31`).price);
  }
}

export function saleForLot(lot, units, price, exemption, year, applyExemption, applyReyndersTax) {
  const gross = units * price;
  const tob = gross * TOB_RATE;
  const taxablePurchasePrice = applyReyndersTax ? lot.purchasePrice : (lot.taxPurchasePrice ?? lot.purchasePrice);
  const gain = Math.max(0, (price - taxablePurchasePrice) * units);
  if (applyReyndersTax) {
    const reyndersTax = gain * REYNDERS_TAX_RATE;
    return { gross, tob, cgt: 0, reyndersTax, exoneratedCgt: 0, net: gross - tob - reyndersTax, gain };
  }
  if (year < CGT_EXEMPTION_START_YEAR) return { gross, tob, cgt: 0, reyndersTax: 0, exoneratedCgt: gain * CGT_RATE, net: gross - tob, gain };
  const exemptedGain = applyExemption ? exemptGain(exemption, gain, year) : 0;
  const cgt = (gain - exemptedGain) * CGT_RATE;
  return { gross, tob, cgt, reyndersTax: 0, exoneratedCgt: exemptedGain * CGT_RATE, net: gross - tob - cgt, gain };
}

export function liquidateLots(lots, prices, price, exemption, year, applyReyndersTax) {
  return lots.reduce((total, lot) => {
    if (!applyReyndersTax) establishTaxPurchasePrice(lot, prices, year);
    const sale = saleForLot(lot, lot.units, price, exemption, year, true, applyReyndersTax);
    return { gross: total.gross + sale.gross, tob: total.tob + sale.tob, cgt: total.cgt + sale.cgt, reyndersTax: total.reyndersTax + sale.reyndersTax, net: total.net + sale.net };
  }, { gross: 0, tob: 0, cgt: 0, reyndersTax: 0, net: 0 });
}

export function unitsForNetOutflow(lot, maxUnits, price, targetNet, exemption, year, applyReyndersTax) {
  let lower = 0;
  let upper = maxUnits;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const units = (lower + upper) / 2;
    const simulatedExemption = { ...exemption };
    if (saleForLot(lot, units, price, simulatedExemption, year, true, applyReyndersTax).net < targetNet) lower = units;
    else upper = units;
  }
  return upper;
}
