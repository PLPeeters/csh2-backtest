import { closingQuoteOnOrBefore } from './quotes.mjs';
import { CGT_RATE, dateAfter, daysBetween, euro, overnightAccrualFactor, REYNDERS_TAX_RATE, TOB_RATE } from './shared.mjs';
import { runBacktest } from './simulation.mjs';
import { calculateOvernightBenchmarkPortfolio } from './return-series.mjs';

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

function trailingOvernightFactor(rates, from, to) {
  const entries = Object.entries(rates)
    .filter(([date, rate]) => date <= to && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right));
  let activeRate = entries.filter(([date]) => date <= from).at(-1)?.[1];
  if (!Number.isFinite(activeRate)) return undefined;
  let factor = 1;
  let previousDate = from;
  for (const [date, rate] of entries) {
    if (date <= from) continue;
    factor *= overnightAccrualFactor(activeRate, daysBetween(previousDate, date));
    activeRate = rate;
    previousDate = date;
  }
  factor *= overnightAccrualFactor(activeRate, daysBetween(previousDate, to));
  return factor;
}

/** Finds when net CSH2 value catches a constant annual target rate after transaction and gain taxes. */
export function estimateConstantRateMatch(csh2AnnualRatePercent, targetAnnualRatePercent, valuationDate, { maximumProjectionDays = 36525, applyReyndersTax = false } = {}) {
  if (![csh2AnnualRatePercent, targetAnnualRatePercent].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || targetAnnualRatePercent <= -100) return undefined;
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, applyReyndersTax,
    (day) => (1 + targetAnnualRatePercent / 100) ** (day / 365));
}

/** Finds when net CSH2 catches a constant overnight benchmark quoted on an Actual/360 basis. */
export function estimateOvernightRateMatch(csh2AnnualRatePercent, overnightRatePercent, valuationDate, { maximumProjectionDays = 36525, applyReyndersTax = false } = {}) {
  if (![csh2AnnualRatePercent, overnightRatePercent].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || overnightAccrualFactor(overnightRatePercent, 1) <= 0) return undefined;
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, applyReyndersTax,
    (day) => overnightAccrualFactor(overnightRatePercent, 1) ** day);
}

function dateAfterCalendarYears(date, years) {
  const [year, month, day] = date.split('-').map(Number);
  const targetYear = year + years;
  const lastDayOfMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month - 1, Math.min(day, lastDayOfMonth))).toISOString().slice(0, 10);
}

/** Finds when net CSH2 catches a savings account whose fidelity premium vests after each uninterrupted year. */
export function estimateSavingsAccountRateMatch(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, { minimumProjectionDays = 0, maximumProjectionDays = 36525, applyReyndersTax = false } = {}) {
  const totalAnnualRatePercent = baseAnnualRatePercent + fidelityPremiumPercent;
  if (![csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, minimumProjectionDays, maximumProjectionDays].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || baseAnnualRatePercent <= -100 || fidelityPremiumPercent < 0 || totalAnnualRatePercent <= -100 || minimumProjectionDays < 0 || maximumProjectionDays < minimumProjectionDays) return undefined;
  let completedYears = 0;
  let periodStartDay = 0;
  let periodEndDay = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, 1));
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, applyReyndersTax, (day) => {
    while (day >= periodEndDay) {
      completedYears += 1;
      periodStartDay = periodEndDay;
      periodEndDay = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, completedYears + 1));
    }
    const periodDays = periodEndDay - periodStartDay;
    const daysIntoFidelityPeriod = day - periodStartDay;
    return (1 + totalAnnualRatePercent / 100) ** completedYears * (1 + baseAnnualRatePercent / 100) ** (daysIntoFidelityPeriod / periodDays);
  }, minimumProjectionDays);
}

/** Separates a possible base-rate match before the first fidelity award from the first match afterward. */
export function estimateSavingsAccountRateMatches(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, { maximumProjectionDays = 36525, applyReyndersTax = false } = {}) {
  const firstFidelityDays = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, 1));
  const sharedOptions = { applyReyndersTax };
  const afterFidelity = maximumProjectionDays >= firstFidelityDays
    ? estimateSavingsAccountRateMatch(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, {
      ...sharedOptions,
      minimumProjectionDays: firstFidelityDays,
      maximumProjectionDays
    })
    : undefined;
  let fidelityMatchWindow;
  if (afterFidelity) {
    let nextAwardNumber = 1;
    let nextAwardDate = dateAfterCalendarYears(valuationDate, nextAwardNumber);
    while (daysBetween(valuationDate, nextAwardDate) <= afterFidelity.days) {
      nextAwardNumber += 1;
      nextAwardDate = dateAfterCalendarYears(valuationDate, nextAwardNumber);
    }
    const previousAwardNumber = nextAwardNumber - 1;
    const previousAwardDate = dateAfterCalendarYears(valuationDate, previousAwardNumber);
    fidelityMatchWindow = {
      previousAwardNumber,
      previousAwardDate,
      daysAfterPreviousAward: daysBetween(previousAwardDate, afterFidelity.date),
      nextAwardNumber,
      nextAwardDate,
      daysBeforeNextAward: daysBetween(afterFidelity.date, nextAwardDate)
    };
  }
  return {
    firstFidelityDays,
    beforeFidelity: estimateSavingsAccountRateMatch(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, {
      ...sharedOptions,
      maximumProjectionDays: Math.min(maximumProjectionDays, firstFidelityDays - 1)
    }),
    afterFidelity,
    fidelityMatchWindow
  };
}

function estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, applyReyndersTax, targetValue, minimumProjectionDays = 0) {
  const dailyGrowthFactor = (1 + csh2AnnualRatePercent / 100) ** (1 / 365);
  const gainTaxRate = applyReyndersTax ? REYNDERS_TAX_RATE : CGT_RATE;
  for (let day = minimumProjectionDays; day <= maximumProjectionDays; day += 1) {
    const priceFactor = dailyGrowthFactor ** day;
    const gross = (1 - TOB_RATE) * priceFactor;
    const gain = Math.max(0, (1 - TOB_RATE) * (priceFactor - 1));
    const net = gross * (1 - TOB_RATE) - gain * gainTaxRate;
    const target = targetValue(day);
    if (net >= target) return { date: dateAfter(valuationDate, day), days: day };
  }
  return undefined;
}

/** Estimates holding periods from current €STR plus CSH2's matched trailing excess return. */
export function estimateConstantRateHoldingPeriods(prices, rates, valuationDate, { lookbackDays = 90, maximumProjectionDays = 36525, applyReyndersTax = false } = {}) {
  const trend = trailingPriceTrend(prices, valuationDate, lookbackDays);
  if (!trend) return undefined;
  const latestRate = Object.entries(rates)
    .filter(([date, rate]) => date <= trend.valuation.date && Number.isFinite(rate))
    .sort(([left], [right]) => right.localeCompare(left))[0];
  const trailingOvernight = trailingOvernightFactor(rates, dateAfter(trend.valuation.date, -trend.trendDays), trend.valuation.date);
  if (!latestRate || latestRate[1] <= -100 || !Number.isFinite(trailingOvernight) || trailingOvernight <= 0) return undefined;
  const observedCsh2AnnualFactor = trend.dailyGrowthFactor ** 365;
  const observedOvernightAnnualFactor = trailingOvernight ** (365 / trend.trendDays);
  const csh2ExcessAnnualFactor = observedCsh2AnnualFactor / observedOvernightAnnualFactor;
  const currentOvernightAnnualFactor = overnightAccrualFactor(latestRate[1], 1) ** 365;
  const csh2AnnualFactor = currentOvernightAnnualFactor * csh2ExcessAnnualFactor;
  if (![observedCsh2AnnualFactor, observedOvernightAnnualFactor, csh2ExcessAnnualFactor, currentOvernightAnnualFactor, csh2AnnualFactor].every((factor) => Number.isFinite(factor) && factor > 0)) return undefined;
  const csh2AnnualRatePercent = (csh2AnnualFactor - 1) * 100;
  const matchOptions = { maximumProjectionDays, applyReyndersTax };
  return {
    valuationDate: trend.valuation.date,
    trendStartDate: dateAfter(trend.valuation.date, -trend.trendDays),
    rateDate: latestRate[0],
    trendDays: trend.trendDays,
    csh2AnnualRatePercent,
    observedCsh2AnnualRatePercent: (observedCsh2AnnualFactor - 1) * 100,
    observedOvernightAnnualRatePercent: (observedOvernightAnnualFactor - 1) * 100,
    csh2ExcessAnnualRatePercent: (csh2ExcessAnnualFactor - 1) * 100,
    currentOvernightAnnualRatePercent: (currentOvernightAnnualFactor - 1) * 100,
    overnightRatePercent: latestRate[1],
    breakEven: estimateConstantRateMatch(csh2AnnualRatePercent, 0, trend.valuation.date, matchOptions),
    matchOvernight: estimateOvernightRateMatch(csh2AnnualRatePercent, latestRate[1], trend.valuation.date, matchOptions)
  };
}

/** Projects all cumulative-return lines to a future interest payout on common assumptions. */
export function buildReturnProjection(flows, prices, rates, valuationDate, from, payoutDate, payoutAmount, options, { lookbackDays = 30 } = {}) {
  if (!payoutDate || !Number.isFinite(payoutAmount) || payoutAmount <= 0 || payoutDate <= valuationDate) return undefined;
  if (payoutAmount < (options.unpaidAccruedInterest ?? 0)) throw new Error('Future interest payout amount cannot be smaller than unpaid accrued interest.');
  const trend = trailingPriceTrend(prices, valuationDate, lookbackDays);
  if (!trend) return undefined;
  const externalInflows = flows.filter((flow) => flow.type === 'inflow' && !flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
  if (!externalInflows) return undefined;
  const outflows = flows.filter((flow) => flow.type === 'outflow').reduce((sum, flow) => sum + flow.amount, 0);
  const paidInterest = flows.filter((flow) => flow.type === 'inflow' && flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
  const projectionOptions = { ...options, unpaidAccruedInterest: 0 };
  const projectedPrices = { ...prices };
  const csh2 = [];
  const projectionDays = daysBetween(valuationDate, payoutDate);
  for (let day = 0; day <= projectionDays; day += 1) {
    const date = dateAfter(valuationDate, day);
    if (day) projectedPrices[date] = { close: trend.valuation.price * trend.dailyGrowthFactor ** day };
    const result = runBacktest(flows, projectedPrices, date, projectionOptions);
    csh2.push({ date, value: ((result.netLiquidationValue + outflows - externalInflows) / externalInflows) * 100 });
  }

  const overnightPortfolio = calculateOvernightBenchmarkPortfolio(flows, prices, rates, valuationDate, from, valuationDate, projectionOptions);
  if (!overnightPortfolio.latestDate || !Number.isFinite(overnightPortfolio.latestRate) || !overnightPortfolio.inflows) return undefined;
  const overnight = [{ date: overnightPortfolio.latestDate, value: ((overnightPortfolio.balance + overnightPortfolio.outflows - overnightPortfolio.inflows) / overnightPortfolio.inflows) * 100 }];
  let overnightBalance = overnightPortfolio.balance;
  const overnightDays = daysBetween(overnightPortfolio.latestDate, payoutDate);
  for (let day = 1; day <= overnightDays; day += 1) {
    const date = dateAfter(overnightPortfolio.latestDate, day);
    overnightBalance *= overnightAccrualFactor(overnightPortfolio.latestRate, 1);
    overnight.push({ date, value: ((overnightBalance + overnightPortfolio.outflows - overnightPortfolio.inflows) / overnightPortfolio.inflows) * 100 });
  }

  const currentAccountReturn = ((paidInterest + (options.unpaidAccruedInterest ?? 0)) / externalInflows) * 100;
  return {
    csh2,
    overnight,
    account: [
      { date: valuationDate, value: currentAccountReturn },
      { date: payoutDate, value: ((paidInterest + payoutAmount) / externalInflows) * 100 }
    ],
    payoutDate,
    trendDays: trend.trendDays,
    trendReturnPercent: trend.trendReturnPercent,
    overnightRatePercent: overnightPortfolio.latestRate
  };
}

/**
 * Projects move-now and wait-for-payout scenarios from the trailing CSH2 price trend.
 * This is a mechanical comparison, not a price forecast.
 */
export function assessInterestPayoutTiming(flows, prices, valuationDate, options, payoutDate, payoutAmount, { lookbackDays = 30 } = {}) {
  if (!payoutDate && !payoutAmount) return undefined;
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) throw new Error('Interest payout amount must be a positive amount.');
  if (payoutAmount < (options.unpaidAccruedInterest ?? 0)) throw new Error('Future interest payout amount cannot be smaller than unpaid accrued interest.');
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
