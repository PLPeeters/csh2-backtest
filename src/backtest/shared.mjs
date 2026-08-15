export const TOB_RATE = 0.0012;
export const CGT_RATE = 0.1;
export const REYNDERS_TAX_RATE = 0.3;
export const ANNUAL_CGT_EXEMPTION = 10000;
export const CGT_EXEMPTION_CARRY_INCREMENT = 1000;
export const MAXIMUM_CGT_EXEMPTION = 15000;
export const CGT_EXEMPTION_START_YEAR = 2026;

/** Applies the European money-market Actual/360 convention for one overnight-rate interval. */
export function overnightAccrualFactor(annualRatePercent, calendarDays) {
  return 1 + (annualRatePercent / 100) * (calendarDays / 360);
}

export function euro(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

export function dateAfter(date, days) {
  const projected = new Date(`${date}T00:00:00Z`);
  projected.setUTCDate(projected.getUTCDate() + days);
  return projected.toISOString().slice(0, 10);
}
