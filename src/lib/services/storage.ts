import type { CalculationSettings, CashFlowDraft, FidelityPremiumDraft, StoredState } from '../types';
import type { HistoricalRateRow, HistoricalSavingsState } from './historical-savings';

export const flowStorageKey = 'csh2-belgium-flows-v1';
export const settingsStorageKey = 'csh2-belgium-settings-v1';
export const historicalSavingsStorageKey = 'csh2-belgium-historical-savings-v1';

let flowIdSequence = 0;
export function createFlowId() {
  flowIdSequence += 1;
  return `flow-${Date.now().toString(36)}-${flowIdSequence.toString(36)}`;
}

let premiumIdSequence = 0;
export function createPremiumId() {
  premiumIdSequence += 1;
  return `premium-${Date.now().toString(36)}-${premiumIdSequence.toString(36)}`;
}

export const defaultSettings = (): CalculationSettings => ({
  applyCapitalGainsExemption: true,
  applyReyndersTax: false,
  buyWholeSharesOnly: true,
  accruedBaseInterest: '',
  fidelityPremiums: [],
  brokerTransactionFee: '0',
  accountBaseInterestRate: '',
  accountFidelityPremium: '',
  bestSavingsBaseInterestRate: '',
  bestSavingsFidelityPremium: '',
  totalSavingsAmount: '',
  csh2RateScenario: 'base',
  returnMode: 'nominal'
});

export const blankFlow = (): CashFlowDraft => ({ id: createFlowId(), date: '', type: 'inflow', amount: '', interestPayment: false });
export const blankFidelityPremium = (): FidelityPremiumDraft => ({ id: createPremiumId(), baseAmount: '', earnedDate: '', finalPayoutAmount: '' });

function isFlow(value: unknown): value is Omit<CashFlowDraft, 'id'> & { id?: string } {
  if (!value || typeof value !== 'object') return false;
  const flow = value as Record<string, unknown>;
  return typeof flow.date === 'string' && (flow.type === 'inflow' || flow.type === 'outflow') &&
    (typeof flow.amount === 'string' || typeof flow.amount === 'number');
}

function fidelityPremiums(candidate: Record<string, unknown>): FidelityPremiumDraft[] {
  if (Array.isArray(candidate.fidelityPremiums)) {
    return candidate.fidelityPremiums.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const premium = value as Record<string, unknown>;
      const baseAmount = premium.baseAmount;
      const earnedDate = premium.earnedDate;
      const finalPayoutAmount = premium.finalPayoutAmount;
      if ((typeof baseAmount !== 'string' && typeof baseAmount !== 'number') || typeof earnedDate !== 'string' ||
          (typeof finalPayoutAmount !== 'string' && typeof finalPayoutAmount !== 'number')) return [];
      return [{ id: typeof premium.id === 'string' ? premium.id : createPremiumId(), baseAmount: String(baseAmount), earnedDate, finalPayoutAmount: String(finalPayoutAmount) }];
    });
  }
  const legacyDate = typeof candidate.interestPayoutDate === 'string' ? candidate.interestPayoutDate : '';
  const legacyPayout = typeof candidate.interestPayoutAmount === 'string' || typeof candidate.interestPayoutAmount === 'number' ? String(candidate.interestPayoutAmount) : '';
  return legacyDate || legacyPayout ? [{ ...blankFidelityPremium(), earnedDate: legacyDate, finalPayoutAmount: legacyPayout }] : [];
}

function readJson(storage: Storage, key: string): unknown {
  const text = storage.getItem(key);
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { storage.removeItem(key); return undefined; }
}

export function loadStoredState(storage: Storage): StoredState {
  const flowValue = readJson(storage, flowStorageKey);
  const flows = Array.isArray(flowValue) && flowValue.every(isFlow)
    ? flowValue.map((flow) => ({ id: flow.id ?? createFlowId(), date: flow.date, type: flow.type, amount: String(flow.amount), interestPayment: flow.type === 'inflow' && flow.interestPayment === true }))
    : [blankFlow()];
  if (!Array.isArray(flowValue) && flowValue !== undefined) storage.removeItem(flowStorageKey);
  const defaults = defaultSettings();
  const value = readJson(storage, settingsStorageKey);
  if (!value || typeof value !== 'object') return { flows, settings: defaults };
  const candidate = value as Record<string, unknown>;
  const settings: CalculationSettings = {
    applyCapitalGainsExemption: typeof candidate.applyCapitalGainsExemption === 'boolean' ? candidate.applyCapitalGainsExemption : defaults.applyCapitalGainsExemption,
    applyReyndersTax: typeof candidate.applyReyndersTax === 'boolean' ? candidate.applyReyndersTax : defaults.applyReyndersTax,
    buyWholeSharesOnly: typeof candidate.buyWholeSharesOnly === 'boolean' ? candidate.buyWholeSharesOnly : defaults.buyWholeSharesOnly,
    accruedBaseInterest: typeof candidate.accruedBaseInterest === 'string' || typeof candidate.accruedBaseInterest === 'number'
      ? String(candidate.accruedBaseInterest)
      : typeof candidate.unpaidAccruedInterest === 'string' || typeof candidate.unpaidAccruedInterest === 'number' ? String(candidate.unpaidAccruedInterest) : '',
    fidelityPremiums: fidelityPremiums(candidate),
    brokerTransactionFee: typeof candidate.brokerTransactionFee === 'string' || typeof candidate.brokerTransactionFee === 'number' ? String(candidate.brokerTransactionFee) : '0',
    accountBaseInterestRate: typeof candidate.accountBaseInterestRate === 'string' || typeof candidate.accountBaseInterestRate === 'number'
      ? String(candidate.accountBaseInterestRate)
      : typeof candidate.accountInterestRate === 'string' || typeof candidate.accountInterestRate === 'number' ? String(candidate.accountInterestRate) : '',
    accountFidelityPremium: typeof candidate.accountFidelityPremium === 'string' || typeof candidate.accountFidelityPremium === 'number' ? String(candidate.accountFidelityPremium) : '',
    // Existing rate inputs described the comparison account. Keep them as the
    // best available account when introducing the separate current-account rates.
    bestSavingsBaseInterestRate: typeof candidate.bestSavingsBaseInterestRate === 'string' || typeof candidate.bestSavingsBaseInterestRate === 'number'
      ? String(candidate.bestSavingsBaseInterestRate)
      : typeof candidate.accountBaseInterestRate === 'string' || typeof candidate.accountBaseInterestRate === 'number'
        ? String(candidate.accountBaseInterestRate)
        : typeof candidate.accountInterestRate === 'string' || typeof candidate.accountInterestRate === 'number' ? String(candidate.accountInterestRate) : '',
    bestSavingsFidelityPremium: typeof candidate.bestSavingsFidelityPremium === 'string' || typeof candidate.bestSavingsFidelityPremium === 'number'
      ? String(candidate.bestSavingsFidelityPremium)
      : typeof candidate.accountFidelityPremium === 'string' || typeof candidate.accountFidelityPremium === 'number' ? String(candidate.accountFidelityPremium) : '',
    totalSavingsAmount: typeof candidate.totalSavingsAmount === 'string' || typeof candidate.totalSavingsAmount === 'number' ? String(candidate.totalSavingsAmount) : defaults.totalSavingsAmount,
    csh2RateScenario: candidate.csh2RateScenario === 'cautious' || candidate.csh2RateScenario === 'optimistic' || candidate.csh2RateScenario === 'base'
      ? candidate.csh2RateScenario
      : defaults.csh2RateScenario,
    returnMode: candidate.returnMode === 'real' || candidate.returnMode === 'nominal' ? candidate.returnMode : defaults.returnMode
  };
  return { flows, settings };
}

export function saveFlows(storage: Storage, flows: CashFlowDraft[]) {
  storage.setItem(flowStorageKey, JSON.stringify(flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount, interestPayment }))));
}

export function saveSettings(storage: Storage, settings: CalculationSettings) {
  storage.setItem(settingsStorageKey, JSON.stringify(settings));
}

export function loadHistoricalSavingsState(storage: Storage, today = new Date().toISOString().slice(0, 10)): HistoricalSavingsState {
  const value = readJson(storage, historicalSavingsStorageKey);
  if (!value || typeof value !== 'object') return { rates: [{ id: `historical-rate-${Date.now().toString(36)}`, date: today, baseRate: '', fidelityPremium: '' }], endDate: today };
  const candidate = value as Record<string, unknown>;
  const rates = Array.isArray(candidate.rates) ? candidate.rates.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.date !== 'string') return [];
    const baseRate = typeof row.baseRate === 'string' || typeof row.baseRate === 'number' ? String(row.baseRate) : '';
    const fidelityPremium = typeof row.fidelityPremium === 'string' || typeof row.fidelityPremium === 'number' ? String(row.fidelityPremium) : '';
    return [{ id: typeof row.id === 'string' ? row.id : `historical-rate-${index}-${Date.now().toString(36)}`, date: row.date, baseRate, fidelityPremium } satisfies HistoricalRateRow];
  }) : [];
  const endDate = typeof candidate.endDate === 'string' ? candidate.endDate : today;
  return { rates: rates.length ? rates : [{ id: `historical-rate-${Date.now().toString(36)}`, date: today, baseRate: '', fidelityPremium: '' }], endDate };
}

export function saveHistoricalSavingsState(storage: Storage, state: HistoricalSavingsState) {
  storage.setItem(historicalSavingsStorageKey, JSON.stringify(state));
}

export function clearStoredState(storage: Storage) {
  storage.removeItem(flowStorageKey);
  storage.removeItem(settingsStorageKey);
}
