import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it } from 'vitest';
import '../../app.css';
import ResultsSection from './ResultsSection.svelte';
import type { BacktestController } from '../state/backtest.svelte';
import type { CalculationView } from '../types';

const emptyComparisonSeries = () => ({ csh2: [], overnight: [], account: [] });

const viewForReturns = (csh2MoneyWeightedReturn: number | undefined, accountMoneyWeightedReturn: number | undefined): CalculationView => ({
  result: {
    valuation: { date: '2026-08-08', price: 100 },
    netLiquidationValue: 100,
    grossValue: 100,
    units: 1,
    availableCash: 0,
    paidTob: 0,
    paidCgt: 0,
    paidReyndersTax: 0,
    terminalTob: 0,
    terminalCgt: 0,
    terminalReyndersTax: 0,
    paidBrokerFees: 0,
    terminalBrokerFee: 0,
    missedAmount: 0,
    csh2MoneyWeightedReturn,
    accountMoneyWeightedReturn,
    csh2TimeWeightedReturn: 0,
    accountTimeWeightedReturn: 0,
    entries: [],
    observedHoldingPeriods: {},
    fidelityPremiumAssessments: []
  },
  metadata: { cachedAt: '2026-08-08T00:00:00.000Z', prices: {} },
  rateMetadata: { cachedAt: '2026-08-08T00:00:00.000Z', rates: {} },
  cpiMetadata: {
    source: 'test', dataSourceId: 'test', backfillViewId: 'test', currentViewId: 'test', license: 'test',
    adaptations: 'test', cachedAt: '2026-08-08T00:00:00.000Z', base: 'test', indices: { '2026-01': 100, '2026-08': 101 }
  },
  settings: {
    applyCapitalGainsExemption: false,
    applyReyndersTax: false,
    buyWholeSharesOnly: false,
    accruedBaseInterest: '0',
    fidelityPremiums: [],
    brokerTransactionFee: '0',
    accountBaseInterestRate: '0',
    accountFidelityPremium: '0',
    bestSavingsBaseInterestRate: '0',
    bestSavingsFidelityPremium: '0',
    totalSavingsAmount: '100',
    csh2RateScenario: 'base',
    returnMode: 'nominal'
  },
  returnSeries: {
    ...emptyComparisonSeries(),
    timeWeighted: emptyComparisonSeries(),
    portfolioValue: emptyComparisonSeries()
  },
  from: '2026-01-01',
  to: '2026-08-08'
});

const renderReturns = async (csh2: number, account: number) => {
  await render(ResultsSection, { controller: { view: viewForReturns(csh2, account) } as unknown as BacktestController });
  await expect.element(page.getByText('CSH2 annualized money-weighted return', { exact: true })).toBeVisible();
  return {
    csh2: page.getByText('CSH2 annualized money-weighted return', { exact: true }).element().closest('article')!,
    account: page.getByText('Account annualized money-weighted return', { exact: true }).element().closest('article')!
  };
};

const backgroundColor = (element: Element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor;

describe('annualized money-weighted return cards', () => {
  it('uses dark and light green for positive returns, with the lower return lighter', async () => {
    const cards = await renderReturns(0.1, 0.05);

    expect(cards.csh2.classList.contains('negative')).toBe(false);
    expect(cards.csh2.classList.contains('comparison-secondary')).toBe(false);
    expect(cards.account.classList.contains('negative')).toBe(false);
    expect(cards.account.classList.contains('comparison-secondary')).toBe(true);
    expect(backgroundColor(cards.csh2)).toBe('rgb(29, 79, 62)');
    expect(backgroundColor(cards.account)).toBe('rgb(231, 241, 236)');
  });

  it('uses dark and light red for negative returns, with the less negative return lighter', async () => {
    const cards = await renderReturns(-0.1, -0.05);

    expect(cards.csh2.classList.contains('negative')).toBe(true);
    expect(cards.csh2.classList.contains('comparison-secondary')).toBe(false);
    expect(cards.account.classList.contains('negative')).toBe(true);
    expect(cards.account.classList.contains('comparison-secondary')).toBe(true);
    expect(backgroundColor(cards.csh2)).toBe('rgb(138, 48, 38)');
    expect(backgroundColor(cards.account)).toBe('rgb(255, 245, 243)');
  });

  it('colors mixed-sign returns independently', async () => {
    const cards = await renderReturns(0.1, -0.05);

    expect(cards.csh2.classList.contains('negative')).toBe(false);
    expect(cards.csh2.classList.contains('comparison-secondary')).toBe(false);
    expect(cards.account.classList.contains('negative')).toBe(true);
    expect(cards.account.classList.contains('comparison-secondary')).toBe(false);
    expect(backgroundColor(cards.csh2)).toBe('rgb(29, 79, 62)');
    expect(backgroundColor(cards.account)).toBe('rgb(138, 48, 38)');
  });

  it('keeps equal returns symmetric without marking either as secondary', async () => {
    const cards = await renderReturns(-0.05, -0.05);

    expect(cards.csh2.classList.contains('negative')).toBe(true);
    expect(cards.account.classList.contains('negative')).toBe(true);
    expect(cards.csh2.classList.contains('comparison-secondary')).toBe(false);
    expect(cards.account.classList.contains('comparison-secondary')).toBe(false);
    expect(backgroundColor(cards.csh2)).toBe('rgb(138, 48, 38)');
    expect(backgroundColor(cards.account)).toBe('rgb(138, 48, 38)');
  });

  it('keeps equal positive returns symmetric without marking either as secondary', async () => {
    const cards = await renderReturns(0.05, 0.05);

    expect(cards.csh2.classList.contains('negative')).toBe(false);
    expect(cards.account.classList.contains('negative')).toBe(false);
    expect(cards.csh2.classList.contains('comparison-secondary')).toBe(false);
    expect(cards.account.classList.contains('comparison-secondary')).toBe(false);
    expect(backgroundColor(cards.csh2)).toBe('rgb(29, 79, 62)');
    expect(backgroundColor(cards.account)).toBe('rgb(29, 79, 62)');
  });
});
