const marketTimeZone = 'Europe/Brussels';

function dayAfter(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function sortByDate(records) {
  return Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right)));
}

function publishedPricesWithFallbacks(prices, endDate) {
  const publishedPrices = {};
  const firstDate = Object.keys(prices).sort()[0];
  let sourceDate;
  let sourceClose;
  for (let date = firstDate; date <= endDate; date = dayAfter(date)) {
    const price = prices[date];
    if (price) {
      publishedPrices[date] = price;
      sourceDate = date;
      sourceClose = price.close;
    } else if (sourceDate) {
      publishedPrices[date] = { close: sourceClose, isFallback: true, fallbackSource: sourceDate };
    }
  }
  return publishedPrices;
}

export function marketDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: marketTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function publishCsh2Prices(existingPrices, dailyPrices, endDate) {
  const historyPrices = Object.fromEntries(Object.entries(existingPrices)
    .filter(([, price]) => !price?.isFallback && Number.isFinite(price?.open) && Number.isFinite(price?.close)));
  const prices = sortByDate({ ...historyPrices, ...dailyPrices });
  if (!Object.keys(prices).length) throw new Error('CSH2 history contains no prices.');
  return publishedPricesWithFallbacks(prices, endDate);
}
