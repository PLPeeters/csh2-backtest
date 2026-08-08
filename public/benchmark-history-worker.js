import { buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries } from './modules/backtest.mjs?v=e2e8634465d5';

const lookbackPeriods = { '1m': 30, '3m': 90, '6m': 183, '1y': 365, '2y': 730, '5y': 1825 };
const forwardPeriods = { '3m': 90, '6m': 183, '1y': 365 };

function buildSeries(periods, buildCsh2, buildOvernight, prices, rates, to) {
  return Object.fromEntries(Object.entries(periods).map(([period, lookbackDays]) => [period, {
    csh2: buildCsh2(prices, '', to, { lookbackDays }),
    overnight: buildOvernight(rates, '', to, { lookbackDays })
  }]));
}

self.onmessage = ({ data: { prices, rates, to } }) => {
  self.postMessage({
    lookback: buildSeries(lookbackPeriods, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, prices, rates, to),
    forward: buildSeries(forwardPeriods, buildForwardAnnualizedCsh2ReturnSeries, buildForwardAnnualizedOvernightBenchmarkReturnSeries, prices, rates, to)
  });
};
