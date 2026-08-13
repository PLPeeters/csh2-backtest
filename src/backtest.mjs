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
  REYNDERS_TAX_RATE,
  TOB_RATE
} from './backtest/shared.mjs';
export { runBacktest } from './backtest/simulation.mjs';
export { assessInterestPayoutTiming, estimateBreakEvenDate } from './backtest/projections.mjs';
export {
  buildAccountReturnSeries,
  buildBacktestReturnSeries,
  buildForwardAnnualizedCsh2ReturnSeries,
  buildForwardAnnualizedOvernightBenchmarkReturnSeries,
  buildOvernightBenchmarkReturnSeries,
  buildTrailingAnnualizedCsh2ReturnSeries,
  buildTrailingAnnualizedOvernightBenchmarkReturnSeries
} from './backtest/return-series.mjs';
