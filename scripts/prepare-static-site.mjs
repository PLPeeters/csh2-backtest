import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const copyFiles = [
  ['node_modules/papaparse/papaparse.min.js', 'public/vendor/papaparse.js'],
  ['node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs', 'public/vendor/lightweight-charts.js'],
  ['node_modules/luxon/build/es6/luxon.mjs', 'public/vendor/luxon.mjs'],
  ['src/backtest.mjs', 'public/modules/backtest.mjs'],
  ['src/cash-flow-csv.mjs', 'public/modules/cash-flow-csv.mjs'],
  ['src/static-market-data.mjs', 'public/modules/static-market-data.mjs']
];

await Promise.all(copyFiles.map(async ([from, to]) => {
  const destination = resolve(root, to);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, from), destination);
}));

const assetPaths = [
  'favicon.svg',
  'styles.css',
  'app.js',
  'modules/backtest.mjs',
  'modules/cash-flow-csv.mjs',
  'modules/static-market-data.mjs',
  'vendor/papaparse.js',
  'vendor/lightweight-charts.js',
  'vendor/luxon.mjs',
  'data/csh2-prices.json',
  'data/overnight-rates.json'
];

function digest(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

const versions = Object.fromEntries(await Promise.all(assetPaths.map(async (assetPath) => [
  assetPath,
  digest(await readFile(resolve(root, 'public', assetPath)))
])));
const runtimeVersion = digest(`${versions['app.js']}:${versions['data/csh2-prices.json']}:${versions['data/overnight-rates.json']}`);

function versionUrl(assetPath, version = versions[assetPath]) {
  return `./${assetPath}?v=${version}`;
}

function replaceVersion(url, version) {
  return new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[0-9a-f]+)?`, 'g');
}

const appPath = resolve(root, 'public/app.js');
let app = await readFile(appPath, 'utf8');
for (const assetPath of assetPaths.filter((assetPath) => assetPath.startsWith('modules/') || assetPath.startsWith('vendor/'))) {
  app = app.replace(replaceVersion(`./${assetPath}`), versionUrl(assetPath));
}
await writeFile(appPath, app);

const indexPath = resolve(root, 'public/index.html');
let index = await readFile(indexPath, 'utf8');
for (const assetPath of ['favicon.svg', 'styles.css', 'vendor/papaparse.js']) {
  index = index.replace(replaceVersion(`./${assetPath}`), versionUrl(assetPath));
}
index = index.replace(replaceVersion('./app.js'), versionUrl('app.js', runtimeVersion));
await writeFile(indexPath, index);
