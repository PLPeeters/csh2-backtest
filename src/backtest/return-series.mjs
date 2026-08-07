import { daysBetween } from './shared.mjs';
import { isUsableClose, priceValue } from './quotes.mjs';
import { runBacktest } from './simulation.mjs';

/** Builds the CSH2 net-return chart from each real price date after the first inflow. */
export function buildBacktestReturnSeries(flows, prices, options) {
  const dates = Object.entries(prices).filter(([, price]) => !price?.isFallback).map(([date]) => date);
  const snapshots = [];
  for (const date of dates) {
    const completedFlows = flows.filter((flow) => flow.date <= date);
    const inflows = completedFlows.filter((flow) => flow.type === 'inflow').reduce((sum, flow) => sum + flow.amount, 0);
    if (!inflows) continue;
    const outflows = completedFlows.filter((flow) => flow.type === 'outflow').reduce((sum, flow) => sum + flow.amount, 0);
    const result = runBacktest(completedFlows, prices, date, options);
    snapshots.push({ date, value: ((result.netLiquidationValue + outflows - inflows) / inflows) * 100 });
  }
  return snapshots;
}

function trailingAnnualizedReturnSeries(points, from, lookbackDays) {
  return points.map((point, index) => {
    if (point.date < from) return undefined;
    const prior = [...points.slice(0, index)].reverse().find((candidate) => daysBetween(candidate.date, point.date) >= lookbackDays);
    if (!prior) return undefined;
    const days = daysBetween(prior.date, point.date);
    return { date: point.date, value: ((point.value / prior.value) ** (365 / days) - 1) * 100 };
  }).filter(Boolean);
}

export function buildTrailingAnnualizedCsh2ReturnSeries(prices, from, to, { lookbackDays = 90 } = {}) {
  const points = Object.entries(prices)
    .filter(([date, record]) => date <= to && !record?.isFallback && isUsableClose(record))
    .map(([date, record]) => ({ date, value: priceValue(record, 'close') }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return trailingAnnualizedReturnSeries(points, from, lookbackDays);
}

export function buildTrailingAnnualizedOvernightBenchmarkReturnSeries(rates, from, to, { lookbackDays = 90 } = {}) {
  let value = 1;
  let previousDate;
  let previousRate;
  const points = Object.entries(rates)
    .filter(([date, rate]) => date <= to && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, rate]) => {
      if (previousDate) value *= (1 + previousRate / 100) ** (daysBetween(previousDate, date) / 365);
      previousDate = date;
      previousRate = rate;
      return { date, value };
    });
  return trailingAnnualizedReturnSeries(points, from, lookbackDays);
}

function benchmarkFlowsWithoutResidualCash(flows, prices, valuationDate, options) {
  const { entries } = runBacktest(flows, prices, valuationDate, options);
  let priorCash = 0;
  return entries.map((entry) => {
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
export function buildOvernightBenchmarkReturnSeries(flows, prices, rates, valuationDate, from, to, options) {
  const scheduledFlows = benchmarkFlowsWithoutResidualCash(flows, prices, valuationDate, options).sort((left, right) => left.date.localeCompare(right.date));
  const snapshots = [];
  let flowIndex = 0;
  let balance = 0;
  let inflows = 0;
  let outflows = 0;
  for (const [date, rate] of Object.entries(rates).filter(([date, rate]) => date >= from && date <= to && Number.isFinite(rate)).sort(([left], [right]) => left.localeCompare(right))) {
    balance *= (1 + rate / 100) ** (1 / 365);
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
  }
  return snapshots;
}
