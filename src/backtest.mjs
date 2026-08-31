/**
 * Stable public API for CSH2 valuation, tax, projection, and chart calculations.
 * Implementation is split by responsibility in `src/backtest/` so callers do not
 * need to depend on internal financial rules.
 */
export {
  ANNUAL_CGT_EXEMPTION,
  CGT_EXEMPTION_CARRY_INCREMENT,
  CGT_EXEMPTION_START_YEAR,
  CGT_RATE,
  MAXIMUM_CGT_EXEMPTION,
  overnightAccrualFactor,
  REYNDERS_TAX_RATE,
  TOB_RATE
} from './backtest/shared.mjs';
export { runBacktest } from './backtest/simulation.mjs';
export { assessCalculatedCurrentRateModelHealth, assessCurrentRateModelHealth, assertCalculatedCurrentRateModelHealthy, assertCurrentRateModelHealthy, buildRelativeCsh2Series, calculateCurrentRateModel, CURRENT_RATE_EVALUATION_DAYS, CURRENT_RATE_LOOKBACK_DAYS, CURRENT_RATE_VALIDATION_START, fitRelativeExcess } from './backtest/current-rate.mjs';
export { allocateFidelityWithdrawals, assessFidelityPremiumTiming, assessFidelityPremiumTimings, buildCurrentRateEvolution, buildMarketReturnProjection, buildProjectedAccountReturnSeries, buildReturnProjection, estimateBreakEvenDate, estimateConstantRateHoldingPeriods, estimateConstantRateMatch, estimateOvernightRateMatch, estimateSavingsAccountRateMatch, estimateSavingsAccountRateMatches, orderFidelityAssessmentsByRecommendation, orderFidelityPremiumsForWithdrawal } from './backtest/projections.mjs';
export {
  buildAccountReturnSeries,
  buildBacktestReturnSeries,
  buildForwardAnnualizedCsh2ReturnSeries,
  buildForwardAnnualizedOvernightBenchmarkReturnSeries,
  buildOvernightBenchmarkReturnSeries,
  buildOvernightTimeWeightedReturnSeries,
  buildTrailingAnnualizedCsh2ReturnSeries,
  buildTrailingAnnualizedOvernightBenchmarkReturnSeries,
  estimateAnnualizedAfterTaxCsh2Rate,
  findObservedHoldingPeriods
} from './backtest/return-series.mjs';
export { buildAccountTimeWeightedReturnSeries, buildCsh2TimeWeightedReturnSeries, buildTimeWeightedReturnProjection, calculateAccountTimeWeightedReturn, calculateCsh2TimeWeightedReturn, calculateMoneyWeightedReturn, calculateRealMoneyWeightedReturn } from './backtest/performance-returns.mjs';
export { cpiIndexForDate, cpiPointForDate, deflateCashFlowsToDate, deflateCumulativeReturnSeries, latestAnnualInflation, realAnnualizedReturn, realAnnualRate, realGrowthFactor, realGrowthFactorWithProvenance } from './backtest/inflation.mjs';
