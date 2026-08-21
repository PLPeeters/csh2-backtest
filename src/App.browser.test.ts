import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import './app.css';
import App from './App.svelte';
import { createBacktestController } from './lib/state/backtest.svelte';
import { duration } from './lib/services/formatters';
import { createFlowId } from './lib/services/storage';
import type { CalculationSettings, CalculationView, MarketDataBundle } from './lib/types';

describe('CSH2 application inputs', () => {
  beforeEach(() => localStorage.clear());

  it('omits zero-valued units from durations', () => {
    expect(duration('2026-08-13', '2026-09-19')).toBe('1 month and 6 days');
    expect(duration('2026-08-13', '2027-08-20')).toBe('1 year and 7 days');
    expect(duration('2026-08-13', '2026-08-13')).toBe('0 days');
  });

  it('creates unique flow IDs without secure-context browser APIs', () => {
    const ids = [createFlowId(), createFlowId(), createFlowId()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('flow-'))).toBe(true);
  });

  it('migrates the former total account rate to the base-rate field', async () => {
    localStorage.setItem('csh2-belgium-settings-v1', JSON.stringify({ accountInterestRate: '2.5' }));
    render(App);

    await expect.element(page.getByLabelText('Base annual rate (%)')).toHaveValue(2.5);
    await expect.element(page.getByLabelText('Fidelity premium (%)')).toHaveValue(null);
  });

  it('loads defaults, adds flows, and restores the documented example', async () => {
    render(App);
    await expect.element(page.getByRole('heading', { name: 'CSH2 backtester' })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Backward annualized returns · 1Y' })).toBeVisible();
    const holdingTimeline = page.getByRole('img', { name: /Minimum holding periods in days/ });
    await expect.element(holdingTimeline).toBeVisible();
    const timelineElement = holdingTimeline.element() as HTMLElement;
    const timelineTrack = timelineElement.querySelector<HTMLElement>('.holding-period-track-line')!;
    const breakEvenProgress = timelineElement.querySelector<HTMLElement>('.holding-period-progress.holding-period-break-even')!;
    expect(Math.abs(breakEvenProgress.getBoundingClientRect().right - timelineTrack.getBoundingClientRect().right)).toBeLessThan(1);
    expect(timelineElement.querySelectorAll('.holding-period-row')[1].querySelector('.holding-period-track-line')).toBeNull();
    await expect.element(page.getByRole('heading', { name: 'CSH2 versus your account' })).toBeVisible();
    await expect.element(page.getByText('Enter valid account rates to compare your account with the current CSH2 projection.')).toBeVisible();
    await expect.element(holdingTimeline.getByText('Break even', { exact: true })).toBeVisible();
    await expect.element(holdingTimeline.getByText('Match €STR', { exact: true })).toBeVisible();
    const estimatePicker = page.getByRole('group', { name: 'CSH2 rate scenario' });
    await expect.element(estimatePicker.getByRole('button', { name: 'Base' })).toHaveAttribute('aria-pressed', 'true');
    await estimatePicker.getByRole('button', { name: 'Cautious' }).click();
    await expect.element(estimatePicker.getByRole('button', { name: 'Cautious' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByText(/^At the cautious estimated CSH2 rate/)).toBeVisible();
    await expect.element(page.getByText(/Assumes CSH2 stays near its/)).toHaveLength(0);
    const currentRates = page.getByLabelText('Current rates used');
    await expect.element(currentRates.getByText(/Current €STR/)).toBeVisible();
    await expect.element(currentRates.getByText(/Estimated CSH2 .*±.* pp/)).toBeVisible();
    await expect.element(currentRates.getByText(/Estimated CSH2 \(/)).toHaveLength(0);
    await expect.element(currentRates.getByText(/Base .* pp/)).toHaveLength(0);
    await page.getByRole('button', { name: 'How estimated CSH2 is calculated' }).click();
    const methodology = page.getByRole('dialog', { name: 'How we estimate today’s CSH2 return' });
    await expect.element(methodology).toBeVisible();
    const methodologyElement = methodology.element() as HTMLDialogElement;
    const renderedDocument = methodologyElement.ownerDocument;
    const renderedStyles = (element: Element) => renderedDocument.defaultView!.getComputedStyle(element);
    expect(renderedStyles(renderedDocument.documentElement).overflow).toBe('hidden');
    expect(renderedStyles(renderedDocument.body).overflow).toBe('hidden');
    const methodologyContent = methodologyElement.querySelector<HTMLElement>('.methodology-dialog-content')!;
    expect(renderedStyles(methodologyElement).overflowY).toBe('hidden');
    expect(renderedStyles(methodologyContent).overflowY).toBe('auto');
    expect(renderedStyles(methodologyContent).overscrollBehaviorY).toBe('contain');
    const methodologyHeader = methodologyElement.querySelector<HTMLElement>('.methodology-dialog-header')!;
    const headerTop = methodologyHeader.getBoundingClientRect().top;
    methodologyContent.scrollTop = methodologyContent.scrollHeight;
    expect(methodologyContent.scrollTop).toBeGreaterThan(0);
    expect(methodologyHeader.getBoundingClientRect().top).toBe(headerTop);
    await expect.element(methodology.getByText('Compare CSH2 with the overnight rate.')).toBeVisible();
    await expect.element(methodology.getByRole('columnheader', { name: 'Overnight benchmark' })).toBeVisible();
    await expect.element(methodology.getByText('Estimated CSH2 return')).toBeVisible();
    await expect.element(methodology.getByRole('heading', { name: 'How accurate is this methodology when applying it to past data?' })).toBeVisible();
    await expect.element(methodology.getByText(/Mean absolute error \(MAE\)/)).toBeVisible();
    await expect.element(methodology.getByRole('rowheader', { name: 'Last 1 year' })).toBeVisible();
    await expect.element(methodology.getByRole('rowheader', { name: 'Last 2 years' })).toBeVisible();
    await expect.element(methodology.getByRole('rowheader', { name: 'Last 3 years' })).toBeVisible();
    await expect.element(methodology.getByRole('rowheader', { name: 'Full history' })).toBeVisible();
    await expect.element(methodology.getByText('Year-by-year accuracy')).toBeVisible();
    await expect.element(methodology.getByText(/not Amundi’s tracking error/)).toBeVisible();
    await page.getByRole('button', { name: 'Close methodology' }).click();
    await expect.element(page.getByRole('dialog', { name: 'How we estimate today’s CSH2 return' })).toHaveLength(0);
    expect(renderedStyles(renderedDocument.documentElement).overflow).not.toBe('hidden');
    expect(renderedStyles(renderedDocument.body).overflow).not.toBe('hidden');
    await expect.element(page.getByText('Enter your account rate', { exact: true })).toBeVisible();
    const baseRate = page.getByLabelText('Base annual rate (%)');
    const fidelityPremium = page.getByLabelText('Fidelity premium (%)');
    await baseRate.fill('0');
    await fidelityPremium.fill('0.1');
    await expect.element(page.getByText('Before the first fidelity premium · Still ahead after it.')).toHaveLength(0);
    await fidelityPremium.clear();
    await baseRate.fill('0.5');
    await expect.element(page.getByText(/0,5% base rate and 0% fidelity premium/)).toBeVisible();
    await fidelityPremium.fill('2');
    await expect.element(page.getByText(/0,5% base rate and 2% fidelity premium/)).toBeVisible();
    await expect.element(page.getByRole('img', { name: /Net CSH2 advantage compared with your account in percent/ })).toBeVisible();
    await expect.element(page.getByRole('group', { name: 'Compare net CSH2 with' })).toHaveLength(0);
    await expect.element(page.getByText(/^CSH2 matches €STR after/)).toHaveLength(0);
    await expect.element(page.getByText(/Below 0%: CSH2 is behind your account/)).toHaveLength(0);
    await expect.element(page.getByText(/^Re-match · /)).toHaveLength(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const accountRow = timelineElement.querySelectorAll<HTMLElement>('.holding-period-row')[1];
    const accountMarkers = accountRow.querySelectorAll('.holding-period-marker.holding-period-account');
    const accountLabels = accountRow.querySelectorAll<HTMLElement>('.holding-period-value.holding-period-account');
    const accountPoles = accountRow.querySelectorAll<HTMLElement>('.holding-period-flag-pole');
    const accountTrackBounds = accountRow.querySelector<HTMLElement>('.holding-period-track')!.getBoundingClientRect();
    expect(accountLabels.length).toBe(accountMarkers.length);
    expect(accountPoles.length).toBe(accountMarkers.length);
    expect(accountLabels[0].classList.contains('below')).toBe(false);
    [...accountLabels].forEach((label, index) => {
      const styles = renderedStyles(label);
      const pole = accountPoles[index];
      const poleStyles = renderedStyles(pole);
      const labelBounds = label.getBoundingClientRect();
      const poleBounds = pole.getBoundingClientRect();
      const markerBounds = accountMarkers[index].getBoundingClientRect();
      expect(styles.backgroundColor).toBe('rgb(238, 243, 251)');
      expect(styles.color).toBe('rgb(56, 103, 168)');
      expect(styles.fontWeight).toBe('400');
      expect(styles.zIndex).toBe('2');
      expect(poleStyles.backgroundColor).toBe('rgb(56, 103, 168)');
      expect(poleStyles.zIndex).toBe('1');
      expect(Number.parseFloat(poleStyles.width)).toBe(3);
      expect(Number.parseFloat(poleStyles.height)).toBeGreaterThanOrEqual(11);
      expect(Math.abs(poleBounds.left - markerBounds.left)).toBeLessThan(0.1);
      expect(Math.abs(poleBounds.right - markerBounds.right)).toBeLessThan(0.1);
      const facesLeft = label.classList.contains('faces-left');
      expect(facesLeft).toBe(markerBounds.left + labelBounds.width > accountTrackBounds.right);
      expect(Math.abs((facesLeft ? labelBounds.right : labelBounds.left) - (facesLeft ? markerBounds.right : markerBounds.left))).toBeLessThan(0.1);
      const connectionOverlap = label.classList.contains('below') ? poleBounds.bottom - labelBounds.top : labelBounds.bottom - poleBounds.top;
      expect(connectionOverlap).toBeGreaterThan(0);
      expect(connectionOverlap).toBeLessThanOrEqual(3);
      const connectedBorderWidth = facesLeft ? styles.borderRightWidth : styles.borderLeftWidth;
      expect(connectedBorderWidth).toBe('3px');
      const connectedCorner = label.classList.contains('below') ? (facesLeft ? styles.borderTopRightRadius : styles.borderTopLeftRadius) : (facesLeft ? styles.borderBottomRightRadius : styles.borderBottomLeftRadius);
      expect(connectedCorner).toBe('0px');
    });
    const labelsByLane = new Map<number, HTMLElement[]>();
    [...accountLabels].forEach((label) => {
      const lane = Math.round(label.getBoundingClientRect().top);
      labelsByLane.set(lane, [...(labelsByLane.get(lane) ?? []), label]);
    });
    for (const labels of labelsByLane.values()) {
      const orderedLabels = labels.toSorted((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
      orderedLabels.slice(1).forEach((label, index) => expect(label.getBoundingClientRect().left - orderedLabels[index].getBoundingClientRect().right).toBeGreaterThanOrEqual(11));
    }
    expect(localStorage.getItem('csh2-belgium-settings-v1')).toContain('"accountBaseInterestRate":"0.5"');
    expect(localStorage.getItem('csh2-belgium-settings-v1')).toContain('"accountFidelityPremium":"2"');
    expect(localStorage.getItem('csh2-belgium-settings-v1')).toContain('"csh2RateScenario":"cautious"');
    await expect.element(page.getByLabelText('Backward annualized CSH2 return compared with the Euro overnight benchmark over 1 year')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Calculate with latest data' })).toBeDisabled();
    await page.getByRole('button', { name: 'Add cash flow' }).click();
    await expect.element(page.getByLabelText('Date')).toHaveLength(2);
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect.element(page.getByLabelText('Date')).toHaveLength(3);
    const calculate = page.getByRole('button', { name: 'Calculate with latest data' });
    await expect.element(calculate).toBeEnabled();
    await fidelityPremium.fill('-1');
    await expect.element(page.getByText('Enter valid rates', { exact: true })).toBeVisible();
    await expect.element(calculate).toBeEnabled();
  });

  it('marks inflows as interest payments and clears the marker for outflows', async () => {
    render(App);
    await page.getByLabelText('Date').fill('2026-01-02');
    await page.getByLabelText('Net amount in euro').fill('50');
    const interest = page.getByRole('checkbox', { name: 'Interest payment' });
    await interest.click();
    await expect.element(interest).toBeChecked();
    expect(localStorage.getItem('csh2-belgium-flows-v1')).toContain('"interestPayment":true');

    await page.getByRole('combobox', { name: /Direction/ }).selectOptions('outflow');
    await expect.element(interest).not.toBeChecked();
    await expect.element(interest).toBeDisabled();
  });

  it('accepts accrued base interest and any number of complete fidelity premium entries', async () => {
    render(App);
    await page.getByLabelText('Date').fill('2026-01-02');
    await page.getByLabelText('Net amount in euro').fill('1000');
    const calculate = page.getByRole('button', { name: 'Calculate with latest data' });
    const accrued = page.getByLabelText('Accrued base interest (€)');

    await expect.element(accrued).toBeVisible();
    await accrued.fill('50');
    await page.getByRole('button', { name: 'Add fidelity premium' }).click();
    await expect.element(page.getByRole('heading', { name: 'Ongoing fidelity premiums' })).toBeVisible();
    const baseAmount = page.getByLabelText('Fidelity premium 1 base amount in euro');
    const earnedDate = page.getByLabelText('Fidelity premium 1 earned on');
    const payoutAmount = page.getByLabelText('Fidelity premium 1 final payout in euro');
    await baseAmount.fill('500');
    await earnedDate.fill('2026-12-31');
    await earnedDate.click();
    await expect.element(calculate).toBeDisabled();
    await payoutAmount.fill('12.50');
    await earnedDate.click();
    await expect.element(calculate).toBeEnabled();
    await page.getByRole('button', { name: 'Add fidelity premium' }).click();
    await expect.element(page.getByLabelText('Fidelity premium 2 base amount in euro')).toBeVisible();
    await page.getByRole('button', { name: 'Remove fidelity premium 2' }).click();
    await expect.element(page.getByLabelText('Fidelity premium 2 base amount in euro')).toHaveLength(0);
  });

  it('does not count uninvested whole-share cash as an immediate break-even', async () => {
    render(App);
    await page.getByLabelText('Date').fill('2022-10-14');
    await page.getByLabelText('Net amount in euro').fill('10');
    await page.getByLabelText('Date').click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();

    await expect.element(page.getByText('No CSH2 purchase was executed.')).toHaveLength(2);
    await expect.element(page.getByText('Not yet', { exact: true })).toHaveLength(2);

    await page.getByRole('button', { name: 'Add cash flow' }).click();
    await page.getByLabelText('Date').nth(1).fill('2023-08-22');
    await page.getByLabelText('Net amount in euro').nth(1).fill('200');
    await page.getByLabelText('Date').nth(1).click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();

    await expect.element(page.getByText('11 months and 1 day', { exact: true })).toBeVisible();
  });

  it('recovers malformed storage and preserves the CGT preference while Reynders Tax is active', async () => {
    localStorage.setItem('csh2-belgium-flows-v1', '{broken');
    render(App);
    await expect.element(page.getByRole('button', { name: 'Calculate with latest data' })).toBeDisabled();
    expect(localStorage.getItem('csh2-belgium-flows-v1')).toBeNull();
    const holdingPeriodAssumption = page.getByText(/Investment-agnostic estimate/);
    await expect.element(holdingPeriodAssumption).toHaveTextContent('10% CGT');
    const exemption = page.getByRole('checkbox', { name: 'Apply the annual capital-gains exemption' });
    const taxRegime = page.getByRole('group', { name: 'CSH2 gain tax regime' });
    await expect.element(taxRegime.getByRole('button', { name: '10% CGT' })).toHaveAttribute('aria-pressed', 'true');
    await taxRegime.getByRole('button', { name: '30% Reynders Tax' }).click();
    await expect.element(exemption).toBeDisabled();
    await expect.element(exemption).toBeChecked();
    await expect.element(holdingPeriodAssumption).toHaveTextContent('30% Reynders Tax');
    await expect.element(taxRegime.getByRole('button', { name: '30% Reynders Tax' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('calculates the example and remembers independent benchmark periods', async () => {
    render(App);
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(page.getByRole('heading', { name: 'Backtest result' })).toBeVisible();
    await expect.element(page.getByText('CSH2 backtest first broke even after')).toBeVisible();
    await expect.element(page.getByText('CSH2 backtest first matched €STR after')).toBeVisible();
    const csh2Update = page.getByText(/^CSH2 data last updated/);
    const estrUpdate = page.getByText(/^€STR data last updated/);
    await expect.element(csh2Update).toHaveTextContent(/ago$/);
    await expect.element(estrUpdate).toHaveTextContent(/ago$/);
    await expect.element(page.getByRole('tooltip')).toHaveLength(2);
    await page.getByRole('group', { name: 'Backward comparison period' }).getByRole('button', { name: '3M' }).click();
    await page.getByRole('button', { name: 'Forward' }).click();
    await page.getByRole('group', { name: 'Forward comparison period' }).getByRole('button', { name: '1M' }).click();
    await page.getByRole('button', { name: 'Backward' }).click();
    await expect.element(page.getByRole('group', { name: 'Backward comparison period' }).getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    const taxTreatment = page.getByRole('group', { name: 'Tax treatment' });
    await expect.element(taxTreatment.getByRole('button', { name: 'Gross' })).toHaveAttribute('aria-pressed', 'true');
    await taxTreatment.getByRole('button', { name: 'After tax' }).click();
    await expect.element(page.getByText(/ignoring the annual CGT exemption/)).toBeVisible();
    await expect.element(page.getByText(/The euro overnight benchmark is unchanged/)).toBeVisible();
    await page.getByRole('group', { name: 'CSH2 gain tax regime' }).getByRole('button', { name: '30% Reynders Tax' }).click();
    await expect.element(page.getByText(/plus 30% Reynders Tax/)).toBeVisible();
    await expect.element(taxTreatment.getByRole('button', { name: 'After tax' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Forward' }).click();
    await expect.element(page.getByRole('group', { name: 'Forward comparison period' }).getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks edited results as stale and refreshes the chart for calculation settings', async () => {
    render(App);
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.getByRole('button', { name: 'Calculate with latest data' }).click();
    await expect.element(page.getByRole('heading', { name: 'Backtest result' })).toBeVisible();
    const staleMessage = page.getByText('Inputs have changed. The results below still reflect your last calculation. Calculate again to update them.');
    const chart = page.getByLabelText('Cumulative return of your account compared with CSH2 and a euro overnight benchmark portfolio using the same external cash flows');
    const initialChart = await chart.screenshot({ base64: true, save: false });
    const exemption = page.getByRole('checkbox', { name: 'Apply the annual capital-gains exemption' });

    await page.getByLabelText('Base annual rate (%)').fill('2.5');
    await page.getByRole('heading', { name: 'Calculation settings' }).click();
    await expect.element(staleMessage).not.toBeInTheDocument();

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

    await page.getByRole('group', { name: 'CSH2 gain tax regime' }).getByRole('button', { name: '30% Reynders Tax' }).click();
    await expect.element(page.getByText('Reynders Tax', { exact: true })).toBeVisible();
    await expect.element(staleMessage).not.toBeInTheDocument();
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
        return { settings: { ...settings }, result: { valuation: { date: '2026-08-08' } }, metadata: market.data, rateMetadata: market.rateData, returnSeries: { csh2: [], overnight: [] }, from: '2026-08-08', to: '2026-08-08' } as unknown as CalculationView;
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

  it('recalculates only the submitted backtest snapshot when the global tax regime changes', async () => {
    const market = { data: { cachedAt: '2026-08-09T00:00:00Z', prices: {} }, rateData: { rates: {} }, version: 'test' } as MarketDataBundle;
    const calculations: Array<{ flows: Array<{ amount: string }>; settings: CalculationSettings }> = [];
    const controller = createBacktestController({
      storage: localStorage,
      today: () => '2026-08-09',
      loadMarketData: async () => market,
      calculate: (flows, settings) => {
        calculations.push({ flows: flows.map((flow) => ({ amount: flow.amount })), settings: { ...settings } });
        return { settings: { ...settings }, result: { valuation: { date: '2026-08-08' } }, metadata: market.data, rateMetadata: market.rateData, returnSeries: { csh2: [], overnight: [], account: [] }, from: '2026-01-02', to: '2026-08-08' } as unknown as CalculationView;
      },
      prepareBenchmark: async () => ({}) as never
    });
    const flow = { id: createFlowId(), date: '2026-01-02', type: 'inflow' as const, amount: '1000', interestPayment: false };
    controller.replaceFlows([flow]);
    await controller.calculate();
    controller.updateFlow(flow.id, 'amount', '2000');

    await controller.setTaxRegime(true);

    await controller.setCsh2RateScenario('optimistic');

    expect(calculations).toHaveLength(3);
    expect(calculations[1].flows[0].amount).toBe('1000');
    expect(calculations[1].settings.applyReyndersTax).toBe(true);
    expect(calculations[2].flows[0].amount).toBe('1000');
    expect(calculations[2].settings.csh2RateScenario).toBe('optimistic');
    expect(controller.view?.settings.applyReyndersTax).toBe(true);
    expect(controller.view?.settings.csh2RateScenario).toBe('optimistic');
    expect(controller.resultIsStale).toBe(true);
  });
});
