export function nextYearComparisonValues({ csh2Value, currentAccountValue, bestAccountValue }) {
  if (currentAccountValue === undefined) return undefined;
  const values = [
    csh2Value === undefined ? undefined : { label: 'CSH2', value: csh2Value },
    currentAccountValue === undefined ? undefined : { label: 'Current account', value: currentAccountValue },
    bestAccountValue === undefined ? undefined : { label: 'Best savings account', value: bestAccountValue }
  ].filter((value) => value !== undefined)
    .toSorted((left, right) => right.value - left.value);
  if (values.length < 2) return undefined;
  return {
    label: values[0].label,
    difference: values[0].value - currentAccountValue,
    ...(values[0].label === 'CSH2' && bestAccountValue !== undefined
      ? { otherAlternative: { label: 'Best savings account', difference: bestAccountValue - currentAccountValue } }
      : values[0].label === 'Best savings account' && csh2Value !== undefined
        ? { otherAlternative: { label: 'CSH2', difference: csh2Value - currentAccountValue } }
      : {})
  };
}
