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

test('schedules CSH2 refreshes at midnight Tuesday through Saturday Brussels time', async () => {
  const contents = await workflow('refresh-csh2.yml');
  assert.match(contents, /cron: '0 0 \* \* 2-6'/);
  assert.match(contents, /timezone: Europe\/Brussels/);
  assert.match(contents, /npm run refresh-csh2/);
});

test('publishes changed refreshes through the reusable Pages workflow', async () => {
  const overnight = await workflow('refresh-overnight-rates.yml');
  const csh2 = await workflow('refresh-csh2.yml');
  assert.match(overnight, /src\/assets\/data\/overnight-rates\.json/);
  assert.match(csh2, /src\/assets\/data\/csh2-prices\.json/);
  for (const contents of [overnight, csh2]) assert.match(contents, /uses: \.\/\.github\/workflows\/pages\.yml/);
  const pages = await workflow('pages.yml');
  assert.match(pages, /workflow_call:/);
  assert.match(pages, /npm run verify/);
  assert.match(pages, /path: dist/);
});
