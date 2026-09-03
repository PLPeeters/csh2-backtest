import { describe, expect, it } from 'vitest';
import { calculateHistoricalSavings } from './historical-savings';
import { parseHistoricalSavingsRatesHtml, parseHistoricalSavingsRatesText, parseHistoricalSavingsTable, readHistoricalSavingsRatesFromClipboard } from './historical-savings-clipboard';

const rate = (date: string, baseRate = 3.65, fidelityPremium = 0) => ({ id: date, date, baseRate, fidelityPremium });

describe('historical savings calculation', () => {
  it('uses the rate active on each day and excludes the deposit date from base interest', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-01-01', 3.65), rate('2024-01-03', 7.3)], endDate: '2024-01-04' });
    // Lump sum earns one day at 3.65% and two days at 7.3% (Jan 2–4).
    expect(result.lumpSum.baseInterestEarned).toBeCloseTo(10000 * (0.0365 + 0.073 * 2) / 365, 10);
    expect(result.lumpSum.endingBalance).toBe(10000);
  });

  it('clamps monthly deposits to the last day of shorter months', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-01-31', 0)], endDate: '2024-04-01' });
    expect(result.monthly.series.filter((point, index, points) => index === 0 || point.value > points[index - 1].value).map((point) => point.date)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
    expect(result.monthly.totalDeposited).toBe(1800);
  });

  it('uses ACT/365 over a leap-year interval', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-02-28', 3.65)], endDate: '2024-02-29' });
    // 29 February is included in the one earning day after the deposit.
    expect(result.lumpSum.baseInterestEarned).toBeCloseTo(10000 * 0.0365 / 365, 10);
  });

  it('credits base interest on 1 January, while current-year accrual remains uncredited', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-01-01', 3.65)], endDate: '2025-01-01' });
    expect(result.lumpSum.baseInterestEarned).toBeCloseTo(366.0365, 6);
    expect(result.lumpSum.endingBalance).toBeCloseTo(10365, 8);
  });

  it('locks fidelity rate for a period and separates quarterly payout from pending premium', () => {
    const rates = [rate('2024-01-02', 0, 1), rate('2024-07-01', 0, 2)];
    const pending = calculateHistoricalSavings({ rates, endDate: '2025-01-31' }).lumpSum;
    expect(pending.fidelityPremiumPending).toBeCloseTo(100, 10);
    expect(pending.fidelityPremiumCredited).toBe(0);
    const paid = calculateHistoricalSavings({ rates, endDate: '2025-04-01' }).lumpSum;
    expect(paid.fidelityPremiumPending).toBe(0);
    expect(paid.fidelityPremiumCredited).toBeCloseTo(100, 10);
    expect(paid.endingBalance).toBeCloseTo(10100, 10);
  });

  it('credits a premium acquired on a quarter boundary on the next quarter', () => {
    const rates = [rate('2024-01-01', 0, 1)];
    const acquired = calculateHistoricalSavings({ rates, endDate: '2025-01-01' }).lumpSum;
    expect(acquired.fidelityPremiumCredited).toBe(0);
    expect(acquired.fidelityPremiumPending).toBeCloseTo(100, 10);
    const paid = calculateHistoricalSavings({ rates, endDate: '2025-04-01' }).lumpSum;
    expect(paid.fidelityPremiumCredited).toBeCloseTo(100, 10);
    expect(paid.fidelityPremiumPending).toBe(0);
  });

  it('recognizes an acquired but unpaid premium in economic value on its acquisition date', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-01-02', 0, 1)], endDate: '2025-01-02' }).lumpSum;
    expect(result.endingBalance).toBe(10_000);
    expect(result.fidelityPremiumPending).toBeCloseTo(100, 10);
    expect(result.economicValue).toBeCloseTo(10_100, 10);
    expect(result.series.at(-1)).toEqual({ date: '2025-01-02', value: 10_100 });
    expect(result.annualizedReturn).toBeCloseTo((1.01 ** (365 / 366) - 1), 10);
  });

  it('reclassifies a paid premium without a second economic-value jump', () => {
    const result = calculateHistoricalSavings({ rates: [rate('2024-01-02', 0, 1)], endDate: '2025-04-01' }).lumpSum;
    expect(result.fidelityPremiumPending).toBe(0);
    expect(result.endingBalance).toBeCloseTo(10_100, 10);
    expect(result.economicValue).toBeCloseTo(10_100, 10);
    const acquiredValue = result.series.find((point) => point.date === '2025-01-02')?.value;
    const creditedValue = result.series.find((point) => point.date === '2025-04-01')?.value;
    expect(acquiredValue).toBeCloseTo(creditedValue ?? Number.NaN, 10);
  });

  it('does not compound an acquired premium before its payout date', () => {
    const rates = [rate('2024-01-02', 3.65, 0)];
    const withoutPremium = calculateHistoricalSavings({ rates, endDate: '2025-03-31' }).lumpSum;
    const withPremium = calculateHistoricalSavings({ rates: [rate('2024-01-02', 3.65, 1)], endDate: '2025-03-31' }).lumpSum;
    expect(withPremium.fidelityPremiumPending).toBeCloseTo(100, 10);
    expect(withPremium.baseInterestEarned).toBeCloseTo(withoutPremium.baseInterestEarned, 10);
    expect(withPremium.economicValue - withoutPremium.economicValue).toBeCloseTo(100, 10);
  });

  it('keeps a January 1 acquired premium pending until the next quarter', () => {
    const acquired = calculateHistoricalSavings({
      rates: [rate('2024-01-02', 3.65, 1)],
      endDate: '2026-01-01'
    }).lumpSum;
    // The original premium was credited on Apr 1, 2025. The base-interest
    // lot acquires €3.64 on Jan 1, 2026, but that premium is paid on Apr 1.
    expect(acquired.fidelityPremiumCredited).toBeCloseTo(100, 8);
    expect(acquired.fidelityPremiumPending).toBeCloseTo(3.64, 8);
    const credited = calculateHistoricalSavings({
      rates: [rate('2024-01-02', 3.65, 1)],
      endDate: '2026-04-01'
    }).lumpSum;
    expect(credited.fidelityPremiumCredited).toBeCloseTo(203.64, 8);
  });

  it('keeps a premium acquired on April 1 pending until July 1', () => {
    const acquired = calculateHistoricalSavings({
      rates: [rate('2024-01-02', 0, 1)],
      endDate: '2026-04-01'
    }).lumpSum;
    // The original €100 premium and the €100 premium acquired on Jan 2 are
    // credited on Apr 1. The €1 premium acquired by the Apr 1 credit lot is
    // newly acquired and waits for the next quarter.
    expect(acquired.fidelityPremiumCredited).toBeCloseTo(200, 8);
    expect(acquired.fidelityPremiumPending).toBeCloseTo(1, 8);
    const credited = calculateHistoricalSavings({
      rates: [rate('2024-01-02', 0, 1)],
      endDate: '2026-07-01'
    }).lumpSum;
    expect(credited.fidelityPremiumCredited).toBeCloseTo(201, 8);
    expect(credited.fidelityPremiumPending).toBe(0);
  });
});

describe('historical savings clipboard import', () => {
  it('parses the French line-per-cell clipboard representation', () => {
    const text = `Date\tBase\tPrime\tTotal
15 juillet 2026	
1,67%
1,50%
3,17%
16 mai 2026	
1,45%
    1,50%
    2,95%`;
    expect(parseHistoricalSavingsRatesText(text)).toEqual([
      { date: '2026-05-16', baseRate: '1.45', fidelityPremium: '1.5' },
      { date: '2026-07-15', baseRate: '1.67', fidelityPremium: '1.5' }
    ]);
  });

  it('parses Dutch HTML and prefers the HTML representation', async () => {
    const html = '<table><thead><tr><th>Datum</th><th>Basis</th><th>Premie</th><th>Totaal</th></tr></thead><tbody><tr><td>15 juli 2026</td><td>1,67%</td><td>1,50%</td><td>3,17%</td></tr><tr><td>16 februari 2025</td><td>1,35%</td><td>1,50%</td><td>2,85%</td></tr></tbody></table>';
    expect(parseHistoricalSavingsRatesHtml(html)).toEqual([
      { date: '2025-02-16', baseRate: '1.35', fidelityPremium: '1.5' },
      { date: '2026-07-15', baseRate: '1.67', fidelityPremium: '1.5' }
    ]);
    const clipboard = {
      read: async () => [{ types: ['text/html'], getType: async () => new Blob([html], { type: 'text/html' }) }],
      readText: async () => 'not used'
    };
    expect(await readHistoricalSavingsRatesFromClipboard(clipboard)).toEqual([
      { date: '2025-02-16', baseRate: '1.35', fidelityPremium: '1.5' },
      { date: '2026-07-15', baseRate: '1.67', fidelityPremium: '1.5' }
    ]);
  });

  it('recognizes descriptive rate headers and preserves their flexible order', () => {
    const html = '<table><tr><th>Effective date</th><th>Loyalty bonus (% annual)</th><th>Base annual interest rate</th></tr><tr><td>2025-01-01</td><td>1,50%</td><td>1,35%</td></tr></table>';
    expect(parseHistoricalSavingsRatesHtml(html)).toEqual([{ date: '2025-01-01', baseRate: '1.35', fidelityPremium: '1.5' }]);
  });

  it('returns an ambiguous table for unknown headers and imports after an explicit mapping', () => {
    const result = parseHistoricalSavingsRatesHtml('<table><tr><th>When it applies</th><th>Rate A</th><th>Rate B</th></tr><tr><td>2025-01-01</td><td>1,35%</td><td>1,50%</td></tr></table>');
    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) return;
    expect(result.kind).toBe('ambiguous');
    expect(result.table.columns).toEqual(['When it applies', 'Rate A', 'Rate B']);
    expect(parseHistoricalSavingsTable(result.table, { date: 0, base: 1, premium: 2 })).toEqual([{ date: '2025-01-01', baseRate: '1.35', fidelityPremium: '1.5' }]);
  });
});
