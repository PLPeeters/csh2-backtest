import { beforeEach, describe, expect, it } from 'vitest';
import prices from '../../assets/data/csh2-prices.json';
import rates from '../../assets/data/overnight-rates.json';
import type { CalculationSettings, CashFlowDraft, MarketDataBundle } from '../types';
import { calculateBacktest, clearBacktestStageCache, createBacktestCalculator } from './backtest';
import { clearCurrentRateModelCache } from './current-rate-model-cache.mjs';

const market = { data: prices, rateData: rates, version: 'published-test-data' } as MarketDataBundle;
const flows: CashFlowDraft[] = [{ id: 'flow-1', date: '2026-01-02', type: 'inflow', amount: '10000', interestPayment: false }];
const settings: CalculationSettings = {
  applyCapitalGainsExemption: true,
  applyReyndersTax: false,
  buyWholeSharesOnly: false,
  accruedBaseInterest: '10',
  fidelityPremiums: [{ id: 'premium-1', baseAmount: '5000', earnedDate: '2027-03-01', finalPayoutAmount: '75' }],
  brokerTransactionFee: '0',
  accountBaseInterestRate: '1.5',
  accountFidelityPremium: '0.5',
  bestSavingsBaseInterestRate: '1.5',
  bestSavingsFidelityPremium: '0.5',
  totalSavingsAmount: '',
  csh2RateScenario: 'base'
};

function changedSettings(change: Partial<CalculationSettings>): CalculationSettings {
  return { ...settings, ...change, fidelityPremiums: change.fidelityPremiums ?? settings.fidelityPremiums.map((premium) => ({ ...premium })) };
}

describe('bounded backtest stage cache', () => {
  beforeEach(() => {
    clearCurrentRateModelCache();
    clearBacktestStageCache();
  });

  it('withholds fidelity timing without a valid base rate and accepts an explicit zero rate', () => {
    const calculator = createBacktestCalculator();
    const missing = calculator.calculate(flows, changedSettings({ accountBaseInterestRate: '' }), market, '2026-08-20');
    const blank = calculator.calculate(flows, changedSettings({ accountBaseInterestRate: ' ' }), market, '2026-08-20');
    const invalid = calculator.calculate(flows, changedSettings({ accountBaseInterestRate: 'not-a-rate' }), market, '2026-08-20');
    const zero = calculator.calculate(flows, changedSettings({ accountBaseInterestRate: '0' }), market, '2026-08-20');

    expect(missing.result.fidelityPremiumAssessments).toEqual([]);
    expect(blank.result.fidelityPremiumAssessments).toEqual([]);
    expect(invalid.result.fidelityPremiumAssessments).toEqual([]);
    expect(missing.returnSeries.projected).toBeUndefined();
    expect(invalid.returnSeries.projected).toBeUndefined();
    expect(zero.result.fidelityPremiumAssessments).toHaveLength(1);
    expect(zero.result.fidelityPremiumAssessments[0].waitingValue).toBeGreaterThan(0);
  });

  it('exposes honest euro values separately from cash-flow-neutral performance', () => {
    const view = createBacktestCalculator().calculate(flows, settings, market, '2026-08-20');

    expect(view.returnSeries.portfolioValue.csh2.at(-1)?.value).toBeCloseTo(view.result.netLiquidationValue, 2);
    expect(view.returnSeries.portfolioValue.account.at(-1)?.value).toBeCloseTo(10010, 10);
    expect(view.returnSeries.portfolioValue.overnight).toEqual([]);
    expect(view.returnSeries.timeWeighted.csh2.length).toBeGreaterThan(1);
    expect(view.returnSeries.timeWeighted.account.at(-1)?.value).toBeCloseTo(0.1, 10);
    expect(view.result.csh2MoneyWeightedReturn).toBeTypeOf('number');
    expect(view.result.accountMoneyWeightedReturn).toBeTypeOf('number');
  });

  it('reuses observed and scenario-independent projection history for account-rate-only changes', () => {
    const calculator = createBacktestCalculator();
    const initial = calculator.calculate(flows, settings, market, '2026-08-20');
    const changed = calculator.calculate(flows, changedSettings({ accountBaseInterestRate: '2.25' }), market, '2026-08-20');

    expect(changed.returnSeries.csh2).toBe(initial.returnSeries.csh2);
    expect(changed.returnSeries.overnight).toBe(initial.returnSeries.overnight);
    expect(changed.returnSeries.account).toBe(initial.returnSeries.account);
    expect(changed.returnSeries.projected?.csh2).toBe(initial.returnSeries.projected?.csh2);
    expect(changed.returnSeries.projected?.overnight).toBe(initial.returnSeries.projected?.overnight);
    expect(changed.returnSeries.projected?.account).not.toBe(initial.returnSeries.projected?.account);
  });

  it('reuses observed history while rebuilding scenario-dependent results', () => {
    const calculator = createBacktestCalculator();
    const initial = calculator.calculate(flows, settings, market, '2026-08-20');
    const changed = calculator.calculate(flows, changedSettings({ csh2RateScenario: 'optimistic' }), market, '2026-08-20');

    expect(changed.returnSeries.csh2).toBe(initial.returnSeries.csh2);
    expect(changed.returnSeries.overnight).toBe(initial.returnSeries.overnight);
    expect(changed.returnSeries.account).toBe(initial.returnSeries.account);
    expect(changed.returnSeries.projected?.csh2).not.toBe(initial.returnSeries.projected?.csh2);
    expect(changed.returnSeries.projected?.csh2AnnualRatePercent).not.toBe(initial.returnSeries.projected?.csh2AnnualRatePercent);
  });

  const invalidatingChanges: Array<[string, CashFlowDraft[], CalculationSettings]> = [
    ['cash flow', [{ ...flows[0], amount: '12000' }], settings],
    ['transaction cost', flows, changedSettings({ brokerTransactionFee: '5' })],
    ['share purchase mode', flows, changedSettings({ buyWholeSharesOnly: true })],
    ['capital-gains exemption', flows, changedSettings({ applyCapitalGainsExemption: false })],
    ['tax regime', flows, changedSettings({ applyReyndersTax: true })]
  ];

  it.each(invalidatingChanges)('invalidates affected observed stages for a %s change', (_name, nextFlows, nextSettings) => {
    const calculator = createBacktestCalculator();
    const initial = calculator.calculate(flows, settings, market, '2026-08-20');
    const changed = calculator.calculate(nextFlows, nextSettings, market, '2026-08-20');

    expect(changed.returnSeries.csh2).not.toBe(initial.returnSeries.csh2);
    expect(changed.returnSeries.overnight).not.toBe(initial.returnSeries.overnight);
    expect(changed.result.entries).not.toBe(initial.result.entries);
  });

  const parityChanges: Array<[string, CashFlowDraft[], CalculationSettings]> = [
    ['account base rate', flows, changedSettings({ accountBaseInterestRate: '2.25' })],
    ['account fidelity rate', flows, changedSettings({ accountFidelityPremium: '0.75' })],
    ['CSH2 scenario', flows, changedSettings({ csh2RateScenario: 'cautious' })],
    ...invalidatingChanges
  ];

  it.each(parityChanges)('matches a clean full calculation after a %s change', (_name, nextFlows, nextSettings) => {
    const incremental = createBacktestCalculator();
    incremental.calculate(flows, settings, market, '2026-08-20');

    const reused = incremental.calculate(nextFlows, nextSettings, market, '2026-08-20');
    const clean = createBacktestCalculator().calculate(nextFlows, nextSettings, market, '2026-08-20');

    expect(reused).toEqual(clean);
  });

  it('retains only the latest market dataset', () => {
    const calculator = createBacktestCalculator();
    const first = calculator.calculate(flows, settings, market, '2026-08-20');
    const replacementMarket = { ...market, version: 'replacement-data' };
    calculator.calculate(flows, settings, replacementMarket, '2026-08-20');
    const revisited = calculator.calculate(flows, settings, market, '2026-08-20');

    expect(revisited.returnSeries.csh2).not.toBe(first.returnSeries.csh2);
    expect(revisited).toEqual(first);
  });

  it('returns equivalent calculation results before and after default cache reuse', () => {
    const initiallyCalculated = calculateBacktest(flows, settings, market, '2026-08-20');
    const repeated = calculateBacktest(flows, settings, market, '2026-08-20');
    expect(repeated).toEqual(initiallyCalculated);

    clearBacktestStageCache();
    clearCurrentRateModelCache();
    expect(calculateBacktest(flows, settings, market, '2026-08-20')).toEqual(initiallyCalculated);
  });
});
