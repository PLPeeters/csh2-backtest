import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App.svelte';
import { createBacktestController } from './lib/state/backtest.svelte';
import type { CalculationSettings, CalculationView, MarketDataBundle } from './lib/types';

describe('CSH2 application inputs', () => {
  beforeEach(() => localStorage.clear());

  it('loads defaults, adds flows, and restores the documented example', async () => {
    render(App);
    await expect.element(page.getByRole('heading', { name: 'CSH2 backtester' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Calculate with latest data' })).toBeDisabled();
    await page.getByRole('button', { name: 'Add cash flow' }).click();
    await expect.element(page.getByLabelText('Date')).toHaveLength(2);
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect.element(page.getByLabelText('Date')).toHaveLength(3);
    await expect.element(page.getByRole('button', { name: 'Calculate with latest data' })).toBeEnabled();
  });

  it('recovers malformed storage and preserves the CGT preference while Reynders Tax is active', async () => {
    localStorage.setItem('csh2-belgium-flows-v1', '{broken');
    render(App);
    await expect.element(page.getByRole('button', { name: 'Calculate with latest data' })).toBeDisabled();
    expect(localStorage.getItem('csh2-belgium-flows-v1')).toBeNull();
    const exemption = page.getByRole('checkbox', { name: 'Apply the annual capital-gains exemption' });
    await page.getByRole('checkbox', { name: 'Apply Reynders Tax instead of CGT' }).click();
    await expect.element(exemption).toBeDisabled();
    await expect.element(exemption).toBeChecked();
  });

  it('calculates the example and remembers independent benchmark periods', async () => {
    render(App);
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(page.getByRole('heading', { name: 'Backtest result' })).toBeVisible();
    await page.getByRole('group', { name: 'Backward comparison period' }).getByRole('button', { name: '3M' }).click();
    await page.getByRole('button', { name: 'Forward' }).click();
    await page.getByRole('group', { name: 'Forward comparison period' }).getByRole('button', { name: '1M' }).click();
    await page.getByRole('button', { name: 'Backward' }).click();
    await expect.element(page.getByRole('group', { name: 'Backward comparison period' }).getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Forward' }).click();
    await expect.element(page.getByRole('group', { name: 'Forward comparison period' }).getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks edited results as stale and refreshes the chart for calculation settings', async () => {
    render(App);
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(page.getByRole('heading', { name: 'Backtest result' })).toBeVisible();
    const staleMessage = page.getByText('Inputs have changed. The results below still reflect your last calculation. Calculate again to update them.');
    const chart = page.getByLabelText('Cumulative CSH2 backtest return compared with a euro overnight benchmark portfolio using the same cash flows');
    const initialChart = await chart.screenshot({ base64: true, save: false });
    const exemption = page.getByRole('checkbox', { name: 'Apply the annual capital-gains exemption' });

    await exemption.click();
    await expect.element(staleMessage).toBeVisible();
    await exemption.click();
    await expect.element(staleMessage).not.toBeInTheDocument();

    await exemption.click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(staleMessage).not.toBeInTheDocument();
    const exemptionChart = await chart.screenshot({ base64: true, save: false });
    expect(exemptionChart).not.toBe(initialChart);

    await page.getByRole('checkbox', { name: 'Buy whole shares only' }).click();
    await expect.element(staleMessage).toBeVisible();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    const fractionalChart = await chart.screenshot({ base64: true, save: false });
    expect(fractionalChart).not.toBe(exemptionChart);

    await page.getByRole('checkbox', { name: 'Apply Reynders Tax instead of CGT' }).click();
    await expect.element(staleMessage).toBeVisible();
    await expect.element(page.getByText('CGT', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(page.getByText('Reynders Tax', { exact: true })).toBeVisible();
    const reyndersChart = await chart.screenshot({ base64: true, save: false });
    expect(reyndersChart).not.toBe(fractionalChart);
  });

  it('calculates from the submitted snapshot when inputs change during loading', async () => {
    let resolveMarket!: (market: MarketDataBundle) => void;
    const market = { data: { cachedAt: '2026-08-09T00:00:00Z', prices: {} }, rateData: { rates: {} }, version: 'test' } as MarketDataBundle;
    const marketPromise = new Promise<MarketDataBundle>((resolve) => { resolveMarket = resolve; });
    let calculatedSettings: CalculationSettings | undefined;
    const controller = createBacktestController({
      storage: localStorage,
      today: () => '2026-08-09',
      loadMarketData: () => marketPromise,
      calculate: (_flows, settings) => {
        calculatedSettings = { ...settings };
        return { settings: { ...settings }, result: { valuation: { date: '2026-08-08' } }, metadata: market.data, returnSeries: { csh2: [], overnight: [] }, from: '2026-08-08', to: '2026-08-08' } as unknown as CalculationView;
      },
      prepareBenchmark: async () => ({}) as never
    });

    const calculation = controller.calculate();
    controller.updateSetting('buyWholeSharesOnly', false);
    resolveMarket(market);
    await calculation;

    expect(calculatedSettings?.buyWholeSharesOnly).toBe(true);
    expect(controller.view?.settings.buyWholeSharesOnly).toBe(true);
    expect(controller.resultIsStale).toBe(true);
  });
});
