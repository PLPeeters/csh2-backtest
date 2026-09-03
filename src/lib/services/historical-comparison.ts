import {
  buildBacktestReturnSeries,
  buildCsh2TimeWeightedReturnSeries,
  buildProjectedPrices,
  buildOvernightBenchmarkReturnSeries,
  buildOvernightTimeWeightedReturnSeries,
  calculateCurrentRateModel,
  calculateMoneyWeightedReturn,
  calculateRealMoneyWeightedReturn,
  deflateCumulativeReturnSeries,
  findObservedHoldingPeriods,
  runBacktest
} from '../../backtest.mjs';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';
import type { CalculationSettings, ChartPoint, CalculationView, CashFlowDraft, MarketDataBundle } from '../types';
import { calculateHistoricalSavings, type HistoricalSavingsInput, type HistoricalSavingsResult, type HistoricalSavingsScenario } from './historical-savings';
import { getCurrentRateModel } from './current-rate-model-cache.mjs';

export interface HistoricalComparisonScenario {
  label: string;
  savings: HistoricalSavingsScenario;
  flows: CashFlowDraft[];
  view: CalculationView;
}

export interface HistoricalComparisonResult {
  from: string;
  to: string;
  monthly: HistoricalComparisonScenario;
  lumpSum: HistoricalComparisonScenario;
}

function calculationOptions(settings: CalculationSettings) {
  return {
    applyCapitalGainsExemption: settings.applyCapitalGainsExemption,
    applyReyndersTax: settings.applyReyndersTax,
    buyWholeSharesOnly: settings.buyWholeSharesOnly,
    brokerTransactionFee: Number(settings.brokerTransactionFee || 0)
  };
}

function scenarioRate(model: ReturnType<typeof calculateCurrentRateModel> | undefined, scenario: CalculationSettings['csh2RateScenario']) {
  if (!model) return undefined;
  if (scenario === 'cautious') return model.csh2AnnualRateLowPercent;
  if (scenario === 'optimistic') return model.csh2AnnualRateHighPercent;
  return model.csh2AnnualRatePercent;
}

function externalFlows(flows: CashFlowDraft[]) {
  return flows.filter((flow) => !flow.interestPayment);
}

function valueSeries(points: ChartPoint[], flows: CashFlowDraft[]) {
  const dated = externalFlows(flows).toSorted((left, right) => left.date.localeCompare(right.date));
  let index = 0;
  let inflows = 0;
  let outflows = 0;
  return points.map((point) => {
    while (index < dated.length && dated[index].date <= point.date) {
      const flow = dated[index++];
      if (flow.type === 'inflow') inflows += Number(flow.amount);
      else outflows += Number(flow.amount);
    }
    return { date: point.date, value: inflows * (1 + point.value / 100) - outflows };
  });
}

function savingsReturnSeries(scenario: HistoricalSavingsScenario, flows: CashFlowDraft[]) {
  const deposits = externalFlows(flows).toSorted((left, right) => left.date.localeCompare(right.date));
  let index = 0;
  let invested = 0;
  return scenario.series.map((point) => {
    while (index < deposits.length && deposits[index].date <= point.date) invested += Number(deposits[index++].amount);
    return { date: point.date, value: invested ? ((point.value - invested) / invested) * 100 : 0 };
  });
}

/** Link daily savings returns around each external deposit, matching the TWR meaning used by CSH2. */
function savingsTimeWeightedSeries(scenario: HistoricalSavingsScenario, flows: CashFlowDraft[]) {
  const deposits = new Map<string, number>();
  for (const flow of externalFlows(flows)) deposits.set(flow.date, (deposits.get(flow.date) ?? 0) + Number(flow.amount) * (flow.type === 'inflow' ? 1 : -1));
  let factor = 1;
  let previous = 0;
  return scenario.series.map((point) => {
    const beforeFlows = previous;
    const denominator = beforeFlows + (deposits.get(point.date) ?? 0);
    if (denominator > 0) factor *= point.value / denominator;
    previous = point.value;
    return { date: point.date, value: (factor - 1) * 100 };
  });
}

function annualized(points: ChartPoint[], from: string, to: string) {
  const final = points.at(-1)?.value;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return final !== undefined && days > 0 && 1 + final / 100 >= 0 ? ((1 + final / 100) ** (365 / days) - 1) * 100 : undefined;
}

function priceBounds(market: MarketDataBundle) {
  const dates = Object.entries(market.data.prices).filter(([, record]) => typeof record !== 'object' || !record?.isFallback).map(([date]) => date).sort();
  return { earliest: dates[0], latest: dates.at(-1) ?? latestAvailablePriceDate(market.data.prices, dates.at(-1) ?? '') };
}

function validateRange(input: HistoricalSavingsInput, market: MarketDataBundle) {
  const bounds = priceBounds(market);
  if (!bounds.earliest || !bounds.latest) throw new Error('The published CSH2 price data contains no closing prices.');
  const first = [...input.rates].sort((left, right) => left.date.localeCompare(right.date))[0]?.date;
  if (first && first < bounds.earliest) throw new Error(`The first rate date must be on or after the first available CSH2 price date (${bounds.earliest}).`);
  if (first && first > bounds.latest) throw new Error(`The first rate date must be on or before the latest available CSH2 price date (${bounds.latest}).`);
}

function splitAt(points: ChartPoint[], date: string, projected: boolean) {
  return points.filter((point) => projected ? point.date >= date : point.date <= date);
}

function projectedRates(rates: Record<string, number>, valuationDate: string, throughDate: string) {
  const latest = Object.entries(rates)
    .filter(([date, rate]) => date <= valuationDate && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right))
    .at(-1);
  if (!latest) return undefined;
  const result = { ...rates };
  const start = Date.parse(`${valuationDate}T00:00:00Z`);
  const end = Date.parse(`${throughDate}T00:00:00Z`);
  for (let timestamp = start + 86_400_000; timestamp <= end; timestamp += 86_400_000) {
    result[new Date(timestamp).toISOString().slice(0, 10)] = latest[1];
  }
  return { rates: result, latestRate: latest[1] };
}

function scenarioView(savings: HistoricalSavingsScenario, flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, from: string, to: string): CalculationView {
  const normalizedFlows = flows.map((flow) => ({ ...flow, amount: Number(flow.amount) }));
  const options = calculationOptions(settings);
  const returnOptions = settings.returnMode === 'real' ? { ...options, cpiIndices: market.cpiData.indices } : options;
  const bounds = priceBounds(market);
  if (!bounds.latest) throw new Error('The published CSH2 price data contains no closing prices.');
  const valuationDate = bounds.latest;
  const future = to > valuationDate;
  const currentRateModel = getCurrentRateModel(market.version, market.data.prices, market.rateData.rates, valuationDate, undefined, market.currentRateModel);
  const csh2AnnualRatePercent = scenarioRate(currentRateModel, settings.csh2RateScenario);
  const projectedPriceData = future && Number.isFinite(csh2AnnualRatePercent)
    ? buildProjectedPrices(market.data.prices, valuationDate, to, csh2AnnualRatePercent)
    : undefined;
  const simulationPrices = projectedPriceData?.prices ?? market.data.prices;
  const projectedRateData = future ? projectedRates(market.rateData.rates, valuationDate, to) : undefined;
  const projectedMarketPrices = projectedPriceData?.prices;
  const projectedMarketRates = projectedRateData?.rates;
  const csh2NominalAll = buildBacktestReturnSeries(normalizedFlows, simulationPrices, options).filter((point) => point.date >= from && point.date <= to);
  const csh2All = settings.returnMode === 'real'
    ? buildBacktestReturnSeries(normalizedFlows, simulationPrices, returnOptions).filter((point) => point.date >= from && point.date <= to)
    : csh2NominalAll;
  const overnightNominalAll = buildOvernightBenchmarkReturnSeries(normalizedFlows as unknown as CashFlowDraft[], simulationPrices, projectedMarketRates ?? market.rateData.rates, to, from, to, options);
  const overnightAll = settings.returnMode === 'real'
    ? buildOvernightBenchmarkReturnSeries(normalizedFlows, simulationPrices, projectedMarketRates ?? market.rateData.rates, to, from, to, returnOptions)
    : overnightNominalAll;
  const csh2Series = splitAt(csh2All, valuationDate, false);
  const overnightSeries = splitAt(overnightAll, valuationDate, false);
  const csh2Nominal = splitAt(csh2NominalAll, valuationDate, false);
  const overnightNominal = splitAt(overnightNominalAll, valuationDate, false);
  const savingsSeries = savingsReturnSeries(savings, normalizedFlows as unknown as CashFlowDraft[]);
  const savingsTwrNominal = savingsTimeWeightedSeries(savings, normalizedFlows as unknown as CashFlowDraft[]);
  const savingsTwr = settings.returnMode === 'real'
    ? deflateCumulativeReturnSeries(savingsTwrNominal, from, market.cpiData.indices)
    : savingsTwrNominal;
  const csh2TwrAll = projectedMarketPrices
    ? buildCsh2TimeWeightedReturnSeries(normalizedFlows, projectedMarketPrices, to, returnOptions).filter((point) => point.date >= from && point.date <= to)
    : buildCsh2TimeWeightedReturnSeries(normalizedFlows, market.data.prices, to, returnOptions).filter((point) => point.date >= from && point.date <= to);
  const overnightTwrAll = buildOvernightTimeWeightedReturnSeries(projectedMarketRates ?? market.rateData.rates, from, to, settings.returnMode === 'real' ? { cpiIndices: market.cpiData.indices } : {}).filter((point) => point.date >= from && point.date <= to);
  const csh2Twr = splitAt(csh2TwrAll, valuationDate, false);
  const overnightTwr = splitAt(overnightTwrAll, valuationDate, false);
  const simulation = runBacktest(normalizedFlows as unknown as CashFlowDraft[], simulationPrices, to, options);
  const firstPurchaseDate = simulation.entries.find((entry) => entry.type === 'inflow' && entry.units > 0)?.date;
  const cashFlows = externalFlows(normalizedFlows as unknown as CashFlowDraft[]).map((flow) => ({ date: flow.date, amount: flow.type === 'inflow' ? -Number(flow.amount) : Number(flow.amount) }));
  const savingsEnd = savings.economicValue;
  const csh2Mwr = settings.returnMode === 'real' ? calculateRealMoneyWeightedReturn([...cashFlows, { date: to, amount: simulation.netLiquidationValue }], to, market.cpiData.indices) : calculateMoneyWeightedReturn([...cashFlows, { date: to, amount: simulation.netLiquidationValue }]);
  const savingsMwr = settings.returnMode === 'real' ? calculateRealMoneyWeightedReturn([...cashFlows, { date: to, amount: savingsEnd }], to, market.cpiData.indices) : calculateMoneyWeightedReturn([...cashFlows, { date: to, amount: savingsEnd }]);
  const csh2TimeWeighted = annualized(csh2TwrAll, from, to);
  const savingsTimeWeighted = annualized(savingsTwr, from, to);
  const projectedCsh2Nominal = future ? splitAt(csh2NominalAll, valuationDate, true) : [];
  const projectedOvernightNominal = future ? splitAt(overnightNominalAll, valuationDate, true) : [];
  const projectedSavingsReturn = future ? splitAt(savingsSeries, valuationDate, true) : [];
  const projectedSavingsValue = future ? savings.series.filter((point) => point.date >= valuationDate && point.date <= to) : [];
  const projectedCsh2Twr = future ? splitAt(csh2TwrAll, valuationDate, true) : [];
  const projectedOvernightTwr = future ? splitAt(overnightTwrAll, valuationDate, true) : [];
  const projectedSavingsTwr = future ? splitAt(savingsTwr, valuationDate, true) : [];
  const projection = future && projectedPriceData && projectedRateData && csh2AnnualRatePercent !== undefined ? {
    csh2: projectedCsh2Nominal,
    overnight: projectedOvernightNominal,
    account: projectedSavingsReturn,
    throughDate: to,
    csh2AnnualRatePercent,
    overnightRatePercent: projectedRateData.latestRate
  } : undefined;
  const timeWeightedProjection = projection ? {
    ...projection,
    csh2: projectedCsh2Twr,
    overnight: projectedOvernightTwr,
    account: projectedSavingsTwr
  } : undefined;
  const result = {
    ...simulation,
    csh2MoneyWeightedReturn: csh2Mwr,
    accountMoneyWeightedReturn: savingsMwr,
    csh2TimeWeightedReturn: csh2TimeWeighted,
    accountTimeWeightedReturn: savingsTimeWeighted,
    missedAmount: simulation.netLiquidationValue - savingsEnd,
    observedHoldingPeriods: firstPurchaseDate ? { from: firstPurchaseDate, ...findObservedHoldingPeriods(csh2Nominal.filter((point) => point.date >= firstPurchaseDate), overnightNominal, firstPurchaseDate) } : {},
    fidelityPremiumAssessments: []
  } as CalculationView['result'];
  return {
    result,
    metadata: market.data,
    rateMetadata: market.rateData,
    cpiMetadata: market.cpiData,
    settings: { ...settings, fidelityPremiums: [] },
    from,
    to,
    returnSeries: {
      csh2: csh2Series,
      overnight: overnightSeries,
      account: splitAt(savingsSeries, valuationDate, false),
      projected: projection,
      timeWeighted: { csh2: csh2Twr, overnight: overnightTwr, account: splitAt(savingsTwr, valuationDate, false), projected: timeWeightedProjection },
      portfolioValue: {
        csh2: valueSeries(csh2Nominal, flows),
        overnight: valueSeries(overnightNominal, flows),
        account: savings.series.filter((point) => point.date <= valuationDate),
        projected: projection ? { ...projection, csh2: valueSeries(projectedCsh2Nominal, flows), overnight: valueSeries(projectedOvernightNominal, flows), account: projectedSavingsValue } : undefined
      }
    }
  };
}

export function calculateHistoricalComparison(input: HistoricalSavingsInput, settings: CalculationSettings, market: MarketDataBundle): HistoricalComparisonResult {
  validateRange(input, market);
  const savings: HistoricalSavingsResult = calculateHistoricalSavings(input);
  const first = savings.from;
  const makeFlows = (scenario: 'monthly' | 'lumpSum') => (scenario === 'monthly'
    ? savings.monthly.deposits.map((deposit) => ({ id: `historical-${deposit.date}`, date: deposit.date, type: 'inflow' as const, amount: String(deposit.amount), interestPayment: false }))
    : savings.lumpSum.deposits.map((deposit) => ({ id: `historical-${deposit.date}`, date: deposit.date, type: 'inflow' as const, amount: String(deposit.amount), interestPayment: false })));
  return {
    from: first,
    to: input.endDate,
    monthly: { label: '€600 monthly deposits', savings: savings.monthly, flows: makeFlows('monthly'), view: scenarioView(savings.monthly, makeFlows('monthly'), settings, market, first, input.endDate) },
    lumpSum: { label: '€10,000 initial deposit', savings: savings.lumpSum, flows: makeFlows('lumpSum'), view: scenarioView(savings.lumpSum, makeFlows('lumpSum'), settings, market, first, input.endDate) }
  };
}
