import { closingQuoteOnOrBefore } from './quotes.mjs';
import { dateAfter, daysBetween, euro } from './shared.mjs';
import { runBacktest } from './simulation.mjs';

function trailingPriceTrend(prices, valuationDate, lookbackDays) {
  const valuation = closingQuoteOnOrBefore(prices, valuationDate);
  const trendDate = Object.entries(prices)
    .filter(([date, record]) => date < valuation.date && !record?.isFallback && daysBetween(date, valuation.date) >= lookbackDays)
    .map(([date]) => date)
    .sort()
    .at(-1);
  if (!trendDate) return undefined;
  const trendQuote = closingQuoteOnOrBefore(prices, trendDate);
  const trendDays = daysBetween(trendQuote.date, valuation.date);
  const dailyGrowthFactor = (valuation.price / trendQuote.price) ** (1 / trendDays);
  if (!Number.isFinite(dailyGrowthFactor) || dailyGrowthFactor <= 0) return undefined;
  return { valuation, trendDays, dailyGrowthFactor, trendReturnPercent: (dailyGrowthFactor ** trendDays - 1) * 100 };
}

/**
 * Projects move-now and wait-for-payout scenarios from the trailing CSH2 price trend.
 * This is a mechanical comparison, not a price forecast.
 */
export function assessInterestPayoutTiming(flows, prices, valuationDate, options, payoutDate, payoutAmount, { lookbackDays = 30 } = {}) {
  if (!payoutDate && !payoutAmount) return undefined;
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) throw new Error('Interest payout amount must be a positive amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate)) throw new Error('Interest payout date must be a valid date.');
  if (payoutDate <= valuationDate) throw new Error('Interest payout date must be after the latest CSH2 valuation date.');
  const currentBalance = flows.reduce((sum, flow) => sum + (flow.type === 'inflow' ? flow.amount : -flow.amount), 0);
  if (currentBalance <= 0) throw new Error('Interest payout comparison requires a positive current balance.');
  const trend = trailingPriceTrend(prices, valuationDate, lookbackDays);
  if (!trend) return undefined;
  const days = daysBetween(trend.valuation.date, payoutDate);
  const projectedPrices = { ...prices, [payoutDate]: { close: trend.valuation.price * trend.dailyGrowthFactor ** days } };
  const scenarioOptions = { ...options, unpaidAccruedInterest: 0 };
  const immediate = runBacktest([{ date: trend.valuation.date, type: 'inflow', amount: currentBalance }], projectedPrices, payoutDate, scenarioOptions);
  const waiting = runBacktest([{ date: payoutDate, type: 'inflow', amount: currentBalance + payoutAmount }], projectedPrices, payoutDate, scenarioOptions);
  const difference = euro(immediate.netLiquidationValue - waiting.netLiquidationValue);
  return {
    payoutDate,
    days,
    trendDays: trend.trendDays,
    trendReturnPercent: trend.trendReturnPercent,
    immediateValue: immediate.netLiquidationValue,
    waitingValue: waiting.netLiquidationValue,
    difference,
    preferred: difference > 0.005 ? 'move now' : difference < -0.005 ? 'wait' : 'either'
  };
}

/** Estimates a break-even date only when the observed price trend is positive. */
export function estimateBreakEvenDate(flows, prices, valuationDate, options, { lookbackDays = 30, maximumProjectionDays = 36525 } = {}) {
  const current = runBacktest(flows, prices, valuationDate, options);
  if (current.missedAmount >= 0) return undefined;
  const trend = trailingPriceTrend(prices, valuationDate, lookbackDays);
  if (!trend || trend.dailyGrowthFactor <= 1) return undefined;
  const projectedPrices = { ...prices };
  for (let day = 1; day <= maximumProjectionDays; day += 1) {
    const date = dateAfter(trend.valuation.date, day);
    projectedPrices[date] = { close: trend.valuation.price * trend.dailyGrowthFactor ** day };
    const projected = runBacktest(flows, projectedPrices, date, options);
    if (projected.missedAmount >= 0) return { date, days: day, trendDays: trend.trendDays, trendReturnPercent: trend.trendReturnPercent };
  }
  return undefined;
}
