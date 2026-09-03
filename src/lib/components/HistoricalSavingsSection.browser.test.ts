import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import HistoricalSavingsSection from './HistoricalSavingsSection.svelte';
import { createBacktestController } from '../state/backtest.svelte';
import type { CalculationSettings, MarketDataBundle } from '../types';

describe('historical savings controls', () => {
  beforeEach(() => localStorage.clear());

  it('only reports calculated results after an explicit run and marks edits stale', async () => {
    let display: unknown;
    let submit: (() => Promise<void>) | undefined;
    render(HistoricalSavingsSection, { onResult: (next) => { display = next; }, onSubmitReady: (next) => { submit = next; } });
    await page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).fill('1');
    await page.getByLabelText('Rate 1 fidelity premium (%)', { exact: true }).fill('1');
    expect(display).toBeUndefined();
    await expect.poll(() => submit).toBeTruthy();
    await submit!();
    await expect.poll(() => display).toBeTruthy();
    await page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).fill('2');
    await expect.poll(() => display).toBeUndefined();
  });

  it('reports the three-way comparison for the selected deposit schedule', async () => {
    let display: any;
    let submit: (() => Promise<void>) | undefined;
    localStorage.setItem('csh2-belgium-historical-savings-v1', JSON.stringify({ rates: [{ id: 'rate-1', date: '2020-01-02', baseRate: '', fidelityPremium: '' }], endDate: '2021-01-04' }));
    render(HistoricalSavingsSection, { onResult: (next) => { display = next; }, onSubmitReady: (next) => { submit = next; } });
    await page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).fill('1');
    await page.getByLabelText('Rate 1 fidelity premium (%)', { exact: true }).fill('0.5');
    await submit!();
    await expect.poll(() => display?.scenario.label).toBe('€600 monthly deposits');
    expect(display.scenario.view.result.accountMoneyWeightedReturn).toBeDefined();
  });

  it('uses the same collapsible disclosure pattern as cash-flow entries', async () => {
    render(HistoricalSavingsSection);
    const disclosure = page.getByText('Historical rate changes', { exact: true }).element().closest('details')!;
    const summary = disclosure.querySelector('summary')!;
    expect(summary.classList.contains('disclosure-summary')).toBe(true);
    expect(getComputedStyle(summary, '::before').borderLeftColor).toBe('rgb(89, 112, 103)');
    expect(getComputedStyle(page.getByLabelText('Rate 1 base annual rate (%)').element()).fontSize).toBe('16px');
    await page.getByText('Historical rate changes', { exact: true }).click();
    expect(disclosure.open).toBe(false);
    await page.getByText('Historical rate changes', { exact: true }).click();
    expect(disclosure.open).toBe(true);
  });

  it('replaces rate rows with rates imported from the clipboard', async () => {
    render(HistoricalSavingsSection, {
      readClipboardRates: async () => [
        { date: '2026-07-15', baseRate: '1.67', fidelityPremium: '1.5' },
        { date: '2026-05-16', baseRate: '1.45', fidelityPremium: '1.5' }
      ]
    });
    await page.getByRole('button', { name: 'Import from clipboard', exact: true }).click();
    await expect.poll(() => (page.getByLabelText('Rate 1 effective date', { exact: true }).element() as HTMLInputElement).value).toBe('2026-05-16');
    expect((page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).element() as HTMLInputElement).value).toBe('1.45');
    expect((page.getByLabelText('Rate 2 fidelity premium (%)', { exact: true }).element() as HTMLInputElement).value).toBe('1.5');
  });

  it('asks for a column mapping when clipboard headers are ambiguous', async () => {
    render(HistoricalSavingsSection, {
      readClipboardRates: async () => ({
        kind: 'ambiguous' as const,
        table: {
          columns: ['When it applies', 'Rate A', 'Rate B'],
          rows: [['2025-01-01', '1,35%', '1,50%']],
          suggestedMapping: {}
        }
      })
    });
    await page.getByRole('button', { name: 'Import from clipboard', exact: true }).click();
    await expect.poll(() => page.getByRole('heading', { name: 'Map clipboard columns' }).element()).toBeTruthy();
    await page.getByLabelText('Clipboard effective date column', { exact: true }).selectOptions('0');
    await page.getByLabelText('Clipboard base annual rate column', { exact: true }).selectOptions('1');
    await page.getByLabelText('Clipboard fidelity premium column', { exact: true }).selectOptions('2');
    await page.getByRole('button', { name: 'Import mapped rates', exact: true }).click();
    await expect.poll(() => (page.getByLabelText('Rate 1 effective date', { exact: true }).element() as HTMLInputElement).value).toBe('2025-01-01');
    expect((page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).element() as HTMLInputElement).value).toBe('1.35');
    expect((page.getByLabelText('Rate 1 fidelity premium (%)', { exact: true }).element() as HTMLInputElement).value).toBe('1.5');
  });

  it('recalculates after global settings change in historical mode', async () => {
    const market = { data: { cachedAt: '2026-08-10T00:00:00Z', prices: {} }, rateData: { rates: {} }, cpiData: { indices: {} } } as MarketDataBundle;
    const settingsChanges: Array<CalculationSettings> = [];
    let submit: (() => Promise<void>) | undefined;
    const controller = createBacktestController({
      storage: localStorage,
      today: () => '2026-08-10',
      loadMarketData: async () => market,
      calculate: () => ({}) as never,
      prepareBenchmark: async () => ({}) as never
    });
    const calculateComparison = (_input: unknown, settings: CalculationSettings) => {
      settingsChanges.push({ ...settings });
      return { from: '2020-01-02', to: '2021-01-04', monthly: {}, lumpSum: {} } as never;
    };
    render(HistoricalSavingsSection, { controller, active: true, loadMarketDataFn: async () => market, calculateComparison, onSubmitReady: (next) => { submit = next; } });
    await page.getByLabelText('Rate 1 effective date', { exact: true }).fill('2020-01-02');
    await page.getByLabelText('Rate 1 base annual rate (%)', { exact: true }).fill('1');
    await page.getByLabelText('Rate 1 fidelity premium (%)', { exact: true }).fill('0.5');
    await expect.poll(() => submit).toBeTruthy();
    await submit!();
    await expect.poll(() => settingsChanges.length).toBe(1);
    controller.updateSetting('accountBaseInterestRate', '3');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(settingsChanges).toHaveLength(1);

    await controller.setTaxRegime('reynders');
    await expect.poll(() => settingsChanges.length).toBe(2);
    await controller.setCsh2RateScenario('optimistic');
    await expect.poll(() => settingsChanges.length).toBe(3);
    await controller.setReturnMode('real');
    await expect.poll(() => settingsChanges.length).toBe(4);
    expect(settingsChanges.slice(1).map((settings) => [settings.applyReyndersTax, settings.csh2RateScenario, settings.returnMode])).toEqual([
      [true, 'base', 'nominal'],
      [true, 'optimistic', 'nominal'],
      [true, 'optimistic', 'real']
    ]);
  });
});
