import {
  CURRENT_RATE_EVALUATION_DAYS,
  CURRENT_RATE_LOOKBACK_DAYS,
  CURRENT_RATE_VALIDATION_START
} from '../../backtest.mjs';

export const CURRENT_RATE_MODEL_PUBLICATION_SCHEMA = 1;

export function currentRateModelConfiguration(configuration = {}) {
  return {
    lookbackDays: configuration.lookbackDays ?? CURRENT_RATE_LOOKBACK_DAYS,
    evaluationDays: configuration.evaluationDays ?? CURRENT_RATE_EVALUATION_DAYS,
    validationStartDate: configuration.validationStartDate ?? CURRENT_RATE_VALIDATION_START
  };
}

function fingerprint(records) {
  const serialized = JSON.stringify(Object.entries(records ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function currentRateModelSourceData(prices, rates) {
  return { prices: fingerprint(prices), rates: fingerprint(rates) };
}

function diagnostic(condition, path, expectation) {
  if (!condition) throw new Error(`The published current-rate model is invalid: ${path} ${expectation}.`);
}

function date(value, path) {
  diagnostic(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), path, 'must be an ISO date');
}

function finite(value, path) {
  diagnostic(Number.isFinite(value), path, 'must be a finite number');
}

function optionalFinite(value, path) {
  if (value !== undefined) finite(value, path);
}

function natural(value, path) {
  diagnostic(Number.isInteger(value) && value >= 0, path, 'must be a non-negative integer');
}

export function assertValidCurrentRateModelPublication(publication) {
  diagnostic(publication && typeof publication === 'object' && !Array.isArray(publication), 'root', 'must be an object');
  diagnostic(Number.isInteger(publication.schemaVersion) && publication.schemaVersion > 0, 'schemaVersion', 'must be a positive integer');
  if (publication.schemaVersion !== CURRENT_RATE_MODEL_PUBLICATION_SCHEMA) return publication;
  date(publication.valuationDate, 'valuationDate');
  diagnostic(publication.sourceData && typeof publication.sourceData === 'object', 'sourceData', 'must be an object');
  diagnostic(typeof publication.sourceData.prices === 'string' && /^[0-9a-f]{16}$/.test(publication.sourceData.prices), 'sourceData.prices', 'must be a source fingerprint');
  diagnostic(typeof publication.sourceData.rates === 'string' && /^[0-9a-f]{16}$/.test(publication.sourceData.rates), 'sourceData.rates', 'must be a source fingerprint');
  const configuration = publication.configuration;
  diagnostic(configuration && typeof configuration === 'object', 'configuration', 'must be an object');
  natural(configuration.lookbackDays, 'configuration.lookbackDays');
  natural(configuration.evaluationDays, 'configuration.evaluationDays');
  date(configuration.validationStartDate, 'configuration.validationStartDate');
  const model = publication.model;
  diagnostic(model && typeof model === 'object' && !Array.isArray(model), 'model', 'must be an object');
  for (const key of ['valuationDate', 'trendStartDate', 'rateDate']) date(model[key], `model.${key}`);
  for (const key of ['trendDays', 'trendObservations', 'errorEvaluationDays', 'errorValidationObservations']) natural(model[key], `model.${key}`);
  for (const key of [
    'overnightRatePercent', 'currentOvernightAnnualRatePercent', 'csh2ExcessAnnualRatePercent',
    'csh2AnnualRatePercent', 'csh2AnnualRateLowPercent', 'csh2AnnualRateHighPercent'
  ]) finite(model[key], `model.${key}`);
  for (const key of ['modelErrorAnnualRatePercent', 'referenceValidationMaeAnnualRatePercent', 'recentMaeAnnualRatePercent']) optionalFinite(model[key], `model.${key}`);
  diagnostic(typeof model.trendExamplesOmitted === 'boolean', 'model.trendExamplesOmitted', 'must be a boolean');
  diagnostic(Array.isArray(model.trendExamples), 'model.trendExamples', 'must be an array');
  model.trendExamples.forEach((point, index) => {
    diagnostic(point && typeof point === 'object', `model.trendExamples[${index}]`, 'must be an object');
    date(point.date, `model.trendExamples[${index}].date`);
    for (const key of ['csh2Index', 'overnightBenchmarkIndex', 'gapPercent']) finite(point[key], `model.trendExamples[${index}].${key}`);
  });
  for (const key of ['errorValidationFrom', 'errorValidationTo']) if (model[key] !== undefined) date(model[key], `model.${key}`);
  diagnostic(Array.isArray(model.errorWindows), 'model.errorWindows', 'must be an array');
  model.errorWindows.forEach((window, index) => {
    diagnostic(window && typeof window === 'object', `model.errorWindows[${index}]`, 'must be an object');
    date(window.from, `model.errorWindows[${index}].from`);
    date(window.to, `model.errorWindows[${index}].to`);
    natural(window.observations, `model.errorWindows[${index}].observations`);
    finite(window.maeAnnualRatePercent, `model.errorWindows[${index}].maeAnnualRatePercent`);
    if (window.rollingYears !== undefined) natural(window.rollingYears, `model.errorWindows[${index}].rollingYears`);
    if (window.fullHistory !== undefined) diagnostic(typeof window.fullHistory === 'boolean', `model.errorWindows[${index}].fullHistory`, 'must be a boolean');
  });
  diagnostic(model.valuationDate === publication.valuationDate, 'model.valuationDate', 'must match valuationDate');
  return publication;
}

export function publishCurrentRateModel(model, prices, rates, configuration) {
  const publication = {
    schemaVersion: CURRENT_RATE_MODEL_PUBLICATION_SCHEMA,
    valuationDate: model.valuationDate,
    sourceData: currentRateModelSourceData(prices, rates),
    configuration: currentRateModelConfiguration(configuration),
    model
  };
  return assertValidCurrentRateModelPublication(publication);
}

export function compatiblePublishedCurrentRateModel(publication, prices, rates, valuationDate, configuration) {
  if (!publication) return undefined;
  assertValidCurrentRateModelPublication(publication);
  if (publication.schemaVersion !== CURRENT_RATE_MODEL_PUBLICATION_SCHEMA) return undefined;
  const expectedConfiguration = currentRateModelConfiguration(configuration);
  if (publication.valuationDate !== valuationDate ||
      JSON.stringify(publication.configuration) !== JSON.stringify(expectedConfiguration) ||
      JSON.stringify(publication.sourceData) !== JSON.stringify(currentRateModelSourceData(prices, rates))) return undefined;
  return publication.model;
}
