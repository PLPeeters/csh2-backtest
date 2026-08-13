export type CashFlowType = 'inflow' | 'outflow';
export type BenchmarkDirection = 'backward' | 'forward';
export type BackwardPeriod = '1m' | '3m' | '6m' | '1y' | '2y' | '5y';
export type ForwardPeriod = '1m' | '3m' | '6m' | '1y';
export type BenchmarkPeriod = BackwardPeriod | ForwardPeriod;

export interface CashFlowDraft { id: string; date: string; type: CashFlowType; amount: string; interestPayment: boolean }
export interface CalculationSettings {
  applyCapitalGainsExemption: boolean;
  applyReyndersTax: boolean;
  buyWholeSharesOnly: boolean;
  unpaidAccruedInterest: string;
  interestPayoutDate: string;
  interestPayoutAmount: string;
  brokerTransactionFee: string;
}
export interface PriceRecord { open?: number; close: number; isFallback?: boolean; fallbackSource?: string }
export interface PriceEnvelope { source?: string; cachedAt: string; prices: Record<string, PriceRecord | number> }
export interface RateEnvelope { source?: string; cachedAt?: string; rates: Record<string, number> }
export interface MarketDataBundle { data: PriceEnvelope; rateData: RateEnvelope; version: string }
export interface ChartPoint { date: string; value: number }
export interface BenchmarkSeries { csh2: ChartPoint[]; overnight: ChartPoint[] }
export interface ReturnProjection {
  csh2: ChartPoint[]; overnight: ChartPoint[]; account: ChartPoint[]; payoutDate: string;
  trendDays: number; trendReturnPercent: number; overnightRatePercent: number;
}
export interface BacktestSeries extends BenchmarkSeries { account: ChartPoint[]; projected?: ReturnProjection }
export interface BenchmarkHistory {
  lookback: Record<BackwardPeriod, BenchmarkSeries>;
  forward: Record<ForwardPeriod, BenchmarkSeries>;
}
export interface BenchmarkHistoryRequest { prices: PriceEnvelope['prices']; rates: RateEnvelope['rates']; to: string }
export interface LedgerEntry {
  date: string; type: CashFlowType; amount: number; interestPayment?: boolean; price?: number; priceKind?: string; units: number;
  remainingCash: number; brokerFee: number; tob: number; cgt: number; reyndersTax: number; exoneratedCgt: number;
}
export interface BreakEvenEstimate { date: string; trendDays: number; trendReturnPercent: number }
export interface InterestPayoutAssessment {
  preferred: 'move now' | 'wait' | 'either'; difference: number; immediateValue: number; waitingValue: number;
  payoutDate: string; trendDays: number; trendReturnPercent: number;
}
export interface BacktestResult {
  valuation: { date: string; price: number }; netLiquidationValue: number; grossValue: number; units: number; availableCash: number;
  paidTob: number; paidCgt: number; paidReyndersTax: number; terminalTob: number; terminalCgt: number;
  terminalReyndersTax: number; paidBrokerFees: number; terminalBrokerFee: number; missedAmount: number;
  missedSharePercent?: number; entries: LedgerEntry[]; breakEvenEstimate?: BreakEvenEstimate;
  interestPayoutAssessment?: InterestPayoutAssessment;
}
export interface CalculationView {
  result: BacktestResult; metadata: PriceEnvelope; rateMetadata: RateEnvelope; settings: CalculationSettings; returnSeries: BacktestSeries; from: string; to: string;
}
export type StatusState = { kind: 'idle' | 'loading' | 'success' | 'error'; message: string };
export interface StoredState { flows: CashFlowDraft[]; settings: CalculationSettings }
