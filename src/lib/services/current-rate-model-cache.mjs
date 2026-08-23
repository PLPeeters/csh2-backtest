import { calculateCurrentRateModel } from '../../backtest.mjs';
import {
  compatiblePublishedCurrentRateModel,
  currentRateModelConfiguration,
  currentRateModelSourceData
} from './current-rate-model-publication.mjs';

export function createCurrentRateModelCache(calculate = calculateCurrentRateModel) {
  let cached;

  return {
    get(marketDataVersion, prices, rates, valuationDate, configuration, publication) {
      const modelConfiguration = currentRateModelConfiguration(configuration);
      const inputKey = JSON.stringify([marketDataVersion, valuationDate, modelConfiguration]);
      const sourceData = currentRateModelSourceData(prices, rates);
      const key = JSON.stringify([inputKey, sourceData]);
      if (cached?.key === key) return cached.model;

      const model = compatiblePublishedCurrentRateModel(publication, prices, rates, valuationDate, modelConfiguration) ??
        calculate(prices, rates, valuationDate, modelConfiguration);
      if (model != null) cached = { key, model };
      return model;
    },
    clear() {
      cached = undefined;
    }
  };
}

const currentRateModelCache = createCurrentRateModelCache();

export function getCurrentRateModel(marketDataVersion, prices, rates, valuationDate, configuration, publication) {
  return currentRateModelCache.get(marketDataVersion, prices, rates, valuationDate, configuration, publication);
}

export function clearCurrentRateModelCache() {
  currentRateModelCache.clear();
}
