export const TOB_RATE = 0.0012;
export const CGT_RATE = 0.1;
export const REYNDERS_TAX_RATE = 0.3;
export const ANNUAL_CGT_EXEMPTION = 10000;
export const CGT_EXEMPTION_CARRY_INCREMENT = 1000;
export const MAXIMUM_CGT_EXEMPTION = 15000;
export const CGT_EXEMPTION_START_YEAR = 2026;

function euro(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

function dateAfter(date, days) {
  const projected = new Date(`${date}T00:00:00Z`);
  projected.setUTCDate(projected.getUTCDate() + days);
  return projected.toISOString().slice(0, 10);
}

function priceValue(record, field) {
  return Number.isFinite(record) ? record : record?.[field];
}

function directQuote(prices, date) {
  const record = prices[date];
  if (!Number.isFinite(priceValue(record, 'close'))) return undefined;
  return {
    date: record?.fallbackSource ?? date,
    price: priceValue(record, 'close'),
    kind: record?.isFallback ? 'previous close' : record?.period === 'monthly' ? 'monthly close' : 'close'
  };
}

function quoteForTransaction(prices, date) {
  const direct = directQuote(prices, date);
  if (direct) return direct;
  const dates = Object.keys(prices).sort();
  const previousDate = dates.filter((candidate) => candidate <= date && Number.isFinite(priceValue(prices[candidate], 'close'))).at(-1);
  if (!previousDate) throw new Error(`No CSH2 price is available on or before ${date}.`);
  return directQuote(prices, previousDate);
}

function closingQuoteOnOrBefore(prices, date) {
  const direct = directQuote(prices, date);
  if (direct) return direct;
  const matchedDate = Object.keys(prices).filter((candidate) => candidate <= date && Number.isFinite(priceValue(prices[candidate], 'close'))).sort().at(-1);
  if (!matchedDate) throw new Error(`No CSH2 closing price is available on or before ${date}.`);
  return directQuote(prices, matchedDate);
}

function createCapitalGainsExemption(enabled) {
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

function establishTaxPurchasePrice(lot, prices, year) {
  if (year >= CGT_EXEMPTION_START_YEAR && lot.purchaseDate < `${CGT_EXEMPTION_START_YEAR}-01-01` && lot.taxPurchasePrice === undefined) {
    lot.taxPurchasePrice = Math.max(lot.purchasePrice, closingQuoteOnOrBefore(prices, `${CGT_EXEMPTION_START_YEAR - 1}-12-31`).price);
  }
}

function saleForLot(lot, units, price, exemption, year, applyExemption, applyReyndersTax) {
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

function liquidation(lots, prices, price, exemption, year, applyReyndersTax) {
  return lots.reduce((total, lot) => {
    if (!applyReyndersTax) establishTaxPurchasePrice(lot, prices, year);
    const sale = saleForLot(lot, lot.units, price, exemption, year, true, applyReyndersTax);
    return { gross: total.gross + sale.gross, tob: total.tob + sale.tob, cgt: total.cgt + sale.cgt, reyndersTax: total.reyndersTax + sale.reyndersTax, net: total.net + sale.net };
  }, { gross: 0, tob: 0, cgt: 0, reyndersTax: 0, net: 0 });
}

function unitsForNetOutflow(lot, maxUnits, price, targetNet, exemption, year, applyReyndersTax) {
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

export function runBacktest(flows, prices, valuationDate, { applyCapitalGainsExemption = false, applyReyndersTax = false, buyWholeSharesOnly = false, unpaidAccruedInterest = 0, brokerTransactionFee = 0 } = {}) {
  if (!Number.isFinite(unpaidAccruedInterest) || unpaidAccruedInterest < 0) throw new Error('Unpaid accrued interest must be a non-negative amount.');
  if (!Number.isFinite(brokerTransactionFee) || brokerTransactionFee < 0) throw new Error('Broker transaction fee must be a non-negative amount.');
  const lots = [];
  const entries = [];
  let paidTob = 0;
  let paidCgt = 0;
  let paidReyndersTax = 0;
  let paidBrokerFees = 0;
  let availableCash = 0;
  const exemption = createCapitalGainsExemption(applyCapitalGainsExemption && !applyReyndersTax);
  for (const flow of [...flows].sort((left, right) => left.date.localeCompare(right.date))) {
    if (!['inflow', 'outflow'].includes(flow.type) || !Number.isFinite(flow.amount) || flow.amount <= 0) throw new Error('Every cash flow needs a positive amount and a valid type.');
    const quote = quoteForTransaction(prices, flow.date);
    if (flow.type === 'inflow') {
      if (buyWholeSharesOnly) availableCash += flow.amount;
      if (!buyWholeSharesOnly && flow.amount <= brokerTransactionFee) throw new Error(`Inflow of €${flow.amount.toFixed(2)} on ${flow.date} does not cover the broker transaction fee.`);
      const wholeShareUnits = Math.floor((availableCash - brokerTransactionFee) / (quote.price * (1 + TOB_RATE)));
      const units = buyWholeSharesOnly ? Math.max(0, wholeShareUnits) : ((flow.amount - brokerTransactionFee) * (1 - TOB_RATE)) / quote.price;
      const gross = units * quote.price;
      const brokerFee = units > 0 ? brokerTransactionFee : 0;
      const tob = buyWholeSharesOnly ? gross * TOB_RATE : (flow.amount - brokerFee) * TOB_RATE;
      if (buyWholeSharesOnly) availableCash -= gross + tob + brokerFee;
      if (units > 0) lots.push({ units, purchasePrice: quote.price, purchaseDate: flow.date });
      paidTob += tob;
      paidBrokerFees += brokerFee;
      entries.push({ ...flow, priceDate: quote.date, price: quote.price, priceKind: quote.kind, units, tob, brokerFee, cgt: 0, reyndersTax: 0, exoneratedCgt: 0, net: 0, remainingCash: euro(availableCash) });
      continue;
    }
    const cashUsed = buyWholeSharesOnly ? Math.min(availableCash, flow.amount) : 0;
    availableCash -= cashUsed;
    let remainingNet = flow.amount - cashUsed;
    const brokerFee = remainingNet > 0.00000001 ? brokerTransactionFee : 0;
    remainingNet += brokerFee;
    let soldUnits = 0;
    let tob = 0;
    let cgt = 0;
    let reyndersTax = 0;
    let exoneratedCgt = 0;
    for (const lot of lots) {
      if (remainingNet <= 0.00000001 || lot.units <= 0) continue;
      const saleYear = Number(flow.date.slice(0, 4));
      if (!applyReyndersTax) establishTaxPurchasePrice(lot, prices, saleYear);
      const fullSale = saleForLot(lot, lot.units, quote.price, { ...exemption }, Number(flow.date.slice(0, 4)), true, applyReyndersTax);
      const fractionalUnits = fullSale.net <= remainingNet ? lot.units : unitsForNetOutflow(lot, lot.units, quote.price, remainingNet, exemption, Number(flow.date.slice(0, 4)), applyReyndersTax);
      const units = buyWholeSharesOnly ? Math.ceil(fractionalUnits) : fractionalUnits;
      const sale = saleForLot(lot, units, quote.price, exemption, Number(flow.date.slice(0, 4)), true, applyReyndersTax);
      lot.units -= units;
      remainingNet -= sale.net;
      soldUnits += units;
      tob += sale.tob;
      cgt += sale.cgt;
      reyndersTax += sale.reyndersTax;
      exoneratedCgt += sale.exoneratedCgt;
    }
    if (remainingNet > 0.01) throw new Error(`Outflow of €${flow.amount.toFixed(2)} on ${flow.date} exceeds the simulated CSH2 holdings.`);
    if (buyWholeSharesOnly && remainingNet < 0) availableCash -= remainingNet;
    paidTob += tob;
    paidCgt += cgt;
    paidReyndersTax += reyndersTax;
    paidBrokerFees += brokerFee;
    entries.push({ ...flow, priceDate: quote.date, price: quote.price, priceKind: quote.kind, units: soldUnits, tob, brokerFee, cgt, reyndersTax, exoneratedCgt, net: flow.amount, remainingCash: euro(availableCash) });
  }
  const openLots = lots.filter((lot) => lot.units > 0.00000001);
  const valuation = closingQuoteOnOrBefore(prices, valuationDate);
  const terminal = liquidation(openLots, prices, valuation.price, exemption, Number(valuation.date.slice(0, 4)), applyReyndersTax);
  const terminalBrokerFee = openLots.length ? brokerTransactionFee : 0;
  terminal.net -= terminalBrokerFee;
  const totalInput = flows.reduce((sum, flow) => sum + (flow.type === 'inflow' ? flow.amount : -flow.amount), 0) + unpaidAccruedInterest;
  const missedAmount = terminal.net + availableCash - totalInput;
  const missedSharePercent = totalInput ? (missedAmount / totalInput) * 100 : undefined;
  return {
    entries: entries.map((entry) => ({ ...entry, units: Number(entry.units.toFixed(6)), tob: euro(entry.tob), brokerFee: euro(entry.brokerFee), cgt: euro(entry.cgt), reyndersTax: euro(entry.reyndersTax), exoneratedCgt: euro(entry.exoneratedCgt), net: euro(entry.net) })),
    openLots,
    valuation,
    units: openLots.reduce((sum, lot) => sum + lot.units, 0),
    availableCash: euro(availableCash),
    grossValue: euro(openLots.reduce((sum, lot) => sum + lot.units, 0) * valuation.price),
    paidTob: euro(paidTob),
    paidCgt: euro(paidCgt),
    paidReyndersTax: euro(paidReyndersTax),
    paidBrokerFees: euro(paidBrokerFees),
    terminalTob: euro(terminal.tob),
    terminalCgt: euro(terminal.cgt),
    terminalReyndersTax: euro(terminal.reyndersTax),
    terminalBrokerFee: euro(terminalBrokerFee),
    netLiquidationValue: euro(terminal.net + availableCash),
    totalInput: euro(totalInput),
    missedAmount: euro(missedAmount),
    missedSharePercent
  };
}

export function estimateBreakEvenDate(flows, prices, valuationDate, options, { lookbackDays = 30, maximumProjectionDays = 365 } = {}) {
  const current = runBacktest(flows, prices, valuationDate, options);
  if (current.missedAmount >= 0) return undefined;
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
  if (!Number.isFinite(dailyGrowthFactor) || dailyGrowthFactor <= 1) return undefined;
  const projectedPrices = { ...prices };
  for (let day = 1; day <= maximumProjectionDays; day += 1) {
    const date = dateAfter(valuation.date, day);
    projectedPrices[date] = { close: valuation.price * dailyGrowthFactor ** day };
    const projected = runBacktest(flows, projectedPrices, date, options);
    if (projected.missedAmount >= 0) return { date, days: day, trendDays, trendReturnPercent: (dailyGrowthFactor ** trendDays - 1) * 100 };
  }
  return undefined;
}

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
