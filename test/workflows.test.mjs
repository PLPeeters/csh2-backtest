import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function workflow(name) {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}

test('schedules €STR refreshes at 09:15 Brussels time', async () => {
  const contents = await workflow('refresh-overnight-rates.yml');
  assert.match(contents, /cron: '15 9 \* \* 1-5'/);
  assert.match(contents, /timezone: Europe\/Brussels/);
  assert.match(contents, /npm run refresh-overnight-rates/);
});

test('schedules CSH2 refreshes at midnight Brussels time every day', async () => {
  const contents = await workflow('refresh-csh2.yml');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(contents, /cron: '0 0 \* \* \*'/);
  assert.match(contents, /timezone: Europe\/Brussels/);
  assert.match(contents, /npm run refresh-csh2/);
  assert.match(packageJson.scripts['refresh-csh2'], /check-current-rate-model/);
});

test('can regenerate and validate the current-rate model without refreshing market data', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['update-current-rate-model'], /scripts\/update-current-rate-model\.mjs/);
  assert.match(packageJson.scripts['update-current-rate-model'], /check-current-rate-model/);
});

test('schedules a CPI-only refresh at 10:30 Brussels time each Monday', async () => {
  const contents = await workflow('refresh-cpi.yml');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(contents, /cron: '30 10 \* \* 1'/);
  assert.match(contents, /timezone: Europe\/Brussels/);
  assert.match(contents, /npm run refresh-cpi/);
  assert.match(contents, /git diff --quiet -- src\/assets\/data\/cpi\.json/);
  assert.match(contents, /git add src\/assets\/data\/cpi\.json/);
  assert.doesNotMatch(packageJson.scripts['refresh-cpi'], /check-current-rate-model/);
});

test('publishes changed refreshes through the reusable Pages workflow', async () => {
  const overnight = await workflow('refresh-overnight-rates.yml');
  const csh2 = await workflow('refresh-csh2.yml');
  const cpi = await workflow('refresh-cpi.yml');
  assert.match(overnight, /git diff --quiet -- src\/assets\/data\/overnight-rates\.json src\/assets\/data\/current-rate-model\.json/);
  assert.match(overnight, /git add src\/assets\/data\/overnight-rates\.json src\/assets\/data\/current-rate-model\.json/);
  assert.match(csh2, /git diff --quiet -- src\/assets\/data\/csh2-prices\.json src\/assets\/data\/current-rate-model\.json/);
  assert.match(csh2, /git add src\/assets\/data\/csh2-prices\.json src\/assets\/data\/current-rate-model\.json/);
  for (const contents of [overnight, csh2, cpi]) assert.match(contents, /uses: \.\/\.github\/workflows\/pages\.yml/);
  const pages = await workflow('pages.yml');
  assert.match(pages, /workflow_call:/);
  assert.match(pages, /npm run verify/);
  assert.match(pages, /path: dist/);
});

test('independent refresh workflows keep their no-op path when neither source nor model changes', async () => {
  for (const name of ['refresh-overnight-rates.yml', 'refresh-csh2.yml']) {
    const contents = await workflow(name);
    assert.match(contents, /if git diff --quiet --[^\n]+current-rate-model\.json; then\n\s+echo 'changed=false'/);
    assert.match(contents, /if: needs\.refresh\.outputs\.changed == 'true'/);
  }
  const cpi = await workflow('refresh-cpi.yml');
  assert.match(cpi, /if git diff --quiet -- src\/assets\/data\/cpi\.json; then\n\s+echo 'changed=false'/);
  assert.match(cpi, /if: needs\.refresh\.outputs\.changed == 'true'/);
});
