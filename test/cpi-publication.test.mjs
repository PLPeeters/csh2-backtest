import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBackfillCpiFacts, parseCurrentCpiFacts, publishCpi } from '../scripts/cpi-publication.mjs';
import { runCpiRefresh } from '../scripts/refresh-cpi.mjs';

test('parses French backfill months, skips annual rows, and collapses identical duplicates', () => {
  const facts = { facts: [
    { Année: '2026', Mois: 'Juillet 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.01 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.04 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.04 },
    { Année: '2026', Mois: null, 'Indice des prix à la consommation': 139 }
  ] };
  assert.deepEqual(parseBackfillCpiFacts(facts), { '2026-07': 104.01, '2026-08': 104.04 });
});

test('rejects conflicting duplicate months and invalid values', () => {
  assert.throws(() => parseBackfillCpiFacts({ facts: [
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.04 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.05 }
  ] }), /conflicting observations for 2026-08/);
  assert.throws(() => parseBackfillCpiFacts({ facts: [{ Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 0 }] }), /positive finite/);
  assert.throws(() => parseBackfillCpiFacts({ facts: [
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.034 },
    { Année: '2026', Mois: 'Août 2026', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.036 }
  ] }), /conflicting observations for 2026-08/);
});

test('rounds source values to eight decimals and requires the shared 2025 base year', () => {
  const raw = 135.35000000000048;
  assert.equal(parseBackfillCpiFacts({ facts: [{ Année: '2016', Mois: 'Janvier 2016', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': raw }] })['2016-01'], 135.35);
  assert.equal(parseBackfillCpiFacts({ facts: [{ Année: '2016', Mois: 'Janvier 2016', 'Année de base': '2025 = 100', 'Indice des prix à la consommation': 104.123456789 }] })['2016-01'], 104.12345679);
  assert.equal(parseCurrentCpiFacts({ facts: [{ Year: '2016', Month: 'January 2016', 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': raw }] })['2016-01'], 135.35);
  assert.throws(() => parseBackfillCpiFacts({ facts: [{ Année: '2016', Mois: 'Janvier 2016', 'Année de base': '2013 = 100', 'Indice des prix à la consommation': raw }] }), /unexpected base year.*2025 = 100/);
  assert.throws(() => parseCurrentCpiFacts({ facts: [{ Year: '2026', Month: 'August 2026', 'Base year': '2026 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': 104.01 }] }), /unexpected base year.*2025 = 100/);
});

test('selects only monthly all-items rows from the current English view', () => {
  const common = { Year: '2026', Month: 'August 2026', 'Base year': '2025 = 100', 'Global Index': 'Global Index' };
  assert.deepEqual(parseCurrentCpiFacts({ facts: [
    { ...common, 'Level 1': 'Energy', 'Consumer price index': 114.11 },
    { ...common, 'Level 1': null, 'Consumer price index': 104.01 }
  ] }), { '2026-08': 104.01 });
});

test('publishes sorted provenance and lets direct backfill observations win overlaps', () => {
  const existing = { base: '2025 = 100', indices: {
    '2015-02': 100, '2015-03': 101, '2015-04': 102, '2015-05': 103, '2015-06': 104, '2015-07': 105,
    '2015-08': 106, '2015-09': 107, '2015-10': 108, '2015-11': 109, '2015-12': 110,
    '2016-01': 135, '2016-02': 136.35, '2016-03': 137.7
  } };
  const current = { facts: [
    ...[['January', 100], ['February', 101], ['March', 102]].map(([month, value]) => ({ Year: '2016', Month: `${month} 2016`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  const publication = publishCpi(existing, undefined, current, '2026-08-30T00:00:00.000Z');
  assert.deepEqual(Object.keys(publication.indices), ['2015-02', '2015-03', '2015-04', '2015-05', '2015-06', '2015-07', '2015-08', '2015-09', '2015-10', '2015-11', '2015-12', '2016-01', '2016-02', '2016-03']);
  assert.equal(publication.cachedAt, '2026-08-30T00:00:00.000Z');
  assert.equal(publication.base, '2025 = 100');
  assert.equal(publication.indices['2016-01'], 135);
  assert.match(publication.adaptations, /Selected.*deduplicated.*normalized/i);
});

test('rejects malformed stored indices', () => {
  const current = { facts: [
    ...[['June', 102.95], ['July', 103.6], ['August', 104.01]].map(([month, value]) => ({ Year: '2026', Month: `${month} 2026`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  assert.throws(() => publishCpi({ base: '2025 = 100', indices: { '2026-06': null, '2026-07': null, '2026-08': null } }, undefined, current, '2026-08-30T00:00:00.000Z'), /stored reference observation.*positive finite/);
});

test('rejects stored publication histories with a missing start or internal month', () => {
  const current = { facts: [
    ...[['January', 100], ['February', 101], ['March', 102]].map(([month, value]) => ({ Year: '2016', Month: `${month} 2016`, 'Base year': '2025 = 100', 'Global Index': 'Global Index', 'Level 1': null, 'Consumer price index': value }))
  ] };
  assert.throws(() => publishCpi({ base: '2025 = 100', indices: { '2016-02': 136.35, '2016-03': 137.7, '2016-04': 139.05 } }, undefined, current, '2026-08-30T00:00:00Z'), /must begin at 2015-02/);
  assert.throws(() => publishCpi({ base: '2025 = 100', indices: { '2015-02': 100, '2015-03': 101, '2015-04': 102, '2015-05': 103, '2015-06': 104, '2015-07': 105, '2015-08': 106, '2015-09': 107, '2015-10': 108, '2015-11': 109, '2015-12': 110, '2016-01': 135, '2016-03': 137.7, '2016-04': 139.05 } }, undefined, current, '2026-08-30T00:00:00Z'), /missing monthly observation 2016-02/);
});

test('refreshes unseeded and seeded publications idempotently and never writes a failed publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cpi-refresh-test-'));
  const publicationPath = join(directory, 'cpi.json');
  const backfillFacts = { facts: [
    ...[['Février', 100], ['Mars', 101], ['Avril', 102], ['Mai', 103], ['Juin', 104], ['Juillet', 105], ['Août', 106], ['Septembre', 107], ['Octobre', 108], ['Novembre', 109], ['Décembre', 110]].map(([month, value]) => ({ Année: '2015', Mois: `${month} 2015`, 'Année de base': '2025 = 100', 'Indice des prix à la consommation': value })),
    ...[['Janvier', 135], ['Février', 136.35], ['Mars', 137.7]].map(([month, value]) => ({ Année: '2016', Mois: `${month} 2016`, 'Année de base': '2025 = 100', 'Indice des prix à la consommation': value }))
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
  assert.ok(calls.some((path) => path.startsWith('942375c9')));

  const invalidFetch = async (path) => {
    if (path === '86586e27-90ac-47c6-87ce-64b63194e605/result/JSON') return { facts: currentFacts.facts.map((fact) => ({ ...fact, 'Base year': '2026 = 100' })) };
    if (path === '942375c9-71d5-4d0c-9120-e051bd58b9d5/result/JSON') return backfillFacts;
    return { id: path, dataSourceId: '314984ea-123f-4c42-93e5-4942cb877795', standard: true, published: true };
  };
  await assert.rejects(runCpiRefresh({ publicationPath, fetchJsonImpl: invalidFetch, logger: { log() {} } }), /unexpected base year/);
  assert.equal(await readFile(publicationPath, 'utf8'), seededBytes);

  const damaged = JSON.parse(seededBytes);
  delete damaged.indices['2016-02'];
  const damagedBytes = `${JSON.stringify(damaged, null, 2)}\n`;
  await writeFile(publicationPath, damagedBytes);
  const repaired = await runCpiRefresh({ publicationPath, fetchJsonImpl, logger: { log() {} } });
  assert.equal(repaired.changed, true);
  assert.notEqual(await readFile(publicationPath, 'utf8'), damagedBytes);
  assert.equal(JSON.parse(await readFile(publicationPath, 'utf8')).indices['2016-02'], 136.35);
});
