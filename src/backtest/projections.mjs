import { closingQuoteOnOrBefore } from './quotes.mjs';
import { CGT_RATE, dateAfter, daysBetween, euro, overnightAccrualFactor, REYNDERS_TAX_RATE, TOB_RATE } from './shared.mjs';
import { runBacktest } from './simulation.mjs';
import { estimateSingleInvestmentLiquidationValue } from './taxation.mjs';
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
export function estimateConstantRateMatch(csh2AnnualRatePercent, targetAnnualRatePercent, valuationDate, { maximumProjectionDays = 36525, ...taxOptions } = {}) {
  if (![csh2AnnualRatePercent, targetAnnualRatePercent].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || targetAnnualRatePercent <= -100) return undefined;
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, taxOptions,
    (day) => (1 + targetAnnualRatePercent / 100) ** (day / 365));
}

/** Finds when net CSH2 catches a constant overnight benchmark quoted on an Actual/360 basis. */
export function estimateOvernightRateMatch(csh2AnnualRatePercent, overnightRatePercent, valuationDate, { maximumProjectionDays = 36525, ...taxOptions } = {}) {
  if (![csh2AnnualRatePercent, overnightRatePercent].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || overnightAccrualFactor(overnightRatePercent, 1) <= 0) return undefined;
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, taxOptions,
    (day) => overnightAccrualFactor(overnightRatePercent, 1) ** day);
}

function dateAfterCalendarYears(date, years) {
  const [year, month, day] = date.split('-').map(Number);
  const targetYear = year + years;
  const lastDayOfMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month - 1, Math.min(day, lastDayOfMonth))).toISOString().slice(0, 10);
}

/**
 * Finds when net CSH2 catches a savings account whose fidelity premium vests after each uninterrupted year.
 * @param {number} csh2AnnualRatePercent
 * @param {number} baseAnnualRatePercent
 * @param {number} fidelityPremiumPercent
 * @param {string} valuationDate
 * @param {{ minimumProjectionDays?: number, maximumProjectionDays?: number, applyReyndersTax?: boolean, applyCapitalGainsExemption?: boolean, investmentAmount?: number }} [options]
 */
export function estimateSavingsAccountRateMatch(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, { minimumProjectionDays = 0, maximumProjectionDays = 36525, ...taxOptions } = {}) {
  const totalAnnualRatePercent = baseAnnualRatePercent + fidelityPremiumPercent;
  if (![csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, minimumProjectionDays, maximumProjectionDays].every(Number.isFinite) || csh2AnnualRatePercent <= -100 || baseAnnualRatePercent <= -100 || fidelityPremiumPercent < 0 || totalAnnualRatePercent <= -100 || minimumProjectionDays < 0 || maximumProjectionDays < minimumProjectionDays) return undefined;
  let completedYears = 0;
  let periodStartDay = 0;
  let periodEndDay = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, 1));
  return estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, taxOptions, (day) => {
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

/**
 * Separates a possible base-rate match before the first fidelity award from the first match afterward.
 * @param {number} csh2AnnualRatePercent
 * @param {number} baseAnnualRatePercent
 * @param {number} fidelityPremiumPercent
 * @param {string} valuationDate
 * @param {{ maximumProjectionDays?: number, applyReyndersTax?: boolean, applyCapitalGainsExemption?: boolean, investmentAmount?: number }} [options]
 */
export function estimateSavingsAccountRateMatches(csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, valuationDate, { maximumProjectionDays = 36525, ...taxOptions } = {}) {
  const firstFidelityDays = daysBetween(valuationDate, dateAfterCalendarYears(valuationDate, 1));
  const sharedOptions = taxOptions;
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

function estimateRateMatch(csh2AnnualRatePercent, valuationDate, maximumProjectionDays, { applyReyndersTax = false, applyCapitalGainsExemption = false, investmentAmount } = {}, targetValue, minimumProjectionDays = 0) {
  const dailyGrowthFactor = (1 + csh2AnnualRatePercent / 100) ** (1 / 365);
  for (let day = minimumProjectionDays; day <= maximumProjectionDays; day += 1) {
    const priceFactor = dailyGrowthFactor ** day;
    const gross = (1 - TOB_RATE) * priceFactor;
    const gain = Math.max(0, (1 - TOB_RATE) * (priceFactor - 1));
    const net = applyCapitalGainsExemption && !applyReyndersTax && Number.isFinite(investmentAmount) && investmentAmount > 0
      ? estimateSingleInvestmentLiquidationValue(investmentAmount, 100, 100 * priceFactor, valuationDate, dateAfter(valuationDate, day), { applyCapitalGainsExemption }) / investmentAmount
      : gross * (1 - TOB_RATE) - gain * (applyReyndersTax ? REYNDERS_TAX_RATE : CGT_RATE);
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
 * @param {{ baseAnnualRatePercent?: number, fidelityPremiumPercent?: number, maximumProjectionDays?: number, applyReyndersTax?: boolean, applyCapitalGainsExemption?: boolean, investmentAmount?: number }} [options]
 */
export function buildCurrentRateEvolution(csh2AnnualRatePercent, overnightRatePercent, valuationDate, {
  baseAnnualRatePercent,
  fidelityPremiumPercent = 0,
  maximumProjectionDays = 365,
  applyReyndersTax = false,
  applyCapitalGainsExemption = false,
  investmentAmount
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
    const csh2 = applyCapitalGainsExemption && !applyReyndersTax && Number.isFinite(investmentAmount) && investmentAmount > 0
      ? estimateSingleInvestmentLiquidationValue(investmentAmount, 100, 100 * priceFactor, valuationDate, dateAfter(valuationDate, day), { applyCapitalGainsExemption }) / investmentAmount * 100
      : 100 * (gross * (1 - TOB_RATE) - gain * (applyReyndersTax ? REYNDERS_TAX_RATE : CGT_RATE));
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

function projectAccountReturnSeries(futurePremiums, valuationDate, throughDate, paidInterest, accruedBaseInterest, externalInflows, outflows, baseAnnualRatePercent) {
  const initialInterest = paidInterest + accruedBaseInterest;
  const baseRateIsAvailable = Number.isFinite(baseAnnualRatePercent) && baseAnnualRatePercent > -100;
  if (!baseRateIsAvailable) {
    const account = [{ date: valuationDate, value: (initialInterest / externalInflows) * 100 }];
    let projectedInterest = initialInterest;
    let premiumIndex = 0;
    while (premiumIndex < futurePremiums.length) {
      const earnedDate = futurePremiums[premiumIndex].earnedDate;
      while (premiumIndex < futurePremiums.length && futurePremiums[premiumIndex].earnedDate === earnedDate) {
        projectedInterest += futurePremiums[premiumIndex].finalPayoutAmount;
        premiumIndex += 1;
      }
      account.push({ date: earnedDate, value: (projectedInterest / externalInflows) * 100 });
    }
    return { account, baseRateIsAvailable };
  }

  const baseDailyGrowthFactor = (1 + baseAnnualRatePercent / 100) ** (1 / 365);
  const projectionDays = daysBetween(valuationDate, throughDate);
  const payoutByDate = new Map();
  for (const premium of futurePremiums) payoutByDate.set(premium.earnedDate, (payoutByDate.get(premium.earnedDate) ?? 0) + premium.finalPayoutAmount);
  let accountBalance = externalInflows - outflows + initialInterest;
  const account = [];
  for (let day = 0; day <= projectionDays; day += 1) {
    if (day) accountBalance *= baseDailyGrowthFactor;
    const date = dateAfter(valuationDate, day);
    accountBalance += payoutByDate.get(date) ?? 0;
    account.push({ date, value: ((accountBalance + outflows - externalInflows) / externalInflows) * 100 });
  }
  return { account, baseRateIsAvailable };
}

/**
 * Estimates holding periods from current €STR plus CSH2's fitted trailing excess return.
 * @param {Record<string, unknown>} prices
 * @param {Record<string, number>} rates
 * @param {string} valuationDate
 * @param {{ lookbackDays?: number, maximumProjectionDays?: number, applyReyndersTax?: boolean, applyCapitalGainsExemption?: boolean, investmentAmount?: number, currentRateModel?: ReturnType<typeof calculateCurrentRateModel> }} [options]
 */
export function estimateConstantRateHoldingPeriods(prices, rates, valuationDate, { lookbackDays = CURRENT_RATE_LOOKBACK_DAYS, maximumProjectionDays = 36525, applyReyndersTax = false, applyCapitalGainsExemption = false, investmentAmount, currentRateModel } = {}) {
  const model = currentRateModel ?? calculateCurrentRateModel(prices, rates, valuationDate, { lookbackDays });
  if (!model) return undefined;
  const matchOptions = { maximumProjectionDays, applyReyndersTax, applyCapitalGainsExemption, investmentAmount };
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

/** Projects the CSH2 and overnight lines through the last ongoing fidelity premium. */
export function buildMarketReturnProjection(flows, prices, rates, valuationDate, from, fidelityPremiums, options, { csh2AnnualRatePercent } = {}) {
  const futurePremiums = fidelityPremiums.filter((premium) => premium.earnedDate > valuationDate).toSorted((left, right) => left.earnedDate.localeCompare(right.earnedDate));
  if (!futurePremiums.length) return undefined;
  const throughDate = futurePremiums.at(-1).earnedDate;
  const projectionRate = projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent);
  if (!projectionRate) return undefined;
  const externalInflows = flows.filter((flow) => flow.type === 'inflow' && !flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
  if (!externalInflows) return undefined;
  const outflows = flows.filter((flow) => flow.type === 'outflow').reduce((sum, flow) => sum + flow.amount, 0);
  const projectionOptions = { ...options, accruedBaseInterest: 0 };
  const projectedPrices = { ...prices };
  const csh2 = [];
  const projectionDays = daysBetween(valuationDate, throughDate);
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
  const overnightDays = daysBetween(overnightPortfolio.latestDate, throughDate);
  for (let day = 1; day <= overnightDays; day += 1) {
    const date = dateAfter(overnightPortfolio.latestDate, day);
    overnightBalance *= overnightAccrualFactor(overnightPortfolio.latestRate, 1);
    overnight.push({ date, value: ((overnightBalance + overnightPortfolio.outflows - overnightPortfolio.inflows) / overnightPortfolio.inflows) * 100 });
  }

  return {
    csh2,
    overnight,
    throughDate,
    csh2AnnualRatePercent: projectionRate.csh2AnnualRatePercent,
    overnightRatePercent: overnightPortfolio.latestRate
  };
}

/** Projects only the savings-account line through the last ongoing fidelity premium. */
export function buildProjectedAccountReturnSeries(flows, valuationDate, fidelityPremiums, options, { baseAnnualRatePercent } = {}) {
  const futurePremiums = fidelityPremiums.filter((premium) => premium.earnedDate > valuationDate).toSorted((left, right) => left.earnedDate.localeCompare(right.earnedDate));
  if (!futurePremiums.length) return undefined;
  const throughDate = futurePremiums.at(-1).earnedDate;
  const externalInflows = flows.filter((flow) => flow.type === 'inflow' && !flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
  if (!externalInflows) return undefined;
  const outflows = flows.filter((flow) => flow.type === 'outflow').reduce((sum, flow) => sum + flow.amount, 0);
  const paidInterest = flows.filter((flow) => flow.type === 'inflow' && flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
  const { account, baseRateIsAvailable } = projectAccountReturnSeries(
    futurePremiums,
    valuationDate,
    throughDate,
    paidInterest,
    options.accruedBaseInterest ?? 0,
    externalInflows,
    outflows,
    baseAnnualRatePercent
  );
  return {
    account,
    throughDate,
    ...(baseRateIsAvailable ? { baseAnnualRatePercent } : {})
  };
}

/** Projects all cumulative-return lines through the last ongoing fidelity premium. */
export function buildReturnProjection(flows, prices, rates, valuationDate, from, fidelityPremiums, options, assumptions = {}) {
  const market = buildMarketReturnProjection(flows, prices, rates, valuationDate, from, fidelityPremiums, options, assumptions);
  const account = buildProjectedAccountReturnSeries(flows, valuationDate, fidelityPremiums, options, assumptions);
  if (!market || !account) return undefined;
  return { ...market, ...account };
}

/**
 * Compares one ongoing fidelity premium with moving its principal to CSH2 now and after vesting.
 * This is a mechanical comparison, not a price forecast.
 */
export function assessFidelityPremiumTiming(prices, valuationDate, options, premium, { csh2AnnualRatePercent, baseAnnualRatePercent, fidelityPremiumPercent, bestSavingsBaseAnnualRatePercent, bestSavingsFidelityPremiumPercent } = {}) {
  const { id, baseAmount, earnedDate, finalPayoutAmount } = premium;
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) throw new Error('Every fidelity premium needs a positive base amount.');
  if (!Number.isFinite(finalPayoutAmount) || finalPayoutAmount <= 0) throw new Error('Every fidelity premium needs a positive final payout amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earnedDate)) throw new Error('Every fidelity premium needs a valid earned date.');
  if (earnedDate <= valuationDate) throw new Error('Every fidelity premium earned date must be after the latest CSH2 valuation date.');
  if (!Number.isFinite(baseAnnualRatePercent) || baseAnnualRatePercent <= -100) throw new Error('Enter a valid account base annual rate before assessing fidelity premium timing.');
  const projectionRate = projectedCsh2Growth(prices, valuationDate, csh2AnnualRatePercent);
  if (!projectionRate) return undefined;
  const days = daysBetween(projectionRate.valuation.date, earnedDate);
  const projectedPrices = { ...prices, [earnedDate]: { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** days } };
  const scenarioOptions = { ...options, accruedBaseInterest: 0, buyWholeSharesOnly: false };
  const immediate = runBacktest([{ date: projectionRate.valuation.date, type: 'inflow', amount: baseAmount }], projectedPrices, earnedDate, scenarioOptions);
  const baseGrowthFactor = (1 + baseAnnualRatePercent / 100) ** (days / 365);
  const waitingValue = euro(baseAmount * baseGrowthFactor + finalPayoutAmount);
  const currentPeriodDifference = euro(immediate.netLiquidationValue - waitingValue);
  const bestSavingsRateIsValid = Number.isFinite(bestSavingsBaseAnnualRatePercent) && bestSavingsBaseAnnualRatePercent > -100 &&
    Number.isFinite(bestSavingsFidelityPremiumPercent) && bestSavingsFidelityPremiumPercent >= 0 && bestSavingsBaseAnnualRatePercent + bestSavingsFidelityPremiumPercent > -100;
  const bestAccountCurrentValue = bestSavingsRateIsValid
    ? euro(baseAmount * (1 + bestSavingsBaseAnnualRatePercent / 100) ** (days / 365))
    : undefined;
  const currentPeriodPreferred = bestAccountCurrentValue !== undefined && bestAccountCurrentValue > immediate.netLiquidationValue + 0.005 && bestAccountCurrentValue > waitingValue + 0.005
    ? 'move to best account'
    : currentPeriodDifference > 0.005 ? 'move now' : currentPeriodDifference < -0.005 ? 'wait' : 'either';
  let recommendation = currentPeriodPreferred === 'move now' ? 'move now' : currentPeriodPreferred === 'move to best account' ? 'move to best account' : currentPeriodPreferred === 'either' ? 'either' : 'wait, then reassess';
  let transferDate = currentPeriodPreferred === 'wait' ? dateAfter(earnedDate, 1) : undefined;
  let nextYearCsh2Value;
  let nextYearAccountValue;
  let nextYearBestAccountValue;
  if (currentPeriodPreferred === 'wait' && Number.isFinite(baseAnnualRatePercent) && baseAnnualRatePercent > -100 &&
      Number.isFinite(fidelityPremiumPercent) && fidelityPremiumPercent >= 0 && baseAnnualRatePercent + fidelityPremiumPercent > -100) {
    const nextEarnedDate = dateAfterCalendarYears(transferDate, 1);
    const transferDays = daysBetween(projectionRate.valuation.date, transferDate);
    const nextDays = daysBetween(projectionRate.valuation.date, nextEarnedDate);
    projectedPrices[transferDate] = { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** transferDays };
    projectedPrices[nextEarnedDate] = { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** nextDays };
    nextYearCsh2Value = runBacktest([{ date: transferDate, type: 'inflow', amount: baseAmount }], projectedPrices, nextEarnedDate, scenarioOptions).netLiquidationValue;
    nextYearAccountValue = euro(baseAmount * (1 + (baseAnnualRatePercent + fidelityPremiumPercent) / 100));
    nextYearBestAccountValue = bestSavingsRateIsValid ? euro(baseAmount * (1 + (bestSavingsBaseAnnualRatePercent + bestSavingsFidelityPremiumPercent) / 100)) : undefined;
    recommendation = nextYearCsh2Value > nextYearAccountValue + 0.005 && (nextYearBestAccountValue === undefined || nextYearCsh2Value > nextYearBestAccountValue + 0.005)
      ? 'move after payout'
      : nextYearBestAccountValue !== undefined && nextYearBestAccountValue > nextYearAccountValue + 0.005
        ? 'move to best account after payout'
        : 'keep in account';
  }
  return {
    id,
    baseAmount,
    earnedDate,
    finalPayoutAmount,
    csh2AnnualRatePercent: projectionRate.csh2AnnualRatePercent,
    immediateValue: immediate.netLiquidationValue,
    waitingValue,
    bestAccountCurrentValue,
    currentPeriodDifference,
    currentPeriodPreferred,
    recommendation,
    transferDate,
    nextYearCsh2Value,
    nextYearAccountValue,
    nextYearBestAccountValue
  };
}

function fidelityPeriodOn(premium, date) {
  let periodStartDate = dateAfterCalendarYears(premium.earnedDate, -1);
  let nextEarnedDate = premium.earnedDate;
  while (nextEarnedDate <= date) {
    periodStartDate = nextEarnedDate;
    nextEarnedDate = dateAfterCalendarYears(nextEarnedDate, 1);
  }
  return { periodStartDate, nextEarnedDate, daysAdvanced: daysBetween(periodStartDate, date) };
}

/** Orders ongoing periods as a regulated savings-account withdrawal would: least advanced first, then lowest premium rate. */
export function orderFidelityPremiumsForWithdrawal(fidelityPremiums, asOfDate) {
  return fidelityPremiums.toSorted((left, right) =>
    (asOfDate
      ? fidelityPeriodOn(left, asOfDate).daysAdvanced - fidelityPeriodOn(right, asOfDate).daysAdvanced
      : right.earnedDate.localeCompare(left.earnedDate)) ||
    (left.finalPayoutAmount / left.baseAmount) - (right.finalPayoutAmount / right.baseAmount));
}

/** Applies dated cash withdrawals to the tranches that legally supply them on each date. */
export function allocateFidelityWithdrawals(fidelityPremiums, withdrawals) {
  const remaining = fidelityPremiums.map((premium) => ({ ...premium, remainingAmount: euro(premium.baseAmount) }));
  const allocations = [];
  const chronological = withdrawals.map((withdrawal, index) => ({ ...withdrawal, index }))
    .toSorted((left, right) => left.date.localeCompare(right.date) || left.index - right.index);

  for (const withdrawal of chronological) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(withdrawal.date)) throw new Error('Every fidelity withdrawal needs a valid date.');
    if (!Number.isFinite(withdrawal.amount) || withdrawal.amount <= 0) throw new Error('Every fidelity withdrawal needs a positive amount.');
    let amountLeft = euro(withdrawal.amount);
    const available = euro(remaining.reduce((sum, tranche) => sum + tranche.remainingAmount, 0));
    if (amountLeft > available) throw new Error('A fidelity withdrawal cannot exceed the remaining account balance.');

    const ordered = orderFidelityPremiumsForWithdrawal(
      remaining.filter((tranche) => tranche.remainingAmount > 0),
      withdrawal.date
    );
    for (const tranche of ordered) {
      if (amountLeft <= 0) break;
      const amount = Math.min(amountLeft, tranche.remainingAmount);
      tranche.remainingAmount = euro(tranche.remainingAmount - amount);
      amountLeft = euro(amountLeft - amount);
      allocations.push({ withdrawalId: withdrawal.id, trancheId: tranche.id, date: withdrawal.date, amount });
    }
  }

  return { allocations, remaining };
}

/** Orders finished recommendations by their next action date, with indefinite keep decisions last. */
export function orderFidelityAssessmentsByRecommendation(assessments, valuationDate) {
  const actionDate = (assessment) => {
    if (assessment.recommendation === 'move now' || assessment.recommendation === 'move to best account' || assessment.recommendation === 'either') return valuationDate;
    if (assessment.recommendation === 'move after payout' || assessment.recommendation === 'move to best account after payout') return assessment.transferDate;
    if (assessment.recommendation === 'wait, then reassess') return assessment.transferDate;
    return '9999-12-31';
  };
  return assessments.toSorted((left, right) =>
    actionDate(left).localeCompare(actionDate(right)) ||
    right.earnedDate.localeCompare(left.earnedDate) ||
    (left.finalPayoutAmount / left.baseAmount) - (right.finalPayoutAmount / right.baseAmount));
}

/** Assesses all premiums and combines principals that would be purchased in CSH2 on the same day. */
export function assessFidelityPremiumTimings(prices, valuationDate, options, fidelityPremiums, projection = {}) {
  const assessments = orderFidelityPremiumsForWithdrawal(fidelityPremiums)
    .map((premium) => assessFidelityPremiumTiming(prices, valuationDate, options, premium, projection))
    .filter(Boolean)
    .map((assessment) => ({ ...assessment, transferAllocations: [] }));
  const projectionRate = projectedCsh2Growth(prices, valuationDate, projection.csh2AnnualRatePercent);
  if (!projectionRate) return assessments;
  const scenarioOptions = { ...options, accruedBaseInterest: 0, buyWholeSharesOnly: false };
  const immediateGroup = assessments.filter((assessment) => assessment.recommendation === 'move now');
  if (immediateGroup.length > 1) {
    const combinedBaseAmount = immediateGroup.reduce((sum, assessment) => sum + assessment.baseAmount, 0);
    for (const assessment of immediateGroup) {
      const days = daysBetween(projectionRate.valuation.date, assessment.earnedDate);
      const projectedPrices = { ...prices, [assessment.earnedDate]: { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** days } };
      const combined = runBacktest([{ date: projectionRate.valuation.date, type: 'inflow', amount: combinedBaseAmount }], projectedPrices, assessment.earnedDate, scenarioOptions);
      assessment.immediateValue = euro(combined.netLiquidationValue * assessment.baseAmount / combinedBaseAmount);
      assessment.currentPeriodDifference = euro(assessment.immediateValue - assessment.waitingValue);
      assessment.currentPeriodPreferred = assessment.currentPeriodDifference > 0.005 ? 'move now' : assessment.currentPeriodDifference < -0.005 ? 'wait' : 'either';
      assessment.recommendation = assessment.currentPeriodPreferred === 'move now' ? 'move now' : assessment.currentPeriodPreferred === 'wait' ? 'wait, then reassess' : 'either';
    }
  }

  const acceptedImmediate = immediateGroup.filter((assessment) => assessment.recommendation === 'move now');
  if (acceptedImmediate.length > 1) for (const assessment of acceptedImmediate) assessment.purchaseGroupSize = acceptedImmediate.length;
  const acceptedFlows = acceptedImmediate.length
    ? [{ date: projectionRate.valuation.date, type: 'inflow', amount: acceptedImmediate.reduce((sum, assessment) => sum + assessment.baseAmount, 0) }]
    : [];
  const futureGroups = [...Map.groupBy(
    assessments.filter((assessment) => assessment.currentPeriodPreferred === 'wait' && assessment.transferDate && assessment.nextYearAccountValue !== undefined),
    (assessment) => assessment.transferDate
  )].toSorted(([left], [right]) => left.localeCompare(right));

  for (const [transferDate, group] of futureGroups) {
    const combinedBaseAmount = group.reduce((sum, assessment) => sum + assessment.baseAmount, 0);
    const nextEarnedDate = dateAfterCalendarYears(transferDate, 1);
    const projectedPrices = { ...prices };
    for (const date of [...acceptedFlows.map((flow) => flow.date), transferDate, nextEarnedDate]) {
      const days = daysBetween(projectionRate.valuation.date, date);
      projectedPrices[date] = { close: projectionRate.valuation.price * projectionRate.dailyGrowthFactor ** days };
    }
    const priorPlanValue = runBacktest(acceptedFlows, projectedPrices, nextEarnedDate, scenarioOptions).netLiquidationValue;
    const candidateFlow = { date: transferDate, type: 'inflow', amount: combinedBaseAmount };
    const candidatePlanValue = runBacktest([...acceptedFlows, candidateFlow], projectedPrices, nextEarnedDate, scenarioOptions).netLiquidationValue;
    const marginalCsh2Value = euro(candidatePlanValue - priorPlanValue);
    const combinedAccountValue = group.reduce((sum, assessment) => sum + assessment.nextYearAccountValue, 0);
    const combinedBestAccountValue = group.every((assessment) => assessment.nextYearBestAccountValue !== undefined)
      ? group.reduce((sum, assessment) => sum + assessment.nextYearBestAccountValue, 0)
      : undefined;
    const recommendation = marginalCsh2Value > combinedAccountValue + 0.005 &&
      (combinedBestAccountValue === undefined || marginalCsh2Value > combinedBestAccountValue + 0.005)
      ? 'move after payout'
      : combinedBestAccountValue !== undefined && combinedBestAccountValue > combinedAccountValue + 0.005
        ? 'move to best account after payout'
        : 'keep in account';
    for (const assessment of group) {
      assessment.nextYearCsh2Value = euro(marginalCsh2Value * assessment.baseAmount / combinedBaseAmount);
      assessment.recommendation = recommendation;
      if (recommendation === 'move after payout') assessment.purchaseGroupSize = group.length;
    }
    if (recommendation === 'move after payout') acceptedFlows.push(candidateFlow);
  }

  const withdrawals = assessments.flatMap((assessment) => {
    if (assessment.recommendation === 'move now') {
      return [{ id: assessment.id, date: projectionRate.valuation.date, amount: assessment.baseAmount }];
    }
    if (assessment.recommendation === 'move after payout' && assessment.transferDate) {
      return [{ id: assessment.id, date: assessment.transferDate, amount: assessment.baseAmount }];
    }
    return [];
  });
  const { allocations } = allocateFidelityWithdrawals(fidelityPremiums, withdrawals);
  for (const assessment of assessments) {
    assessment.transferAllocations = allocations
      .filter((allocation) => allocation.trancheId === assessment.id)
      .map(({ date, amount }) => ({ date, amount }));
  }
  return orderFidelityAssessmentsByRecommendation(assessments, valuationDate);
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
