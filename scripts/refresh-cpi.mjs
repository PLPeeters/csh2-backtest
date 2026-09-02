import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithBackoff } from './fetch-with-backoff.mjs';
import { CPI_BACKFILL_VIEW_ID, CPI_CURRENT_VIEW_ID, CPI_DATA_SOURCE_ID, publishCpi } from './cpi-publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPublicationPath = resolve(root, 'src/assets/data/cpi.json');
const retryStatuses = [429, 500, 502, 503, 504];
const retryDelaysMilliseconds = [10_000, 20_000, 40_000, 80_000];

async function readPublication(publicationPath) {
  try { return JSON.parse(await readFile(publicationPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { indices: {} }; throw error; }
}

async function fetchJson(path, label) {
  const response = await fetchWithBackoff(`https://bestat.statbel.fgov.be/bestat/api/views/${path}`, () => ({
    headers: { Accept: 'application/json', 'User-Agent': 'CSH2-Belgium-Backtester/1.0' },
    signal: AbortSignal.timeout(30_000)
  }), {
    retryStatuses,
    retryDelaysMilliseconds,
    retryError: (error) => error instanceof TypeError || error?.name === 'TimeoutError',
    onRetry: ({ delay, error, response: failedResponse }) => console.warn(`Statbel ${label} request failed (${error?.message ?? `HTTP ${failedResponse.status}`}); retrying in ${delay / 1_000} seconds.`)
  });
  if (!response.ok) throw new Error(`Statbel ${label} returned HTTP ${response.status}.`);
  return response.json();
}

function assertMetadata(metadata, viewId, role) {
  if (metadata?.id !== viewId) throw new Error(`Statbel ${role} metadata returned an unexpected view ID.`);
  if (metadata?.dataSourceId !== CPI_DATA_SOURCE_ID) throw new Error(`Statbel ${role} view belongs to unexpected data source ${metadata?.dataSourceId ?? 'unknown'}.`);
}

function withoutCachedAt(value) {
  const { cachedAt: _cachedAt, ...comparable } = value;
  return comparable;
}

export async function runCpiRefresh({ publicationPath = defaultPublicationPath, fetchJsonImpl = fetchJson, now = () => new Date(), logger = console } = {}) {
  const existing = await readPublication(publicationPath);
  const [currentMetadata, currentResult, backfillMetadata, backfillResult] = await Promise.all([
    fetchJsonImpl(CPI_CURRENT_VIEW_ID, 'current-view metadata'),
    fetchJsonImpl(`${CPI_CURRENT_VIEW_ID}/result/JSON`, 'current-view result'),
    fetchJsonImpl(CPI_BACKFILL_VIEW_ID, 'backfill metadata'),
    fetchJsonImpl(`${CPI_BACKFILL_VIEW_ID}/result/JSON`, 'backfill result')
  ]);
  assertMetadata(currentMetadata, CPI_CURRENT_VIEW_ID, 'current');
  if (!currentMetadata.standard || !currentMetadata.published) throw new Error('Statbel current CPI view is no longer the published standard view.');
  assertMetadata(backfillMetadata, CPI_BACKFILL_VIEW_ID, 'backfill');

  const publication = publishCpi(existing, backfillResult, currentResult, now().toISOString());
  if (JSON.stringify(withoutCachedAt(existing)) === JSON.stringify(withoutCachedAt(publication))) {
    logger.log(`Statbel CPI publication unchanged through ${Object.keys(existing.indices).sort().at(-1)}.`);
    return { changed: false, publication: existing };
  }
  await mkdir(dirname(publicationPath), { recursive: true });
  const temporaryPath = `${publicationPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(publication, null, 2)}\n`);
  await rename(temporaryPath, publicationPath);
  logger.log(`Published ${Object.keys(publication.indices).length} Statbel CPI months through ${Object.keys(publication.indices).sort().at(-1)}.`);
  return { changed: true, publication };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCpiRefresh();
