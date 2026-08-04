export function latestAvailablePriceDate(prices, maximumDate) {
  return Object.entries(prices)
    .filter(([date, record]) => date <= maximumDate && !record?.isFallback && Number.isFinite(Number.isFinite(record) ? record : record?.close))
    .map(([date]) => date)
    .sort()
    .at(-1);
}
