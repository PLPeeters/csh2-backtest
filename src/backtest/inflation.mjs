import { daysBetween } from './shared.mjs';

const DAYS_PER_YEAR = 365.2425;
const statusRank = { observed: 0, interpolated: 1, extrapolated: 2, projected: 3 };

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`));
}

function observations(indices) {
  if (!indices || typeof indices !== 'object') return [];
  return Object.entries(indices)
    .filter(([month, value]) => /^\d{4}-\d{2}$/.test(month) && Number.isFinite(value) && value > 0)
    .map(([month, value]) => ({ month, date: `${month}-15`, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function leastAuthoritative(...statuses) {
  return statuses.reduce((least, status) => statusRank[status] > statusRank[least] ? status : least, 'observed');
}

/** Resolves a smooth daily CPI level and records whether it was observed or estimated. */
export function cpiPointForDate(indices, date, { mode = 'retrospective', projectionAnnualRate } = {}) {
  if (!validDate(date) || (mode !== 'retrospective' && mode !== 'projection')) return undefined;
  const anchors = observations(indices);
  if (!anchors.length || date < anchors[0].date) return undefined;
  const exact = anchors.find((anchor) => anchor.date === date);
  if (exact) return { value: exact.value, status: 'observed', lowerMonth: exact.month, upperMonth: exact.month };

  const upperIndex = anchors.findIndex((anchor) => anchor.date > date);
  if (upperIndex > 0) {
    const lower = anchors[upperIndex - 1];
    const upper = anchors[upperIndex];
    const elapsed = daysBetween(lower.date, date);
    const interval = daysBetween(lower.date, upper.date);
    return {
      value: lower.value * (upper.value / lower.value) ** (elapsed / interval),
      status: 'interpolated',
      lowerMonth: lower.month,
      upperMonth: upper.month
    };
  }

  const latest = anchors.at(-1);
  const elapsed = daysBetween(latest.date, date);
  if (mode === 'projection') {
    if (!Number.isFinite(projectionAnnualRate) || projectionAnnualRate <= -100) return undefined;
    return { value: latest.value * (1 + projectionAnnualRate / 100) ** (elapsed / DAYS_PER_YEAR), status: 'projected', lowerMonth: latest.month };
  }
  const [year, month] = latest.month.split('-').map(Number);
  const priorMonth = `${String(year - 1).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const prior = indices[priorMonth];
  if (!Number.isFinite(prior) || prior <= 0) return undefined;
  const annualFactor = latest.value / prior;
  return { value: latest.value * annualFactor ** (elapsed / DAYS_PER_YEAR), status: 'extrapolated', lowerMonth: latest.month };
}

export function cpiIndexForDate(indices, date, options) {
  return cpiPointForDate(indices, date, options)?.value;
}

export function realGrowthFactorWithProvenance(nominalFactor, fromDate, toDate, indices, options) {
  if (!Number.isFinite(nominalFactor) || nominalFactor < 0 || !validDate(fromDate) || !validDate(toDate) || toDate < fromDate) return undefined;
  const from = cpiPointForDate(indices, fromDate, options);
  const to = cpiPointForDate(indices, toDate, options);
  if (!from || !to) return undefined;
  return { value: nominalFactor / (to.value / from.value), status: leastAuthoritative(from.status, to.status) };
}

export function realGrowthFactor(nominalFactor, fromDate, toDate, indices, options) {
  return realGrowthFactorWithProvenance(nominalFactor, fromDate, toDate, indices, options)?.value;
}

export function realAnnualizedReturn(nominalFactor, fromDate, toDate, indices, options) {
  const factor = realGrowthFactor(nominalFactor, fromDate, toDate, indices, options);
  const days = validDate(fromDate) && validDate(toDate) ? daysBetween(fromDate, toDate) : 0;
  return factor !== undefined && days > 0 ? (factor ** (365 / days) - 1) * 100 : undefined;
}

/** Returns observed trailing twelve-month inflation from raw monthly anchors. */
export function latestAnnualInflation(indices, asOfDate) {
  if (!validDate(asOfDate)) return undefined;
  const latest = observations(indices).filter((anchor) => anchor.date <= asOfDate).at(-1);
  if (!latest) return undefined;
  const [year, month] = latest.month.split('-').map(Number);
  const prior = indices[`${String(year - 1).padStart(4, '0')}-${String(month).padStart(2, '0')}`];
  return Number.isFinite(prior) && prior > 0 ? (latest.value / prior - 1) * 100 : undefined;
}

export function realAnnualRate(nominalRatePercent, annualInflationPercent) {
  if (!Number.isFinite(nominalRatePercent) || nominalRatePercent <= -100 || !Number.isFinite(annualInflationPercent) || annualInflationPercent <= -100) return undefined;
  return ((1 + nominalRatePercent / 100) / (1 + annualInflationPercent / 100) - 1) * 100;
}

export function deflateCashFlowsToDate(cashFlows, valuationDate, indices, options) {
  const valuation = cpiIndexForDate(indices, valuationDate, options);
  if (!Number.isFinite(valuation) || !Array.isArray(cashFlows)) return undefined;
  const adjusted = [];
  for (const flow of cashFlows) {
    const observation = cpiIndexForDate(indices, flow?.date, options);
    if (!Number.isFinite(observation) || !Number.isFinite(flow?.amount)) return undefined;
    adjusted.push({ ...flow, amount: flow.amount * valuation / observation });
  }
  return adjusted;
}

/** Converts cumulative nominal percentage points to real points and retains CPI provenance. */
export function deflateCumulativeReturnSeries(points, fromDate, indices, options) {
  if (!Array.isArray(points)) return [];
  if (!cpiPointForDate(indices, fromDate, options)) {
    const firstCovered = points.find((point) => cpiPointForDate(indices, point.date, options));
    if (!firstCovered) return [];
    const baselineFactor = 1 + firstCovered.value / 100;
    return points.filter((point) => point.date >= firstCovered.date).flatMap((point) => {
      const adjusted = realGrowthFactorWithProvenance((1 + point.value / 100) / baselineFactor, firstCovered.date, point.date, indices, options);
      return adjusted ? [{ ...point, value: (adjusted.value - 1) * 100, cpiStatus: adjusted.status }] : [];
    });
  }
  return points.flatMap((point) => {
    const adjusted = realGrowthFactorWithProvenance(1 + point.value / 100, fromDate, point.date, indices, options);
    return adjusted ? [{ ...point, value: (adjusted.value - 1) * 100, cpiStatus: adjusted.status }] : [];
  });
}
