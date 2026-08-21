import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessCurrentRateModelHealth, assessFidelityPremiumTiming, assessFidelityPremiumTimings, buildAccountReturnSeries, buildBacktestReturnSeries, buildCurrentRateEvolution, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildOvernightBenchmarkReturnSeries, buildReturnProjection, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, calculateCurrentRateModel, estimateBreakEvenDate, estimateConstantRateHoldingPeriods, estimateOvernightRateMatch, estimateSavingsAccountRateMatch, estimateSavingsAccountRateMatches, findObservedHoldingPeriods, orderFidelityAssessmentsByRecommendation, orderFidelityPremiumsForWithdrawal, overnightAccrualFactor, runBacktest } from '../src/backtest.mjs';

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

test('reports missed earnings against net inputs and accrued base interest', () => {
  const result = runBacktest([
    { date: '2026-01-02', type: 'inflow', amount: 1000 },
    { date: '2026-02-02', type: 'outflow', amount: 100 }
  ], prices, '2026-03-02', { accruedBaseInterest: 50 });
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

test('compares moving a fidelity-premium principal now with waiting until it is earned', () => {
  const premium = { id: 'premium-1', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50 };
  const assessment = assessFidelityPremiumTiming(prices, '2026-03-02', {}, premium, { csh2AnnualRatePercent: 100 });
  assert.equal(assessment.recommendation, 'move now');
  assert.ok(assessment.immediateValue > assessment.waitingValue);
  assert.equal(assessment.csh2AnnualRatePercent, 100);
  assert.throws(() => assessFidelityPremiumTiming(prices, '2026-03-02', {}, { ...premium, finalPayoutAmount: 0 }, { csh2AnnualRatePercent: 8 }), /positive final payout/);
  assert.throws(() => assessFidelityPremiumTiming(prices, '2026-03-02', {}, { ...premium, earnedDate: '2026-03-02' }, { csh2AnnualRatePercent: 8 }), /must be after/);
});

test('recommends moving after payout when waiting wins now but CSH2 wins the next full fidelity year', () => {
  const assessment = assessFidelityPremiumTiming(prices, '2026-03-02', {}, {
    id: 'premium-1', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50
  }, { csh2AnnualRatePercent: 20, baseAnnualRatePercent: 1, fidelityPremiumPercent: 1 });
  assert.equal(assessment.currentPeriodPreferred, 'wait');
  assert.equal(assessment.recommendation, 'move after payout');
  assert.equal(assessment.transferDate, '2026-04-03');
  assert.ok(assessment.nextYearCsh2Value > assessment.nextYearAccountValue);
});

test('orders fidelity periods from least advanced to most advanced and resolves equal dates by implied premium rate', () => {
  const ordered = orderFidelityPremiumsForWithdrawal([
    { id: 'earlier', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 10 },
    { id: 'higher-rate', baseAmount: 1000, earnedDate: '2026-05-02', finalPayoutAmount: 20 },
    { id: 'lower-rate', baseAmount: 2000, earnedDate: '2026-05-02', finalPayoutAmount: 20 }
  ]);
  assert.deepEqual(ordered.map((premium) => premium.id), ['lower-rate', 'higher-rate', 'earlier']);
});

test('combines same-day fidelity transfers into one CSH2 purchase', () => {
  const projection = { csh2AnnualRatePercent: 20, baseAnnualRatePercent: 1, fidelityPremiumPercent: 1 };
  const premiums = [
    { id: 'higher-rate', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50 },
    { id: 'lower-rate', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 40 }
  ];
  const separate = premiums.map((premium) => assessFidelityPremiumTiming(prices, '2026-03-02', { brokerTransactionFee: 10 }, premium, projection));
  const combined = assessFidelityPremiumTimings(prices, '2026-03-02', { brokerTransactionFee: 10 }, premiums, projection);

  assert.deepEqual(combined.map((assessment) => assessment.id), ['lower-rate', 'higher-rate']);
  assert.equal(combined[0].purchaseGroupSize, 2);
  assert.equal(combined[1].purchaseGroupSize, 2);
  assert.ok(combined.reduce((sum, assessment) => sum + assessment.nextYearCsh2Value, 0) >
    separate.reduce((sum, assessment) => sum + assessment.nextYearCsh2Value, 0));
});

test('fidelity timing always uses fractional shares', () => {
  const premium = { id: 'premium-1', baseAmount: 150, earnedDate: '2026-04-02', finalPayoutAmount: 1 };
  const fractional = assessFidelityPremiumTiming(prices, '2026-03-02', { buyWholeSharesOnly: false }, premium, { csh2AnnualRatePercent: 20 });
  const globallyWhole = assessFidelityPremiumTiming(prices, '2026-03-02', { buyWholeSharesOnly: true }, premium, { csh2AnnualRatePercent: 20 });
  assert.equal(globallyWhole.immediateValue, fractional.immediateValue);
  assert.equal(globallyWhole.currentPeriodDifference, fractional.currentPeriodDifference);
});

test('orders fidelity timing rows by their recommended action date and puts keep decisions last', () => {
  const base = { baseAmount: 1000, finalPayoutAmount: 10, csh2AnnualRatePercent: 3, immediateValue: 1000, waitingValue: 1010, currentPeriodDifference: -10, currentPeriodPreferred: 'wait' };
  const ordered = orderFidelityAssessmentsByRecommendation([
    { ...base, id: 'keep', earnedDate: '2026-04-01', recommendation: 'keep in account' },
    { ...base, id: 'later', earnedDate: '2026-05-01', recommendation: 'move after payout', transferDate: '2026-05-02' },
    { ...base, id: 'now', earnedDate: '2026-06-01', recommendation: 'move now' },
    { ...base, id: 'reassess', earnedDate: '2026-04-15', recommendation: 'wait, then reassess', transferDate: '2026-04-16' }
  ], '2026-03-02');
  assert.deepEqual(ordered.map((assessment) => assessment.id), ['now', 'reassess', 'later', 'keep']);
});

test('projects all cumulative-return series through multiple fidelity premiums', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const premiums = [
    { id: 'premium-1', baseAmount: 500, earnedDate: '2026-04-02', finalPayoutAmount: 20 },
    { id: 'premium-2', baseAmount: 500, earnedDate: '2026-05-02', finalPayoutAmount: 30 }
  ];
  const projection = buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-01-02', premiums, {}, { csh2AnnualRatePercent: 8 });

  assert.ok(projection);
  assert.equal(projection.csh2[0].date, '2026-03-02');
  assert.equal(projection.csh2.at(-1).date, '2026-05-02');
  assert.ok(projection.csh2.at(-1).value > projection.csh2[0].value);
  assert.equal(projection.overnight[0].date, '2026-03-02');
  assert.equal(projection.overnight.at(-1).date, '2026-05-02');
  assert.ok(projection.overnight.at(-1).value > projection.overnight[0].value);
  assert.deepEqual(projection.account, [
    { date: '2026-03-02', value: 0 },
    { date: '2026-04-02', value: 2 },
    { date: '2026-05-02', value: 5 }
  ]);
  assert.equal(projection.overnightRatePercent, 3);
  assert.equal(projection.csh2AnnualRatePercent, 8);
});

test('keeps accrued base interest and adds future fidelity payouts separately', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const premiums = [{ id: 'premium-1', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50 }];
  const projection = buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-01-02', premiums, { accruedBaseInterest: 25 }, { csh2AnnualRatePercent: 8 });

  assert.deepEqual(projection.account, [
    { date: '2026-03-02', value: 2.5 },
    { date: '2026-04-02', value: 7.5 }
  ]);
});

test('omits the combined projection when a selected CSH2 rate or overnight starting point is unavailable', () => {
  const flows = [{ date: '2026-01-02', type: 'inflow', amount: 1000 }];
  const premiums = [{ id: 'premium-1', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50 }];
  assert.equal(buildReturnProjection(flows, prices, {}, '2026-03-02', '2026-01-02', premiums, {}, { csh2AnnualRatePercent: 8 }), undefined);
  assert.equal(buildReturnProjection(flows, prices, { '2026-03-02': 3 }, '2026-03-02', '2026-01-02', premiums, {}), undefined);
});

test('projects from the latest real CSH2 quote at the selected annual rate, not its recent path', () => {
  const flows = [{ date: '2026-03-02', type: 'inflow', amount: 1000 }];
  const rates = { '2026-01-02': 3, '2026-02-02': 3, '2026-03-02': 3 };
  const assumedRate = { csh2AnnualRatePercent: 8 };
  const premiums = [{ id: 'premium-1', baseAmount: 1000, earnedDate: '2026-04-02', finalPayoutAmount: 50 }];
  const rising = buildReturnProjection(flows, prices, rates, '2026-03-02', '2026-03-02', premiums, {}, assumedRate);
  const falling = buildReturnProjection(flows, {
    '2026-01-02': 240,
    '2026-02-02': 180,
    '2026-03-02': 120
  }, rates, '2026-03-02', '2026-03-02', premiums, {}, assumedRate);

  assert.ok(rising);
  assert.ok(falling);
  assert.equal(rising.csh2.at(-1).value, falling.csh2.at(-1).value);
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

test('estimates a break-even date from a positive selected CSH2 rate', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100.2
  }, '2026-01-31', {}, { csh2AnnualRatePercent: 3 });
  assert.ok(estimate);
  assert.ok(estimate.date > '2026-01-31');
  assert.ok(estimate.days <= 36525);
  assert.equal(estimate.csh2AnnualRatePercent, 3);
});

test('estimates a break-even date beyond one year when the price trend remains positive', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100.01
  }, '2026-01-31', {}, { csh2AnnualRatePercent: 0.1 });
  assert.ok(estimate);
  assert.ok(estimate.days > 365);
  assert.ok(estimate.days <= 36525);
});

test('does not estimate break-even without a positive selected CSH2 rate', () => {
  const estimate = estimateBreakEvenDate([{ date: '2026-01-01', type: 'inflow', amount: 1000 }], {
    '2026-01-01': 100,
    '2026-01-31': 100
  }, '2026-01-31', {}, { csh2AnnualRatePercent: 0 });
  assert.equal(estimate, undefined);
});

test('estimates investment-agnostic holding periods from constant current rates', () => {
  const prices = { '2026-01-01': 100, '2026-01-31': 100.3 };
  const rates = { '2026-01-01': 3, '2026-01-30': 3 };
  const cgt = estimateConstantRateHoldingPeriods(prices, rates, '2026-01-31', { lookbackDays: 30 });
  const reynders = estimateConstantRateHoldingPeriods(prices, rates, '2026-01-31', { lookbackDays: 30, applyReyndersTax: true });

  assert.equal(cgt.valuationDate, '2026-01-31');
  assert.equal(cgt.rateDate, '2026-01-30');
  assert.equal(cgt.trendDays, 30);
  assert.equal(cgt.overnightRatePercent, 3);
  assert.ok(cgt.csh2ExcessAnnualRatePercent > 0);
  assert.ok(cgt.breakEven.days > 0);
  assert.ok(cgt.matchOvernight.days > cgt.breakEven.days);
  assert.deepEqual(cgt.breakEvenRange, { earliest: cgt.breakEven, central: cgt.breakEven, latest: cgt.breakEven });
  assert.ok(reynders.breakEven.days > cgt.breakEven.days);
  assert.ok(reynders.matchOvernight.days > cgt.matchOvernight.days);
  assert.deepEqual(
    estimateOvernightRateMatch(cgt.csh2AnnualRatePercent, cgt.overnightRatePercent, cgt.valuationDate),
    cgt.matchOvernight
  );
});

test('combines current overnight rate with CSH2 excess over the same trailing window', () => {
  const observedCsh2AnnualFactor = 1.04;
  const historicalOvernightFactor = overnightAccrualFactor(2, 90);
  const historicalOvernightAnnualFactor = historicalOvernightFactor ** (365 / 90);
  const currentOvernightAnnualFactor = overnightAccrualFactor(3, 1) ** 365;
  const expectedCsh2AnnualFactor = currentOvernightAnnualFactor * observedCsh2AnnualFactor / historicalOvernightAnnualFactor;
  const estimate = estimateConstantRateHoldingPeriods({
    '2026-01-01': 100,
    '2026-04-01': 100 * observedCsh2AnnualFactor ** (90 / 365)
  }, {
    '2026-01-01': 2,
    '2026-04-01': 3
  }, '2026-04-01', { lookbackDays: 90 });

  assert.ok(estimate);
  assert.equal(estimate.trendDays, 90);
  assert.equal(estimate.trendStartDate, '2026-01-01');
  assert.ok(Math.abs(estimate.currentOvernightAnnualRatePercent - (currentOvernightAnnualFactor - 1) * 100) < 1e-10);
  assert.ok(Math.abs(estimate.csh2AnnualRatePercent - (expectedCsh2AnnualFactor - 1) * 100) < 1e-10);
  assert.ok(Math.abs(estimate.csh2ExcessAnnualRatePercent - (observedCsh2AnnualFactor / historicalOvernightAnnualFactor - 1) * 100) < 1e-10);
});

test('calculates the regression model and annual MAE periods dynamically from published history', async () => {
  const [priceEnvelope, rateEnvelope] = await Promise.all([
    readFile(new URL('../src/assets/data/csh2-prices.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const model = calculateCurrentRateModel(priceEnvelope.prices, rateEnvelope.rates, '9999-12-31');

  assert.ok(model);
  assert.equal(model.trendDays <= 180, true);
  assert.equal(model.trendDays >= 175, true);
  assert.ok(model.trendObservations > 100);
  assert.equal(model.trendExamples.length, 5);
  assert.equal(model.trendExamplesOmitted, true);
  assert.equal(model.trendExamples[0].csh2Index, 100);
  assert.equal(model.trendExamples[0].overnightBenchmarkIndex, 100);
  assert.ok(model.modelErrorAnnualRatePercent > 0);
  assert.ok(model.errorWindows.length > 5);
  assert.equal(model.errorWindows.at(-1).fullHistory, true);
  assert.deepEqual(model.errorWindows.filter(({ rollingYears }) => rollingYears).map(({ rollingYears }) => rollingYears), [1, 2, 3]);
  const annualWindows = model.errorWindows.filter(({ rollingYears, fullHistory }) => !rollingYears && !fullHistory);
  for (let index = 1; index < annualWindows.length; index += 1) {
    assert.ok(annualWindows[index - 1].from > annualWindows[index].to);
  }
  assert.ok(model.errorWindows.every(({ maeAnnualRatePercent, observations }) => maeAnnualRatePercent > 0 && observations > 0));
  assert.ok(model.csh2AnnualRateLowPercent < model.csh2AnnualRatePercent);
  assert.ok(model.csh2AnnualRateHighPercent > model.csh2AnnualRatePercent);
  assert.equal(model.csh2AnnualRateLowPercent, model.csh2AnnualRatePercent - model.modelErrorAnnualRatePercent);
  assert.equal(model.csh2AnnualRateHighPercent, model.csh2AnnualRatePercent + model.modelErrorAnnualRatePercent);

  const health = assessCurrentRateModelHealth(priceEnvelope.prices, rateEnvelope.rates, model.valuationDate);
  assert.equal(health.healthy, true, health.issues.join(' '));
  const forcedFailure = assessCurrentRateModelHealth(priceEnvelope.prices, rateEnvelope.rates, model.valuationDate, { maximumValidationMaePercent: 0 });
  assert.equal(forcedFailure.healthy, false);
  assert.match(forcedFailure.issues.join(' '), /Validation MAE/);
});

test('does not estimate current-rate holding periods without both market rates', () => {
  assert.equal(estimateConstantRateHoldingPeriods({ '2026-01-31': 100 }, { '2026-01-30': 3 }, '2026-01-31'), undefined);
  assert.equal(estimateConstantRateHoldingPeriods({ '2026-01-01': 100, '2026-01-31': 100.3 }, {}, '2026-01-31'), undefined);
});

test('reports a constant-rate threshold as unreached within the projection horizon', () => {
  const estimate = estimateConstantRateHoldingPeriods(
    { '2026-01-01': 100, '2026-01-31': 100.2 },
    { '2026-01-01': 3, '2026-01-30': 3 },
    '2026-01-31',
    { lookbackDays: 30, maximumProjectionDays: 365 }
  );
  assert.ok(estimate.breakEven);
  assert.equal(estimate.matchOvernight, undefined);
});

test('does not make the fidelity premium available before 12 uninterrupted months', () => {
  const withoutPremium = estimateSavingsAccountRateMatch(4, 3, 0, '2026-01-01');
  const withPremium = estimateSavingsAccountRateMatch(4, 3, 2, '2026-01-01');

  assert.ok(withoutPremium);
  assert.ok(withoutPremium.days < 365);
  assert.deepEqual(withPremium, withoutPremium);
});

test('reports account matches separately before and after the first fidelity premium', () => {
  const matches = estimateSavingsAccountRateMatches(4, 3, 2, '2026-01-01');

  assert.ok(matches.beforeFidelity);
  assert.ok(matches.beforeFidelity.days < matches.firstFidelityDays);
  assert.equal(matches.afterFidelity, undefined);
});

test('recognizes when a pre-fidelity match survives the first premium', () => {
  const matches = estimateSavingsAccountRateMatches(6, 3, 2, '2026-01-01');

  assert.ok(matches.beforeFidelity);
  assert.equal(matches.afterFidelity.days, matches.firstFidelityDays);
});

test('finds the first re-match after the fidelity premium overtakes CSH2', () => {
  const matches = estimateSavingsAccountRateMatches(5.3, 3, 2, '2026-01-01');

  assert.ok(matches.beforeFidelity);
  assert.ok(matches.afterFidelity.days > matches.firstFidelityDays);
  assert.deepEqual(matches.fidelityMatchWindow, {
    previousAwardNumber: 1,
    previousAwardDate: '2027-01-01',
    daysAfterPreviousAward: matches.afterFidelity.days - matches.firstFidelityDays,
    nextAwardNumber: 2,
    nextAwardDate: '2028-01-01',
    daysBeforeNextAward: 730 - matches.afterFidelity.days
  });
});

test('builds current-rate evolution and records fidelity-driven re-matches', () => {
  const evolution = buildCurrentRateEvolution(5.3, 3, '2026-01-01', {
    baseAnnualRatePercent: 3,
    fidelityPremiumPercent: 2,
    maximumProjectionDays: 730
  });

  assert.ok(evolution);
  assert.equal(evolution.points[0].day, 0);
  assert.equal(evolution.points[0].breakEven, 100);
  assert.ok(evolution.points[0].csh2 < 100);
  assert.ok(evolution.matches.breakEven.length, 1);
  assert.ok(evolution.matches.overnight.length, 1);
  assert.ok(evolution.matches.account.length >= 2);
  assert.ok(evolution.matches.account[0].day < 365);
  assert.ok(evolution.matches.account[1].day > 365);
  assert.ok(evolution.points.some((point) => point.day === 365));
  assert.deepEqual(evolution.matchingIntervals.account, [
    { startDay: evolution.matches.account[0].day, endDay: 365 },
    { startDay: evolution.matches.account[1].day, endDay: 730 }
  ]);
});

test('reports a marginal re-match relative to the next fidelity premium', () => {
  const matches = estimateSavingsAccountRateMatches(2.5494856545249966, 1.67, 1.01, '2026-08-14');
  const misses = estimateSavingsAccountRateMatches(2.5494856545249966, 1.67, 1.02, '2026-08-14');

  assert.deepEqual(matches.afterFidelity, { date: '2028-08-10', days: 727 });
  assert.deepEqual(matches.fidelityMatchWindow, {
    previousAwardNumber: 1,
    previousAwardDate: '2027-08-14',
    daysAfterPreviousAward: 362,
    nextAwardNumber: 2,
    nextAwardDate: '2028-08-14',
    daysBeforeNextAward: 4
  });
  assert.equal(misses.afterFidelity, undefined);
  assert.equal(misses.fidelityMatchWindow, undefined);
});

test('applies the fidelity premium after each completed uninterrupted year', () => {
  const baseOnly = estimateSavingsAccountRateMatch(3.6, 3, 0, '2026-01-01');
  const withPremium = estimateSavingsAccountRateMatch(3.6, 3, 2, '2026-01-01');

  assert.ok(baseOnly);
  assert.ok(baseOnly.days >= 365);
  assert.equal(withPremium, undefined);
  assert.equal(estimateSavingsAccountRateMatch(3.2, 2.5, -0.1, '2026-01-01'), undefined);
});

test('does not vest the fidelity premium before the calendar anniversary across a leap day', () => {
  assert.deepEqual(estimateSavingsAccountRateMatch(3.6, 3, 2, '2027-03-01'), {
    date: '2028-02-29',
    days: 365
  });
});

test('finds the first observed dates that a backtest breaks even and matches the overnight benchmark', () => {
  assert.deepEqual(findObservedHoldingPeriods([
    { date: '2026-01-02', value: -0.24 },
    { date: '2026-01-05', value: 0.04 },
    { date: '2026-01-06', value: 0.12 }
  ], [
    { date: '2026-01-02', value: 0 },
    { date: '2026-01-05', value: 0.05 },
    { date: '2026-01-06', value: 0.08 }
  ], '2026-01-02'), {
    breakEven: { date: '2026-01-05', days: 3 },
    matchOvernight: { date: '2026-01-06', days: 4 }
  });
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
  ], '2026-04-02', { accruedBaseInterest: 25 });

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

test('can show annualized CSH2 returns after transaction and gain taxes', () => {
  const gross = buildForwardAnnualizedCsh2ReturnSeries({
    '2026-01-01': 100,
    '2027-01-01': 110
  }, '2026-01-01', '2027-01-01');
  const afterTax = buildForwardAnnualizedCsh2ReturnSeries({
    '2026-01-01': 100,
    '2027-01-01': 110
  }, '2026-01-01', '2027-01-01', { afterTax: true });
  const afterReyndersTax = buildForwardAnnualizedCsh2ReturnSeries({
    '2026-01-01': 100,
    '2027-01-01': 110
  }, '2026-01-01', '2027-01-01', { afterTax: true, applyReyndersTax: true });

  assert.ok(afterTax[0].value < gross[0].value);
  assert.ok(afterReyndersTax[0].value < afterTax[0].value);
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
  const expected = (overnightAccrualFactor(3, 1) ** 365 - 1) * 100;
  assert.ok(Math.abs(series[0].value - expected) < 0.000001);
});

test('uses a selected 1-month lookback while retaining annualization for the overnight benchmark', () => {
  const series = buildTrailingAnnualizedOvernightBenchmarkReturnSeries({
    '2025-12-01': 3,
    '2026-01-01': 3
  }, '2026-01-01', '2026-01-01', { lookbackDays: 30 });
  assert.equal(series.length, 1);
  const expected = (overnightAccrualFactor(3, 31) ** (365 / 31) - 1) * 100;
  assert.ok(Math.abs(series[0].value - expected) < 0.000001);
});

test('builds a forward annualized overnight benchmark return at the start of the measured period', () => {
  const series = buildForwardAnnualizedOvernightBenchmarkReturnSeries({
    '2025-01-01': 3,
    '2026-01-01': 3
  }, '2025-01-01', '2026-01-01');
  assert.equal(series.length, 1);
  assert.equal(series[0].date, '2025-01-01');
  const expected = (overnightAccrualFactor(3, 365) - 1) * 100;
  assert.ok(Math.abs(series[0].value - expected) < 0.000001);
});

test('leaves the overnight benchmark unchanged in after-tax comparisons', () => {
  const rates = {
    '2025-01-01': 3,
    '2026-01-01': 3
  };
  const gross = buildForwardAnnualizedOvernightBenchmarkReturnSeries(rates, '2025-01-01', '2026-01-01');
  const afterTax = buildForwardAnnualizedOvernightBenchmarkReturnSeries(rates, '2025-01-01', '2026-01-01', { afterTax: true });
  assert.deepEqual(afterTax, gross);
});

test('carries an overnight rate across calendar gaps before annualizing it', () => {
  const series = buildTrailingAnnualizedOvernightBenchmarkReturnSeries({
    '2025-10-01': 3,
    '2025-12-30': 3
  }, '2025-12-30', '2025-12-30');
  assert.equal(series.length, 1);
  const expected = (overnightAccrualFactor(3, 90) ** (365 / 90) - 1) * 100;
  assert.ok(Math.abs(series[0].value - expected) < 0.000001);
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
  assert.ok(series.at(-1).value < 0.6);
});

test('accrues the overnight portfolio across weekends and publication gaps', () => {
  const series = buildOvernightBenchmarkReturnSeries([
    { date: '2026-01-02', type: 'inflow', amount: 1000 }
  ], {
    '2026-01-02': 100,
    '2026-01-06': 100
  }, {
    '2026-01-02': 3,
    '2026-01-06': 3
  }, '2026-01-06', '2026-01-02', '2026-01-06');

  const expected = ((1 + 0.03 * 4 / 360) - 1) * 100;
  assert.ok(Math.abs(series.at(-1).value - expected) < 0.000000001);
});

test('matches the official ECB compounded €STR index over a historical interval', async () => {
  const rates = JSON.parse(await readFile(new URL('../src/assets/data/overnight-rates.json', import.meta.url), 'utf8')).rates;
  const series = buildOvernightBenchmarkReturnSeries([
    { date: '2025-08-15', type: 'inflow', amount: 1000 }
  ], {
    '2025-08-15': 100,
    '2026-07-10': 100
  }, rates, '2026-07-10', '2025-08-15', '2026-07-10');
  const officialIndexReturn = ((109.33409115 / 107.40606381) - 1) * 100;

  assert.ok(Math.abs(series.at(-1).value - officialIndexReturn) < 0.00000001);
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
