import { describe, expect, it } from 'vitest';
import publication from '../../assets/data/current-rate-model.json';
import cpi from '../../assets/data/cpi.json';
import { loadCpi, loadOptionalCurrentRateModel } from './market-data';

describe('optional current-rate model loading', () => {
  it('allows older deployments where the publication returns 404', async () => {
    const response = new Response('', { status: 404 });
    await expect(loadOptionalCurrentRateModel(response)).resolves.toBeUndefined();
  });

  it.each([403, 500])('reports HTTP %s instead of treating it as an absent publication', async (status) => {
    const response = new Response('', { status });
    await expect(loadOptionalCurrentRateModel(response)).rejects.toThrow(
      `The published current-rate model could not be loaded (HTTP ${status}).`
    );
  });

  it('ignores publications using an unknown schema', async () => {
    const response = new Response(JSON.stringify({ schemaVersion: 2 }), { status: 200 });
    await expect(loadOptionalCurrentRateModel(response)).resolves.toBeUndefined();
  });

  it('loads valid publications and diagnoses malformed current-schema data', async () => {
    const valid = new Response(JSON.stringify(publication), { status: 200 });
    await expect(loadOptionalCurrentRateModel(valid)).resolves.toEqual(publication);

    const malformed: unknown = structuredClone(publication);
    (malformed as { model: { trendDays: unknown } }).model.trendDays = 'many';
    const response = new Response(JSON.stringify(malformed), { status: 200 });
    await expect(loadOptionalCurrentRateModel(response)).rejects.toThrow(/model\.trendDays must be a non-negative integer/);
  });
});

describe('Belgian CPI loading', () => {
  it('loads the complete checked-in publication', async () => {
    await expect(loadCpi(new Response(JSON.stringify(cpi), { status: 200 }))).resolves.toEqual(cpi);
  });

  it('fails loudly for an invalid observation or HTTP error', async () => {
    const malformed: unknown = structuredClone(cpi);
    (malformed as { indices: Record<string, number> }).indices['2026-08'] = 0;
    await expect(loadCpi(new Response(JSON.stringify(malformed), { status: 200 }))).rejects.toThrow(/Belgian CPI.*2026-08/);
    await expect(loadCpi(new Response('', { status: 500 }))).rejects.toThrow(/Belgian CPI.*HTTP 500/);
  });

  it('rejects histories that do not start in February 2015 or contain a monthly gap', async () => {
    const lateStart = structuredClone(cpi);
    delete (lateStart as { indices: Record<string, number> }).indices['2015-02'];
    await expect(loadCpi(new Response(JSON.stringify(lateStart), { status: 200 }))).rejects.toThrow(/coverage must begin at 2015-02/);

    const gapped = structuredClone(cpi);
    delete (gapped as { indices: Record<string, number> }).indices['2020-06'];
    await expect(loadCpi(new Response(JSON.stringify(gapped), { status: 200 }))).rejects.toThrow(/missing monthly observation 2020-06/);
  });
});
