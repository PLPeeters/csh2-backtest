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
    descriptionColumn: 'Description',
    dateFormat: 'iso'
  });
  assert.deepEqual(detectCsvMapping([
    { When: '14-02-2026', Note: 'Deposit', Net: '100' },
    { When: '15-02-2026', Note: 'Withdrawal', Net: '-25' }
  ], ['When', 'Note', 'Net']), {
    dateColumn: 'When',
    amountColumn: 'Net',
    descriptionColumn: 'Note',
    dateFormat: 'dmy'
  });
  assert.deepEqual(detectCsvMapping([{ Date: '01/02/2026', Value: '100' }], ['Date', 'Value']), {
    dateColumn: 'Date', amountColumn: 'Value', descriptionColumn: '', dateFormat: 'dmy'
  });
});

test('parses common EUR and US amount formats', () => {
  assert.equal(parseImportedAmount('€ 1.234,56'), 1234.56);
  assert.equal(parseImportedAmount('-1,234.56'), -1234.56);
  assert.equal(parseImportedAmount('1,234'), 1234);
  assert.equal(parseImportedAmount('0'), null);
});

test('maps signed imported amounts, sorts them chronologically, and reports invalid rows', () => {
  const result = mapImportedRows([{ When: '02/04/2026', Value: '-25,50' }, { When: '01/04/2026', Value: '100' }, { When: '02/04/2026', Value: '30' }, { When: 'no date', Value: '2' }], { dateColumn: 'When', amountColumn: 'Value', dateFormat: 'dmy' });
  assert.deepEqual(result.flows, [{ date: '2026-04-01', type: 'inflow', amount: 100, interestPayment: false }, { date: '2026-04-02', type: 'outflow', amount: 25.5, interestPayment: false }, { date: '2026-04-02', type: 'inflow', amount: 30, interestPayment: false }]);
  assert.deepEqual(result.invalidRows, [5]);
});

test('marks multilingual interest descriptions and term-account liquidations on inflows', () => {
  const result = mapImportedRows([
    { Date: '2026-01-01', Amount: '1', Description: 'Intérêts créditeurs' },
    { Date: '2026-01-02', Amount: '2', Description: 'Prime de fidélité' },
    { Date: '2026-01-03', Amount: '3', Description: "Liquidation d'un emprunt" },
    { Date: '2026-01-04', Amount: '4', Description: 'Getrouwheidspremie' },
    { Date: '2026-01-05', Amount: '5', Description: 'Loyalty bonus' },
    { Date: '2026-01-06', Amount: '-6', Description: 'Interest payment' },
    { Date: '2026-01-07', Amount: '7', Description: 'Transfer from savings' },
    { Date: '2026-01-08', Amount: '8', Description: 'Maturity of term deposit' }
  ], { dateColumn: 'Date', amountColumn: 'Amount', descriptionColumn: 'Description', dateFormat: 'iso' });
  assert.deepEqual(result.flows.map((flow) => flow.interestPayment), [true, true, true, true, true, false, false, true]);
});
