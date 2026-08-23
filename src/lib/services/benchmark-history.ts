import BenchmarkWorker from '../workers/benchmark-history.worker.ts?worker';
import type { BenchmarkHistory, BenchmarkHistoryRequest } from '../types';
import { currentRateModelSourceData } from './current-rate-model-publication.mjs';

export interface BenchmarkHistoryClient { prepare(request: BenchmarkHistoryRequest): Promise<BenchmarkHistory>; dispose(): void }

export function benchmarkHistoryRequestKey(request: BenchmarkHistoryRequest) {
  const sourceData = currentRateModelSourceData(request.prices, request.rates);
  return `${request.to}:${sourceData.prices}:${sourceData.rates}`;
}

export function createBenchmarkHistoryClient(): BenchmarkHistoryClient {
  let worker: Worker | undefined;
  let cacheKey = '';
  let cached: Promise<BenchmarkHistory> | undefined;
  return {
    prepare(request) {
      const key = benchmarkHistoryRequestKey(request);
      if (cached && key === cacheKey) return cached;
      worker?.terminate();
      worker = new BenchmarkWorker();
      cacheKey = key;
      cached = new Promise<BenchmarkHistory>((resolve, reject) => {
        if (!worker) return reject(new Error('Benchmark worker is unavailable.'));
        worker.onmessage = ({ data }: MessageEvent<{ ok: boolean; history?: BenchmarkHistory; error?: string }>) => {
          if (data.ok && data.history) resolve(data.history);
          else reject(new Error(data.error ?? 'Benchmark history could not be prepared.'));
        };
        worker.onerror = () => reject(new Error('Benchmark history could not be prepared.'));
        worker.postMessage(request);
      }).catch((error) => { cached = undefined; throw error; });
      return cached!;
    },
    dispose() { worker?.terminate(); worker = undefined; cached = undefined; }
  };
}
