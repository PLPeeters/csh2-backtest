import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const copyFiles = [
  ['node_modules/papaparse/papaparse.min.js', 'public/vendor/papaparse.js'],
  ['node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs', 'public/vendor/lightweight-charts.js'],
  ['src/backtest.mjs', 'public/modules/backtest.mjs'],
  ['src/cash-flow-csv.mjs', 'public/modules/cash-flow-csv.mjs'],
  ['src/static-market-data.mjs', 'public/modules/static-market-data.mjs']
];

await Promise.all(copyFiles.map(async ([from, to]) => {
  const destination = resolve(root, to);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, from), destination);
}));
