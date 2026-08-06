# CSH2 Belgium Backtester

A local, browser-based simulator for dated EUR cash flows hypothetically invested in Amundi Smart Overnight Return UCITS ETF Acc (CSH2, ISIN `LU1190417599`). It models 0.12% TOB on both purchases and sales, an optional fixed broker fee per executed CSH2 trade, FIFO withdrawals expressed as net cash received, and assumes a 10% tax on each positive FIFO gain when you sell. A default-off Reynders Tax setting instead applies 30% to all positive gains, without CGT or its exemption.

<a href="https://www.buymeacoffee.com/plpeeters" target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60">
</a>

Enable **Buy whole shares only** to restrict purchases and sales to whole CSH2 shares. Each inflow is added to available cash; the simulator buys the maximum affordable number of whole shares after TOB and the optional broker fee, then carries the remainder to the next buy. Available cash is used before selling shares for a withdrawal; a sale rounds up to the minimum whole shares needed, retains any excess proceeds as cash, and is included in the final net value. The transaction ledger shows cash remaining and broker fees after each transaction.

## Run it locally

Requires Node.js 18 or newer.

    npm test
    npm start

Open [http://localhost:3000](http://localhost:3000).

If port 3000 is already in use, choose another port with `PORT=3100 npm start` and open `http://localhost:3100`.

`npm start` prepares a self-contained static site in `public/` before serving it. The browser uses `public/data/csh2-prices.json` and `public/data/overnight-rates.json`; it does not fetch financial data at calculation time. CSH2 contains daily open/close values from 13 March 2015 onward. A cash flow uses the close on its date or latest prior market date.

The result uses Lightweight Charts to plot cumulative net backtest return against a euro overnight benchmark portfolio and to compare the trailing 90-day annualized realised returns of CSH2 and that benchmark. For the trailing benchmark return, each published overnight rate accrues through the calendar days until the next observation. The chart uses pre-flow price and rate history only to establish the 90-day lookback, then displays points from the first cash flow onward. The overnight portfolio follows the CSH2 transactions but excludes any cash left over by whole-share purchases or sales, so that residual cash does not earn the benchmark rate. It uses EONIA from 13 March 2015 through 31 August 2018, the ECB Pre-Euro Short-Term Rate from 3 September 2018 through 30 September 2019, and €STR from 1 October 2019 onward.

## Missed earnings

Optionally enter unpaid accrued interest alongside the cash flows. The backtest adds it to net inputs (total inflows minus total outflows), then compares that total with the estimated net value if CSH2 were sold today. It highlights the euro amount missed and shows that amount as a percentage of net cash input. When CSH2 is still below net input, its result card turns red and may estimate how many days remain to break even by extending CSH2’s trailing 30-day price trend for up to one year. This is a mechanical scenario, not a price forecast; no estimate is shown when the recent trend is flat, negative, or insufficient.

## GitHub Pages and data refresh

The repository includes `.github/workflows/pages.yml`. It refreshes the JSON data files each weekday at 20:20 UTC (after Euronext Paris has closed), supports a manual run from the Actions tab, commits changed data, and deploys `public/` through GitHub Pages. `public/data/csh2-prices.json` is the canonical CSH2 history, seeded with Google Finance historical data and updated daily with Yahoo Finance trading prices. It sorts and deduplicates real market records, then regenerates closed-date fallback entries. Those fallbacks use `{ "isFallback": true, "fallbackSource": "YYYY-MM-DD" }`, carrying the prior close while preserving its real source date; charts and valuations use real trading dates only. The euro overnight benchmark cache backfills EONIA and the ECB Pre-Euro Short-Term Rate once, then retrieves €STR incrementally with a seven-day overlap to incorporate recent revisions. A transient ECB error (429 or 5xx) or timeout is retried four times after 10, 20, 40, and 80 seconds; a final failure stops the refresh workflow. Unchanged cache files retain their prior timestamp so reruns do not create no-op commits. Enable **Settings → Pages → Build and deployment → Source → GitHub Actions** after pushing the repository.

Run `npm run refresh-data` locally to update the published data files and `npm run prepare-site` to copy browser dependencies and calculation modules into `public/`. The workflow runs both commands for every deployment. Its static JSON means the site stays available if Yahoo Finance or the ECB are temporarily unavailable, but prices can be no newer than the last successful workflow run.

## Importing cash flows

Choose or drop a CSV file above the cash-flow list. The tool preselects its date and signed-amount columns from headers and sampled data; when there is only one numeric column, it selects that as the amount. It also detects the date format, while leaving every choice editable. It accepts `YYYY-M-D`, `D/M/YYYY`, `D/M/YY`, `M/D/YYYY`, and `M/D/YY`, with `/`, `-`, or `.` separators and optional zero padding. Positive amounts are inflows and negative amounts are outflows; zero amounts and malformed rows are skipped. Everything is processed locally on your device: files are parsed in the browser only, and neither they nor your cash flows leave your machine. A successful import replaces the untouched initial blank row and then resets the file and mapping fields. Use **Clear all data** and confirm the prompt to remove locally saved cash flows and settings, pending CSV data, and results; it restores a blank cash-flow row with both option toggles enabled.

## Important limitations

This is an educational estimate, not tax advice. CGT applies only to sales from 2026 onward. For a purchase before 2026 that is sold in 2026 or later, the tool uses the higher of its original price and the 31 December 2025 CSH2 close as its tax basis. When selected, the annual capital-gains exemption applies a €10,000 annual allowance and eligible carry-forward, using only gains generated by this backtest. The default-off Reynders Tax setting treats all positive FIFO gains as Article 19bis income taxed at 30%, disables the exemption, and does not apply CGT to the same gain. The broker-fee setting applies the same fixed EUR amount to each executed CSH2 purchase, sale, and estimated final sale; it does not model broker spreads, variable commissions, fund taxation, or other tax-law exceptions. The tool uses daily closing prices, not broker execution prices. If the online source rejects a request, the app reports the error and never substitutes manual CSV data.
