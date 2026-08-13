import test from 'node:test';
import assert from 'node:assert/strict';
import { assessInterestPayoutTiming, buildAccountReturnSeries, buildBacktestReturnSeries, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildOvernightBenchmarkReturnSeries, buildReturnProjection, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, estimateBreakEvenDate, runBacktest } from '../src/backtest.mjs';

const prices = { '2026-01-02': 100, '2026-02-02': 110, '2026-03-02': 120 };

test('deducts TOB on inflow and estimates terminal taxes', () => {
  const result = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices, '2026-03-02');
  assert.equal(result.paidTob, 1.2);
  assert.equal(result.grossValue, 1198.56);
  assert.equal(result.terminalTob, 1.44);
  assert.equal(result.terminalCgt, 19.98);
  assert.equal(result.netLiquidationValue, 1177.15);
});

test('deducts a fixed broker fee from executed purchases, sales, and terminal liquidation', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 500 }
  ], prices, '2026-03-02', { brokerTransactionFee: 5 });
  assert.equal(result.entries[0].brokerFee, 5);
  assert.equal(result.entries[1].brokerFee, 5);
  assert.equal(result.paidBrokerFees, 10);
  assert.equal(result.terminalBrokerFee, 5);
  assert.ok(result.netLiquidationValue < runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 500 }
  ], prices, '2026-03-02').netLiquidationValue);
});

test('does not charge a broker fee when whole-share cash cannot fund a purchase', () => {
  const result = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 100 }], { '2026-01-02': 100 }, '2026-01-02', { buyWholeSharesOnly: true, brokerTransactionFee: 5 });
  assert.equal(result.entries[0].brokerFee, 0);
  assert.equal(result.paidBrokerFees, 0);
  assert.equal(result.availableCash, 100);
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

test('counts paid interest in the actual balance without investing it in CSH2', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'inflow', amount: 50, interestPayment: true }
  ], prices, '2026-03-02');
  const withoutInterest = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices, '2026-03-02');

  assert.equal(result.units, withoutInterest.units);
  assert.equal(result.netLiquidationValue, withoutInterest.netLiquidationValue);
  assert.equal(result.totalInput, 1050);
  assert.equal(result.missedAmount, 127.15);
  assert.equal(result.entries[1].interestPayment, true);
  assert.equal(result.entries[1].units, 0);
  assert.equal(result.entries[1].price, undefined);
});

test('rejects marking an outflow as an interest payment', () => {
  assert.throws(() => runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 50, interestPayment: true }
  ], prices, '2026-03-02'), /Only an inflow/);
});

test('compares moving now with waiting for a future interest payout using the recent CSH2 trend', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const assessment = assessInterestPayoutTiming(flows, prices, '2026-03-02', {}, '2026-04-02', 50);
  assert.equal(assessment.preferred, 'move now');
  assert.ok(assessment.immediateValue > assessment.waitingValue);
  assert.equal(assessment.trendDays, 59);
  assert.equal(assessInterestPayoutTiming(flows, prices, '2026-03-02', {}, '', 0), undefined);
  assert.throws(() => assessInterestPayoutTiming(flows, prices, '2026-03-02', {}, '2026-04-02', 0), /positive amount/);
  assert.throws(() => assessInterestPayoutTiming(flows, prices, '2026-03-02', {}, '2026-03-02', 50), /must be after/);
});

test('projects all cumulative-return series to a future interest payout', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const projection = buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-01-02', '2026-04-02', 50, {});

  assert.ok(projection);
  assert.equal(projection.csh2[0].date, '2026-03-02');
  assert.equal(projection.csh2.at(-1).date, '2026-04-02');
  assert.ok(projection.csh2.at(-1).value > projection.csh2[0].value);
  assert.equal(projection.overnight[0].date, '2026-03-02');
  assert.equal(projection.overnight.at(-1).date, '2026-04-02');
  assert.ok(projection.overnight.at(-1).value > projection.overnight[0].value);
  assert.deepEqual(projection.account, [
    { date: '2026-03-02', value: 0 },
    { date: '2026-04-02', value: 5 }
  ]);
  assert.equal(projection.overnightRatePercent, 3);
  assert.equal(projection.trendDays, 59);
});

test('treats unpaid accrued interest as part of the future payout rather than adding it twice', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const projection = buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-01-02', '2026-04-02', 50, { unpaidAccruedInterest: 25 });

  assert.deepEqual(projection.account, [
    { date: '2026-03-02', value: 2.5 },
    { date: '2026-04-02', value: 5 }
  ]);
  assert.throws(
    () => buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-01-02', '2026-04-02', 20, { unpaidAccruedInterest: 25 }),
    /cannot be smaller/
  );
  assert.throws(
    () => assessInterestPayoutTiming(flows, prices, '2026-03-02', { unpaidAccruedInterest: 25 }, '2026-04-02', 20),
    /cannot be smaller/
  );
});

test('omits the combined projection when a comparable market assumption is unavailable', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  assert.equal(buildReturnProjection(flows, prices, {}, '2026-03-02', '2026-01-02', '2026-04-02', 50, {}), undefined);
  assert.equal(buildReturnProjection(flows, { '2026-03-02': 120 }, { '2026-03-02': 3 }, '2026-03-02', '2026-01-02', '2026-04-02', 50, {}), undefined);
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
  assert.ok(estimate.days <= 36525);
  assert.equal(estimate.trendDays, 30);
  assert.ok(estimate.trendReturnPercent > 0);
});

test('estimates a break-even date beyond one year when the price trend remains positive', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100.01
  }, '2026-01-31');
  assert.ok(estimate);
  assert.ok(estimate.days > 365);
  assert.ok(estimate.days <= 36525);
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

test('applies Reynders Tax instead of CGT and ignores the capital-gains exemption', () => {
  const result = runBacktest([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices, '2026-03-02', {
    applyCapitalGainsExemption: true,
    applyReyndersTax: true
  });
  assert.equal(result.terminalCgt, 0);
  assert.equal(result.terminalReyndersTax, 59.93);
  assert.equal(result.netLiquidationValue, 1137.19);
});

test('applies Reynders Tax to pre-2026 purchases without using the CGT reference basis', () => {
  const result = runBacktest([{ date: '2025-01-02', type: 'inflow', amount: 1000 }], {
    '2025-01-02': 100,
    '2026-01-02': 120
  }, '2026-01-02', { applyReyndersTax: true });
  assert.equal(result.terminalCgt, 0);
  assert.equal(result.terminalReyndersTax, 59.93);
});

test('applies Reynders Tax to gains realised before 2026', () => {
  const result = runBacktest([
    { date: '2025-01-02', type: 'inflow', amount: 1000 },
    { date: '2025-02-02', type: 'outflow', amount: 500 }
  ], { '2025-01-02': 100, '2025-02-02': 120 }, '2025-02-02', { applyReyndersTax: true });
  assert.equal(result.entries[1].cgt, 0);
  assert.ok(result.entries[1].reyndersTax > 0);
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

test('excludes paid interest from the CSH2 return-series capital base', () => {
  const withInterest = buildBacktestReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'inflow', amount: 50, interestPayment: true }
  ], prices);
  const withoutInterest = buildBacktestReturnSeries([{ date: '2026-01-02', type: 'inflow', amount: 1000 }], prices);
  assert.deepEqual(withInterest, withoutInterest);
});

test('builds the actual account return from paid and unpaid interest', () => {
  const series = buildAccountReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'inflow', amount: 50, interestPayment: true },
    { date: '2026-02-15', type: 'outflow', amount: 400 },
    { date: '2026-03-02', type: 'inflow', amount: 1000 }
  ], '2026-04-02', { unpaidAccruedInterest: 25 });

  assert.deepEqual(series, [
    { date: '2026-01-02', value: 0 },
    { date: '2026-02-02', value: 5 },
    { date: '2026-02-15', value: 5 },
    { date: '2026-03-02', value: 2.5 },
    { date: '2026-04-02', value: 3.75 }
  ]);
});

test('combines same-day account flows into one return point', () => {
  assert.deepEqual(buildAccountReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-01-02', type: 'inflow', amount: 25, interestPayment: true }
  ], '2026-01-02'), [{ date: '2026-01-02', value: 2.5 }]);
});

test('uses pre-flow CSH2 price history to provide a trailing annualized return from the first flow date', () => {
  const series = buildTrailingAnnualizedCsh2ReturnSeries({
    '2025-10-01': 100,
    '2026-01-01': 110
  }, '2026-01-01', '2026-01-01');
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2026-01-01');
  assert.ok(series[0].value > 0);
});

test('uses a selected 1-month lookback while retaining annualization for CSH2 returns', () => {
  const series = buildTrailingAnnualizedCsh2ReturnSeries({
    '2025-12-01': 100,
    '2026-01-01': 110
  }, '2026-01-01', '2026-01-01', { lookbackDays: 30 });
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2026-01-01');
  assert.ok(series[0].value > 100);
});

test('uses a selected 5-year lookback while retaining annualization for CSH2 returns', () => {
  const series = buildTrailingAnnualizedCsh2ReturnSeries({
    '2021-01-01': 100,
    '2026-01-01': 200
  }, '2026-01-01', '2026-01-01', { lookbackDays: 1825 });
  assert.equal(series.length, 1);
  assert.ok(series[0].value > 14 && series[0].value < 15);
});

test('builds a forward annualized CSH2 return at the start of the measured period', () => {
  const series = buildForwardAnnualizedCsh2ReturnSeries({
    '2025-01-01': 100,
    '2026-01-01': 110
  }, '2025-01-01', '2026-01-01');
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2025-01-01');
  assert.ok(series[0].value > 9 && series[0].value < 11);
});

test('keeps all available annualized CSH2 points when no backtest start date is supplied', () => {
  const prices = {
    '2025-01-01': 100,
    '2026-01-01': 110,
    '2027-01-01': 121
  };
  assert.deepEqual(buildTrailingAnnualizedCsh2ReturnSeries(prices, '', '2027-01-01', { lookbackDays: 365 }).map((point) => point.date), ['2026-01-01', '2027-01-01']);
  assert.deepEqual(buildForwardAnnualizedCsh2ReturnSeries(prices, '', '2027-01-01', { lookbackDays: 365 }).map((point) => point.date), ['2025-01-01', '2026-01-01']);
});

test('uses the same trailing annualization for the compounded overnight benchmark', () => {
  const rates = {};
  const start = new Date('2025-10-01T00:00:00Z');
  for (let day = 0; day <= 90; day += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + day);
    rates[date.toISOString().slice(0, 10)] = 3;
  }
  const series = buildTrailingAnnualizedOvernightBenchmarkReturnSeries(rates, '2025-12-30', '2025-12-30');
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2025-12-30');
  assert.ok(Math.abs(series[0].value - 3) < 0.000001);
});

test('uses a selected 1-month lookback while retaining annualization for the overnight benchmark', () => {
  const series = buildTrailingAnnualizedOvernightBenchmarkReturnSeries({
    '2025-12-01': 3,
    '2026-01-01': 3
  }, '2026-01-01', '2026-01-01', { lookbackDays: 30 });
  assert.equal(series.length, 1);
  assert.ok(Math.abs(series[0].value - 3) < 0.000001);
});

test('builds a forward annualized overnight benchmark return at the start of the measured period', () => {
  const series = buildForwardAnnualizedOvernightBenchmarkReturnSeries({
    '2025-01-01': 3,
    '2026-01-01': 3
  }, '2025-01-01', '2026-01-01');
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2025-01-01');
  assert.ok(Math.abs(series[0].value - 3) < 0.000001);
});

test('carries an overnight rate across calendar gaps before annualizing it', () => {
  const series = buildTrailingAnnualizedOvernightBenchmarkReturnSeries({
    '2025-10-01': 3,
    '2025-12-30': 3
  }, '2025-12-30', '2025-12-30');
  assert.equal(series.length, 1);
  assert.ok(Math.abs(series[0].value - 3) < 0.000001);
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

test('does not add paid interest to the overnight benchmark portfolio', () => {
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const withInterest = buildOvernightBenchmarkReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'inflow', amount: 50, interestPayment: true }
  ], prices, rates, '2026-03-02', '2026-01-02', '2026-03-02');
  const withoutInterest = buildOvernightBenchmarkReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 }
  ], prices, rates, '2026-03-02', '2026-01-02', '2026-03-02');
  assert.deepEqual(withInterest, withoutInterest);
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
