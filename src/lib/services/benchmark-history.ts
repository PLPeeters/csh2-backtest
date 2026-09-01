import BenchmarkWorker from '../workers/benchmark-history.worker.ts?worker';
import type { BenchmarkHistory, BenchmarkHistoryRequest } from '../types';
import { currentRateModelSourceData } from './current-rate-model-publication.mjs';

export interface BenchmarkHistoryClient { prepare(request: BenchmarkHistoryRequest): Promise<BenchmarkHistory>; dispose(): void }

export function benchmarkHistoryRequestKey(request: BenchmarkHistoryRequest) {
  const sourceData = currentRateModelSourceData(request.prices, request.rates);
  return `${request.to}:${sourceData.prices}:${sourceData.rates}:${request.cpiPublicationIdentity}:${JSON.stringify(request.cpiIndices)}:${request.returnMode}:${request.applyCapitalGainsExemption}:${request.totalSavingsAmount}:${JSON.stringify(request.currentRateModel ?? null)}`;
}

export function createBenchmarkHistoryClient(): BenchmarkHistoryClient {
  let worker: Worker | undefined;
  let nextRequestId = 0;
  // Keep recent nominal/real and tax variants alive so UI toggles do not restart a worker.
  const cache = new Map<string, Promise<BenchmarkHistory>>();
  const pending = new Map<number, { resolve: (history: BenchmarkHistory) => void; reject: (error: Error) => void }>();
  const rejectPending = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const ensureWorker = () => {
    if (worker) return worker;
    worker = new BenchmarkWorker();
    worker.onmessage = ({ data }: MessageEvent<{ id: number; ok: boolean; history?: BenchmarkHistory; error?: string }>) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.ok && data.history) request.resolve(data.history);
      else request.reject(new Error(data.error ?? 'Benchmark history could not be prepared.'));
    };
    worker.onerror = () => {
      worker = undefined;
      rejectPending(new Error('Benchmark history could not be prepared.'));
    };
    return worker;
  };
  return {
    prepare(request) {
      const key = benchmarkHistoryRequestKey(request);
      const cached = cache.get(key);
      if (cached) return cached;
      const requestId = ++nextRequestId;
      const requestPromise = new Promise<BenchmarkHistory>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        ensureWorker().postMessage({ id: requestId, request });
      }).catch((error) => {
        if (cache.get(key) === requestPromise) cache.delete(key);
        throw error;
      });
      cache.set(key, requestPromise);
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
      return requestPromise;
    },
    dispose() {
      worker?.terminate();
      worker = undefined;
      rejectPending(new Error('Benchmark history client was disposed.'));
      cache.clear();
    }
  };
}
