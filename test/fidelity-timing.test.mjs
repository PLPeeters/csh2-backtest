import assert from 'node:assert/strict';
import test from 'node:test';
import { nextYearComparisonValues } from '../src/lib/services/fidelity-timing.mjs';

test('measures the next full year winner against the current savings account', () => {
  assert.deepEqual(nextYearComparisonValues({
    csh2Value: 1030,
    currentAccountValue: 1020,
    bestAccountValue: 1050
  }), {
    label: 'Best savings account',
    difference: 30,
    otherAlternative: { label: 'CSH2', difference: 10 }
  });
});

test('includes the best savings account delta when CSH2 wins the next full year', () => {
  assert.deepEqual(nextYearComparisonValues({
    csh2Value: 1050,
    currentAccountValue: 1020,
    bestAccountValue: 1030
  }), {
    label: 'CSH2',
    difference: 30,
    otherAlternative: { label: 'Best savings account', difference: 10 }
  });
});
