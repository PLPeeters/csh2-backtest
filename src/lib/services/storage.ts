import type { CalculationSettings, CashFlowDraft, StoredState } from '../types';

export const flowStorageKey = 'csh2-belgium-flows-v1';
export const settingsStorageKey = 'csh2-belgium-settings-v1';

export const defaultSettings = (): CalculationSettings => ({
  applyCapitalGainsExemption: true,
  applyReyndersTax: false,
  buyWholeSharesOnly: true,
  interestMode: 'accrued',
  unpaidAccruedInterest: '',
  interestPayoutDate: '',
  interestPayoutAmount: '',
  brokerTransactionFee: '0'
});

export const blankFlow = (): CashFlowDraft => ({ id: crypto.randomUUID(), date: '', type: 'inflow', amount: '', interestPayment: false });

function isFlow(value: unknown): value is Omit<CashFlowDraft, 'id'> & { id?: string } {
  if (!value || typeof value !== 'object') return false;
  const flow = value as Record<string, unknown>;
  return typeof flow.date === 'string' && (flow.type === 'inflow' || flow.type === 'outflow') &&
    (typeof flow.amount === 'string' || typeof flow.amount === 'number');
}

function readJson(storage: Storage, key: string): unknown {
  const text = storage.getItem(key);
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { storage.removeItem(key); return undefined; }
}

export function loadStoredState(storage: Storage): StoredState {
  const flowValue = readJson(storage, flowStorageKey);
  const flows = Array.isArray(flowValue) && flowValue.every(isFlow)
    ? flowValue.map((flow) => ({ id: flow.id ?? crypto.randomUUID(), date: flow.date, type: flow.type, amount: String(flow.amount), interestPayment: flow.type === 'inflow' && flow.interestPayment === true }))
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
    interestMode: candidate.interestMode === 'payout' ? 'payout' : 'accrued',
    unpaidAccruedInterest: typeof candidate.unpaidAccruedInterest === 'string' || typeof candidate.unpaidAccruedInterest === 'number' ? String(candidate.unpaidAccruedInterest) : '',
    interestPayoutDate: typeof candidate.interestPayoutDate === 'string' ? candidate.interestPayoutDate : '',
    interestPayoutAmount: typeof candidate.interestPayoutAmount === 'string' || typeof candidate.interestPayoutAmount === 'number' ? String(candidate.interestPayoutAmount) : '',
    brokerTransactionFee: typeof candidate.brokerTransactionFee === 'string' || typeof candidate.brokerTransactionFee === 'number' ? String(candidate.brokerTransactionFee) : '0'
  };
  return { flows, settings };
}

export function saveFlows(storage: Storage, flows: CashFlowDraft[]) {
  storage.setItem(flowStorageKey, JSON.stringify(flows.map(({ date, type, amount, interestPayment }) => ({ date, type, amount, interestPayment }))));
}

export function saveSettings(storage: Storage, settings: CalculationSettings) {
  storage.setItem(settingsStorageKey, JSON.stringify(settings));
}

export function clearStoredState(storage: Storage) {
  storage.removeItem(flowStorageKey);
  storage.removeItem(settingsStorageKey);
}
