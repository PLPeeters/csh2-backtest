import { daysBetween, overnightAccrualFactor } from './shared.mjs';
import { isUsableClose, priceValue } from './quotes.mjs';

export const CURRENT_RATE_LOOKBACK_DAYS = 180;
export const CURRENT_RATE_EVALUATION_DAYS = 90;
export const CURRENT_RATE_VALIDATION_START = '2024-01-01';

const minimumValidationObservations = 200;
const maximumValidationMaePercent = 0.25;
const maximumRecentMaePercent = 0.35;
const maximumReferenceMaeRatio = 1.1;

function dateYearsBefore(date, years) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() - years);
  return value.toISOString().slice(0, 10);
}

function pointIndexOnOrBefore(points, targetDate, maximumIndex = points.length - 1) {
  let low = 0;
  let high = maximumIndex;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].date <= targetDate) {
      match = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return match;
}

function pointIndexOnOrAfter(points, targetDate, minimumIndex = 0) {
  let low = minimumIndex;
  let high = points.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].date >= targetDate) {
      match = middle;
      high = middle - 1;
    } else low = middle + 1;
  }
  return match;
}

function dateAfter(date, calendarDays) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + calendarDays);
  return value.toISOString().slice(0, 10);
}

/** Builds a tradable CSH2 price series relative to the exact compounded overnight benchmark. */
export function buildRelativeCsh2Series(prices, rates, valuationDate) {
  const pricePoints = Object.entries(prices)
    .filter(([date, record]) => date <= valuationDate && !record?.isFallback && isUsableClose(record))
    .map(([date, record]) => ({ date, price: priceValue(record, 'close') }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!pricePoints.length) return [];

  const rateEntries = Object.entries(rates)
    .filter(([date, rate]) => date <= valuationDate && Number.isFinite(rate))
    .sort(([left], [right]) => left.localeCompare(right));
  let rateIndex = rateEntries.findLastIndex(([date]) => date <= pricePoints[0].date);
  if (rateIndex < 0) return [];
  let activeRate = rateEntries[rateIndex][1];
  let previousDate = pricePoints[0].date;
  let overnightIndex = 1;

  return pricePoints.map((point) => {
    while (rateIndex + 1 < rateEntries.length && rateEntries[rateIndex + 1][0] <= point.date) {
      const [nextDate, nextRate] = rateEntries[++rateIndex];
      overnightIndex *= overnightAccrualFactor(activeRate, daysBetween(previousDate, nextDate));
      previousDate = nextDate;
      activeRate = nextRate;
    }
    overnightIndex *= overnightAccrualFactor(activeRate, daysBetween(previousDate, point.date));
    previousDate = point.date;
    return { ...point, overnightIndex, relativeLogValue: Math.log(point.price / overnightIndex) };
  });
}

function annualizedExcessPercent(dailyLogReturn) {
  return Math.expm1(dailyLogReturn * 365) * 100;
}

/** Fits the annualized CSH2 excess using every relative log-price observation in the trailing window. */
export function fitRelativeExcess(points, originIndex, lookbackDays = CURRENT_RATE_LOOKBACK_DAYS) {
  const origin = points[originIndex];
  if (!origin) return undefined;
  const cutoffDate = dateAfter(origin.date, -lookbackDays);
  const boundaryIndex = pointIndexOnOrBefore(points, cutoffDate, originIndex - 1);
  if (boundaryIndex < 0) return undefined;
  const startIndex = points[boundaryIndex].date < cutoffDate ? boundaryIndex + 1 : boundaryIndex;
  if (startIndex >= originIndex) return undefined;
  const startDate = points[startIndex].date;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let index = startIndex; index <= originIndex; index += 1) {
    sumX += daysBetween(startDate, points[index].date);
    sumY += points[index].relativeLogValue;
    count += 1;
  }
  const meanX = sumX / count;
  const meanY = sumY / count;
  let covariance = 0;
  let variance = 0;
  for (let index = startIndex; index <= originIndex; index += 1) {
    const centeredX = daysBetween(startDate, points[index].date) - meanX;
    covariance += centeredX * (points[index].relativeLogValue - meanY);
    variance += centeredX ** 2;
  }
  if (!variance) return undefined;
  return {
    startDate,
    endDate: origin.date,
    calendarDays: daysBetween(startDate, origin.date),
    observations: count,
    annualExcessPercent: annualizedExcessPercent(covariance / variance)
  };
}

function endpointExcessPercent(points, originIndex, lookbackDays) {
  const origin = points[originIndex];
  const startIndex = pointIndexOnOrBefore(points, dateAfter(origin.date, -lookbackDays), originIndex - 1);
  if (startIndex < 0) return undefined;
  const calendarDays = daysBetween(points[startIndex].date, origin.date);
  return annualizedExcessPercent((origin.relativeLogValue - points[startIndex].relativeLogValue) / calendarDays);
}

function meanAbsoluteError(records, field = 'error') {
  if (!records.length) return undefined;
  return records.reduce((sum, record) => sum + Math.abs(record[field]), 0) / records.length;
}

function errorWindow(records, { fromExclusive, toInclusive, fullHistory = false } = {}) {
  const selected = records.filter((record) =>
    (!fromExclusive || record.date > fromExclusive) && (!toInclusive || record.date <= toInclusive)
  );
  if (!selected.length) return undefined;
  return {
    fullHistory,
    from: selected[0].date,
    to: selected.at(-1).date,
    observations: selected.length,
    maeAnnualRatePercent: meanAbsoluteError(selected)
  };
}

function buildAnnualErrorWindows(records) {
  const first = records[0];
  const last = records.at(-1);
  if (!first || !last) return [];
  const windows = [];
  let toInclusive = last.date;
  while (toInclusive >= first.date) {
    const fromExclusive = dateYearsBefore(toInclusive, 1);
    const window = errorWindow(records, { fromExclusive, toInclusive });
    if (window) windows.push(window);
    if (fromExclusive < first.date) break;
    toInclusive = fromExclusive;
  }
  const fullWindow = errorWindow(records, { fullHistory: true });
  if (fullWindow) windows.push(fullWindow);
  return windows;
}

function buildRollingErrorWindows(records) {
  const last = records.at(-1);
  if (!last) return [];
  return [1, 2, 3].map((rollingYears) => {
    const window = errorWindow(records, {
      fromExclusive: dateYearsBefore(last.date, rollingYears),
      toInclusive: last.date
    });
    return window ? { ...window, rollingYears } : undefined;
  }).filter(Boolean);
}

function buildTrendExamples(points, fitted) {
  const startIndex = points.findIndex((point) => point.date === fitted.startDate);
  const endIndex = points.findIndex((point) => point.date === fitted.endDate);
  if (startIndex < 0 || endIndex < startIndex) return { examples: [], omitted: false };
  const window = points.slice(startIndex, endIndex + 1);
  const selected = window.length <= 5 ? window : [...window.slice(0, 2), ...window.slice(-3)];
  const base = window[0];
  const examples = selected.map((point) => {
    const csh2Index = point.price / base.price * 100;
    const overnightBenchmarkIndex = point.overnightIndex / base.overnightIndex * 100;
    return {
      date: point.date,
      csh2Index,
      overnightBenchmarkIndex,
      gapPercent: (csh2Index / overnightBenchmarkIndex - 1) * 100
    };
  });
  return { examples, omitted: window.length > selected.length };
}

function buildErrorHistory(points, lookbackDays, evaluationDays) {
  const records = [];
  for (let originIndex = 0; originIndex < points.length; originIndex += 1) {
    const fitted = fitRelativeExcess(points, originIndex, lookbackDays);
    if (!fitted) continue;
    const futureIndex = pointIndexOnOrAfter(points, dateAfter(points[originIndex].date, evaluationDays), originIndex + 1);
    if (futureIndex < 0) continue;
    const elapsedDays = daysBetween(points[originIndex].date, points[futureIndex].date);
    const actualAnnualExcessPercent = annualizedExcessPercent(
      (points[futureIndex].relativeLogValue - points[originIndex].relativeLogValue) / elapsedDays
    );
    const referenceAnnualExcessPercent = endpointExcessPercent(points, originIndex, evaluationDays);
    records.push({
      date: points[originIndex].date,
      predictedAnnualExcessPercent: fitted.annualExcessPercent,
      actualAnnualExcessPercent,
      error: fitted.annualExcessPercent - actualAnnualExcessPercent,
      referenceError: Number.isFinite(referenceAnnualExcessPercent)
        ? referenceAnnualExcessPercent - actualAnnualExcessPercent
        : undefined
    });
  }
  return records;
}

/** Calculates the browser estimate and dynamically scores the same model against later observed returns. */
export function calculateCurrentRateModel(prices, rates, valuationDate, {
  lookbackDays = CURRENT_RATE_LOOKBACK_DAYS,
  evaluationDays = CURRENT_RATE_EVALUATION_DAYS,
  validationStartDate = CURRENT_RATE_VALIDATION_START
} = {}) {
  const points = buildRelativeCsh2Series(prices, rates, valuationDate);
  const latestPoint = points.at(-1);
  if (!latestPoint) return undefined;
  const fitted = fitRelativeExcess(points, points.length - 1, lookbackDays);
  if (!fitted) return undefined;
  const latestRate = Object.entries(rates)
    .filter(([date, rate]) => date <= latestPoint.date && Number.isFinite(rate))
    .sort(([left], [right]) => right.localeCompare(left))[0];
  if (!latestRate || latestRate[1] <= -100) return undefined;

  const errorHistory = buildErrorHistory(points, lookbackDays, evaluationDays);
  const validationHistory = errorHistory.filter((record) => record.date >= validationStartDate);
  const annualErrorWindows = buildAnnualErrorWindows(errorHistory);
  const rollingErrorWindows = buildRollingErrorWindows(errorHistory);
  const fullWindow = annualErrorWindows.find((window) => window.fullHistory);
  const errorWindows = [
    ...rollingErrorWindows,
    ...annualErrorWindows.filter((window) => !window.fullHistory),
    ...(fullWindow ? [fullWindow] : [])
  ];
  const recentWindow = rollingErrorWindows[0];
  const validationMaeAnnualRatePercent = meanAbsoluteError(validationHistory) ?? fullWindow?.maeAnnualRatePercent;
  const referenceValidationMaeAnnualRatePercent = meanAbsoluteError(
    validationHistory.filter((record) => Number.isFinite(record.referenceError)),
    'referenceError'
  );
  const currentOvernightAnnualFactor = overnightAccrualFactor(latestRate[1], 1) ** 365;
  const excessAnnualFactor = 1 + fitted.annualExcessPercent / 100;
  const csh2AnnualRatePercent = (currentOvernightAnnualFactor * excessAnnualFactor - 1) * 100;
  const modelErrorAnnualRatePercent = validationMaeAnnualRatePercent;
  const trendExamples = buildTrendExamples(points, fitted);

  return {
    valuationDate: latestPoint.date,
    trendStartDate: fitted.startDate,
    trendDays: fitted.calendarDays,
    trendObservations: fitted.observations,
    trendExamples: trendExamples.examples,
    trendExamplesOmitted: trendExamples.omitted,
    rateDate: latestRate[0],
    overnightRatePercent: latestRate[1],
    currentOvernightAnnualRatePercent: (currentOvernightAnnualFactor - 1) * 100,
    csh2ExcessAnnualRatePercent: fitted.annualExcessPercent,
    csh2AnnualRatePercent,
    csh2AnnualRateLowPercent: Number.isFinite(modelErrorAnnualRatePercent)
      ? csh2AnnualRatePercent - modelErrorAnnualRatePercent
      : csh2AnnualRatePercent,
    csh2AnnualRateHighPercent: Number.isFinite(modelErrorAnnualRatePercent)
      ? csh2AnnualRatePercent + modelErrorAnnualRatePercent
      : csh2AnnualRatePercent,
    modelErrorAnnualRatePercent,
    errorEvaluationDays: evaluationDays,
    errorValidationFrom: validationHistory[0]?.date ?? fullWindow?.from,
    errorValidationTo: validationHistory.at(-1)?.date ?? fullWindow?.to,
    errorValidationObservations: validationHistory.length || fullWindow?.observations || 0,
    referenceValidationMaeAnnualRatePercent,
    recentMaeAnnualRatePercent: recentWindow?.maeAnnualRatePercent,
    errorWindows
  };
}

/** Returns diagnostics suitable for failing a refresh before degraded market data is committed. */
export function assessCurrentRateModelHealth(prices, rates, valuationDate, overrides = {}) {
  const model = calculateCurrentRateModel(prices, rates, valuationDate);
  if (!model) return { healthy: false, issues: ['The current-rate model could not be calculated.'], model };
  const thresholds = {
    minimumValidationObservations,
    maximumValidationMaePercent,
    maximumRecentMaePercent,
    maximumReferenceMaeRatio,
    ...overrides
  };
  const issues = [];
  const recentMae = model.recentMaeAnnualRatePercent;
  if (model.errorValidationObservations < thresholds.minimumValidationObservations) {
    issues.push(`Only ${model.errorValidationObservations} validation observations are available.`);
  }
  if (!Number.isFinite(model.modelErrorAnnualRatePercent) || model.modelErrorAnnualRatePercent > thresholds.maximumValidationMaePercent) {
    issues.push(`Validation MAE is ${model.modelErrorAnnualRatePercent?.toFixed(4) ?? 'unavailable'} percentage points.`);
  }
  if (!Number.isFinite(recentMae) || recentMae > thresholds.maximumRecentMaePercent) {
    issues.push(`One-year MAE is ${recentMae?.toFixed(4) ?? 'unavailable'} percentage points.`);
  }
  if (Number.isFinite(model.referenceValidationMaeAnnualRatePercent) &&
      model.modelErrorAnnualRatePercent > model.referenceValidationMaeAnnualRatePercent * thresholds.maximumReferenceMaeRatio) {
    issues.push(`Regression MAE exceeds the endpoint reference by more than ${((thresholds.maximumReferenceMaeRatio - 1) * 100).toFixed(0)}%.`);
  }
  return { healthy: !issues.length, issues, model };
}

export function assertCurrentRateModelHealthy(prices, rates, valuationDate, overrides) {
  const assessment = assessCurrentRateModelHealth(prices, rates, valuationDate, overrides);
  if (!assessment.healthy) throw new Error(`Current-rate model health check failed: ${assessment.issues.join(' ')}`);
  return assessment.model;
}
