import { assessFidelityPremiumTimings, buildAccountReturnSeries, buildAccountTimeWeightedReturnSeries, buildBacktestReturnSeries, buildCsh2TimeWeightedReturnSeries, buildMarketReturnProjection, buildOvernightBenchmarkReturnSeries, buildOvernightTimeWeightedReturnSeries, buildProjectedAccountReturnSeries, calculateCurrentRateModel, calculateMoneyWeightedReturn, estimateBreakEvenDate, findObservedHoldingPeriods, runBacktest } from '../../backtest.mjs';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';
import type { BacktestResult, CalculationSettings, CashFlowDraft, CalculationView, MarketDataBundle } from '../types';
import { getCurrentRateModel } from './current-rate-model-cache.mjs';

function options(settings: CalculationSettings) {
  return {
    applyCapitalGainsExemption: settings.applyCapitalGainsExemption,
    applyReyndersTax: settings.applyReyndersTax,
    buyWholeSharesOnly: settings.buyWholeSharesOnly,
    accruedBaseInterest: Number(settings.accruedBaseInterest || 0),
    brokerTransactionFee: Number(settings.brokerTransactionFee || 0)
  };
}

function scenarioRate(model: ReturnType<typeof calculateCurrentRateModel>, scenario: CalculationSettings['csh2RateScenario']) {
  if (!model) return undefined;
  if (scenario === 'cautious') return model.csh2AnnualRateLowPercent;
  if (scenario === 'optimistic') return model.csh2AnnualRateHighPercent;
  return model.csh2AnnualRatePercent;
}

function portfolioValueSeries(points: CalculationView['returnSeries']['csh2'], flows: Array<{ date: string; type: 'inflow' | 'outflow'; amount: number; interestPayment?: boolean }>) {
  const externalFlows = flows.filter((flow) => !flow.interestPayment).toSorted((left, right) => left.date.localeCompare(right.date));
  let flowIndex = 0;
  let inflows = 0;
  let outflows = 0;
  return points.map((point) => {
    while (flowIndex < externalFlows.length && externalFlows[flowIndex].date <= point.date) {
      const flow = externalFlows[flowIndex];
      if (flow.type === 'inflow') inflows += flow.amount;
      else outflows += flow.amount;
      flowIndex += 1;
    }
    return { date: point.date, value: inflows * (1 + point.value / 100) - outflows };
  });
}

function annualizedLinkedReturn(points: CalculationView['returnSeries']['csh2']) {
  if (points.length < 2) return undefined;
  const days = (Date.parse(`${points.at(-1)!.date}T00:00:00Z`) - Date.parse(`${points[0].date}T00:00:00Z`)) / 86_400_000;
  const factor = 1 + points.at(-1)!.value / 100;
  return days > 0 && factor >= 0 ? (factor ** (365 / days) - 1) * 100 : undefined;
}

interface StageEntry<T> { key: string; value: T }

/** Owns one cached input per stage for one market dataset at a time. */
export function createBacktestCalculator() {
  let marketKey: string | undefined;
  let observedStage: StageEntry<{
    csh2: CalculationView['returnSeries']['csh2'];
    overnight: CalculationView['returnSeries']['overnight'];
    timeWeighted: CalculationView['returnSeries']['timeWeighted'];
    simulation: Omit<BacktestResult, 'fidelityPremiumAssessments' | 'observedHoldingPeriods'>;
    observedHoldingPeriods: BacktestResult['observedHoldingPeriods'];
  }> | undefined;
  let accountHistoryStage: StageEntry<CalculationView['returnSeries']['account']> | undefined;
  let scenarioStage: StageEntry<{
    breakEvenEstimate: BacktestResult['breakEvenEstimate'];
    marketProjection: ReturnType<typeof buildMarketReturnProjection>;
  }> | undefined;
  let projectedAccountStage: StageEntry<ReturnType<typeof buildProjectedAccountReturnSeries>> | undefined;

  const clear = () => {
    marketKey = undefined;
    observedStage = undefined;
    accountHistoryStage = undefined;
    scenarioStage = undefined;
    projectedAccountStage = undefined;
  };
  const getStage = <T>(entry: StageEntry<T> | undefined, key: string, build: () => T): StageEntry<T> =>
    entry?.key === key ? entry : { key, value: build() };

  const calculate = (flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, today: string): CalculationView => {
    const normalized = flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount: Number(amount), interestPayment }));
    if (!normalized.length || normalized.some((flow) => !flow.date || !Number.isFinite(flow.amount) || flow.amount <= 0)) throw new Error('Add a date and a positive EUR amount to every cash flow.');
    const investedFlows = normalized.filter((flow) => !flow.interestPayment);
    const firstInvestment = investedFlows.filter((flow) => flow.type === 'inflow').toSorted((left, right) => left.date.localeCompare(right.date))[0];
    if (!firstInvestment) throw new Error('Add at least one inflow that is not an interest payment.');
    const accruedBaseInterest = Number(settings.accruedBaseInterest || 0);
    if (!Number.isFinite(accruedBaseInterest) || accruedBaseInterest < 0) throw new Error('Accrued base interest must be a non-negative amount.');
    const fidelityPremiums = settings.fidelityPremiums.map((premium) => ({ id: premium.id, baseAmount: Number(premium.baseAmount), earnedDate: premium.earnedDate, finalPayoutAmount: Number(premium.finalPayoutAmount) }));
    if (fidelityPremiums.some((premium) => !Number.isFinite(premium.baseAmount) || premium.baseAmount <= 0)) throw new Error('Every fidelity premium needs a positive base amount.');
    if (fidelityPremiums.some((premium) => !premium.earnedDate)) throw new Error('Every fidelity premium needs an earned date.');
    if (fidelityPremiums.some((premium) => !Number.isFinite(premium.finalPayoutAmount) || premium.finalPayoutAmount <= 0)) throw new Error('Every fidelity premium needs a positive final payout amount.');
    const valuationDate = latestAvailablePriceDate(market.data.prices, today);
    if (!valuationDate) throw new Error('The published CSH2 price data contains no closing prices.');

    const nextMarketKey = JSON.stringify([market.version, market.data.cachedAt, market.rateData.cachedAt, valuationDate]);
    if (marketKey !== nextMarketKey) {
      clear();
      marketKey = nextMarketKey;
    }

    const calculationOptions = options(settings);
    const historicalKey = JSON.stringify([normalized, calculationOptions]);
    observedStage = getStage(observedStage, historicalKey, () => {
      const csh2 = buildBacktestReturnSeries(normalized, market.data.prices, calculationOptions).filter((point) => point.date <= valuationDate);
      const overnight = buildOvernightBenchmarkReturnSeries(normalized, market.data.prices, market.rateData.rates, valuationDate, firstInvestment.date, valuationDate, calculationOptions);
      const baseSimulation = runBacktest(normalized, market.data.prices, valuationDate, calculationOptions);
      const firstPurchaseDate = baseSimulation.entries.find((entry) => entry.type === 'inflow' && entry.units > 0)?.date;
      const timeWeighted = {
        csh2: buildCsh2TimeWeightedReturnSeries(normalized, market.data.prices, valuationDate, calculationOptions),
        overnight: firstPurchaseDate ? buildOvernightTimeWeightedReturnSeries(market.rateData.rates, firstPurchaseDate, valuationDate) : [],
        account: buildAccountTimeWeightedReturnSeries(normalized, valuationDate, calculationOptions)
      };
      const externalFlows = normalized.filter((flow) => !flow.interestPayment);
      const externalCashFlows = externalFlows.map((flow) => ({ date: flow.date, amount: flow.type === 'inflow' ? -flow.amount : flow.amount }));
      const accountEndingValue = externalCashFlows.reduce((sum, flow) => sum - flow.amount, 0)
        + normalized.filter((flow) => flow.interestPayment).reduce((sum, flow) => sum + flow.amount, 0)
        + accruedBaseInterest;
      const simulation = {
        ...baseSimulation,
        csh2MoneyWeightedReturn: calculateMoneyWeightedReturn([...externalCashFlows, { date: valuationDate, amount: baseSimulation.netLiquidationValue }]),
        accountMoneyWeightedReturn: calculateMoneyWeightedReturn([...externalCashFlows, { date: valuationDate, amount: accountEndingValue }]),
        csh2TimeWeightedReturn: annualizedLinkedReturn(timeWeighted.csh2),
        accountTimeWeightedReturn: annualizedLinkedReturn(timeWeighted.account)
      } as Omit<BacktestResult, 'fidelityPremiumAssessments' | 'observedHoldingPeriods'>;
      return {
        csh2,
        overnight,
        timeWeighted,
        simulation,
        observedHoldingPeriods: firstPurchaseDate ? { from: firstPurchaseDate, ...findObservedHoldingPeriods(csh2.filter((point) => point.date >= firstPurchaseDate), overnight, firstPurchaseDate) } : {}
      };
    });

    const accountHistoryKey = JSON.stringify([normalized, valuationDate, accruedBaseInterest]);
    accountHistoryStage = getStage(accountHistoryStage, accountHistoryKey, () => buildAccountReturnSeries(normalized, valuationDate, calculationOptions));

    const currentRateModel = getCurrentRateModel(market.version, market.data.prices, market.rateData.rates, valuationDate, undefined, market.currentRateModel);
    const csh2AnnualRatePercent = scenarioRate(currentRateModel, settings.csh2RateScenario);
    const projectionAssumption = { csh2AnnualRatePercent };
    const scenarioKey = JSON.stringify([historicalKey, fidelityPremiums, settings.csh2RateScenario]);
    scenarioStage = getStage(scenarioStage, scenarioKey, () => ({
      breakEvenEstimate: estimateBreakEvenDate(normalized, market.data.prices, valuationDate, calculationOptions, projectionAssumption),
      marketProjection: fidelityPremiums.length ? buildMarketReturnProjection(normalized, market.data.prices, market.rateData.rates, valuationDate, firstInvestment.date, fidelityPremiums, calculationOptions, projectionAssumption) : undefined
    }));

    const accountBaseRateInput = settings.accountBaseInterestRate.trim();
    const accountBaseRate = accountBaseRateInput === '' ? undefined : Number(accountBaseRateInput);
    const accountBaseRateIsValid = Number.isFinite(accountBaseRate) && accountBaseRate! > -100;
    const bestSavingsBaseRateInput = settings.bestSavingsBaseInterestRate.trim();
    const bestSavingsBaseRate = bestSavingsBaseRateInput === '' ? undefined : Number(bestSavingsBaseRateInput);
    const bestSavingsBaseRateIsValid = Number.isFinite(bestSavingsBaseRate) && bestSavingsBaseRate! > -100;
    const accountRates: { baseAnnualRatePercent?: number; fidelityPremiumPercent?: number; bestSavingsBaseAnnualRatePercent?: number; bestSavingsFidelityPremiumPercent?: number } = accountBaseRateIsValid ? { baseAnnualRatePercent: accountBaseRate } : {};
    if (accountBaseRateInput !== '' && settings.accountFidelityPremium !== '') accountRates.fidelityPremiumPercent = Number(settings.accountFidelityPremium);
    if (bestSavingsBaseRateIsValid) accountRates.bestSavingsBaseAnnualRatePercent = bestSavingsBaseRate;
    if (bestSavingsBaseRateInput !== '' && settings.bestSavingsFidelityPremium !== '') accountRates.bestSavingsFidelityPremiumPercent = Number(settings.bestSavingsFidelityPremium);
    const projectedAccountKey = JSON.stringify([normalized, valuationDate, fidelityPremiums, accruedBaseInterest, accountRates.baseAnnualRatePercent]);
    projectedAccountStage = getStage(projectedAccountStage, projectedAccountKey, () => fidelityPremiums.length && accountBaseRateIsValid
      ? buildProjectedAccountReturnSeries(normalized, valuationDate, fidelityPremiums, calculationOptions, accountRates)
      : undefined);

    const fidelityPremiumAssessments = fidelityPremiums.length && !accountBaseRateIsValid
      ? []
      : assessFidelityPremiumTimings(market.data.prices, valuationDate, calculationOptions, fidelityPremiums, { ...projectionAssumption, ...accountRates }) as BacktestResult['fidelityPremiumAssessments'];
    const projected = scenarioStage.value.marketProjection && projectedAccountStage.value ? { ...scenarioStage.value.marketProjection, ...projectedAccountStage.value } : undefined;
    const portfolioValue = {
      csh2: portfolioValueSeries(observedStage.value.csh2, normalized),
      overnight: [],
      account: portfolioValueSeries(accountHistoryStage.value, normalized),
      projected: projected ? {
        ...projected,
        csh2: portfolioValueSeries(projected.csh2, normalized),
        overnight: [],
        account: portfolioValueSeries(projected.account, normalized)
      } : undefined
    };
    const result = {
      ...observedStage.value.simulation,
      fidelityPremiumAssessments,
      observedHoldingPeriods: observedStage.value.observedHoldingPeriods,
      breakEvenEstimate: scenarioStage.value.breakEvenEstimate
    } as BacktestResult;
    return {
      result,
      metadata: market.data,
      rateMetadata: market.rateData,
      settings: { ...settings },
      from: firstInvestment.date,
      to: valuationDate,
      returnSeries: { csh2: observedStage.value.csh2, overnight: observedStage.value.overnight, account: accountHistoryStage.value, projected, timeWeighted: observedStage.value.timeWeighted, portfolioValue }
    };
  };

  return { calculate, clear };
}

const backtestCalculator = createBacktestCalculator();

export function calculateBacktest(flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, today: string): CalculationView {
  return backtestCalculator.calculate(flows, settings, market, today);
}

export function clearBacktestStageCache() {
  backtestCalculator.clear();
}
