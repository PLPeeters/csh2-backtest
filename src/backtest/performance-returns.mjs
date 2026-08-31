import { isUsableClose } from './quotes.mjs';
import { dateAfter, daysBetween, overnightAccrualFactor } from './shared.mjs';
import { runBacktest } from './simulation.mjs';
import { deflateCashFlowsToDate, deflateCumulativeReturnSeries, realAnnualizedReturn } from './inflation.mjs';

const CASH_FLOW_EPSILON = 1e-8;
const MINIMUM_XIRR_RATE = -0.999999;
const MAXIMUM_XIRR_RATE = 1_000_000;
const XIRR_SEARCH_SAMPLES = 8_192;
const XIRR_ITERATIONS = 120;

function distinctRoots(roots) {
  return roots.toSorted((left, right) => left - right).filter((root, index, sorted) => {
    if (!index) return true;
    return Math.abs(root - sorted[index - 1]) > 1e-8 * Math.max(1, Math.abs(root));
  });
}

/** Calculates an annualized money-weighted return (XIRR) for dated investor cash flows. */
export function calculateMoneyWeightedReturn(cashFlows) {
  const flows = cashFlows
    .filter((flow) => flow.date && Number.isFinite(flow.amount) && Math.abs(flow.amount) > CASH_FLOW_EPSILON)
    .toSorted((left, right) => left.date.localeCompare(right.date));
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return undefined;
  const start = flows[0].date;
  if (flows.at(-1).date === start) return undefined;

  const netPresentValue = (rate) => flows.reduce((sum, flow) => sum + flow.amount / ((1 + rate) ** (daysBetween(start, flow.date) / 365)), 0);
  const valueTolerance = flows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0) * 1e-12;
  const minimumLogRate = Math.log1p(MINIMUM_XIRR_RATE);
  const maximumLogRate = Math.log1p(MAXIMUM_XIRR_RATE);
  const sampledRates = [0];
  for (let index = 0; index <= XIRR_SEARCH_SAMPLES; index += 1) {
    const logRate = minimumLogRate + ((maximumLogRate - minimumLogRate) * index) / XIRR_SEARCH_SAMPLES;
    sampledRates.push(Math.expm1(logRate));
  }
  sampledRates.sort((left, right) => left - right);

  const roots = [];
  let previousRate;
  let previousValue;
  for (const rate of sampledRates) {
    const value = netPresentValue(rate);
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value) <= valueTolerance) roots.push(rate);
    if (previousRate !== undefined && previousValue !== undefined && Math.abs(previousValue) > valueTolerance && Math.abs(value) > valueTolerance && Math.sign(previousValue) !== Math.sign(value)) {
      let low = previousRate;
      let high = rate;
      let lowValue = previousValue;
      for (let iteration = 0; iteration < XIRR_ITERATIONS; iteration += 1) {
        const middle = (low + high) / 2;
        const middleValue = netPresentValue(middle);
        if (Math.abs(middleValue) <= valueTolerance) { low = middle; high = middle; break; }
        if (Math.sign(lowValue) !== Math.sign(middleValue)) high = middle;
        else { low = middle; lowValue = middleValue; }
      }
      roots.push((low + high) / 2);
    }
    previousRate = rate;
    previousValue = value;
  }
  const uniqueRoots = distinctRoots(roots);
  return uniqueRoots.length === 1 ? uniqueRoots[0] * 100 : undefined;
}

/** Calculates XIRR after expressing every cash flow in valuation-date purchasing power. */
export function calculateRealMoneyWeightedReturn(cashFlows, valuationDate, cpiIndices) {
  const adjusted = deflateCashFlowsToDate(cashFlows, valuationDate, cpiIndices);
  return adjusted ? calculateMoneyWeightedReturn(adjusted) : undefined;
}

function csh2TimeWeightedPerformance(flows, prices, valuationDate, options) {
  const portfolioFlows = flows
    .filter((flow) => flow.date <= valuationDate)
    .toSorted((left, right) => left.date.localeCompare(right.date));
  const fullSimulation = runBacktest(portfolioFlows, prices, valuationDate, options);
  const firstPurchase = fullSimulation.entries.find((entry) => !entry.interestPayment && entry.type === 'inflow' && entry.units > 0);
  if (!firstPurchase) return { snapshots: [], factor: undefined, firstFundedDate: undefined, valuationDate: undefined };

  const effectiveValuation = fullSimulation.valuation.date;
  const eventDates = new Set(portfolioFlows.filter((flow) => flow.date >= firstPurchase.date).map((flow) => flow.date));
  for (const [date, record] of Object.entries(prices)) {
    if (date >= firstPurchase.date && date <= effectiveValuation && !record?.isFallback && isUsableClose(record)) eventDates.add(date);
  }
  eventDates.add(effectiveValuation);

  const snapshots = [];
  const processedFlows = [];
  let flowIndex = 0;
  let factor = 1;
  let previousValue = 0;
  let hasFundedPortfolio = false;
  for (const date of [...eventDates].filter((date) => date <= effectiveValuation).sort()) {
    let valueBeforeFlows = processedFlows.length ? runBacktest(processedFlows, prices, date, options).netLiquidationValue : 0;
    if (previousValue > CASH_FLOW_EPSILON) factor *= valueBeforeFlows / previousValue;

    while (flowIndex < portfolioFlows.length && portfolioFlows[flowIndex].date <= date) {
      const flow = portfolioFlows[flowIndex];
      if (flow.interestPayment) {
        processedFlows.push(flow);
        valueBeforeFlows = runBacktest(processedFlows, prices, date, options).netLiquidationValue;
        flowIndex += 1;
        continue;
      }
      const externalFlow = flow.type === 'inflow' ? flow.amount : -flow.amount;
      const adjustedStartingValue = valueBeforeFlows + externalFlow;
      processedFlows.push(flow);
      const valueAfterFlow = runBacktest(processedFlows, prices, date, options).netLiquidationValue;
      if (adjustedStartingValue > CASH_FLOW_EPSILON) factor *= valueAfterFlow / adjustedStartingValue;
      else if (valueAfterFlow > CASH_FLOW_EPSILON) return { snapshots: [], factor: undefined, firstFundedDate: firstPurchase.date, valuationDate: effectiveValuation };
      valueBeforeFlows = valueAfterFlow;
      hasFundedPortfolio ||= flow.type === 'inflow';
      flowIndex += 1;
    }
    previousValue = valueBeforeFlows;
    if (hasFundedPortfolio && Number.isFinite(factor) && factor >= 0) snapshots.push({ date, value: (factor - 1) * 100 });
  }
  return { snapshots, factor, firstFundedDate: firstPurchase.date, valuationDate: effectiveValuation };
}

/** Builds CSH2 portfolio TWR by geometrically linking returns around every external cash flow. */
export function buildCsh2TimeWeightedReturnSeries(flows, prices, valuationDate, options = {}) {
  const performance = csh2TimeWeightedPerformance(flows, prices, valuationDate, options);
  return options.cpiIndices && performance.firstFundedDate
    ? deflateCumulativeReturnSeries(performance.snapshots, performance.firstFundedDate, options.cpiIndices)
    : performance.snapshots;
}

/** Calculates annualized CSH2 portfolio TWR from geometrically linked sub-period returns. */
export function calculateCsh2TimeWeightedReturn(flows, prices, valuationDate, options = {}) {
  const performance = csh2TimeWeightedPerformance(flows, prices, valuationDate, options);
  if (!Number.isFinite(performance.factor) || performance.factor < 0 || !performance.firstFundedDate || !performance.valuationDate) return undefined;
  const days = daysBetween(performance.firstFundedDate, performance.valuationDate);
  if (days <= 0) return undefined;
  return options.cpiIndices
    ? realAnnualizedReturn(performance.factor, performance.firstFundedDate, performance.valuationDate, options.cpiIndices)
    : (performance.factor ** (365 / days) - 1) * 100;
}

function accountTimeWeightedPerformance(flows, valuationDate, accruedBaseInterest) {
  const datedFlows = flows
    .filter((flow) => flow.date <= valuationDate && Number.isFinite(flow.amount) && flow.amount > 0)
    .toSorted((left, right) => left.date.localeCompare(right.date));
  const snapshots = [];
  let balance = 0;
  let factor = 1;
  let firstFundedDate;
  let index = 0;
  while (index < datedFlows.length) {
    const date = datedFlows[index].date;
    let externalNet = 0;
    let creditedInterest = 0;
    while (index < datedFlows.length && datedFlows[index].date === date) {
      const flow = datedFlows[index];
      if (flow.interestPayment) creditedInterest += flow.amount;
      else externalNet += flow.type === 'inflow' ? flow.amount : -flow.amount;
      index += 1;
    }
    if (creditedInterest) {
      if (balance <= CASH_FLOW_EPSILON) return { snapshots: [], factor: undefined, firstFundedDate };
      factor *= 1 + creditedInterest / balance;
      balance += creditedInterest;
    }
    balance += externalNet;
    if (!firstFundedDate && balance > CASH_FLOW_EPSILON) firstFundedDate = date;
    if (firstFundedDate) snapshots.push({ date, value: (factor - 1) * 100 });
  }
  if (!firstFundedDate) return { snapshots: [], factor: undefined, firstFundedDate: undefined };
  if (accruedBaseInterest) {
    if (balance <= CASH_FLOW_EPSILON) return { snapshots: [], factor: undefined, firstFundedDate };
    factor *= 1 + accruedBaseInterest / balance;
  }
  const valuationPoint = { date: valuationDate, value: (factor - 1) * 100 };
  if (snapshots.at(-1)?.date === valuationDate) snapshots[snapshots.length - 1] = valuationPoint;
  else snapshots.push(valuationPoint);
  return { snapshots, factor, firstFundedDate };
}

/** Builds account TWR from credited and accrued interest, neutralizing external cash flows. */
export function buildAccountTimeWeightedReturnSeries(flows, valuationDate, options = {}) {
  const { accruedBaseInterest = 0 } = options;
  const performance = accountTimeWeightedPerformance(flows, valuationDate, accruedBaseInterest);
  return options.cpiIndices && performance.firstFundedDate
    ? deflateCumulativeReturnSeries(performance.snapshots, performance.firstFundedDate, options.cpiIndices)
    : performance.snapshots;
}

/** Calculates annualized account TWR from credited and accrued interest. */
export function calculateAccountTimeWeightedReturn(flows, valuationDate, options = {}) {
  const { accruedBaseInterest = 0 } = options;
  const performance = accountTimeWeightedPerformance(flows, valuationDate, accruedBaseInterest);
  if (!Number.isFinite(performance.factor) || performance.factor < 0 || !performance.firstFundedDate) return undefined;
  const days = daysBetween(performance.firstFundedDate, valuationDate);
  if (days <= 0) return undefined;
  return options.cpiIndices
    ? realAnnualizedReturn(performance.factor, performance.firstFundedDate, valuationDate, options.cpiIndices)
    : (performance.factor ** (365 / days) - 1) * 100;
}

function latestRateAtOrBefore(rates, date) {
  return Object.entries(rates ?? {})
    .filter(([rateDate, rate]) => rateDate <= date && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right))
    .at(-1)?.[1];
}

function latestPointAtOrBefore(points, date) {
  return points.filter((point) => point.date <= date).toSorted((left, right) => left.date.localeCompare(right.date)).at(-1);
}

function projectedBalance(point, inflows, outflows) {
  return inflows * (1 + point.value / 100) - outflows;
}

/**
 * Extends observed cash-flow-neutral returns through a value projection.
 * The market and account projections are balances expressed as cumulative
 * return points, so each is converted to a balance ratio and seeded from its
 * corresponding observed TWR endpoint. €STR is compounded independently from
 * the latest known rate because its observed series has no portfolio flows.
 */
export function buildTimeWeightedReturnProjection(observed, projection, rates, valuationDate, {
  externalInflows,
  outflows,
  cpiIndices
} = {}) {
  if (!projection || !Number.isFinite(projection.csh2AnnualRatePercent) || !Number.isFinite(externalInflows) || externalInflows <= 0 || !Number.isFinite(outflows) || !valuationDate) return undefined;
  const throughDate = projection.throughDate;
  const validDate = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
  if (!validDate(valuationDate) || !validDate(throughDate) || throughDate <= valuationDate || !Array.isArray(projection.csh2) || !projection.csh2.length || !Array.isArray(projection.account) || !projection.account.length) return undefined;
  const observedCsh2 = latestPointAtOrBefore(observed?.csh2 ?? [], valuationDate);
  const observedOvernight = latestPointAtOrBefore(observed?.overnight ?? [], valuationDate);
  const observedAccount = latestPointAtOrBefore(observed?.account ?? [], valuationDate);
  if (!observedCsh2 || !observedOvernight || !observedAccount) return undefined;

  const projectBalanceSeries = (observedPoint, projectedPoints) => {
    const points = projectedPoints
      .filter((point) => validDate(point?.date) && point.date >= valuationDate && point.date <= throughDate && Number.isFinite(point.value))
      .toSorted((left, right) => left.date.localeCompare(right.date));
    if (points[0]?.date !== valuationDate) return [];
    const observedFactor = 1 + observedPoint.value / 100;
    const valuationBalance = projectedBalance(points[0], externalInflows, outflows);
    if (!Number.isFinite(observedFactor) || observedFactor < 0 || !Number.isFinite(valuationBalance) || valuationBalance <= CASH_FLOW_EPSILON) return [];
    return points.map((point) => {
      const balance = projectedBalance(point, externalInflows, outflows);
      if (!Number.isFinite(balance) || balance <= CASH_FLOW_EPSILON) return undefined;
      return { date: point.date, value: (observedFactor * balance / valuationBalance - 1) * 100 };
    }).filter(Boolean);
  };

  const csh2 = projectBalanceSeries(observedCsh2, projection.csh2 ?? []);
  const account = projectBalanceSeries(observedAccount, projection.account ?? []);
  if (!csh2.length || !account.length || csh2.at(-1).date !== throughDate || account.at(-1).date !== throughDate) return undefined;
  const rate = latestRateAtOrBefore(rates, valuationDate);
  if (!Number.isFinite(rate) || overnightAccrualFactor(rate, 1) <= 0) return undefined;
  const overnightFactor = 1 + observedOvernight.value / 100;
  if (!Number.isFinite(overnightFactor) || overnightFactor < 0) return undefined;
  const overnight = [{ date: valuationDate, value: (overnightFactor - 1) * 100 }];
  let factor = overnightFactor;
  for (let day = 1; day <= daysBetween(valuationDate, throughDate); day += 1) {
    factor *= overnightAccrualFactor(rate, 1);
    overnight.push({ date: dateAfter(valuationDate, day), value: (factor - 1) * 100 });
  }
  const nominal = {
    csh2,
    overnight,
    account,
    throughDate,
    csh2AnnualRatePercent: projection.csh2AnnualRatePercent,
    overnightRatePercent: rate,
    ...(Number.isFinite(projection.baseAnnualRatePercent) ? { baseAnnualRatePercent: projection.baseAnnualRatePercent } : {})
  };
  if (!cpiIndices) return nominal;
  const deflate = (history, points) => {
    const historical = history.filter((point) => point.date <= valuationDate).toSorted((left, right) => left.date.localeCompare(right.date));
    const from = historical[0]?.date;
    if (!from) return [];
    const continuation = [...historical, ...points.filter((point) => point.date > valuationDate)];
    return deflateCumulativeReturnSeries(continuation, from, cpiIndices).filter((point) => point.date >= valuationDate);
  };
  return {
    ...nominal,
    csh2: deflate(observed?.csh2 ?? [], csh2),
    overnight: deflate(observed?.overnight ?? [], overnight),
    account: deflate(observed?.account ?? [], account)
  };
}
