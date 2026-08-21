export type CashFlowType = 'inflow' | 'outflow';
export type BenchmarkDirection = 'backward' | 'forward';
export type BackwardPeriod = '1m' | '3m' | '6m' | '1y' | '2y' | '5y';
export type ForwardPeriod = '1m' | '3m' | '6m' | '1y';
export type BenchmarkPeriod = BackwardPeriod | ForwardPeriod;
export type Csh2RateScenario = 'cautious' | 'base' | 'optimistic';

export interface CashFlowDraft { id: string; date: string; type: CashFlowType; amount: string; interestPayment: boolean }
export interface FidelityPremiumDraft { id: string; baseAmount: string; earnedDate: string; finalPayoutAmount: string }
export interface CalculationSettings {
  applyCapitalGainsExemption: boolean;
  applyReyndersTax: boolean;
  buyWholeSharesOnly: boolean;
  accruedBaseInterest: string;
  fidelityPremiums: FidelityPremiumDraft[];
  brokerTransactionFee: string;
  accountBaseInterestRate: string;
  accountFidelityPremium: string;
  csh2RateScenario: Csh2RateScenario;
}
export interface PriceRecord { open?: number; close: number; isFallback?: boolean; fallbackSource?: string }
export interface PriceEnvelope { source?: string; cachedAt: string; prices: Record<string, PriceRecord | number> }
export interface RateEnvelope { source?: string; cachedAt?: string; rates: Record<string, number> }
export interface MarketDataBundle { data: PriceEnvelope; rateData: RateEnvelope; version: string }
export interface ChartPoint { date: string; value: number }
export interface BenchmarkSeries { csh2: ChartPoint[]; overnight: ChartPoint[] }
export interface ReturnProjection {
  csh2: ChartPoint[]; overnight: ChartPoint[]; account: ChartPoint[]; throughDate: string;
  csh2AnnualRatePercent: number; overnightRatePercent: number; baseAnnualRatePercent?: number;
}
export interface BacktestSeries extends BenchmarkSeries { account: ChartPoint[]; projected?: ReturnProjection }
export interface BenchmarkHistorySeries {
  lookback: Record<BackwardPeriod, BenchmarkSeries>;
  forward: Record<ForwardPeriod, BenchmarkSeries>;
}
export interface MinimumHoldingPeriod { date: string; days: number }
export interface MinimumHoldingPeriodRange { earliest?: MinimumHoldingPeriod; central?: MinimumHoldingPeriod; latest?: MinimumHoldingPeriod }
export interface CurrentRateErrorWindow {
  rollingYears?: number; fullHistory?: boolean; from: string; to: string; observations: number; maeAnnualRatePercent: number;
}
export interface CurrentRateTrendExample {
  date: string; csh2Index: number; overnightBenchmarkIndex: number; gapPercent: number;
}
export interface ObservedHoldingPeriods { from?: string; breakEven?: MinimumHoldingPeriod; matchOvernight?: MinimumHoldingPeriod }
export interface ConstantRateHoldingPeriods {
  valuationDate: string; trendStartDate: string; rateDate: string; trendDays: number; trendObservations: number;
  trendExamples: CurrentRateTrendExample[]; trendExamplesOmitted: boolean;
  csh2AnnualRatePercent: number; csh2AnnualRateLowPercent: number; csh2AnnualRateHighPercent: number; overnightRatePercent: number;
  csh2ExcessAnnualRatePercent: number; currentOvernightAnnualRatePercent: number; modelErrorAnnualRatePercent?: number;
  errorEvaluationDays: number; errorValidationFrom?: string; errorValidationTo?: string; errorValidationObservations: number;
  recentMaeAnnualRatePercent?: number; errorWindows: CurrentRateErrorWindow[];
  breakEven?: MinimumHoldingPeriod; matchOvernight?: MinimumHoldingPeriod;
  breakEvenRange: MinimumHoldingPeriodRange; matchOvernightRange: MinimumHoldingPeriodRange;
}
export interface BenchmarkHistory {
  gross: BenchmarkHistorySeries; cgt: BenchmarkHistorySeries; reynders: BenchmarkHistorySeries;
  holdingPeriods: { cgt?: ConstantRateHoldingPeriods; reynders?: ConstantRateHoldingPeriods };
}
export interface BenchmarkHistoryRequest { prices: PriceEnvelope['prices']; rates: RateEnvelope['rates']; to: string }
export interface LedgerEntry {
  date: string; type: CashFlowType; amount: number; interestPayment?: boolean; price?: number; priceKind?: string; units: number;
  remainingCash: number; brokerFee: number; tob: number; cgt: number; reyndersTax: number; exoneratedCgt: number;
}
export interface BreakEvenEstimate { date: string; days: number; csh2AnnualRatePercent: number }
export interface FidelityPremiumAssessment {
  id: string; baseAmount: number; earnedDate: string; finalPayoutAmount: number;
  currentPeriodPreferred: 'move now' | 'wait' | 'either'; currentPeriodDifference: number;
  immediateValue: number; waitingValue: number; csh2AnnualRatePercent: number;
  recommendation: 'move now' | 'move after payout' | 'keep in account' | 'wait, then reassess' | 'either'; transferDate?: string;
  nextYearCsh2Value?: number; nextYearAccountValue?: number;
  purchaseGroupSize?: number;
}
export interface BacktestResult {
  valuation: { date: string; price: number }; netLiquidationValue: number; grossValue: number; units: number; availableCash: number;
  paidTob: number; paidCgt: number; paidReyndersTax: number; terminalTob: number; terminalCgt: number;
  terminalReyndersTax: number; paidBrokerFees: number; terminalBrokerFee: number; missedAmount: number;
  missedSharePercent?: number; entries: LedgerEntry[]; breakEvenEstimate?: BreakEvenEstimate;
  observedHoldingPeriods: ObservedHoldingPeriods;
  fidelityPremiumAssessments: FidelityPremiumAssessment[];
}
export interface CalculationView {
  result: BacktestResult; metadata: PriceEnvelope; rateMetadata: RateEnvelope; settings: CalculationSettings; returnSeries: BacktestSeries; from: string; to: string;
}
export type StatusState = { kind: 'idle' | 'loading' | 'success' | 'error'; message: string };
export interface StoredState { flows: CashFlowDraft[]; settings: CalculationSettings }
