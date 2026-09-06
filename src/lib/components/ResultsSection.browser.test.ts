import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it } from 'vitest';
import '../../app.css';
import ResultsSection from './ResultsSection.svelte';
import FutureOutlookSection from './FutureOutlookSection.svelte';
import type { BacktestController } from '../state/backtest.svelte';
import type { CalculationView } from '../types';

const emptyComparisonSeries = () => ({ csh2: [], overnight: [], account: [] });

const viewForReturns = (csh2MoneyWeightedReturn: number | undefined, accountMoneyWeightedReturn: number | undefined, csh2TimeWeightedReturn = 0, accountTimeWeightedReturn = 0): CalculationView => ({
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
    missedAmount: (csh2MoneyWeightedReturn ?? 0) - (accountMoneyWeightedReturn ?? 0),
    csh2MoneyWeightedReturn,
    accountMoneyWeightedReturn,
    csh2TimeWeightedReturn,
    accountTimeWeightedReturn,
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
  await page.getByText('Costs and calculation details', { exact: true }).click();
  await expect.element(page.getByText('Annualized outcome (MWR)', { exact: true })).toBeVisible();
  const results = page.getByRole('heading', { name: 'How the net value is formed' }).element().closest('.comparison-results')!;
  return {
    outcome: results.querySelector('.result-summary-outcome')!,
    returns: page.getByText('Annualized outcome (MWR)', { exact: true }).element().closest('tr')!
  };
};

const viewForBaselineDetails = (): CalculationView => {
  const base = viewForReturns(-0.1, 0.05);
  const holding = { date: '2026-03-01', days: 59 };
  return {
    ...base,
    result: {
      ...base.result,
      missedAmount: -10,
      projectedCrossover: { date: '2026-04-01', days: 90, trailing: 'csh2' },
      observedHoldingPeriods: { from: '2026-01-01', breakEven: holding, matchOvernight: { date: '2026-05-01', days: 120 } },
      fidelityPremiumAssessments: [{
        id: 'detail', baseAmount: 100, earnedDate: '2026-01-01', finalPayoutAmount: 5,
        currentPeriodPreferred: 'either', currentPeriodDifference: 0, immediateValue: 100, waitingValue: 100,
        recommendation: 'keep in account', transferAllocations: [], csh2AnnualRatePercent: 2,
        nextYearCsh2Value: 110, nextYearAccountValue: 100, nextYearBestAccountValue: 100
      }]
    }
  };
};

const backgroundColor = (element: Element) => element.ownerDocument.defaultView!.getComputedStyle(element).backgroundColor;

const renderFutureOutlook = async (view: CalculationView) => render(FutureOutlookSection, {
  controller: { view, settings: view.settings, benchmark: undefined, benchmarkStatus: { kind: 'idle', message: '' }, cpiData: undefined } as unknown as BacktestController,
  setupTab: 'current'
});

describe('outcome summary emphasis', () => {
  it('uses the positive outcome treatment when CSH2 is ahead', async () => {
    const summary = await renderReturns(0.1, 0.05);
    expect(summary.outcome.classList.contains('negative')).toBe(false);
    expect(backgroundColor(summary.outcome)).toBe('rgb(29, 79, 62)');
  });

  it('uses the negative outcome treatment when CSH2 is behind', async () => {
    const summary = await renderReturns(-0.1, 0.05);
    expect(summary.outcome.classList.contains('negative')).toBe(true);
    expect(backgroundColor(summary.outcome)).toBe('rgb(138, 48, 38)');
  });

  it('exposes both return values and the difference in the comparison table', async () => {
    const summary = await renderReturns(0.1, -0.05);
    expect(summary.returns.querySelectorAll('td')).toHaveLength(3);
    expect(summary.returns.textContent).toContain('0,1%');
    expect(summary.returns.textContent).toContain('-0,05%');
  });

  it('keeps equal outcomes neutral', async () => {
    const summary = await renderReturns(0.05, 0.05);
    expect(summary.outcome.classList.contains('comparison-secondary')).toBe(true);
  });

  it('calculates displayed MWR and TWR differences from displayed precision', async () => {
    await render(ResultsSection, { controller: { view: viewForReturns(2.246, 1.551, 2.246, 1.551) } as unknown as BacktestController });
    const outcome = page.getByText(/CSH2 is ahead of your account balance by/).nth(0).element().closest('article')!;
    expect(outcome.textContent).toContain('+0,7 p.p. p.a. (MWR)');
    await page.getByText('Costs and calculation details', { exact: true }).click();
    const rows = page.getByRole('table').filter({ has: page.getByText('Annualized outcome (MWR)', { exact: true }) }).getByRole('row').all();
    const returnRows = await rows;
    await expect.element(returnRows[1]).toHaveTextContent('2,25%1,55%+0,7 p.p.');
    await expect.element(returnRows[2]).toHaveTextContent('2,25%1,55%+0,7 p.p.');
  });
});

describe('current result content parity', () => {
  it('capitalizes an unprefixed suggested transfer and keeps the next-year alternative on a second line', async () => {
    const view = viewForBaselineDetails();
    view.result = {
      ...view.result,
      fidelityPremiumAssessments: [{ ...view.result.fidelityPremiumAssessments[0], recommendation: 'move now', nextYearCsh2Value: 110, nextYearAccountValue: 100, nextYearBestAccountValue: 100 }]
    };
    await renderFutureOutlook(view);

    await expect.element(page.getByRole('heading', { name: 'Transfer this amount to CSH2 now.' })).toBeVisible();
    const nextYear = document.querySelector('.fidelity-outlook tbody td:nth-child(5)')!;
    expect(nextYear.querySelector('.next-year-alternative')?.textContent).toBe('Best savings account effectively equal');
    expect(nextYear.textContent).not.toContain(' · ');
  });

  it('uses compact net values and a return difference in the result summary', async () => {
    await render(ResultsSection, { controller: { view: viewForBaselineDetails() } as unknown as BacktestController });

    const csh2 = page.getByText('Net CSH2 value if sold today', { exact: true }).element().closest('article')!;
    const account = page.getByText('Account value if sold today', { exact: true }).element().closest('article')!;
    const difference = page.getByText(/CSH2 is behind your account balance by/, { exact: true }).element().closest('article')!;
    expect(csh2.closest('.result-summary-support-item')?.classList.contains('result-summary-support-item')).toBe(true);
    expect(account.closest('.result-summary-support-item')?.classList.contains('result-summary-support-item')).toBe(true);
    expect(difference.classList.contains('result-summary-outcome')).toBe(true);
    expect(difference.classList.contains('result-summary-card')).toBe(true);
    const summaryPadding = [csh2.closest('.result-summary-support-item')!, account.closest('.result-summary-support-item')!].map((card) => getComputedStyle(card).padding);
    expect(summaryPadding[1]).toBe(summaryPadding[0]);
    expect(csh2.querySelector('small')?.textContent).toBe('-0,1% p.a. (MWR)');
    expect(account.querySelector('small')?.textContent).toBe('0,05% p.a. (MWR)');
    expect(difference.querySelector('small')?.textContent).toBe('−0,15 p.p. p.a. (MWR)');
    expect(difference.querySelector('small b')?.textContent).toBe('−0,15');
    expect(page.getByRole('heading', { name: 'How the net value is formed' })).toBeVisible();
  });

  it('keeps forward-looking catch-up and fidelity timing out of the outcome', async () => {
    await render(ResultsSection, { controller: { view: viewForBaselineDetails() } as unknown as BacktestController });
    await expect.element(page.getByText('Fidelity premium timing', { exact: true })).toHaveLength(0);
    await page.getByText('Costs and calculation details', { exact: true }).click();
    await expect.element(page.getByText(/Estimated .*catch-up/)).toHaveLength(0);
    await expect.element(page.getByText('(using the selected CSH2 rate scenario of 2%)', { exact: true })).not.toBeInTheDocument();
  });

  it('shows no forward catch-up estimate in the outcome', async () => {
    const reverse = viewForBaselineDetails();
    reverse.result = { ...reverse.result, missedAmount: 10, projectedCrossover: { date: '2026-04-01', days: 90, trailing: 'account' } };
    await render(ResultsSection, { controller: { view: reverse } as unknown as BacktestController });
    await expect.element(page.getByText(/Estimated Account catch-up with CSH2 in/)).toHaveLength(0);

    const noCrossingBase = viewForBaselineDetails();
    const noCrossing = {
      ...noCrossingBase,
      result: { ...noCrossingBase.result, projectedCrossover: undefined },
      returnSeries: {
        ...noCrossingBase.returnSeries,
        portfolioValue: {
          ...noCrossingBase.returnSeries.portfolioValue,
          projected: { csh2: [], overnight: [], account: [], throughDate: '2026-12-01', csh2AnnualRatePercent: 2, overnightRatePercent: 1 }
        }
      }
    };
    await render(ResultsSection, { controller: { view: noCrossing } as unknown as BacktestController });
    await expect.element(page.getByText(/catch-up .*can’t be estimated within the displayed projection/i)).not.toBeInTheDocument();
  });

  it('places the historical performance before the transaction ledger', async () => {
    await render(ResultsSection, { controller: { view: viewForBaselineDetails() } as unknown as BacktestController });
    await page.getByText('Costs and calculation details', { exact: true }).click();
    await page.getByText('Transaction ledger', { exact: true }).nth(0).click();
    const performance = page.getByRole('heading', { name: 'Cash-flow-neutral performance' }).element().closest('section')!;
    const costsDisclosure = page.getByText('Costs and calculation details', { exact: true }).element().closest('details')!;
    const ledger = page.getByRole('heading', { name: 'Transaction ledger' }).element().closest('section')!;
    expect(performance.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(costsDisclosure).marginTop).toBe('16px');
    expect(costsDisclosure.getBoundingClientRect().top - performance.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(16);
    await expect.element(page.getByText('Fidelity premium timing', { exact: true })).toHaveLength(0);
  });
});
