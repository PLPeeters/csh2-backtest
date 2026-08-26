import { CGT_EXEMPTION_START_YEAR, CGT_RATE, dateAfter, daysBetween, overnightAccrualFactor, REYNDERS_TAX_RATE, TOB_RATE } from './shared.mjs';
import { isUsableClose, priceValue } from './quotes.mjs';
import { runBacktest } from './simulation.mjs';
import { estimateSingleInvestmentLiquidationValue } from './taxation.mjs';

/** Builds the CSH2 net-return chart from each real price date after the first inflow. */
export function buildBacktestReturnSeries(flows, prices, options) {
  const dates = Object.entries(prices).filter(([, price]) => !price?.isFallback).map(([date]) => date);
  const snapshots = [];
  for (const date of dates) {
    const completedFlows = flows.filter((flow) => flow.date <= date);
    const inflows = completedFlows.filter((flow) => flow.type === 'inflow' && !flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0);
    if (!inflows) continue;
    const outflows = completedFlows.filter((flow) => flow.type === 'outflow').reduce((sum, flow) => sum + flow.amount, 0);
    const result = runBacktest(completedFlows, prices, date, options);
    if (!result.entries.some((entry) => entry.type === 'inflow' && entry.units > 0)) continue;
    snapshots.push({ date, value: ((result.netLiquidationValue + outflows - inflows) / inflows) * 100 });
  }
  return snapshots;
}

/** Reconstructs the actual account return from external inflows and identified interest payments. */
export function buildAccountReturnSeries(flows, valuationDate, { accruedBaseInterest = 0 } = {}) {
  const datedFlows = flows
    .filter((flow) => flow.date <= valuationDate)
    .toSorted((left, right) => left.date.localeCompare(right.date));
  const snapshots = [];
  let inflows = 0;
  let paidInterest = 0;
  let index = 0;
  while (index < datedFlows.length) {
    const date = datedFlows[index].date;
    while (index < datedFlows.length && datedFlows[index].date === date) {
      const flow = datedFlows[index];
      if (flow.type === 'inflow' && flow.interestPayment) paidInterest += flow.amount;
      else if (flow.type === 'inflow') inflows += flow.amount;
      index += 1;
    }
    if (inflows) snapshots.push({ date, value: (paidInterest / inflows) * 100 });
  }
  if (!inflows) return [];
  const valuationPoint = { date: valuationDate, value: ((paidInterest + accruedBaseInterest) / inflows) * 100 };
  if (snapshots.at(-1)?.date === valuationDate) snapshots[snapshots.length - 1] = valuationPoint;
  else snapshots.push(valuationPoint);
  return snapshots;
}

function priceRatio(from, to) {
  return to.value / from.value;
}

function trailingAnnualizedReturnSeries(points, from, lookbackDays, periodRatio = priceRatio) {
  let priorIndex = 0;
  return points.map((point, index) => {
    if (point.date < from) return undefined;
    while (priorIndex + 1 < index && daysBetween(points[priorIndex + 1].date, point.date) >= lookbackDays) priorIndex += 1;
    const prior = points[priorIndex];
    if (priorIndex >= index || daysBetween(prior.date, point.date) < lookbackDays) return undefined;
    const days = daysBetween(prior.date, point.date);
    return { date: point.date, value: (periodRatio(prior, point) ** (365 / days) - 1) * 100 };
  }).filter(Boolean);
}

function forwardAnnualizedReturnSeries(points, from, lookbackDays, periodRatio = priceRatio) {
  let futureIndex = 1;
  return points.map((point, index) => {
    if (point.date < from) return undefined;
    futureIndex = Math.max(futureIndex, index + 1);
    while (futureIndex < points.length && daysBetween(point.date, points[futureIndex].date) < lookbackDays) futureIndex += 1;
    const future = points[futureIndex];
    if (!future) return undefined;
    const days = daysBetween(point.date, future.date);
    return { date: point.date, value: (periodRatio(point, future) ** (365 / days) - 1) * 100 };
  }).filter(Boolean);
}

function csh2AfterTaxRatio(prices, { applyReyndersTax = false, applyCapitalGainsExemption = false, investmentAmount } = {}) {
  const yearEnd2025Price = Object.entries(prices)
    .filter(([date, record]) => date <= '2025-12-31' && !record?.isFallback && isUsableClose(record))
    .sort(([left], [right]) => right.localeCompare(left))[0];
  return (purchase, sale) => {
    if (applyCapitalGainsExemption && Number.isFinite(investmentAmount) && investmentAmount > 0) {
      return estimateSingleInvestmentLiquidationValue(investmentAmount, purchase.value, sale.value, purchase.date, sale.date, {
        applyCapitalGainsExemption,
        applyReyndersTax,
        yearEnd2025Price: yearEnd2025Price ? priceValue(yearEnd2025Price[1], 'close') : undefined
      }) / investmentAmount;
    }
    const units = (1 - TOB_RATE) / purchase.value;
    const gross = units * sale.value;
    const saleYear = Number(sale.date.slice(0, 4));
    const taxBasis = !applyReyndersTax && saleYear >= CGT_EXEMPTION_START_YEAR && purchase.date < `${CGT_EXEMPTION_START_YEAR}-01-01` && yearEnd2025Price
      ? Math.max(purchase.value, priceValue(yearEnd2025Price[1], 'close'))
      : purchase.value;
    const taxableGain = Math.max(0, (sale.value - taxBasis) * units);
    const gainTax = applyReyndersTax
      ? taxableGain * REYNDERS_TAX_RATE
      : saleYear >= CGT_EXEMPTION_START_YEAR ? taxableGain * CGT_RATE : 0;
    return gross - (gross * TOB_RATE) - gainTax;
  };
}

/**
 * Converts a gross annual CSH2 estimate into the net annual return of a
 * one-year buy-and-sell holding period. It deliberately uses the same
 * transaction-tax and gain-tax treatment as the annualized return charts.
 */
export function estimateAnnualizedAfterTaxCsh2Rate(grossAnnualRatePercent, purchaseDate, options = {}) {
  if (!Number.isFinite(grossAnnualRatePercent) || grossAnnualRatePercent <= -100 || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return undefined;
  const saleDate = dateAfter(purchaseDate, 365);
  const purchase = { date: purchaseDate, value: 100 };
  const sale = { date: saleDate, value: 100 * (1 + grossAnnualRatePercent / 100) };
  const netFactor = csh2AfterTaxRatio({}, options)(purchase, sale);
  return (netFactor ** (365 / daysBetween(purchaseDate, saleDate)) - 1) * 100;
}

export function buildTrailingAnnualizedCsh2ReturnSeries(prices, from, to, { lookbackDays = 90, afterTax = false, ...taxOptions } = {}) {
  const points = Object.entries(prices)
    .filter(([date, record]) => date <= to && !record?.isFallback && isUsableClose(record))
    .map(([date, record]) => ({ date, value: priceValue(record, 'close') }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return trailingAnnualizedReturnSeries(points, from, lookbackDays, afterTax ? csh2AfterTaxRatio(prices, taxOptions) : priceRatio);
}

export function buildForwardAnnualizedCsh2ReturnSeries(prices, from, to, { lookbackDays = 365, afterTax = false, ...taxOptions } = {}) {
  const points = Object.entries(prices)
    .filter(([date, record]) => date <= to && !record?.isFallback && isUsableClose(record))
    .map(([date, record]) => ({ date, value: priceValue(record, 'close') }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return forwardAnnualizedReturnSeries(points, from, lookbackDays, afterTax ? csh2AfterTaxRatio(prices, taxOptions) : priceRatio);
}

export function buildTrailingAnnualizedOvernightBenchmarkReturnSeries(rates, from, to, { lookbackDays = 90 } = {}) {
  let value = 1;
  let previousDate;
  let previousRate;
  const points = Object.entries(rates)
    .filter(([date, rate]) => date <= to && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, rate]) => {
      if (previousDate) value *= overnightAccrualFactor(previousRate, daysBetween(previousDate, date));
      previousDate = date;
      previousRate = rate;
      return { date, value };
    });
  return trailingAnnualizedReturnSeries(points, from, lookbackDays);
}

export function buildForwardAnnualizedOvernightBenchmarkReturnSeries(rates, from, to, { lookbackDays = 365 } = {}) {
  let value = 1;
  let previousDate;
  let previousRate;
  const points = Object.entries(rates)
    .filter(([date, rate]) => date <= to && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, rate]) => {
      if (previousDate) value *= overnightAccrualFactor(previousRate, daysBetween(previousDate, date));
      previousDate = date;
      previousRate = rate;
      return { date, value };
    });
  return forwardAnnualizedReturnSeries(points, from, lookbackDays);
}

function benchmarkFlowsWithoutResidualCash(flows, prices, valuationDate, options) {
  const { entries } = runBacktest(flows, prices, valuationDate, options);
  let priorCash = 0;
  return entries.filter((entry) => !entry.interestPayment).map((entry) => {
    const cashChange = entry.remainingCash - priorCash;
    priorCash = entry.remainingCash;
    return {
      date: entry.date,
      type: entry.type,
      amount: entry.type === 'inflow' ? entry.amount - cashChange : entry.amount + cashChange
    };
  }).filter((flow) => flow.amount > 0.00000001);
}

/** Mirrors invested CSH2 cash flows while deliberately excluding uninvested whole-share residual cash. */
export function calculateOvernightBenchmarkPortfolio(flows, prices, rates, valuationDate, from, to, options) {
  const scheduledFlows = benchmarkFlowsWithoutResidualCash(flows, prices, valuationDate, options).sort((left, right) => left.date.localeCompare(right.date));
  const rateEntries = Object.entries(rates)
    .filter(([date, rate]) => date <= to && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right));
  const ratesByDate = new Map(rateEntries);
  const eventDates = new Set([from, to]);
  for (const [date] of rateEntries) if (date >= from) eventDates.add(date);
  for (const [date, record] of Object.entries(prices)) if (date >= from && date <= to && !record?.isFallback) eventDates.add(date);
  for (const flow of scheduledFlows) if (flow.date >= from && flow.date <= to) eventDates.add(flow.date);
  const snapshots = [];
  let flowIndex = 0;
  let balance = 0;
  let inflows = 0;
  let outflows = 0;
  let latestRate = rateEntries.filter(([date]) => date <= from).at(-1)?.[1];
  let latestDate;
  let previousDate = from;
  for (const date of [...eventDates].sort()) {
    if (date > previousDate && Number.isFinite(latestRate)) balance *= overnightAccrualFactor(latestRate, daysBetween(previousDate, date));
    if (ratesByDate.has(date)) latestRate = ratesByDate.get(date);
    while (flowIndex < scheduledFlows.length && scheduledFlows[flowIndex].date <= date) {
      const flow = scheduledFlows[flowIndex];
      if (flow.type === 'inflow') {
        balance += flow.amount;
        inflows += flow.amount;
      } else {
        balance -= flow.amount;
        outflows += flow.amount;
      }
      flowIndex += 1;
    }
    if (inflows) snapshots.push({ date, value: ((balance + outflows - inflows) / inflows) * 100 });
    if (Number.isFinite(latestRate)) latestDate = date;
    previousDate = date;
  }
  return { snapshots, balance, inflows, outflows, latestRate, latestDate };
}

/** Mirrors invested CSH2 cash flows while deliberately excluding uninvested whole-share residual cash. */
export function buildOvernightBenchmarkReturnSeries(flows, prices, rates, valuationDate, from, to, options) {
  return calculateOvernightBenchmarkPortfolio(flows, prices, rates, valuationDate, from, to, options).snapshots;
}

/** Finds when an actual taxed CSH2 backtest first breaks even and catches its overnight benchmark. */
export function findObservedHoldingPeriods(csh2, overnight, from) {
  let breakEven;
  let matchOvernight;
  let overnightIndex = -1;
  for (const point of csh2) {
    if (!breakEven && point.value >= 0) breakEven = { date: point.date, days: daysBetween(from, point.date) };
    while (overnightIndex + 1 < overnight.length && overnight[overnightIndex + 1].date <= point.date) overnightIndex += 1;
    const benchmark = overnight[overnightIndex];
    if (!matchOvernight && benchmark && point.value >= benchmark.value) {
      matchOvernight = { date: point.date, days: daysBetween(from, point.date) };
    }
    if (breakEven && matchOvernight) break;
  }
  return { breakEven, matchOvernight };
}
