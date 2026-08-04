import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBacktestReturnSeries, buildOvernightBenchmarkReturnSeries, estimateBreakEvenDate, runBacktest } from '../src/backtest.mjs';

const prices = { '2026-01-02': 100, '2026-02-02': 110, '2026-03-02': 120 };

test('deducts TOB on inflow and estimates terminal taxes', () => {
  const result = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices, '2026-03-02');
  assert.equal(result.paidTob, 1.2);
  assert.equal(result.grossValue, 1198.56);
  assert.equal(result.terminalTob, 1.44);
  assert.equal(result.terminalCgt, 19.98);
  assert.equal(result.netLiquidationValue, 1177.15);
});

test('buys whole shares with available cash and carries the remainder to the next inflow', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 150 },
    { date: '2026-02-02', type: 'inflow', amount: 150 }
  ], { '2026-01-02': 100, '2026-02-02': 100 }, '2026-02-02', { buyWholeSharesOnly: true });
  assert.equal(result.entries[0].units, 1);
  assert.equal(result.entries[1].units, 1);
  assert.equal(result.units, 2);
  assert.equal(result.availableCash, 99.76);
  assert.equal(result.netLiquidationValue, 299.52);
  assert.equal(result.missedAmount, -0.48);
});

test('uses available cash before selling whole-share holdings for an outflow', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 150 },
    { date: '2026-02-02', type: 'outflow', amount: 49.88 }
  ], { '2026-01-02': 100, '2026-02-02': 100 }, '2026-02-02', { buyWholeSharesOnly: true });
  assert.equal(result.entries[1].units, 0);
  assert.equal(result.availableCash, 0);
  assert.equal(result.units.toFixed(6), '1.000000');
});

test('sells the minimum whole shares for an outflow and retains excess proceeds as cash', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 300 },
    { date: '2026-02-02', type: 'outflow', amount: 100 }
  ], { '2026-01-02': 100, '2026-02-02': 100 }, '2026-02-02', { buyWholeSharesOnly: true });
  assert.equal(result.entries[1].units, 1);
  assert.equal(result.entries[1].remainingCash, 99.64);
  assert.equal(result.units, 1);
  assert.equal(result.availableCash, 99.64);
});

test('reports missed earnings against net inputs and unpaid accrued interest', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 100 }
  ], prices, '2026-03-02', { unpaidAccruedInterest: 50 });
  assert.equal(result.totalInput, 950);
  assert.equal(result.missedAmount, 118.89);
  assert.equal(result.missedSharePercent.toFixed(6), '12.514722');
});

test('calculates missed earnings percentage from net cash input in whole-share mode', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 150 },
    { date: '2026-02-02', type: 'inflow', amount: 150 }
  ], { '2026-01-02': 100, '2026-02-02': 110 }, '2026-02-02', { buyWholeSharesOnly: true });
  assert.equal(result.totalInput, 300);
  assert.equal(result.missedAmount, 8.48);
  assert.equal(result.missedSharePercent.toFixed(6), '2.828000');
});

test('estimates a break-even date from a positive 30-day CSH2 price trend', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100.2
  }, '2026-01-31');
  assert.ok(estimate);
  assert.ok(estimate.date > '2026-01-31');
  assert.ok(estimate.days <= 365);
  assert.equal(estimate.trendDays, 30);
  assert.ok(estimate.trendReturnPercent > 0);
});

test('does not estimate break-even without a positive 30-day CSH2 price trend', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100
  }, '2026-01-31');
  assert.equal(estimate, undefined);
});

test('applies the annual capital-gains exemption and carry-forward when selected', () => {
  const prices = { '2026-01-02': 100, '2027-01-02': 220 };
  const withoutExemption = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 10000 }], prices, '2027-01-02');
  const withExemption = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 10000 }], prices, '2027-01-02', { applyCapitalGainsExemption: true });
  assert.equal(withExemption.terminalCgt, 98.56);
  assert.equal(withoutExemption.terminalCgt, 1198.56);
  assert.ok(withExemption.netLiquidationValue > withoutExemption.netLiquidationValue);
});

test('caps accumulated capital-gains exemption carry-forward at €15,000', () => {
  const result = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 10000 }], {
    '2026-01-02': 100,
    '2031-01-02': 260
  }, '2031-01-02', { applyCapitalGainsExemption: true });
  assert.equal(result.terminalCgt, 98.08);
});

test('reports charged and exonerated CGT separately for a partially exempt sale', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 10000 },
    { date: '2027-01-02', type: 'outflow', amount: 22000 }
  ], { '2026-01-02': 100, '2027-01-02': 230 }, '2027-01-02', { applyCapitalGainsExemption: true });
  assert.ok(result.entries[1].cgt > 0);
  assert.ok(result.entries[1].exoneratedCgt > 0);
});

test('exonerates all positive gains from a sale before 2026', () => {
  const result = runBacktest([
    { date: '2025-01-02', type: 'inflow', amount: 1000 },
    { date: '2025-02-02', type: 'outflow', amount: 500 }
  ], { '2025-01-02': 100, '2025-02-02': 110 }, '2025-02-02');
  assert.equal(result.entries[1].cgt, 0);
  assert.ok(result.entries[1].exoneratedCgt > 0);
});

test('uses the 31 December 2025 close as the tax basis for earlier purchases', () => {
  const result = runBacktest([{ date: '2025-01-02', type: 'inflow', amount: 1000 }], {
    '2025-01-02': 100,
    '2025-12-31': 110,
    '2026-01-02': 120
  }, '2026-01-02');
  assert.equal(result.terminalCgt, 9.99);
});

test('retains an original purchase price above the 2025 reference close', () => {
  const result = runBacktest([{ date: '2025-01-02', type: 'inflow', amount: 1000 }], {
    '2025-01-02': 115,
    '2025-12-31': 110,
    '2026-01-02': 120
  }, '2026-01-02');
  assert.equal(result.terminalCgt, 4.34);
});

test('sells FIFO lots to meet a net outflow', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 500 }
  ], prices, '2026-03-02');
  assert.equal(result.entries[1].net, 500);
  assert.ok(result.entries[1].tob > 0);
  assert.ok(result.entries[1].cgt > 0);
  assert.ok(result.units > 0);
});

test('rejects an outflow that exceeds holdings', () => {
  assert.throws(() => runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 100 },
    { date: '2026-02-02', type: 'outflow', amount: 1000 }
  ], prices, '2026-03-02'), /exceeds/);
});

test('uses the preceding monthly close for dates covered only by monthly history', () => {
  const result = runBacktest([{ date: '2025-02-01', type: 'inflow', amount: 1000 }], {
    '2025-01-31': { close: 105.64, period: 'monthly' },
    '2025-02-28': { close: 105.92, period: 'monthly' },
    '2025-03-17': { open: 106, close: 106.16 }
  }, '2025-03-18');
  assert.equal(result.entries[0].price, 105.64);
  assert.equal(result.entries[0].priceDate, '2025-01-31');
  assert.equal(result.entries[0].priceKind, 'monthly close');
});

test('uses a marked fallback close in constant time for a closed date', () => {
  const result = runBacktest([{ date: '2026-01-03', type: 'inflow', amount: 1000 }], {
    '2026-01-02': { open: 100, close: 100 },
    '2026-01-03': { close: 100, isFallback: true, fallbackSource: '2026-01-02' }
  }, '2026-01-03');
  assert.equal(result.entries[0].priceDate, '2026-01-02');
  assert.equal(result.entries[0].priceKind, 'previous close');
});

test('rejects dates before the available price history', () => {
  assert.throws(() => runBacktest([{ date: '2014-12-31', type: 'inflow', amount: 1000 }], {
    '2015-03-31': { close: 100, period: 'monthly' }
  }, '2015-03-31'), /on or before/);
});

test('builds a net-return snapshot for each available price date after investing', () => {
  const series = buildBacktestReturnSeries([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices);
  assert.equal(series.length, 3);
  assert.equal(series[0].date, '2026-01-02');
  assert.ok(series.at(-1).value > series[0].value);
});

test('excludes whole-share residual cash from the overnight benchmark portfolio', () => {
  const series = buildOvernightBenchmarkReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 150 },
    { date: '2026-02-02', type: 'inflow', amount: 150 },
    { date: '2026-03-02', type: 'outflow', amount: 100 }
  ], {
    '2026-01-02': 100,
    '2026-02-02': 100,
    '2026-03-02': 100
  }, {
    '2026-01-02': 3,
    '2026-02-02': 3,
    '2026-03-02': 3
  }, '2026-03-02', '2026-01-02', '2026-03-02', { buyWholeSharesOnly: true });
  assert.equal(series.length, 3);
  assert.equal(series[0].value, 0);
  assert.equal(series.at(-1).date, '2026-03-02');
  assert.ok(series.at(-1).value > 0);
  assert.ok(series.at(-1).value < 0.1);
});

test('does not create an overnight benchmark position from uninvested whole-share cash', () => {
  const series = buildOvernightBenchmarkReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 50 }
  ], {
    '2026-01-02': 100,
    '2026-01-05': 100
  }, {
    '2026-01-02': 3,
    '2026-01-05': 3
  }, '2026-01-05', '2026-01-02', '2026-01-05', { buyWholeSharesOnly: true });
  assert.deepEqual(series, []);
});
