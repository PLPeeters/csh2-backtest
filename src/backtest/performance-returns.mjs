import { isUsableClose } from './quotes.mjs';
import { daysBetween } from './shared.mjs';
import { runBacktest } from './simulation.mjs';

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
  return csh2TimeWeightedPerformance(flows, prices, valuationDate, options).snapshots;
}

/** Calculates annualized CSH2 portfolio TWR from geometrically linked sub-period returns. */
export function calculateCsh2TimeWeightedReturn(flows, prices, valuationDate, options = {}) {
  const performance = csh2TimeWeightedPerformance(flows, prices, valuationDate, options);
  if (!Number.isFinite(performance.factor) || performance.factor < 0 || !performance.firstFundedDate || !performance.valuationDate) return undefined;
  const days = daysBetween(performance.firstFundedDate, performance.valuationDate);
  if (days <= 0) return undefined;
  return (performance.factor ** (365 / days) - 1) * 100;
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
export function buildAccountTimeWeightedReturnSeries(flows, valuationDate, { accruedBaseInterest = 0 } = {}) {
  return accountTimeWeightedPerformance(flows, valuationDate, accruedBaseInterest).snapshots;
}

/** Calculates annualized account TWR from credited and accrued interest. */
export function calculateAccountTimeWeightedReturn(flows, valuationDate, { accruedBaseInterest = 0 } = {}) {
  const performance = accountTimeWeightedPerformance(flows, valuationDate, accruedBaseInterest);
  if (!Number.isFinite(performance.factor) || performance.factor < 0 || !performance.firstFundedDate) return undefined;
  const days = daysBetween(performance.firstFundedDate, valuationDate);
  if (days <= 0) return undefined;
  return (performance.factor ** (365 / days) - 1) * 100;
}
