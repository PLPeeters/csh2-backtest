# CSH2 Belgium Backtester

A local, browser-based simulator for comparing dated EUR cash flows invested in
[Amundi Smart Overnight Return UCITS ETF Acc](https://www.amundietf.com/) (CSH2,
ISIN `LU1190417599`) with the euro overnight rate and a savings account.

**[Open the backtester](https://csh2-backtest.plpeeters.com/)**

The backtest includes:

- purchases, withdrawals, and final liquidation using historical daily closes;
- Belgian transaction tax (TOB), optional broker fees, and FIFO gains;
- the 2026 capital-gains regime with or without its annual exemption, or Reynders Tax;
- fractional or whole-share trading, including residual cash;
- current-rate scenarios, break-even estimates, and missed-earnings comparisons;
- local CSV import for cash flows; and
- interactive historical and annualized-return charts.

All calculations run in the browser. Imported files and cash flows remain on your
device.

<a href="https://www.buymeacoffee.com/plpeeters" target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60">
</a>

## Run locally

Node.js 20.19 or newer is required.

```sh
npm install
npm start
```

Open the URL printed by Vite, normally <http://localhost:5173>.

## Market data

The app uses bundled CSH2 prices, euro overnight rates, and a validated current-rate
model, so it does not contact financial-data providers while calculating. A cash
flow uses the closing price on its date, or the latest earlier market close.

Refresh the bundled datasets with:

```sh
npm run refresh-data
```

You can refresh the source datasets separately with `npm run refresh-csh2` and
`npm run refresh-overnight-rates`. Both commands regenerate and validate the shared
current-rate model against the resulting pair of datasets.

To regenerate the published model from the currently bundled datasets only (with no
network requests), run `npm run update-current-rate-model`.

## Development

- `npm test` runs the calculation and browser tests.
- `npm run check` runs Svelte and TypeScript diagnostics.
- `npm run lint` checks the source code.
- `npm run build` creates a production build in `dist/`.
- `npm run verify` runs all checks, tests, and the production build.

Install the project-local Chromium before the first browser-test run:

```sh
npm run playwright:install
```

The Svelte frontend lives in `src/`. The framework-independent calculation API is
`src/backtest.mjs`, with its implementation split by responsibility under
`src/backtest/`.

## Important limitations

This project is an educational estimate, not financial or tax advice. It uses
daily closing prices rather than executable broker prices and does not model
spreads, variable commissions, every fund-tax rule, or every personal tax-law
exception. Current-rate projections hold their selected rates constant and are
scenarios, not price forecasts.
