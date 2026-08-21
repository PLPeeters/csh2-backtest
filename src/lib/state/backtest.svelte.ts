import type { BenchmarkDirection, BenchmarkHistory, BackwardPeriod, CalculationSettings, CalculationView, CashFlowDraft, Csh2RateScenario, FidelityPremiumDraft, ForwardPeriod, MarketDataBundle, StatusState } from '../types';
import { blankFidelityPremium, blankFlow, clearStoredState, createFlowId, defaultSettings, loadStoredState, saveFlows, saveSettings } from '../services/storage';
import { latestAvailablePriceDate } from '../../static-market-data.mjs';

export interface BacktestDependencies {
  storage: Storage;
  today(): string;
  loadMarketData(): Promise<MarketDataBundle>;
  calculate(flows: CashFlowDraft[], settings: CalculationSettings, market: MarketDataBundle, today: string): CalculationView;
  prepareBenchmark(request: { prices: MarketDataBundle['data']['prices']; rates: MarketDataBundle['rateData']['rates']; to: string }): Promise<BenchmarkHistory>;
}

function cloneFlows(flows: CashFlowDraft[]) {
  return flows.map((flow) => ({ ...flow }));
}

function cloneSettings(settings: CalculationSettings) {
  return { ...settings, fidelityPremiums: settings.fidelityPremiums.map((premium) => ({ ...premium })) };
}

function calculationInputSignature(flows: CashFlowDraft[], settings: CalculationSettings) {
  const calculationSettings = {
    applyCapitalGainsExemption: settings.applyCapitalGainsExemption,
    applyReyndersTax: settings.applyReyndersTax,
    buyWholeSharesOnly: settings.buyWholeSharesOnly,
    accruedBaseInterest: settings.accruedBaseInterest,
    fidelityPremiums: settings.fidelityPremiums.map(({ baseAmount, earnedDate, finalPayoutAmount }) => ({ baseAmount, earnedDate, finalPayoutAmount })),
    brokerTransactionFee: settings.brokerTransactionFee,
    ...(settings.fidelityPremiums.length ? {
      accountBaseInterestRate: settings.accountBaseInterestRate,
      accountFidelityPremium: settings.accountFidelityPremium
    } : {}),
    csh2RateScenario: settings.csh2RateScenario
  };
  return JSON.stringify({ flows: flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount, interestPayment })), settings: calculationSettings });
}

function interestSettingsAreValid(settings: CalculationSettings) {
  const accruedInterest = Number(settings.accruedBaseInterest || 0);
  if (!Number.isFinite(accruedInterest) || accruedInterest < 0) return false;
  return settings.fidelityPremiums.every((premium) => Number.isFinite(Number(premium.baseAmount)) && Number(premium.baseAmount) > 0 &&
    !!premium.earnedDate && Number.isFinite(Number(premium.finalPayoutAmount)) && Number(premium.finalPayoutAmount) > 0);
}

export function createBacktestController(dependencies: BacktestDependencies) {
  const stored = loadStoredState(dependencies.storage);
  let flows = $state(stored.flows);
  let settings = $state(stored.settings);
  let status = $state<StatusState>({ kind: 'idle', message: '' });
  let view = $state<CalculationView>();
  let benchmark = $state<BenchmarkHistory>();
  let benchmarkStatus = $state<StatusState>({ kind: 'idle', message: '' });
  let direction = $state<BenchmarkDirection>('backward');
  let backwardPeriod = $state<BackwardPeriod>('1y');
  let forwardPeriod = $state<ForwardPeriod>('1y');
  let benchmarkAfterTax = $state(false);
  let submittedInputSignature = $state<string>();
  let submittedFlowsSnapshot: CashFlowDraft[] | undefined;
  let requestGeneration = 0;
  let benchmarkRequestGeneration = 0;

  const persist = () => { saveFlows(dependencies.storage, flows); saveSettings(dependencies.storage, settings); };
  const prepareBenchmark = async (market: MarketDataBundle, requestedTo?: string) => {
    const generation = ++benchmarkRequestGeneration;
    benchmarkStatus = { kind: 'loading', message: 'Preparing benchmark history…' };
    try {
      const to = requestedTo ?? latestAvailablePriceDate(market.data.prices, dependencies.today());
      if (!to) throw new Error('The published CSH2 price data contains no closing prices.');
      const history = await dependencies.prepareBenchmark({ prices: market.data.prices, rates: market.rateData.rates, to });
      if (generation !== benchmarkRequestGeneration) return;
      benchmark = history;
      benchmarkStatus = { kind: 'success', message: '' };
    } catch (error) {
      if (generation !== benchmarkRequestGeneration) return;
      benchmarkStatus = { kind: 'error', message: error instanceof Error ? error.message : 'Benchmark history could not be prepared.' };
    }
  };
  return {
    get flows() { return flows; }, get settings() { return settings; }, get status() { return status; }, get view() { return view; },
    get benchmark() { return benchmark; }, get benchmarkStatus() { return benchmarkStatus; }, get direction() { return direction; },
    get backwardPeriod() { return backwardPeriod; }, get forwardPeriod() { return forwardPeriod; }, get benchmarkAfterTax() { return benchmarkAfterTax; },
    get resultIsStale() { return !!view && submittedInputSignature !== calculationInputSignature(flows, settings); },
    get valid() { return flows.length > 0 && flows.every((flow) => flow.date && Number(flow.amount) > 0) && interestSettingsAreValid(settings); },
    addFlow(flow: Partial<CashFlowDraft> = {}) { flows.push({ ...blankFlow(), ...flow }); persist(); },
    removeFlow(id: string) { flows = flows.filter((flow) => flow.id !== id); if (!flows.length) flows = [blankFlow()]; persist(); },
    replaceFlows(next: CashFlowDraft[]) { flows = next; persist(); },
    updateFlow(id: string, key: 'date' | 'type' | 'amount', value: string) { const flow = flows.find((item) => item.id === id); if (flow) { if (key === 'date') flow.date = value; else if (key === 'amount') flow.amount = value; else if (value === 'inflow' || value === 'outflow') { flow.type = value; if (value === 'outflow') flow.interestPayment = false; } persist(); } },
    updateInterestPayment(id: string, value: boolean) { const flow = flows.find((item) => item.id === id); if (flow?.type === 'inflow') { flow.interestPayment = value; persist(); } },
    addFidelityPremium() { settings.fidelityPremiums.push(blankFidelityPremium()); persist(); },
    removeFidelityPremium(id: string) { settings.fidelityPremiums = settings.fidelityPremiums.filter((premium) => premium.id !== id); persist(); },
    updateFidelityPremium(id: string, key: keyof Omit<FidelityPremiumDraft, 'id'>, value: string) { const premium = settings.fidelityPremiums.find((item) => item.id === id); if (premium) { premium[key] = value; persist(); } },
    updateSetting<K extends keyof CalculationSettings>(key: K, value: CalculationSettings[K]) { settings[key] = value; persist(); },
    async setAccountRate(key: 'accountBaseInterestRate' | 'accountFidelityPremium', value: string) {
      settings[key] = value;
      persist();
      if (!view || !submittedFlowsSnapshot) return;
      const generation = ++requestGeneration;
      const recalculatedFlows = cloneFlows(submittedFlowsSnapshot);
      const recalculatedSettings = { ...view.settings, [key]: value };
      status = { kind: 'loading', message: 'Updating the account projection…' };
      try {
        const market = await dependencies.loadMarketData();
        const nextView = dependencies.calculate(recalculatedFlows, recalculatedSettings, market, dependencies.today());
        if (generation !== requestGeneration) return;
        view = nextView;
        submittedFlowsSnapshot = cloneFlows(recalculatedFlows);
        submittedInputSignature = calculationInputSignature(recalculatedFlows, recalculatedSettings);
        status = { kind: 'success', message: `Updated using the ${nextView.result.valuation.date} close.` };
      } catch (error) {
        if (generation !== requestGeneration) return;
        status = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
    loadExample() { flows = [{ id: createFlowId(), date: '2025-04-01', type: 'inflow', amount: '5000', interestPayment: false }, { id: createFlowId(), date: '2025-10-01', type: 'inflow', amount: '750', interestPayment: false }, { id: createFlowId(), date: '2026-04-01', type: 'outflow', amount: '600', interestPayment: false }]; persist(); status = { kind: 'idle', message: 'Example loaded. Calculate when ready.' }; },
    clear() { clearStoredState(dependencies.storage); flows = [blankFlow()]; settings = defaultSettings(); view = undefined; submittedFlowsSnapshot = undefined; submittedInputSignature = undefined; status = { kind: 'success', message: 'All locally saved cash flows and settings were cleared.' }; },
    setDirection(value: BenchmarkDirection) { direction = value; },
    setPeriod(value: BackwardPeriod | ForwardPeriod) { if (direction === 'backward') backwardPeriod = value as BackwardPeriod; else forwardPeriod = value as ForwardPeriod; },
    setBenchmarkAfterTax(value: boolean) { benchmarkAfterTax = value; },
    async setTaxRegime(applyReyndersTax: boolean) {
      if (settings.applyReyndersTax === applyReyndersTax) return;
      settings.applyReyndersTax = applyReyndersTax;
      persist();
      if (!view || !submittedFlowsSnapshot) return;
      const generation = ++requestGeneration;
      const recalculatedFlows = cloneFlows(submittedFlowsSnapshot);
      const recalculatedSettings = {
        ...view.settings,
        applyReyndersTax,
        accountBaseInterestRate: settings.accountBaseInterestRate,
        accountFidelityPremium: settings.accountFidelityPremium
      };
      status = { kind: 'loading', message: 'Updating the backtest tax regime…' };
      try {
        const market = await dependencies.loadMarketData();
        const nextView = dependencies.calculate(recalculatedFlows, recalculatedSettings, market, dependencies.today());
        if (generation !== requestGeneration) return;
        view = nextView;
        submittedFlowsSnapshot = cloneFlows(recalculatedFlows);
        submittedInputSignature = calculationInputSignature(recalculatedFlows, recalculatedSettings);
        status = { kind: 'success', message: `Recalculated using the ${nextView.result.valuation.date} close.` };
      } catch (error) {
        if (generation !== requestGeneration) return;
        status = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
    async setCsh2RateScenario(csh2RateScenario: Csh2RateScenario) {
      if (settings.csh2RateScenario === csh2RateScenario) return;
      settings.csh2RateScenario = csh2RateScenario;
      persist();
      if (!view || !submittedFlowsSnapshot) return;
      const generation = ++requestGeneration;
      const recalculatedFlows = cloneFlows(submittedFlowsSnapshot);
      const recalculatedSettings = { ...view.settings, csh2RateScenario };
      status = { kind: 'loading', message: 'Updating the CSH2 rate scenario…' };
      try {
        const market = await dependencies.loadMarketData();
        const nextView = dependencies.calculate(recalculatedFlows, recalculatedSettings, market, dependencies.today());
        if (generation !== requestGeneration) return;
        view = nextView;
        submittedFlowsSnapshot = cloneFlows(recalculatedFlows);
        submittedInputSignature = calculationInputSignature(recalculatedFlows, recalculatedSettings);
        status = { kind: 'success', message: `Recalculated using the ${nextView.result.valuation.date} close.` };
      } catch (error) {
        if (generation !== requestGeneration) return;
        status = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    },
    async loadBenchmark() {
      benchmarkStatus = { kind: 'loading', message: 'Loading benchmark market data…' };
      try { await prepareBenchmark(await dependencies.loadMarketData()); }
      catch (error) { benchmarkStatus = { kind: 'error', message: error instanceof Error ? error.message : 'Benchmark history could not be prepared.' }; }
    },
    async calculate() {
      const generation = ++requestGeneration;
      const submittedFlows = cloneFlows(flows);
      const submittedSettings = cloneSettings(settings);
      const nextSubmittedInputSignature = calculationInputSignature(submittedFlows, submittedSettings);
      persist();
      status = { kind: 'loading', message: 'Loading the latest published CSH2 data…' };
      try {
        const market = await dependencies.loadMarketData();
        const nextView = dependencies.calculate(submittedFlows, submittedSettings, market, dependencies.today());
        if (generation !== requestGeneration) return;
        view = nextView;
        submittedFlowsSnapshot = cloneFlows(submittedFlows);
        submittedInputSignature = nextSubmittedInputSignature;
        status = { kind: 'success', message: `Calculated using the ${nextView.result.valuation.date} close.` };
        if (!benchmark && benchmarkStatus.kind !== 'loading') void prepareBenchmark(market, nextView.to);
      } catch (error) {
        if (generation !== requestGeneration) return;
        view = undefined;
        status = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    }
  };
}
export type BacktestController = ReturnType<typeof createBacktestController>;
