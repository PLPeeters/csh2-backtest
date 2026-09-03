import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import HistoricalSavingsResults from './HistoricalSavingsResults.svelte';

const view = {
  result: {
    valuation: { date: '2026-08-08', price: 100 }, netLiquidationValue: 100, grossValue: 100, units: 1, availableCash: 0,
    paidTob: 0, paidCgt: 0, paidReyndersTax: 0, terminalTob: 0, terminalCgt: 0, terminalReyndersTax: 0,
    paidBrokerFees: 0, terminalBrokerFee: 0, missedAmount: 0, csh2MoneyWeightedReturn: 1, accountMoneyWeightedReturn: 2,
    csh2TimeWeightedReturn: 1, accountTimeWeightedReturn: 2, entries: [], observedHoldingPeriods: {}, fidelityPremiumAssessments: []
  },
  metadata: { cachedAt: '2026-08-08T00:00:00.000Z', prices: {} },
  rateMetadata: { cachedAt: '2026-08-08T00:00:00.000Z', rates: {} },
  cpiMetadata: { cachedAt: '2026-08-08T00:00:00.000Z', indices: {} },
  settings: { applyCapitalGainsExemption: false, applyReyndersTax: false, buyWholeSharesOnly: false, accruedBaseInterest: '0', fidelityPremiums: [], brokerTransactionFee: '0', accountBaseInterestRate: '0', accountFidelityPremium: '0', bestSavingsBaseInterestRate: '0', bestSavingsFidelityPremium: '0', totalSavingsAmount: '10000', csh2RateScenario: 'base', returnMode: 'nominal' },
  returnSeries: { csh2: [], overnight: [], account: [], timeWeighted: { csh2: [], overnight: [], account: [] }, portfolioValue: { csh2: [], overnight: [], account: [] } },
  from: '2026-01-01', to: '2026-08-08'
} as never;

const display = (scenario: 'monthly' | 'lumpSum' = 'monthly') => ({
  from: '2026-01-01', to: '2026-08-08', scenario: {
    label: scenario === 'monthly' ? '€600 monthly deposits' : '€10,000 initial deposit',
    view, flows: [], savings: { deposits: [{ date: '2026-01-01', amount: 600 }], totalDeposited: 600, baseInterestEarned: 1, fidelityPremiumCredited: 2, fidelityPremiumPending: 0, endingBalance: 603, economicValue: 603, accruedBaseInterest: 0, series: [] }
  }
});

describe('historical savings result placement', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the full result wrapper within the viewport at narrow widths', async () => {
    await page.viewport(390, 844);
    render(HistoricalSavingsResults, { display: display() });
    await expect.element(page.getByRole('heading', { name: 'Backtest result' })).toBeVisible();
    const results = page.getByRole('heading', { name: 'Backtest result' }).element().closest('#results')!;
    expect(results.scrollWidth).toBeLessThanOrEqual(results.clientWidth);
    expect(results.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    await page.viewport(1280, 720);
  });

  it('renders the schedule picker alongside the shared result output', async () => {
    let selected: string | undefined;
    render(HistoricalSavingsResults, { display: display(), onScenarioChange: (scenario) => { selected = scenario; } });
    const picker = page.getByRole('group', { name: 'Historical deposit scenario' });
    await expect.element(picker.getByRole('button', { name: '€600 monthly deposits' })).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: '€10,000 initial deposit' }).click();
    expect(selected).toBe('lumpSum');
  });

  it('defaults the historical savings chart to Performance', async () => {
    render(HistoricalSavingsResults, { display: display() });
    const picker = page.getByRole('group', { name: 'Performance chart view' });
    await expect.element(picker.getByRole('button', { name: 'Performance' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(picker.getByRole('button', { name: 'Portfolio value' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels terminal values against the selected historical end date', async () => {
    render(HistoricalSavingsResults, { display: display() });
    await expect.element(page.getByText('Net value at end date', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Taxes if sold at end date', { exact: true })).toBeVisible();
    await expect.element(page.getByText(/Paid .* if sold at end date/)).toBeVisible();
    expect(page.getByText('Net value if sold today', { exact: true }).query()).toBeNull();
  });

  it('labels acquired premiums that are still awaiting credit explicitly', async () => {
    render(HistoricalSavingsResults, { display: display() });
    await expect.element(page.getByText('Fidelity premiums acquired, pending credit', { exact: true })).toBeVisible();
  });

  it('places historical interest metric cards before the transaction ledger', async () => {
    render(HistoricalSavingsResults, { display: display() });
    const heading = page.getByRole('heading', { name: 'Historical savings interest details' }).element();
    const details = heading.closest('.historical-savings-details')!;
    const ledger = page.getByRole('heading', { name: 'Transaction ledger' }).element().closest('section')!;
    expect(details.tagName).toBe('DIV');
    expect(details.classList.contains('panel')).toBe(false);
    expect(details.querySelectorAll('article.metric')).toHaveLength(5);
    expect(details.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
