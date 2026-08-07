import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCsvMapping, mapImportedRows, parseImportedAmount, parseImportedDate } from '../src/cash-flow-csv.mjs';

test('parses ISO, European, and US date formats', () => {
  assert.equal(parseImportedDate('2026-08-02', 'iso'), '2026-08-02');
  assert.equal(parseImportedDate('02/08/2026', 'dmy'), '2026-08-02');
  assert.equal(parseImportedDate('08/02/2026', 'mdy'), '2026-08-02');
  assert.equal(parseImportedDate('10/14/22', 'mdy'), '2022-10-14');
  assert.equal(parseImportedDate('02-08-2026', 'dmy'), '2026-08-02');
  assert.equal(parseImportedDate('02.08.2026', 'dmy'), '2026-08-02');
  assert.equal(parseImportedDate('2026/08/02', 'iso'), '2026-08-02');
});

test('detects CSV columns from headers and sampled data', () => {
  assert.deepEqual(detectCsvMapping([
    { 'Booking date': '2026-08-02', Description: 'Deposit', Balance: '1.234,56' },
    { 'Booking date': '2026-08-03', Description: 'Withdrawal', Balance: '-50,00' }
  ], ['Booking date', 'Description', 'Balance']), {
    dateColumn: 'Booking date',
    amountColumn: 'Balance',
    dateFormat: 'iso'
  });
  assert.deepEqual(detectCsvMapping([
    { When: '14-02-2026', Note: 'Deposit', Net: '100' },
    { When: '15-02-2026', Note: 'Withdrawal', Net: '-25' }
  ], ['When', 'Note', 'Net']), {
    dateColumn: 'When',
    amountColumn: 'Net',
    dateFormat: 'dmy'
  });
  assert.equal(detectCsvMapping([{ Date: '01/02/2026', Value: '100' }], ['Date', 'Value']).dateFormat, 'dmy');
});

test('parses common EUR and US amount formats', () => {
  assert.equal(parseImportedAmount('€ 1.234,56'), 1234.56);
  assert.equal(parseImportedAmount('-1,234.56'), -1234.56);
  assert.equal(parseImportedAmount('1,234'), 1234);
  assert.equal(parseImportedAmount('0'), null);
});

test('maps signed imported amounts, sorts them chronologically, and reports invalid rows', () => {
  const result = mapImportedRows([{ When: '02/04/2026', Value: '-25,50' }, { When: '01/04/2026', Value: '100' }, { When: '02/04/2026', Value: '30' }, { When: 'no date', Value: '2' }], { dateColumn: 'When', amountColumn: 'Value', dateFormat: 'dmy' });
  assert.deepEqual(result.flows, [{ date: '2026-04-01', type: 'inflow', amount: 100 }, { date: '2026-04-02', type: 'outflow', amount: 25.5 }, { date: '2026-04-02', type: 'inflow', amount: 30 }]);
  assert.deepEqual(result.invalidRows, [5]);
});
