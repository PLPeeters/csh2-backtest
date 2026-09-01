import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkHistoryRequest } from '../types';

const { workerInstances, MockBenchmarkWorker } = vi.hoisted(() => {
  const instances: Array<{ onmessage?: (event: MessageEvent) => void; onerror?: () => void; posted: Array<{ id: number; request: BenchmarkHistoryRequest }>; terminated: boolean }> = [];
  class WorkerMock {
    onmessage?: (event: MessageEvent) => void;
    onerror?: () => void;
    posted: Array<{ id: number; request: BenchmarkHistoryRequest }> = [];
    terminated = false;
    constructor() { instances.push(this); }
    postMessage(message: { id: number; request: BenchmarkHistoryRequest }) { this.posted.push(message); }
    terminate() { this.terminated = true; }
  }
  return { workerInstances: instances, MockBenchmarkWorker: WorkerMock };
});

vi.mock('../workers/benchmark-history.worker.ts?worker', () => ({ default: MockBenchmarkWorker }));

import { benchmarkHistoryRequestKey, createBenchmarkHistoryClient } from './benchmark-history';

function request(overrides: Partial<BenchmarkHistoryRequest> = {}): BenchmarkHistoryRequest {
  return {
    prices: { '2026-08-20': { close: 100 } },
    rates: { '2026-08-20': 2 },
    to: '2026-08-20',
    cpiIndices: { '2025-08': 100, '2026-08': 102 },
    cpiPublicationIdentity: 'cpi-test',
    returnMode: 'nominal',
    ...overrides
  };
}

describe('benchmark history request identity', () => {
  beforeEach(() => { workerInstances.length = 0; });
  it('is stable for equivalent requests', () => {
    expect(benchmarkHistoryRequestKey(request())).toBe(benchmarkHistoryRequestKey(request()));
  });

  it('invalidates when same-sized price or rate records are corrected', () => {
    const original = benchmarkHistoryRequestKey(request());
    const correctedPrice = benchmarkHistoryRequestKey(request({ prices: { '2026-08-20': { close: 100.01 } } }));
    const correctedRate = benchmarkHistoryRequestKey(request({ rates: { '2026-08-20': 2.01 } }));

    expect(correctedPrice).not.toBe(original);
    expect(correctedRate).not.toBe(original);
  });

  it('invalidates when the requested valuation date changes', () => {
    expect(benchmarkHistoryRequestKey(request({ to: '2026-08-19' }))).not.toBe(benchmarkHistoryRequestKey(request()));
  });

  it('invalidates for corrected CPI, a new CPI publication, or return-mode toggle', () => {
    const original = benchmarkHistoryRequestKey(request());
    expect(benchmarkHistoryRequestKey(request({ cpiIndices: { '2025-08': 100, '2026-08': 103 } }))).not.toBe(original);
    expect(benchmarkHistoryRequestKey(request({ cpiPublicationIdentity: 'cpi-revised' }))).not.toBe(original);
    expect(benchmarkHistoryRequestKey(request({ returnMode: 'real' }))).not.toBe(original);
  });

  it('invalidates model-dependent results when the supplied publication changes', () => {
    const original = benchmarkHistoryRequestKey(request());
    const model = {
      schemaVersion: 1,
      valuationDate: '2026-08-20',
      sourceData: { prices: '0000000000000000', rates: '0000000000000000' },
      configuration: { lookbackDays: 180, evaluationDays: 90, validationStartDate: '2024-01-01' },
      model: { csh2AnnualRatePercent: 1 }
    };
    const revised = benchmarkHistoryRequestKey(request({ currentRateModel: model as unknown as BenchmarkHistoryRequest['currentRateModel'] }));
    expect(revised).not.toBe(original);
    const revisedModel = { ...model, model: { csh2AnnualRatePercent: 2 } } as unknown as BenchmarkHistoryRequest['currentRateModel'];
    expect(benchmarkHistoryRequestKey(request({ currentRateModel: revisedModel }))).not.toBe(revised);
  });

  it('coalesces same-key requests and routes concurrent responses by request id', async () => {
    const client = createBenchmarkHistoryClient();
    const nominal = client.prepare(request());
    const sameNominal = client.prepare(request());
    const real = client.prepare(request({ returnMode: 'real' }));
    const worker = workerInstances[0];
    expect(sameNominal).toBe(nominal);
    expect(worker.posted).toHaveLength(2);

    const nominalHistory = { marker: 'nominal' } as never;
    const realHistory = { marker: 'real' } as never;
    worker.onmessage?.({ data: { id: worker.posted[1].id, ok: true, history: realHistory } } as MessageEvent);
    worker.onmessage?.({ data: { id: worker.posted[0].id, ok: true, history: nominalHistory } } as MessageEvent);

    await expect(nominal).resolves.toBe(nominalHistory);
    await expect(real).resolves.toBe(realHistory);
    client.dispose();
  });

  it('rejects and permits retry after disposal', async () => {
    const client = createBenchmarkHistoryClient();
    const pending = client.prepare(request());
    client.dispose();
    await expect(pending).rejects.toThrow('disposed');

    const retry = client.prepare(request());
    expect(workerInstances).toHaveLength(2);
    const worker = workerInstances[1];
    const history = { marker: 'retry' } as never;
    worker.onmessage?.({ data: { id: worker.posted[0].id, ok: true, history } } as MessageEvent);
    await expect(retry).resolves.toBe(history);
    client.dispose();
  });
});
