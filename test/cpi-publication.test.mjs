import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBackfillCpiFacts, parseCurrentCpiFacts, publishCpi, rebaseCpiIndices } from '../scripts/cpi-publication.mjs';
import { runCpiRefresh } from '../scripts/refresh-cpi.mjs';

test('parses French backfill months, skips annual rows, and collapses identical duplicates', () => {
  const facts = { facts: [
    { Année: '2026', Mois: 'Juillet 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.17 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.73 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.73 },
    { Année: '2026', Mois: null, 'Indice des prix à la consommation': 139 }
  ] };
  assert.deepEqual(parseBackfillCpiFacts(facts), { '2026-07': 140.17, '2026-08': 140.73 });
});

test('rejects conflicting duplicate months and invalid values', () => {
  assert.throws(() => parseBackfillCpiFacts({ facts: [
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.73 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.74 }
  ] }), /conflicting observations for 2026-08/);
  assert.throws(() => parseBackfillCpiFacts({ facts: [{ Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 0 }] }), /positive finite/);
  assert.throws(() => parseBackfillCpiFacts({ facts: [
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.7300001 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': 140.7300002 }
  ] }), /conflicting observations for 2026-08/);
});

test('preserves raw source values and rejects unexpected source base years', () => {
  const raw = 101.59000000000036;
  assert.equal(parseBackfillCpiFacts({ facts: [{ Année: '2016', Mois: 'Janvier 2016', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': raw }] })['2016-01'], raw);
  assert.throws(() => parseBackfillCpiFacts({ facts: [{ Année: '2016', Mois: 'Janvier 2016', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': raw }] }), /unexpected base year.*2013 = 100/);
  assert.throws(() => parseCurrentCpiFacts({ facts: [{ Year: '2026', Month: 'August 2026', 'Base year': '2026 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': 104.01 }] }), /unexpected base year.*2025 = 100/);
});

test('selects only monthly all-items rows from the current English view', () => {
  const common = { Year: '2026', Month: 'August 2026', 'Base year': '2025 = 100', 'Global Index': 'Global Index' };
  assert.deepEqual(parseCurrentCpiFacts({ facts: [
    { ...common, 'Level 1': 'Energy', 'Consumer price index': 114.11 },
    { ...common, 'Level 1': null, 'Consumer price index': 104.01 }
  ] }), { '2026-08': 104.01 });
});

test('rebases the 2025-base rolling series without changing CPI ratios', () => {
  const reference = { '2026-06': 139.29, '2026-07': 140.17, '2026-08': 140.73 };
  const current = { '2026-06': 102.95, '2026-07': 103.6, '2026-08': 104.01 };
  const rebased = rebaseCpiIndices(reference, current);
  assert.ok(Math.abs(rebased['2026-08'] - 140.73) < 0.03);
  assert.ok(Math.abs(rebased['2026-08'] / rebased['2026-06'] - current['2026-08'] / current['2026-06']) < 1e-8);
  assert.throws(() => rebaseCpiIndices(reference, { ...current, '2026-07': 150 }), /inconsistent base-year scales/);
});

test('publishes sorted provenance and lets current observations win after rebasing', () => {
  const existing = { base: '2013 = 100', indices: { '2016-01': 135, '2016-02': 136.35, '2016-03': 137.7 } };
  const current = { facts: [
    ...[['January', 100], ['February', 101], ['March', 102]].map(([month, value]) => ({ Year: '2016', Month: `${month} 2016`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  const publication = publishCpi(existing, undefined, current, '2026-08-30T00:00:00.000Z');
  assert.deepEqual(Object.keys(publication.indices), ['2016-01', '2016-02', '2016-03']);
  assert.equal(publication.cachedAt, '2026-08-30T00:00:00.000Z');
  assert.match(publication.adaptations, /Selected.*deduplicated.*rebased.*normalized/i);
});

test('rejects malformed stored reference indices before calculating a scale', () => {
  const current = { facts: [
    ...[['June', 102.95], ['July', 103.6], ['August', 104.01]].map(([month, value]) => ({ Year: '2026', Month: `${month} 2026`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  assert.throws(() => publishCpi({ base: '2013 = 100', indices: { '2026-06': null, '2026-07': null, '2026-08': null } }, undefined, current, '2026-08-30T00:00:00.000Z'), /stored reference observation.*positive finite/);
  assert.throws(() => rebaseCpiIndices({ '2026-06': 0, '2026-07': 0, '2026-08': 0 }, { '2026-06': 1, '2026-07': 1, '2026-08': 1 }), /reference observation.*positive finite/);
});

test('rejects stored publication histories with a missing start or internal month', () => {
  const current = { facts: [
    ...[['January', 100], ['February', 101], ['March', 102]].map(([month, value]) => ({ Year: '2016', Month: `${month} 2016`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  assert.throws(() => publishCpi({ base: '2013 = 100', indices: { '2016-02': 136.35, '2016-03': 137.7, '2016-04': 139.05 } }, undefined, current, '2026-08-30T00:00:00Z'), /must begin at 2016-01/);
  assert.throws(() => publishCpi({ base: '2013 = 100', indices: { '2016-01': 135, '2016-03': 137.7, '2016-04': 139.05 } }, undefined, current, '2026-08-30T00:00:00Z'), /missing monthly observation 2016-02/);
});

test('refreshes unseeded and seeded publications idempotently and never writes a failed publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cpi-refresh-test-'));
  const publicationPath = join(directory, 'cpi.json');
  const backfillFacts = { facts: [
    ...[['Janvier', 135], ['Février', 136.35], ['Mars', 137.7]].map(([month, value]) => ({ Année: '2016', Mois: `${month} 2016`, 'Année de base': '2013 = 100', 'Indice des prix à la consommation': value }))
  ] };
  const currentFacts = { facts: [
    ...[['January', 100], ['February', 101], ['March', 102]].map(([month, value]) => ({ Year: '2016', Month: `${month} 2016`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  const calls = [];
  const fetchJsonImpl = async (path) => {
    calls.push(path);
    if (path === '86586e27-90ac-47c6-87ce-64b63194e605') return { id: path, dataSourceId: '314984ea-123f-4c42-93e5-4942cb877795', standard: true, published: true };
    if (path === '86586e27-90ac-47c6-87ce-64b63194e605/result/JSON') return currentFacts;
    if (path === '942375c9-71d5-4d0c-9120-e051bd58b9d5') return { id: path, dataSourceId: '314984ea-123f-4c42-93e5-4942cb877795' };
    if (path === '942375c9-71d5-4d0c-9120-e051bd58b9d5/result/JSON') return backfillFacts;
    throw new Error(`Unexpected path ${path}`);
  };
  const first = await runCpiRefresh({ publicationPath, fetchJsonImpl, now: () => new Date('2026-08-30T00:00:00Z'), logger: { log() {} } });
  assert.equal(first.changed, true);
  assert.ok(calls.includes('942375c9-71d5-4d0c-9120-e051bd58b9d5/result/JSON'));
  const seededBytes = await readFile(publicationPath, 'utf8');

  calls.length = 0;
  const second = await runCpiRefresh({ publicationPath, fetchJsonImpl, now: () => new Date('2026-08-31T00:00:00Z'), logger: { log() {} } });
  assert.equal(second.changed, false);
  assert.equal(await readFile(publicationPath, 'utf8'), seededBytes);
  assert.ok(!calls.some((path) => path.startsWith('942375c9')));

  const invalidFetch = async (path) => path.endsWith('/result/JSON')
    ? { facts: currentFacts.facts.map((fact) => ({ ...fact, 'Base year': '2026 = 100' })) }
    : { id: path, dataSourceId: '314984ea-123f-4c42-93e5-4942cb877795', standard: true, published: true };
  await assert.rejects(runCpiRefresh({ publicationPath, fetchJsonImpl: invalidFetch, logger: { log() {} } }), /unexpected base year/);
  assert.equal(await readFile(publicationPath, 'utf8'), seededBytes);

  const damaged = JSON.parse(seededBytes);
  delete damaged.indices['2016-02'];
  const damagedBytes = `${JSON.stringify(damaged, null, 2)}\n`;
  await writeFile(publicationPath, damagedBytes);
  await assert.rejects(runCpiRefresh({ publicationPath, fetchJsonImpl, logger: { log() {} } }), /missing monthly observation 2016-02/);
  assert.equal(await readFile(publicationPath, 'utf8'), damagedBytes);
});
