import { assessInterestPayoutTiming, buildAccountReturnSeries, buildBacktestReturnSeries, buildOvernightBenchmarkReturnSeries, buildReturnProjection, calculateCurrentRateModel, estimateBreakEvenDate, findObservedHoldingPeriods, runBacktest } from '../../backtest.mjs';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';
import type { BacktestResult, CalculationSettings, CashFlowDraft, CalculationView, MarketDataBundle } from '../types';

function options(settings: CalculationSettings) {
  return {
    applyCapitalGainsExemption: settings.applyCapitalGainsExemption,
    applyReyndersTax: settings.applyReyndersTax,
    buyWholeSharesOnly: settings.buyWholeSharesOnly,
    unpaidAccruedInterest: Number(settings.unpaidAccruedInterest || 0),
    brokerTransactionFee: Number(settings.brokerTransactionFee || 0)
  };
}

function scenarioRate(model: ReturnType<typeof calculateCurrentRateModel>, scenario: CalculationSettings['csh2RateScenario']) {
  if (!model) return undefined;
  if (scenario === 'cautious') return model.csh2AnnualRateLowPercent;
  if (scenario === 'optimistic') return model.csh2AnnualRateHighPercent;
  return model.csh2AnnualRatePercent;
}

export function calculateBacktest(flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, today: string): CalculationView {
  const normalized = flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount: Number(amount), interestPayment }));
  if (!normalized.length || normalized.some((flow) => !flow.date || !Number.isFinite(flow.amount) || flow.amount <= 0)) {
    throw new Error('Add a date and a positive EUR amount to every cash flow.');
  }
  const investedFlows = normalized.filter((flow) => !flow.interestPayment);
  const firstInvestment = investedFlows.filter((flow) => flow.type === 'inflow').toSorted((left, right) => left.date.localeCompare(right.date))[0];
  if (!firstInvestment) throw new Error('Add at least one inflow that is not an interest payment.');
  const unpaidAccruedInterest = Number(settings.unpaidAccruedInterest || 0);
  if (!Number.isFinite(unpaidAccruedInterest) || unpaidAccruedInterest < 0) throw new Error('Unpaid accrued interest must be a non-negative amount.');
  const hasPayoutDate = !!settings.interestPayoutDate;
  const hasPayoutAmount = settings.interestPayoutAmount !== '';
  if (hasPayoutDate !== hasPayoutAmount) throw new Error('Enter both the future interest payout date and amount.');
  const interestPayoutAmount = Number(settings.interestPayoutAmount || 0);
  if (hasPayoutAmount && (!Number.isFinite(interestPayoutAmount) || interestPayoutAmount <= 0)) throw new Error('Interest payout amount must be a positive amount.');
  if (hasPayoutAmount && interestPayoutAmount < unpaidAccruedInterest) throw new Error('Future interest payout amount cannot be smaller than unpaid accrued interest.');
  const valuationDate = latestAvailablePriceDate(market.data.prices, today);
  if (!valuationDate) throw new Error('The published CSH2 price data contains no closing prices.');
  const calculationOptions = options(settings);
  const currentRateModel = calculateCurrentRateModel(market.data.prices, market.rateData.rates, valuationDate);
  const csh2AnnualRatePercent = scenarioRate(currentRateModel, settings.csh2RateScenario);
  const projectionAssumption = { csh2AnnualRatePercent };
  const csh2 = buildBacktestReturnSeries(normalized, market.data.prices, calculationOptions);
  const overnight = buildOvernightBenchmarkReturnSeries(normalized, market.data.prices, market.rateData.rates, valuationDate, firstInvestment.date, valuationDate, calculationOptions);
  const simulation = runBacktest(normalized, market.data.prices, valuationDate, calculationOptions);
  const firstPurchaseDate = simulation.entries.find((entry) => entry.type === 'inflow' && entry.units > 0)?.date;
  const result = {
    ...simulation,
    observedHoldingPeriods: firstPurchaseDate
      ? { from: firstInvestment.date, ...findObservedHoldingPeriods(csh2.filter((point) => point.date >= firstPurchaseDate), overnight, firstInvestment.date) }
      : {}
  } as BacktestResult;
  result.interestPayoutAssessment = hasPayoutDate
    ? assessInterestPayoutTiming(normalized, market.data.prices, valuationDate, calculationOptions, settings.interestPayoutDate, interestPayoutAmount, projectionAssumption) as BacktestResult['interestPayoutAssessment']
    : undefined;
  result.breakEvenEstimate = estimateBreakEvenDate(normalized, market.data.prices, valuationDate, calculationOptions, projectionAssumption);
  const projected = hasPayoutDate
    ? buildReturnProjection(normalized, market.data.prices, market.rateData.rates, valuationDate, firstInvestment.date, settings.interestPayoutDate, interestPayoutAmount, calculationOptions, projectionAssumption)
    : undefined;
  return {
    result,
    metadata: market.data,
    rateMetadata: market.rateData,
    settings: { ...settings },
    from: firstInvestment.date,
    to: valuationDate,
    returnSeries: {
      csh2,
      overnight,
      account: buildAccountReturnSeries(normalized, valuationDate, calculationOptions),
      projected
    }
  };
}
