import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithBackoff } from './fetch-with-backoff.mjs';
import { parseRefreshMode } from './refresh-data-mode.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const refreshMode = parseRefreshMode(process.argv.slice(2));
const pricePath = resolve(root, 'src/assets/data/csh2-prices.json');
const priceSource = 'Google Finance historical data, with daily Yahoo Finance updates';
const benchmarkPath = resolve(root, 'src/assets/data/overnight-rates.json');
const legacyRatePath = resolve(root, 'src/assets/data/estr-rates.json');
const historicalStart = '2015-03-13';
const estrCorrectionWindowDays = 7;
const marketDataRetryDelaysMilliseconds = [10_000, 20_000, 40_000, 80_000];
const today = new Date().toISOString().slice(0, 10);
const benchmarkSegments = [
  { id: 'eonia', label: 'EONIA', start: '2015-03-13', end: '2018-08-31', series: 'EON/D.EONIA_TO.RATE' },
  { id: 'pre-estr', label: 'Pre-Euro Short-Term Rate', start: '2018-09-03', end: '2019-09-30', series: 'MMSR/B.U2._X._Z.S12._Z.U.BO.WT.D76.MA._Z._Z.EUR._Z' },
  { id: 'estr', label: '€STR', start: '2019-10-01', end: undefined, series: 'EST/B.EU000A2X2A25.WT' }
];

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function pathExists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}
function dateFromUnix(timestamp) { return new Date(timestamp * 1000).toISOString().slice(0, 10); }
function sortByDate(records) {
  return Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right)));
}
function publishedPricesWithFallbacks(prices, endDate) {
  const publishedPrices = {};
  const firstDate = Object.keys(prices).sort()[0];
  let sourceDate;
  let sourceClose;
  for (let date = firstDate; date <= endDate; date = dayAfter(date)) {
    const price = prices[date];
    if (price) {
      publishedPrices[date] = price;
      sourceDate = date;
      sourceClose = price.close;
    } else if (sourceDate) {
      publishedPrices[date] = { close: sourceClose, isFallback: true, fallbackSource: sourceDate };
    }
  }
  return publishedPrices;
}
function dayAfter(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function daysBefore(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function sameRecords(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function countChangedRecords(previous, current) {
  return Object.keys(current).filter((date) => previous[date] !== current[date]).length;
}
async function fetchDailyPrices(startDate) {
  const start = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const end = Math.floor(new Date(`${today}T23:59:59Z`).getTime() / 1000);
  const url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/CSH2.PA');
  url.search = new URLSearchParams({ period1: String(start), period2: String(end), interval: '1d', events: 'history' });
  const response = await fetchWithBackoff(url, { headers: { Accept: 'application/json', 'User-Agent': 'CSH2-Belgium-Backtester/1.0' } }, {
    retryStatuses: [429, 500, 502, 503, 504],
    retryDelaysMilliseconds: marketDataRetryDelaysMilliseconds,
    onRetry: ({ delay }) => console.warn(`Yahoo Finance returned HTTP 429; retrying in ${delay / 1_000} seconds.`)
  });
  if (!response.ok) throw new Error(`Yahoo Finance returned HTTP ${response.status}.`);
  const result = (await response.json()).chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error('Yahoo Finance returned an invalid CSH2.PA response.');
  const prices = Object.fromEntries(result.timestamp.map((timestamp, index) => [dateFromUnix(timestamp), { open: quote.open[index], close: quote.close[index] }]).filter(([, price]) => Number.isFinite(price.open) && Number.isFinite(price.close)));
  return prices;
}
async function fetchRates(segment, startDate, endDate) {
  const url = new URL(`https://data-api.ecb.europa.eu/service/data/${segment.series}`);
  url.search = new URLSearchParams({ startPeriod: startDate, endPeriod: endDate, format: 'csvdata' });
  const response = await fetchWithBackoff(url, () => ({ headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(30_000) }), {
    retryStatuses: [429, 500, 502, 503, 504],
    retryDelaysMilliseconds: marketDataRetryDelaysMilliseconds,
    retryError: (error) => error instanceof TypeError || error?.name === 'TimeoutError',
    onRetry: ({ delay, error, response: failedResponse }) => {
      const reason = error?.message ?? `HTTP ${failedResponse.status}`;
      console.warn(`ECB ${segment.label} request failed (${reason}); retrying in ${delay / 1_000} seconds.`);
    }
  });
  if (!response.ok) throw new Error(`ECB returned HTTP ${response.status} for ${segment.label}.`);
  return parseRates(await response.text(), segment.label);
}
function parseRates(text, label) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const columns = header.split(',');
  const dateIndex = columns.indexOf('TIME_PERIOD');
  const valueIndex = columns.indexOf('OBS_VALUE');
  const rates = Object.fromEntries(rows.map((row) => {
    const values = row.split(',');
    return [values[dateIndex], Number(values[valueIndex])];
  }).filter(([date, rate]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate)));
  if (!Object.keys(rates).length) throw new Error(`ECB returned no ${label} observations.`);
  return rates;
}

let appendedPrices = 0;
let changedRates = 0;

if (refreshMode.csh2) {
  const existingPrices = await readJson(pricePath, { prices: {} });
  const historyPrices = Object.fromEntries(Object.entries(existingPrices.prices).filter(([, price]) => !price?.isFallback && Number.isFinite(price?.open) && Number.isFinite(price?.close)));
  const lastHistoryDate = Object.keys(historyPrices).sort().at(-1);
  if (!lastHistoryDate) throw new Error('CSH2 history contains no prices.');
  const dailyPrices = lastHistoryDate < today ? await fetchDailyPrices(dayAfter(lastHistoryDate)) : {};
  const publishedPrices = publishedPricesWithFallbacks(sortByDate({ ...historyPrices, ...dailyPrices }), today);
  if (!sameRecords(existingPrices.prices, publishedPrices) || existingPrices.source !== priceSource) {
    await writeJson(pricePath, { source: priceSource, cachedAt: new Date().toISOString(), prices: publishedPrices });
  }
  appendedPrices = Object.keys(dailyPrices).length;
}

if (refreshMode.overnightRates) {
  const [existingBenchmark, benchmarkExists] = await Promise.all([
    readJson(benchmarkPath, readJson(legacyRatePath, { rates: {} })),
    pathExists(benchmarkPath)
  ]);
  const loadedSegmentIds = new Set(existingBenchmark.segments?.map(({ id }) => id));
  const historicalSegments = benchmarkSegments.filter((segment) => segment.id !== 'estr' && !loadedSegmentIds.has(segment.id));
  const estrSegment = benchmarkSegments.at(-1);
  const lastEstrDate = Object.keys(existingBenchmark.rates).filter((date) => date >= estrSegment.start).sort().at(-1);
  const [historicalRates, estrRates] = await Promise.all([
    Promise.all(historicalSegments.map(async (segment) => fetchRates(segment, segment.start, segment.end))),
    fetchRates(estrSegment, lastEstrDate ? daysBefore(lastEstrDate, estrCorrectionWindowDays) : estrSegment.start, today)
  ]);
  const mergedRates = sortByDate({ ...existingBenchmark.rates, ...Object.assign({}, ...historicalRates), ...estrRates });
  if (!benchmarkExists || !sameRecords(existingBenchmark.rates, mergedRates) || existingBenchmark.source !== 'European Central Bank Euro overnight benchmark' || !sameRecords(existingBenchmark.segments, benchmarkSegments)) {
    await writeJson(benchmarkPath, { source: 'European Central Bank Euro overnight benchmark', cachedAt: new Date().toISOString(), segments: benchmarkSegments, rates: mergedRates });
  }
  if (await pathExists(legacyRatePath)) await rm(legacyRatePath);
  changedRates = countChangedRecords(existingBenchmark.rates, mergedRates);
}

console.log(`Appended ${appendedPrices} daily CSH2 records and updated ${changedRates} Euro overnight benchmark records as of ${today}.`);
