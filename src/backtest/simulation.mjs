import { closingQuoteOnOrBefore, quoteForTransaction } from './quotes.mjs';
import { euro, TOB_RATE } from './shared.mjs';
import { createCapitalGainsExemption, establishTaxPurchasePrice, liquidateLots, saleForLot, unitsForNetOutflow } from './taxation.mjs';

function hasNegativeAccountCashFlowBalance(flows) {
  let balance = 0;
  let index = 0;
  const sortedFlows = [...flows].sort((left, right) => left.date.localeCompare(right.date));
  while (index < sortedFlows.length) {
    const date = sortedFlows[index].date;
    while (index < sortedFlows.length && sortedFlows[index].date === date) {
      const flow = sortedFlows[index];
      balance += flow.type === 'inflow' ? flow.amount : -flow.amount;
      index += 1;
    }
    if (balance < -0.00000001) return true;
  }
  return false;
}

/** Simulates chronological CSH2 transactions, including FIFO withdrawals and terminal liquidation. */
export function runBacktest(flows, prices, valuationDate, { applyCapitalGainsExemption = false, applyReyndersTax = false, buyWholeSharesOnly = false, accruedBaseInterest = 0, brokerTransactionFee = 0 } = {}) {
  if (!Number.isFinite(accruedBaseInterest) || accruedBaseInterest < 0) throw new Error('Accrued base interest must be a non-negative amount.');
  if (!Number.isFinite(brokerTransactionFee) || brokerTransactionFee < 0) throw new Error('Broker transaction fee must be a non-negative amount.');
  for (const flow of flows) {
    if (!['inflow', 'outflow'].includes(flow.type) || !Number.isFinite(flow.amount) || flow.amount <= 0) throw new Error('Every cash flow needs a positive amount and a valid type.');
    if (flow.interestPayment && flow.type !== 'inflow') throw new Error('Only an inflow can be marked as an interest payment.');
  }
  if (hasNegativeAccountCashFlowBalance(flows)) throw new Error('Account inflows and outflows cannot produce a negative balance.');
  const lots = [];
  const entries = [];
  let paidTob = 0;
  let paidCgt = 0;
  let paidReyndersTax = 0;
  let paidBrokerFees = 0;
  let availableCash = 0;
  const exemption = createCapitalGainsExemption(applyCapitalGainsExemption && !applyReyndersTax);
  for (const flow of [...flows].sort((left, right) => left.date.localeCompare(right.date))) {
    if (flow.interestPayment) {
      entries.push({ ...flow, units: 0, tob: 0, brokerFee: 0, cgt: 0, reyndersTax: 0, exoneratedCgt: 0, net: 0, remainingCash: euro(availableCash) });
      continue;
    }
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
    // Lots stay in purchase order, so this loop deliberately applies FIFO sales.
    for (const lot of lots) {
      if (remainingNet <= 0.00000001 || lot.units <= 0) continue;
      const saleYear = Number(flow.date.slice(0, 4));
      if (!applyReyndersTax) establishTaxPurchasePrice(lot, prices, saleYear);
      const fullSale = saleForLot(lot, lot.units, quote.price, { ...exemption }, saleYear, true, applyReyndersTax);
      const fractionalUnits = fullSale.net <= remainingNet ? lot.units : unitsForNetOutflow(lot, lot.units, quote.price, remainingNet, exemption, saleYear, applyReyndersTax);
      const units = buyWholeSharesOnly ? Math.ceil(fractionalUnits) : fractionalUnits;
      const sale = saleForLot(lot, units, quote.price, exemption, saleYear, true, applyReyndersTax);
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
  const terminal = liquidateLots(openLots, prices, valuation.price, exemption, Number(valuation.date.slice(0, 4)), applyReyndersTax);
  const terminalBrokerFee = openLots.length ? brokerTransactionFee : 0;
  terminal.net -= terminalBrokerFee;
  const totalInput = flows.reduce((sum, flow) => sum + (flow.type === 'inflow' ? flow.amount : -flow.amount), 0) + accruedBaseInterest;
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
