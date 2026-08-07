import { assessInterestPayoutTiming, buildBacktestReturnSeries, buildOvernightBenchmarkReturnSeries, buildTrailingAnnualizedCsh2ReturnSeries, buildTrailingAnnualizedOvernightBenchmarkReturnSeries, estimateBreakEvenDate, runBacktest } from './modules/backtest.mjs?v=1be6451c075f';
import { detectCsvMapping, mapImportedRows } from './modules/cash-flow-csv.mjs?v=f7148e7603b4';
import { latestAvailablePriceDate } from './modules/static-market-data.mjs?v=ce1614993ff4';
import { ColorType, LineSeries, createChart } from './vendor/lightweight-charts.js?v=66ac22df1b08';
import { DateTime, Interval } from './vendor/luxon.mjs?v=b495ad5cabea';

const storageKey = 'csh2-belgium-flows-v1';
const settingsStorageKey = 'csh2-belgium-settings-v1';
const flowsElement = document.querySelector('#flows');
const template = document.querySelector('#flow-template');
const status = document.querySelector('#status');
const capitalGainsExemption = document.querySelector('#capital-gains-exemption');
const reyndersTax = document.querySelector('#reynders-tax');
const buyWholeSharesOnly = document.querySelector('#buy-whole-shares-only');
const unpaidAccruedInterest = document.querySelector('#unpaid-accrued-interest');
const interestPayoutDate = document.querySelector('#interest-payout-date');
const interestPayoutAmount = document.querySelector('#interest-payout-amount');
const interestModeInputs = [...document.querySelectorAll('input[name="interest-mode"]')];
const unpaidInterestFields = document.querySelector('#unpaid-interest-fields');
const payoutInterestFields = document.querySelector('#payout-interest-fields');
const brokerTransactionFee = document.querySelector('#broker-transaction-fee');
const csvFileInput = document.querySelector('#csv-file');
const csvDropzone = document.querySelector('#csv-dropzone');
const csvFileName = document.querySelector('#csv-file-name');
const calculateButton = document.querySelector('#calculate-button');
const formatEuro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const formatNumber = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 6 });
const formatDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const formatDataUpdatedAt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
let activeCharts = [];
let importedCsvRows = [];
let marketDataPromise;
const marketDataVersion = new URL(import.meta.url).searchParams.get('v') ?? '';

function today() { return new Date().toISOString().slice(0, 10); }
function formatBreakEvenDuration(from, to) {
  return Interval.fromDateTimes(DateTime.fromISO(from, { zone: 'utc' }), DateTime.fromISO(to, { zone: 'utc' }))
    .toDuration(['years', 'months', 'days'])
    .toHuman({ listStyle: 'long', unitDisplay: 'long', showZeros: false });
}
function setStatus(message, type = '', isEmptyState = false) { status.textContent = message; status.className = `status ${type}`; status.dataset.emptyState = String(isEmptyState); }
function hasValidFlows() {
  const flows = getFlows();
  return flows.length > 0 && flows.every((flow) => flow.date && Number.isFinite(flow.amount) && flow.amount > 0);
}
function selectedInterestMode() { return interestModeInputs.find((input) => input.checked).value; }
function syncInterestMode() {
  const isPayout = selectedInterestMode() === 'payout';
  unpaidInterestFields.hidden = isPayout;
  payoutInterestFields.hidden = !isPayout;
}
function updateCalculateButtonState() { calculateButton.disabled = !hasValidFlows(); }
function updateEmptyFlowStatus() {
  const hasInflow = getFlows().some((flow) => flow.type === 'inflow' && flow.date && flow.amount > 0);
  if (hasInflow && status.dataset.emptyState === 'true') setStatus('');
  if (!hasInflow && (!status.textContent || status.dataset.emptyState === 'true')) setStatus('Add at least one inflow to start.', '', true);
}
function addFlow(flow = { date: today(), type: 'inflow', amount: '' }) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector('.flow-row');
  row.querySelector('.flow-date').value = flow.date;
  row.querySelector('.flow-type').value = flow.type;
  row.querySelector('.flow-amount').value = flow.amount;
  row.querySelector('.delete-button').addEventListener('click', () => { row.remove(); saveFlows(); updateEmptyFlowStatus(); updateCalculateButtonState(); });
  const updateFlow = () => { saveFlows(); updateEmptyFlowStatus(); updateCalculateButtonState(); };
  row.querySelectorAll('input, select').forEach((control) => control.addEventListener('input', updateFlow));
  row.querySelectorAll('select').forEach((control) => control.addEventListener('change', updateFlow));
  flowsElement.append(fragment);
  updateCalculateButtonState();
}
function getFlows() {
  return [...document.querySelectorAll('.flow-row')].map((row) => ({ date: row.querySelector('.flow-date').value, type: row.querySelector('.flow-type').value, amount: Number(row.querySelector('.flow-amount').value) }));
}
function saveFlows() { localStorage.setItem(storageKey, JSON.stringify(getFlows())); }
function syncCapitalGainsExemption() {
  capitalGainsExemption.disabled = reyndersTax.checked;
}
function saveSettings() { localStorage.setItem(settingsStorageKey, JSON.stringify({ applyCapitalGainsExemption: capitalGainsExemption.checked, applyReyndersTax: reyndersTax.checked, buyWholeSharesOnly: buyWholeSharesOnly.checked, interestMode: selectedInterestMode(), unpaidAccruedInterest: unpaidAccruedInterest.value, interestPayoutDate: interestPayoutDate.value, interestPayoutAmount: interestPayoutAmount.value, brokerTransactionFee: brokerTransactionFee.value })); }
function restoreSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(settingsStorageKey));
    capitalGainsExemption.checked = settings?.applyCapitalGainsExemption ?? true;
    reyndersTax.checked = settings?.applyReyndersTax ?? false;
    syncCapitalGainsExemption();
    buyWholeSharesOnly.checked = settings?.buyWholeSharesOnly ?? true;
    unpaidAccruedInterest.value = settings?.unpaidAccruedInterest ?? '';
    interestPayoutDate.value = settings?.interestPayoutDate ?? '';
    interestPayoutAmount.value = settings?.interestPayoutAmount ?? '';
    const interestMode = settings?.interestMode ?? (interestPayoutDate.value || interestPayoutAmount.value ? 'payout' : 'accrued');
    interestModeInputs.find((input) => input.value === interestMode).checked = true;
    syncInterestMode();
    brokerTransactionFee.value = settings?.brokerTransactionFee ?? 0;
  } catch { localStorage.removeItem(settingsStorageKey); }
}
function restoreFlows() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length) return saved.forEach(addFlow);
  } catch { localStorage.removeItem(storageKey); }
  addFlow();
}
function optionForColumn(column, selected) {
  const option = document.createElement('option');
  option.value = column;
  option.textContent = column;
  option.selected = column === selected;
  return option;
}
function showCsvMapping(rows, headers) {
  const dateColumn = document.querySelector('#csv-date-column');
  const amountColumn = document.querySelector('#csv-amount-column');
  const dateFormat = document.querySelector('#csv-date-format');
  const detected = detectCsvMapping(rows, headers);
  dateColumn.replaceChildren(...headers.map((header) => optionForColumn(header, detected.dateColumn)));
  amountColumn.replaceChildren(...headers.map((header) => optionForColumn(header, detected.amountColumn)));
  dateFormat.value = detected.dateFormat;
  importedCsvRows = rows;
  document.querySelector('#csv-preview').textContent = `${rows.length} rows ready to import.`;
  document.querySelector('#csv-import-button').textContent = `Add ${rows.length} cash flows`;
  document.querySelector('#csv-mapping').hidden = false;
}
function readCsvFile(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: 'greedy',
    complete: ({ data, meta, errors }) => {
      if (errors.length || !meta.fields?.length) {
        setStatus('The CSV could not be read. Check its delimiter and header row.', 'error');
        return;
      }
      showCsvMapping(data, meta.fields);
    },
    error: () => setStatus('The CSV could not be read.', 'error')
  });
}
function loadCsvFile(file) {
  if (!file || (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv')) {
    setStatus('Choose or drop a CSV file.', 'error');
    return;
  }
  csvFileName.textContent = file.name;
  readCsvFile(file);
}
function resetCsvImport() {
  importedCsvRows = [];
  csvFileInput.value = '';
  csvFileName.textContent = 'or drop a CSV file here';
  document.querySelector('#csv-date-column').replaceChildren();
  document.querySelector('#csv-amount-column').replaceChildren();
  document.querySelector('#csv-preview').textContent = '';
  document.querySelector('#csv-import-button').textContent = 'Add imported cash flows';
  document.querySelector('#csv-mapping').hidden = true;
}
function removeEmptyStarterFlow() {
  const rows = [...flowsElement.querySelectorAll('.flow-row')];
  if (rows.length !== 1) return;
  const row = rows[0];
  if (row.querySelector('.flow-date').value === today() && row.querySelector('.flow-type').value === 'inflow' && !row.querySelector('.flow-amount').value) row.remove();
}
function appendImportedFlows() {
  const { flows, invalidRows } = mapImportedRows(importedCsvRows, {
    dateColumn: document.querySelector('#csv-date-column').value,
    amountColumn: document.querySelector('#csv-amount-column').value,
    dateFormat: document.querySelector('#csv-date-format').value
  });
  if (!flows.length) throw new Error('No valid cash flows were found with this mapping.');
  removeEmptyStarterFlow();
  flows.forEach(addFlow);
  saveFlows();
  resetCsvImport();
  setStatus(`Added ${flows.length} cash flows.${invalidRows.length ? ` Skipped CSV rows ${invalidRows.join(', ')}.` : ''}`, invalidRows.length ? 'error' : 'success');
}
function clearAllData() {
  if (!window.confirm('Clear all saved cash flows, settings, pending CSV data, and results? This cannot be undone.')) return;
  localStorage.removeItem(storageKey);
  localStorage.removeItem(settingsStorageKey);
  flowsElement.replaceChildren();
  addFlow();
  capitalGainsExemption.checked = true;
  reyndersTax.checked = false;
  syncCapitalGainsExemption();
  buyWholeSharesOnly.checked = true;
  unpaidAccruedInterest.value = '';
  interestPayoutDate.value = '';
  interestPayoutAmount.value = '';
  interestModeInputs.find((input) => input.value === 'accrued').checked = true;
  syncInterestMode();
  brokerTransactionFee.value = 0;
  resetCsvImport();
  activeCharts.forEach((chart) => chart.remove());
  activeCharts = [];
  document.querySelector('#results').hidden = true;
  setStatus('All locally saved cash flows and settings were cleared.', 'success');
}
function showResult(result, metadata) {
  const showCgt = !reyndersTax.checked;
  const showReyndersTax = reyndersTax.checked;
  const showExoneratedCgt = capitalGainsExemption.checked && !reyndersTax.checked;
  document.querySelector('#results').hidden = false;
  document.querySelector('#cgt-heading').hidden = !showCgt;
  document.querySelector('#reynders-tax-heading').hidden = !showReyndersTax;
  document.querySelector('#exonerated-cgt-heading').hidden = !showExoneratedCgt;
  document.querySelector('#valuation-date').textContent = result.valuation.date;
  document.querySelector('#price-source').textContent = `Data last updated ${formatDataUpdatedAt.format(new Date(metadata.cachedAt))}`;
  document.querySelector('#net-value').textContent = formatEuro.format(result.netLiquidationValue);
  document.querySelector('#gross-value').textContent = formatEuro.format(result.grossValue);
  document.querySelector('#units').textContent = `${formatNumber.format(result.units)} CSH2 units${result.availableCash ? ` · ${formatEuro.format(result.availableCash)} cash` : ''}`;
  document.querySelector('#paid-taxes').textContent = formatEuro.format(result.paidTob + result.paidCgt + result.paidReyndersTax);
  document.querySelector('#paid-tax-detail').textContent = `TOB ${formatEuro.format(result.paidTob)} · ${reyndersTax.checked ? `Reynders Tax ${formatEuro.format(result.paidReyndersTax)}` : `CGT ${formatEuro.format(result.paidCgt)}`}`;
  document.querySelector('#terminal-taxes').textContent = formatEuro.format(result.terminalTob + result.terminalCgt + result.terminalReyndersTax);
  document.querySelector('#terminal-tax-detail').textContent = `TOB ${formatEuro.format(result.terminalTob)} · ${reyndersTax.checked ? `Reynders Tax ${formatEuro.format(result.terminalReyndersTax)}` : `CGT ${formatEuro.format(result.terminalCgt)}`}`;
  document.querySelector('#broker-fees').textContent = formatEuro.format(result.paidBrokerFees + result.terminalBrokerFee);
  document.querySelector('#broker-fee-detail').textContent = `Paid ${formatEuro.format(result.paidBrokerFees)} · if sold today ${formatEuro.format(result.terminalBrokerFee)}`;
  const missedHeading = document.querySelector('#missed-heading');
  const missedShare = document.querySelector('#missed-share');
  const breakEvenEstimate = document.querySelector('#break-even-estimate');
  const isBelowBreakEven = result.missedAmount < 0;
  document.querySelector('.missed-result').classList.toggle('negative', isBelowBreakEven);
  missedHeading.textContent = isBelowBreakEven ? 'CSH2 would currently be below your net input by' : 'You missed out on';
  document.querySelector('#missed-amount').textContent = formatEuro.format(Math.abs(result.missedAmount));
  missedShare.textContent = result.missedSharePercent === undefined ? 'Your net cash input is zero.' : isBelowBreakEven ? `a shortfall equal to ${Math.abs(result.missedSharePercent).toLocaleString('nl-BE', { maximumFractionDigits: 2 })}% of your current balance + unpaid interest` : `which is ${result.missedSharePercent.toLocaleString('nl-BE', { maximumFractionDigits: 2 })}% of your current balance + unpaid interest`;
  if (isBelowBreakEven && result.breakEvenEstimate) {
    breakEvenEstimate.hidden = false;
    breakEvenEstimate.textContent = `Estimated break-even in ${formatBreakEvenDuration(result.valuation.date, result.breakEvenEstimate.date)}. Assumes the CSH2 price keeps its ${result.breakEvenEstimate.trendDays}-day trend (${result.breakEvenEstimate.trendReturnPercent.toLocaleString('nl-BE', { maximumFractionDigits: 2 })}%).`;
  } else if (isBelowBreakEven) {
    breakEvenEstimate.hidden = false;
    breakEvenEstimate.textContent = 'Break-even can’t be estimated from the recent price trend.';
  } else {
    breakEvenEstimate.hidden = true;
  }
  const interestPayoutAssessment = document.querySelector('#interest-payout-assessment');
  if (result.interestPayoutAssessment) {
    interestPayoutAssessment.hidden = false;
    const { preferred, difference, immediateValue, payoutDate, trendDays, trendReturnPercent, waitingValue } = result.interestPayoutAssessment;
    document.querySelector('#interest-payout-decision').textContent = preferred === 'either' ? 'The projected values are effectively the same.' : `${preferred === 'move now' ? 'Moving now' : `Waiting until ${formatDate.format(new Date(`${payoutDate}T00:00:00Z`))}`} is projected to be ${formatEuro.format(Math.abs(difference))} better.`;
    document.querySelector('#interest-payout-detail').textContent = `Projected net value on ${formatDate.format(new Date(`${payoutDate}T00:00:00Z`))}: move now ${formatEuro.format(immediateValue)} · wait ${formatEuro.format(waitingValue)}. Assumes CSH2 keeps its ${trendDays}-day trend (${trendReturnPercent.toLocaleString('nl-BE', { maximumFractionDigits: 2 })}%).`;
  } else {
    interestPayoutAssessment.hidden = true;
  }
  document.querySelector('#ledger').innerHTML = result.entries.map((entry) => `<tr><td>${entry.date}</td><td>${entry.type === 'inflow' ? 'Inflow / buy' : 'Outflow / sell'}</td><td>${formatEuro.format(entry.amount)}</td><td>${formatEuro.format(entry.price)}${entry.priceKind === 'close' ? '' : ` (${entry.priceKind})`}</td><td>${formatNumber.format(entry.units)}</td><td>${formatEuro.format(entry.remainingCash)}</td><td>${formatEuro.format(entry.brokerFee)}</td><td>${formatEuro.format(entry.tob)}</td><td class="cgt"${showCgt ? '' : ' hidden'}>${entry.cgt ? formatEuro.format(entry.cgt) : '—'}</td><td class="reynders-tax"${showReyndersTax ? '' : ' hidden'}>${entry.reyndersTax ? formatEuro.format(entry.reyndersTax) : '—'}</td><td class="exonerated-cgt"${showExoneratedCgt ? '' : ' hidden'}>${entry.exoneratedCgt ? formatEuro.format(entry.exoneratedCgt) : '—'}</td></tr>`).join('');
}
function makeChart(containerId) {
  const container = document.querySelector(containerId);
  container.replaceChildren();
  const chart = createChart(container, {
    width: container.clientWidth,
    height: 290,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#5b746c' },
    grid: { vertLines: { color: '#edf1ed' }, horzLines: { color: '#edf1ed' } },
    rightPriceScale: { borderColor: '#cbd8d1' },
    timeScale: { borderColor: '#cbd8d1', timeVisible: false }
  });
  activeCharts.push(chart);
  return chart;
}
function addSeries(chart, data, color) {
  const series = chart.addSeries(LineSeries, { color, lineWidth: 2, lastValueVisible: true, priceFormat: { type: 'custom', formatter: (value) => `${value.toFixed(2)}%` } });
  series.setData(data);
  return series;
}
function loadMarketData() {
  if (!marketDataPromise) {
    marketDataPromise = Promise.all([fetch(`./data/csh2-prices.json?v=${marketDataVersion}`), fetch(`./data/overnight-rates.json?v=${marketDataVersion}`)]).then(async ([priceResponse, rateResponse]) => {
      const data = await priceResponse.json();
      if (!priceResponse.ok) throw new Error(data.error ?? 'The published CSH2 price data could not be loaded.');
      const rateData = rateResponse.ok ? await rateResponse.json() : { rates: {} };
      return { data, rateData };
    }).catch((error) => {
      marketDataPromise = undefined;
      throw error;
    });
  }
  return marketDataPromise;
}
function renderCharts(flows, prices, rates, from, to, options) {
  activeCharts.forEach((chart) => chart.remove());
  activeCharts = [];
  const returnChart = makeChart('#return-chart');
  const csh2ReturnSeries = buildBacktestReturnSeries(flows, prices, options).map((point) => ({ time: point.date, value: point.value }));
  const overnightReturnSeries = buildOvernightBenchmarkReturnSeries(flows, prices, rates, to, from, to, options).map((point) => ({ time: point.date, value: point.value }));
  addSeries(returnChart, csh2ReturnSeries, '#1d6a54');
  addSeries(returnChart, overnightReturnSeries, '#c7943c');
  returnChart.timeScale().fitContent();
  const rateChart = makeChart('#rate-chart');
  const csh2RateSeries = buildTrailingAnnualizedCsh2ReturnSeries(prices, from, to).map((point) => ({ time: point.date, value: point.value }));
  const overnightRateSeries = buildTrailingAnnualizedOvernightBenchmarkReturnSeries(rates, from, to).map((point) => ({ time: point.date, value: point.value }));
  addSeries(rateChart, csh2RateSeries, '#1d6a54');
  addSeries(rateChart, overnightRateSeries, '#c7943c');
  rateChart.timeScale().fitContent();
}
async function calculate() {
  const flows = getFlows();
  saveFlows();
  saveSettings();
  if (!flows.length || flows.some((flow) => !flow.date || !Number.isFinite(flow.amount) || flow.amount <= 0)) throw new Error('Add a date and a positive EUR amount to every cash flow.');
  const from = [...flows].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  setStatus('Loading the latest published CSH2 data…');
  const { data, rateData } = await loadMarketData();
  const valuationDate = latestAvailablePriceDate(data.prices, today());
  if (!valuationDate) throw new Error('The published CSH2 price data contains no closing prices.');
  const isPayout = selectedInterestMode() === 'payout';
  const options = { applyCapitalGainsExemption: capitalGainsExemption.checked, applyReyndersTax: reyndersTax.checked, buyWholeSharesOnly: buyWholeSharesOnly.checked, unpaidAccruedInterest: isPayout ? 0 : Number(unpaidAccruedInterest.value || 0), brokerTransactionFee: Number(brokerTransactionFee.value || 0) };
  const result = runBacktest(flows, data.prices, valuationDate, options);
  result.interestPayoutAssessment = isPayout ? assessInterestPayoutTiming(flows, data.prices, valuationDate, options, interestPayoutDate.value, Number(interestPayoutAmount.value || 0)) : undefined;
  result.breakEvenEstimate = estimateBreakEvenDate(flows, data.prices, valuationDate, options);
  showResult(result, data);
  renderCharts(flows, data.prices, rateData.rates, from, valuationDate, options);
  setStatus(`Calculated using the ${result.valuation.date} close of ${formatEuro.format(result.valuation.price)}.`, 'success');
}
document.querySelector('#add-button').addEventListener('click', () => addFlow());
document.querySelector('#clear-data-button').addEventListener('click', clearAllData);
csvFileInput.addEventListener('change', ({ target }) => loadCsvFile(target.files[0]));
csvDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  csvDropzone.classList.add('dragging');
});
csvDropzone.addEventListener('dragleave', () => csvDropzone.classList.remove('dragging'));
csvDropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  csvDropzone.classList.remove('dragging');
  loadCsvFile(event.dataTransfer.files[0]);
});
document.querySelector('#csv-import-button').addEventListener('click', () => {
  try { appendImportedFlows(); } catch (error) { setStatus(error.message, 'error'); }
});
document.querySelector('#example-button').addEventListener('click', () => {
  flowsElement.replaceChildren();
  [{ date: '2025-04-01', type: 'inflow', amount: 5000 }, { date: '2025-10-01', type: 'inflow', amount: 750 }, { date: '2026-04-01', type: 'outflow', amount: 600 }].forEach(addFlow);
  saveFlows();
  setStatus('Example loaded. Refresh prices & calculate when ready.');
});
calculateButton.addEventListener('click', async () => {
  try { await calculate(); } catch (error) { setStatus(error.message, 'error'); document.querySelector('#results').hidden = true; }
});
capitalGainsExemption.addEventListener('change', () => {
  saveSettings();
  if (!document.querySelector('#results').hidden) {
    calculate().catch((error) => setStatus(error.message, 'error'));
  }
});
reyndersTax.addEventListener('change', () => {
  syncCapitalGainsExemption();
  saveSettings();
  if (!document.querySelector('#results').hidden) {
    calculate().catch((error) => setStatus(error.message, 'error'));
  }
});
buyWholeSharesOnly.addEventListener('change', () => {
  saveSettings();
  if (!document.querySelector('#results').hidden) {
    calculate().catch((error) => setStatus(error.message, 'error'));
  }
});
function refreshInterestResult() {
  saveSettings();
  updateCalculateButtonState();
  if (!document.querySelector('#results').hidden) {
    calculate().catch((error) => setStatus(error.message, 'error'));
  }
}
unpaidAccruedInterest.addEventListener('change', () => {
  refreshInterestResult();
});
interestModeInputs.forEach((input) => input.addEventListener('change', () => {
  syncInterestMode();
  refreshInterestResult();
}));
interestPayoutDate.addEventListener('change', () => {
  refreshInterestResult();
});
interestPayoutAmount.addEventListener('change', () => {
  refreshInterestResult();
});
brokerTransactionFee.addEventListener('change', saveSettings);
restoreFlows();
restoreSettings();
syncInterestMode();
updateEmptyFlowStatus();
updateCalculateButtonState();
loadMarketData().catch(() => {});
