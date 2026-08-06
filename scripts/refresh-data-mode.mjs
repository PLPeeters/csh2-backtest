const acceptedModes = new Set(['--csh2', '--overnight-rates']);

export function parseRefreshMode(argumentsList) {
  const requestedModes = new Set(argumentsList);
  const invalidMode = [...requestedModes].find((mode) => !acceptedModes.has(mode));
  if (invalidMode) throw new Error(`Unknown refresh mode: ${invalidMode}. Use --csh2 or --overnight-rates.`);
  return {
    csh2: requestedModes.size === 0 || requestedModes.has('--csh2'),
    overnightRates: requestedModes.size === 0 || requestedModes.has('--overnight-rates')
  };
}
