import { closingQuoteOnOrBefore } from './quotes.mjs';
import { CGT_RATE, dateAfter, daysBetween, euro, overnightAccrualFactor, REYNDERS_TAX_RATE, TOB_RATE } from './shared.mjs';
import { runBacktest } from './simulation.mjs';
import { calculateOvernightBenchmarkPortfolio } from './return-series.mjs';
import { calculateCurrentRateModel, CURRENT_RATE_LOOKBACK_DAYS } from './current-rate.mjs';

function projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent) {
  const valuation = closingQuoteOnOrBefore(prices, valuationDate);
  if (!Number.isFinite(csh2AnnualRatePercent) || csh2AnnualRatePercent <= -100) return undefined;
  const dailyGrowthFactor = (1 + csh2AnnualRatePercent / 100) ** (1 / 365);
  if (!Number.isFinite(dailyGrowthFactor) || dailyGrowthFactor <= 0) return undefined;
  return { valuation, dailyGrowthFactor, csh2AnnualRatePercent };
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

/**
 * Builds a sampled €100 projection, recording match and unmatch intervals for each comparison line.
 * @param {number} csh2AnnualRatePercent
 * @param {number} overnightRatePercent
 * @param {string} valuationDate
 * @param {{ baseAnnualRatePercent?: number, fidelityPremiumPercent?: number, maximumProjectionDays?: number, applyReyndersTax?: boolean }} [options]
 */
export function buildCurrentRateEvolution(csh2AnnualRatePercent, overnightRatePercent, valuationDate, {
  baseAnnualRatePercent,
  fidelityPremiumPercent = 0,
  maximumProjectionDays = 365,
  applyReyndersTax = false
} = {}) {
  const accountIsIncluded = Number.isFinite(baseAnnualRatePercent) && Number.isFinite(fidelityPremiumPercent);
  const totalAnnualRatePercent = accountIsIncluded ? baseAnnualRatePercent + fidelityPremiumPercent : undefined;
  if (![csh2AnnualRatePercent, overnightRatePercent, maximumProjectionDays].every(Number.isFinite) ||
      csh2AnnualRatePercent <= -100 || overnightAccrualFactor(overnightRatePercent, 1) <= 0 ||
      maximumProjectionDays < 1 ||
      (accountIsIncluded && (baseAnnualRatePercent <= -100 || fidelityPremiumPercent < 0 || totalAnnualRatePercent <= -100))) return undefined;

  const lastDay = Math.min(36525, Math.floor(maximumProjectionDays));
  const sampleInterval = Math.max(1, Math.ceil(lastDay / 900));
  const dailyGrowthFactor = (1 + csh2AnnualRatePercent / 100) ** (1 / 365);
  const overnightDailyFactor = overnightAccrualFactor(overnightRatePercent, 1);
  const gainTaxRate = applyReyndersTax ? REYNDERS_TAX_RATE : CGT_RATE;
  const points = [];
  const matches = { breakEven: [], account: [], overnight: [] };
  const matchingIntervals = { breakEven: [], account: [], overnight: [] };
  let completedYears = 0;
  let periodStartDay = 0;
  let periodEndDay = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, 1));
  let previous;

  const pointForDay = (day) => {
    while (day >= periodEndDay) {
      completedYears += 1;
      periodStartDay = periodEndDay;
      periodEndDay = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, completedYears + 1));
    }
    const priceFactor = dailyGrowthFactor ** day;
    const gross = (1 - TOB_RATE) * priceFactor;
    const gain = Math.max(0, (1 - TOB_RATE) * (priceFactor - 1));
    const csh2 = 100 * (gross * (1 - TOB_RATE) - gain * gainTaxRate);
    const account = accountIsIncluded
      ? 100 * (1 + totalAnnualRatePercent / 100) ** completedYears *
        (1 + baseAnnualRatePercent / 100) ** ((day - periodStartDay) / (periodEndDay - periodStartDay))
      : undefined;
    return { day, csh2, breakEven: 100, account, overnight: 100 * overnightDailyFactor ** day };
  };

  const recordMatchState = (kind, point, target) => {
    const isMatching = point.csh2 >= point[target];
    const wasMatching = previous?.csh2 >= previous?.[target];
    if (!previous) return;
    if (!wasMatching && isMatching) {
      const match = { day: point.day, date: dateAfter(valuationDate, point.day) };
      matches[kind].push(match);
      matchingIntervals[kind].push({ startDay: point.day });
    } else if (wasMatching && !isMatching) {
      const interval = matchingIntervals[kind].at(-1);
      if (interval && interval.endDay === undefined) interval.endDay = point.day;
    }
  };
  for (let day = 0; day <= lastDay; day += 1) {
    const point = pointForDay(day);
    recordMatchState('breakEven', point, 'breakEven');
    recordMatchState('overnight', point, 'overnight');
    if (accountIsIncluded) recordMatchState('account', point, 'account');
    const isAnniversary = day === periodStartDay && day > 0;
    const isBeforeAnniversary = day + 1 === periodEndDay;
    const isMatch = Object.values(matches).some((values) => values.at(-1)?.day === day);
    if (day === 0 || day === lastDay || day % sampleInterval === 0 || isAnniversary || isBeforeAnniversary || isMatch) points.push(point);
    previous = point;
  }
  for (const intervals of Object.values(matchingIntervals)) {
    const interval = intervals.at(-1);
    if (interval && interval.endDay === undefined) interval.endDay = lastDay;
  }
  return { points, matches, matchingIntervals, maximumProjectionDays: lastDay };
}

function holdingPeriodRange(model, estimate) {
  return {
    earliest: estimate(model.csh2AnnualRateHighPercent),
    central: estimate(model.csh2AnnualRatePercent),
    latest: estimate(model.csh2AnnualRateLowPercent)
  };
}

/**
 * Estimates holding periods from current €STR plus CSH2's fitted trailing excess return.
 * @param {Record<string, unknown>} prices
 * @param {Record<string, number>} rates
 * @param {string} valuationDate
 * @param {{ lookbackDays?: number, maximumProjectionDays?: number, applyReyndersTax?: boolean, currentRateModel?: ReturnType<typeof calculateCurrentRateModel> }} [options]
 */
export function estimateConstantRateHoldingPeriods(prices, rates, valuationDate, { lookbackDays = CURRENT_RATE_LOOKBACK_DAYS, maximumProjectionDays = 36525, applyReyndersTax = false, currentRateModel } = {}) {
  const model = currentRateModel ?? calculateCurrentRateModel(prices, rates, valuationDate, { lookbackDays });
  if (!model) return undefined;
  const matchOptions = { maximumProjectionDays, applyReyndersTax };
  const breakEvenRange = holdingPeriodRange(model, (rate) => estimateConstantRateMatch(rate, 0, model.valuationDate, matchOptions));
  const matchOvernightRange = holdingPeriodRange(model, (rate) => estimateOvernightRateMatch(rate, model.overnightRatePercent, model.valuationDate, matchOptions));
  return {
    ...model,
    breakEven: breakEvenRange.central,
    matchOvernight: matchOvernightRange.central,
    breakEvenRange,
    matchOvernightRange
  };
}

/** Projects all cumulative-return lines to a future interest payout using the selected CSH2 rate scenario. */
export function buildReturnProjection(flows, prices, rates, valuationDate, from, payoutDate, payoutAmount, options, { csh2AnnualRatePercent } = {}) {
  if (!payoutDate || !Number.isFinite(payoutAmount) || payoutAmount <= 0 || payoutDate <= valuationDate) return undefined;
  if (payoutAmount < (options.unpaidAccruedInterest ?? 0)) throw new Error('Future interest payout amount cannot be smaller than unpaid accrued interest.');
  const projectionRate = projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent);
  if (!projectionRate) return undefined;
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
    if (day) projectedPrices[date] = { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** day };
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
    csh2AnnualRatePercent: projectionRate.csh2AnnualRatePercent,
    overnightRatePercent: overnightPortfolio.latestRate
  };
}

/**
 * Projects move-now and wait-for-payout scenarios from the selected CSH2 rate scenario.
 * This is a mechanical comparison, not a price forecast.
 */
export function assessInterestPayoutTiming(flows, prices, valuationDate, options, payoutDate, payoutAmount, { csh2AnnualRatePercent } = {}) {
  if (!payoutDate && !payoutAmount) return undefined;
  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) throw new Error('Interest payout amount must be a positive amount.');
  if (payoutAmount < (options.unpaidAccruedInterest ?? 0)) throw new Error('Future interest payout amount cannot be smaller than unpaid accrued interest.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate)) throw new Error('Interest payout date must be a valid date.');
  if (payoutDate <= valuationDate) throw new Error('Interest payout date must be after the latest CSH2 valuation date.');
  const currentBalance = flows.reduce((sum, flow) => sum + (flow.type === 'inflow' ? flow.amount : -flow.amount), 0);
  if (currentBalance <= 0) throw new Error('Interest payout comparison requires a positive current balance.');
  const projectionRate = projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent);
  if (!projectionRate) return undefined;
  const days = daysBetween(projectionRate.valuation.date, payoutDate);
  const projectedPrices = { ...prices, [payoutDate]: { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** days } };
  const scenarioOptions = { ...options, unpaidAccruedInterest: 0 };
  const immediate = runBacktest([{ date: projectionRate.valuation.date, type: 'inflow', amount: currentBalance }], projectedPrices, payoutDate, scenarioOptions);
  const waiting = runBacktest([{ date: payoutDate, type: 'inflow', amount: currentBalance + payoutAmount }], projectedPrices, payoutDate, scenarioOptions);
  const difference = euro(immediate.netLiquidationValue - waiting.netLiquidationValue);
  return {
    payoutDate,
    days,
    csh2AnnualRatePercent: projectionRate.csh2AnnualRatePercent,
    immediateValue: immediate.netLiquidationValue,
    waitingValue: waiting.netLiquidationValue,
    difference,
    preferred: difference > 0.005 ? 'move now' : difference < -0.005 ? 'wait' : 'either'
  };
}

/**
 * Estimates a break-even date only when the selected CSH2 rate scenario is positive.
 * @param {{ csh2AnnualRatePercent?: number, maximumProjectionDays?: number }} [projection]
 */
export function estimateBreakEvenDate(flows, prices, valuationDate, options, projection = {}) {
  const { csh2AnnualRatePercent, maximumProjectionDays = 36525 } = projection;
  const current = runBacktest(flows, prices, valuationDate, options);
  if (current.missedAmount >= 0) return undefined;
  const projectionRate = projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent);
  if (!projectionRate || projectionRate.dailyGrowthFactor <= 1) return undefined;
  const projectedPrices = { ...prices };
  for (let day = 1; day <= maximumProjectionDays; day += 1) {
    const date = dateAfter(projectionRate.valuation.date, day);
    projectedPrices[date] = { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** day };
    const projected = runBacktest(flows, projectedPrices, date, options);
    if (projected.missedAmount >= 0) return { date, days: day, csh2AnnualRatePercent: projectionRate.csh2AnnualRatePercent };
  }
  return undefined;
}
