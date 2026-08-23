import { describe, expect, it } from 'vitest';
import publication from '../../assets/data/current-rate-model.json';
import { loadOptionalCurrentRateModel } from './market-data';

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
