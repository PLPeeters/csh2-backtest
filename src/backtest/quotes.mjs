function priceValue(record, field) {
  return Number.isFinite(record) ? record : record?.[field];
}

/** Returns a stored quote, retaining the real source date behind a fallback day. */
function directQuote(prices, date) {
  const record = prices[date];
  if (!Number.isFinite(priceValue(record, 'close'))) return undefined;
  return {
    date: record?.fallbackSource ?? date,
    price: priceValue(record, 'close'),
    kind: record?.isFallback ? 'previous close' : record?.period === 'monthly' ? 'monthly close' : 'close'
  };
}

export function quoteForTransaction(prices, date) {
  const direct = directQuote(prices, date);
  if (direct) return direct;
  const dates = Object.keys(prices).sort();
  const previousDate = dates.filter((candidate) => candidate <= date && Number.isFinite(priceValue(prices[candidate], 'close'))).at(-1);
  if (!previousDate) throw new Error(`No CSH2 price is available on or before ${date}.`);
  return directQuote(prices, previousDate);
}

export function closingQuoteOnOrBefore(prices, date) {
  const direct = directQuote(prices, date);
  if (direct) return direct;
  const matchedDate = Object.keys(prices).filter((candidate) => candidate <= date && Number.isFinite(priceValue(prices[candidate], 'close'))).sort().at(-1);
  if (!matchedDate) throw new Error(`No CSH2 closing price is available on or before ${date}.`);
  return directQuote(prices, matchedDate);
}

export function isUsableClose(record) {
  return Number.isFinite(priceValue(record, 'close'));
}

export { priceValue };
