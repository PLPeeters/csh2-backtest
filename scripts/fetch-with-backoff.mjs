function wait(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (value === null || value === undefined) return undefined;
  const normalizedValue = value.trim();
  if (/^\d+$/.test(normalizedValue)) return Number(normalizedValue) * 1_000;
  const retryAt = Date.parse(normalizedValue);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : undefined;
}

export async function fetchWithBackoff(input, init, {
  retryStatuses,
  retryDelaysMilliseconds,
  retryError = () => false,
  request = fetch,
  sleep = wait,
  now = Date.now,
  onRetry = () => {}
}) {
  const createInit = typeof init === 'function' ? init : () => init;
  for (let attempt = 0; ; attempt += 1) {
    let response;
    let error;
    try {
      response = await request(input, createInit());
      if (!retryStatuses.includes(response.status)) return response;
    } catch (caughtError) {
      if (!retryError(caughtError)) throw caughtError;
      error = caughtError;
    }

    const fallbackDelay = retryDelaysMilliseconds[attempt];
    if (fallbackDelay === undefined) {
      if (error) throw error;
      return response;
    }

    const retryAfter = response && retryAfterMilliseconds(response.headers.get('retry-after'), now());
    const delay = retryAfter ?? fallbackDelay;
    onRetry({ attempt: attempt + 1, delay, error, response });
    await sleep(delay);
  }
}
