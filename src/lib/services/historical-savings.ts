/**
 * Historical Belgian savings-account backtest.
 *
 * The calculation keeps accrued base interest and acquired fidelity premiums
 * outside the account balance until their credit dates while including them
 * in economic value. Amounts are not rounded during the simulation; a bank's
 * statement rounding policy is not part of the available historical input.
 */

export interface HistoricalRateRow {
  id: string;
  date: string;
  baseRate: string | number;
  fidelityPremium: string | number;
}

export interface HistoricalSavingsScenario {
  deposits: { date: string; amount: number }[];
  totalDeposited: number;
  baseInterestEarned: number;
  fidelityPremiumCredited: number;
  fidelityPremiumPending: number;
  endingBalance: number;
  /** Account balance plus acquired or accrued interest entitlements. */
  economicValue: number;
  accruedBaseInterest: number;
  annualizedReturn?: number;
  series: { date: string; value: number }[];
}

export interface HistoricalSavingsResult {
  from: string;
  to: string;
  monthly: HistoricalSavingsScenario;
  lumpSum: HistoricalSavingsScenario;
}

export interface HistoricalSavingsInput {
  rates: HistoricalRateRow[];
  endDate: string;
}

export type HistoricalSavingsState = Pick<HistoricalSavingsInput, 'rates' | 'endDate'>;

const DAY = 86_400_000;
const QUARTER_MONTHS = [1, 4, 7, 10];

function dateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : Number.NaN;
}

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthlyDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, '0')}`;
}

function nextMonthlyDate(date: string, originalDay: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  return month === 12 ? monthlyDate(year + 1, 1, originalDay) : monthlyDate(year, month + 1, originalDay);
}

function oneYearAfter(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return monthlyDate(parsed.getUTCFullYear() + 1, parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function activeRate(rows: { date: string; baseRate: number; fidelityPremium: number }[], date: string) {
  let selected = rows[0];
  for (const row of rows) {
    if (row.date > date) break;
    selected = row;
  }
  return selected;
}

function nextQuarterlyPayout(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const nextQuarter = QUARTER_MONTHS.find((quarter) => quarter > month);
  if (nextQuarter !== undefined) return monthlyDate(year, nextQuarter, 1);
  return monthlyDate(year + 1, 1, 1);
}

function annualizedMoneyWeightedReturn(cashFlows: { date: string; amount: number }[], endingBalance: number, endDate: string) {
  const first = cashFlows[0];
  if (!first) return undefined;
  const horizonDays = Math.round((dateValue(endDate) - dateValue(first.date)) / DAY);
  if (horizonDays <= 0 || endingBalance <= 0) return undefined;
  // Solve the dated cash-flow NPV using annual compounding and ACT/365 time.
  const valueAt = (rate: number) => cashFlows.reduce((total, flow) => {
    const days = (dateValue(endDate) - dateValue(flow.date)) / DAY;
    return total + flow.amount * (1 + rate) ** (days / 365);
  }, endingBalance);
  let low = -0.999999;
  let high = 1;
  while (valueAt(high) > 0 && high < 1e6) high *= 2;
  if (valueAt(low) * valueAt(high) > 0) return undefined;
  for (let index = 0; index < 100; index += 1) {
    const middle = (low + high) / 2;
    if (valueAt(middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

interface Rate {
  date: string;
  baseRate: number;
  fidelityPremium: number;
}

interface Lot {
  amount: number;
  periodStart: string;
  lockedRate: number;
}

interface PendingPremium {
  amount: number;
  payoutDate: string;
  lot: Lot;
}

function validateInput(input: HistoricalSavingsInput): Rate[] {
  if (!input || !Array.isArray(input.rates) || !input.rates.length) throw new Error('Enter at least one historical rate.');
  const end = dateValue(input.endDate);
  if (!Number.isFinite(end)) throw new Error('Enter a valid backtest end date.');
  const rows = input.rates.map((row) => ({
    date: row.date,
    baseRate: Number(row.baseRate),
    fidelityPremium: Number(row.fidelityPremium)
  }));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const source = input.rates[index];
    if (!Number.isFinite(dateValue(row.date))) throw new Error(`Rate ${index + 1} needs a valid effective date.`);
    if (String(source.baseRate).trim() === '' || !Number.isFinite(row.baseRate) || row.baseRate <= -100) throw new Error(`Rate ${index + 1} needs a valid base rate.`);
    if (String(source.fidelityPremium).trim() === '' || !Number.isFinite(row.fidelityPremium) || row.fidelityPremium < 0) throw new Error(`Rate ${index + 1} needs a valid fidelity premium.`);
  }
  rows.sort((left, right) => left.date.localeCompare(right.date));
  if (rows.some((row, index) => index > 0 && row.date === rows[index - 1].date)) throw new Error('Historical rate dates must be unique.');
  if (input.endDate < rows[0].date) throw new Error('The end date must be on or after the first rate date.');
  return rows;
}

function runScenario(rows: Rate[], endDate: string, deposits: { date: string; amount: number }[]) : HistoricalSavingsScenario {
  const from = rows[0].date;
  const depositsByDate = new Map<string, number>();
  for (const deposit of deposits) depositsByDate.set(deposit.date, (depositsByDate.get(deposit.date) ?? 0) + deposit.amount);
  const cashFlows = deposits.map((deposit) => ({ date: deposit.date, amount: -deposit.amount }));
  let principal = 0;
  let baseAccrued = 0;
  let baseInterestEarned = 0;
  let fidelityCredited = 0;
  const lots: Lot[] = [];
  const pending: PendingPremium[] = [];
  const series: { date: string; value: number }[] = [];
  for (let timestamp = dateValue(from); timestamp <= dateValue(endDate); timestamp += DAY) {
    const date = isoDate(timestamp);
    const rate = activeRate(rows, date);

    // Base interest earned through 31 December is credited on 1 January.
    // It is credited before that day's accrual, while a same-day deposit is
    // added afterwards and therefore does not earn interest on its deposit day.
    if (date.endsWith('-01-01')) {
      if (baseAccrued > 0) {
        principal += baseAccrued;
        // Credited interest is a new deposit for fidelity purposes. It starts
        // its own uninterrupted period on the actual credit date.
        lots.push({ amount: baseAccrued, periodStart: date, lockedRate: rate.fidelityPremium });
      }
      baseAccrued = 0;
    }

    // A fidelity period vests at the start of its anniversary date. The rate
    // for the next period is locked on that exact date, while the earned
    // amount waits for the next quarterly payout date.
    for (const lot of lots) {
      if (oneYearAfter(lot.periodStart) !== date) continue;
      const amount = lot.amount * lot.lockedRate / 100;
      pending.push({ amount, payoutDate: nextQuarterlyPayout(date), lot });
      lot.periodStart = date;
      lot.lockedRate = rate.fidelityPremium;
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const payout = pending[index];
      if (payout.payoutDate !== date) continue;
      principal += payout.amount;
      // A paid premium becomes a new principal lot on its payout date. It
      // must not be folded into the period that vested months earlier.
      lots.push({ amount: payout.amount, periodStart: date, lockedRate: rate.fidelityPremium });
      fidelityCredited += payout.amount;
      pending.splice(index, 1);
    }

    const dailyBase = principal * rate.baseRate / 100 / 365;
    baseAccrued += dailyBase;
    baseInterestEarned += dailyBase;

    const deposit = depositsByDate.get(date) ?? 0;
    if (deposit) {
      principal += deposit;
      lots.push({ amount: deposit, periodStart: date, lockedRate: rate.fidelityPremium });
    }
    // Base interest and acquired fidelity premiums are economically earned,
    // even while they remain outside principal until their credit dates.
    const pendingPremium = pending.reduce((total, premium) => total + premium.amount, 0);
    series.push({ date, value: principal + baseAccrued + pendingPremium });
  }
  const pendingPremium = pending.reduce((total, premium) => total + premium.amount, 0);
  return {
    deposits,
    totalDeposited: deposits.reduce((total, deposit) => total + deposit.amount, 0),
    baseInterestEarned,
    fidelityPremiumCredited: fidelityCredited,
    fidelityPremiumPending: pendingPremium,
    endingBalance: principal,
    economicValue: principal + baseAccrued + pendingPremium,
    accruedBaseInterest: baseAccrued,
    annualizedReturn: annualizedMoneyWeightedReturn(cashFlows, principal + baseAccrued + pendingPremium, endDate),
    series
  };
}

export function calculateHistoricalSavings(input: HistoricalSavingsInput): HistoricalSavingsResult {
  const rows = validateInput(input);
  const from = rows[0].date;
  const endDate = input.endDate;
  const firstDay = new Date(`${from}T00:00:00Z`);
  const originalDay = firstDay.getUTCDate();
  const monthlyDeposits: { date: string; amount: number }[] = [];
  for (let date = from; date <= endDate;) {
    monthlyDeposits.push({ date, amount: 600 });
    date = nextMonthlyDate(date, originalDay);
  }
  return {
    from,
    to: endDate,
    monthly: runScenario(rows, endDate, monthlyDeposits),
    lumpSum: runScenario(rows, endDate, [{ date: from, amount: 10_000 }])
  };
}

// Descriptive alias for callers that prefer the backtest terminology.
export const calculateHistoricalSavingsBacktest = calculateHistoricalSavings;
