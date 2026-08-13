import { assessInterestPayoutTiming, buildAccountReturnSeries, buildBacktestReturnSeries, buildOvernightBenchmarkReturnSeries, estimateBreakEvenDate, runBacktest } from '../../backtest.mjs';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';
import type { BacktestResult, CalculationSettings, CashFlowDraft, CalculationView, MarketDataBundle } from '../types';

function options(settings: CalculationSettings) {
  return {
    applyCapitalGainsExemption: settings.applyCapitalGainsExemption,
    applyReyndersTax: settings.applyReyndersTax,
    buyWholeSharesOnly: settings.buyWholeSharesOnly,
    unpaidAccruedInterest: settings.interestMode === 'payout' ? 0 : Number(settings.unpaidAccruedInterest || 0),
    brokerTransactionFee: Number(settings.brokerTransactionFee || 0)
  };
}

export function calculateBacktest(flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, today: string): CalculationView {
  const normalized = flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount: Number(amount), interestPayment }));
  if (!normalized.length || normalized.some((flow) => !flow.date || !Number.isFinite(flow.amount) || flow.amount <= 0)) {
    throw new Error('Add a date and a positive EUR amount to every cash flow.');
  }
  const investedFlows = normalized.filter((flow) => !flow.interestPayment);
  const firstInvestment = investedFlows.filter((flow) => flow.type === 'inflow').toSorted((left, right) => left.date.localeCompare(right.date))[0];
  if (!firstInvestment) throw new Error('Add at least one inflow that is not an interest payment.');
  const valuationDate = latestAvailablePriceDate(market.data.prices, today);
  if (!valuationDate) throw new Error('The published CSH2 price data contains no closing prices.');
  const calculationOptions = options(settings);
  const result = runBacktest(normalized, market.data.prices, valuationDate, calculationOptions) as BacktestResult;
  result.interestPayoutAssessment = settings.interestMode === 'payout'
    ? assessInterestPayoutTiming(normalized, market.data.prices, valuationDate, calculationOptions, settings.interestPayoutDate, Number(settings.interestPayoutAmount || 0)) as BacktestResult['interestPayoutAssessment']
    : undefined;
  result.breakEvenEstimate = estimateBreakEvenDate(normalized, market.data.prices, valuationDate, calculationOptions);
  return {
    result,
    metadata: market.data,
    settings: { ...settings },
    from: firstInvestment.date,
    to: valuationDate,
    returnSeries: {
      csh2: buildBacktestReturnSeries(normalized, market.data.prices, calculationOptions),
      overnight: buildOvernightBenchmarkReturnSeries(normalized, market.data.prices, market.rateData.rates, valuationDate, firstInvestment.date, valuationDate, calculationOptions),
      account: buildAccountReturnSeries(normalized, valuationDate, calculationOptions)
    }
  };
}
