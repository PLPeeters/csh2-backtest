<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  import type { CalculationSettings } from '../types';
  import { calculateHistoricalComparison as defaultCalculateHistoricalComparison, type HistoricalComparisonResult } from '../services/historical-comparison';
  import type { HistoricalRateRow } from '../services/historical-savings';
  import { parseHistoricalSavingsTable, readHistoricalSavingsRatesFromClipboard, type HistoricalSavingsClipboardTable, type HistoricalSavingsColumnMapping, type HistoricalSavingsClipboardResult } from '../services/historical-savings-clipboard';
  import { loadHistoricalSavingsState, saveHistoricalSavingsState, defaultSettings } from '../services/storage';
  import { loadMarketData } from '../services/market-data';
  import { latestAvailablePriceDate } from '../../static-market-data.mjs';
  import type { HistoricalComparisonScenario } from '../services/historical-comparison';
  export interface HistoricalSavingsDisplay {
    from: string;
    to: string;
    scenario: HistoricalComparisonScenario;
  }
  let { controller, active = false, selectedScenario = 'monthly', onResult, onSubmitReady, onLoadingChange, onEndDateChangeReady, onEndDateChange, loadMarketDataFn = loadMarketData, calculateComparison = defaultCalculateHistoricalComparison, readClipboardRates = readHistoricalSavingsRatesFromClipboard }: { controller?: BacktestController; active?: boolean; selectedScenario?: 'monthly' | 'lumpSum'; onResult?: (display: HistoricalSavingsDisplay | undefined) => void; onSubmitReady?: (submit: () => Promise<void>) => void; onLoadingChange?: (loading: boolean) => void; onEndDateChangeReady?: (setEndDate: (value: string) => void) => void; onEndDateChange?: (value: string) => void; loadMarketDataFn?: typeof loadMarketData; calculateComparison?: typeof defaultCalculateHistoricalComparison; readClipboardRates?: typeof readHistoricalSavingsRatesFromClipboard } = $props();
  const storage = localStorage;
  const today = new Date().toISOString().slice(0, 10);
  const saved = loadHistoricalSavingsState(storage, today);
  let rates = $state<HistoricalRateRow[]>(saved.rates);
  let endDate = $state(saved.endDate);
  let calculated = $state(false);
  let loading = $state(false);
  let importing = $state(false);
  let pendingImport = $state<{ table: HistoricalSavingsClipboardTable; mapping: Partial<HistoricalSavingsColumnMapping> }>();
  let comparison = $state<HistoricalComparisonResult>();
  let error = $state('');
  let calculatedSettingsSignature = $state('');
  let resultEffectInitialized = false;
  const settings = (): CalculationSettings => controller?.settings ?? defaultSettings();
  const historicalSettingsSignature = (value: CalculationSettings) => JSON.stringify({
    applyCapitalGainsExemption: value.applyCapitalGainsExemption,
    applyReyndersTax: value.applyReyndersTax,
    buyWholeSharesOnly: value.buyWholeSharesOnly,
    brokerTransactionFee: value.brokerTransactionFee,
    csh2RateScenario: value.csh2RateScenario,
    returnMode: value.returnMode
  });
  let previousSettingsSignature = historicalSettingsSignature(settings());
  const persist = () => saveHistoricalSavingsState(storage, { rates, endDate });
  const markStale = () => { calculated = false; comparison = undefined; calculatedSettingsSignature = ''; error = ''; persist(); };
  const updateRate = (id: string, key: 'date' | 'baseRate' | 'fidelityPremium', value: string) => { rates = rates.map((row) => row.id === id ? { ...row, [key]: value } : row); markStale(); };
  const addRate = () => { rates = [...rates, { id: `historical-rate-${Date.now().toString(36)}-${rates.length}`, date: rates.at(-1)?.date ?? today, baseRate: '', fidelityPremium: '' }]; markStale(); };
  const removeRate = (id: string) => { if (rates.length === 1) return; rates = rates.filter((row) => row.id !== id); markStale(); };
  const setEndDate = (value: string) => { endDate = value; markStale(); };
  const applyImportedRates = (imported: Omit<HistoricalRateRow, 'id'>[]) => {
    const idPrefix = `historical-rate-${Date.now().toString(36)}`;
    rates = [...imported].sort((left, right) => left.date.localeCompare(right.date)).map((row, index) => ({ ...row, id: `${idPrefix}-${index}` }));
    pendingImport = undefined;
    markStale();
  };
  const importRatesFromClipboard = async () => {
    if (importing) return;
    markStale();
    importing = true;
    try {
      const result: HistoricalSavingsClipboardResult = await readClipboardRates();
      if (Array.isArray(result)) applyImportedRates(result);
      else pendingImport = { table: result.table, mapping: { ...result.table.suggestedMapping } };
    } catch (cause) {
      calculated = true;
      error = cause instanceof Error ? cause.message : 'Historical rates could not be imported from the clipboard.';
    } finally {
      importing = false;
    }
  };
  const setImportMapping = (kind: keyof HistoricalSavingsColumnMapping, value: string) => {
    if (!pendingImport) return;
    pendingImport = { ...pendingImport, mapping: { ...pendingImport.mapping, [kind]: value === '' ? undefined : Number(value) } };
    error = '';
  };
  const confirmMappedImport = () => {
    if (!pendingImport) return;
    const mapping = pendingImport.mapping;
    const indexes = [mapping.date, mapping.base, mapping.premium];
    if (indexes.some((index) => index === undefined) || new Set(indexes).size !== indexes.length) {
      error = 'Choose a different clipboard column for each field.';
      calculated = true;
      return;
    }
    try {
      applyImportedRates(parseHistoricalSavingsTable(pendingImport.table, mapping as HistoricalSavingsColumnMapping));
    } catch (cause) {
      calculated = true;
      error = cause instanceof Error ? cause.message : 'Historical rates could not be imported from the clipboard.';
    }
  };
  const cancelMappedImport = () => { pendingImport = undefined; error = ''; };
  const calculate = async () => { calculated = true; loading = true; onLoadingChange?.(true); comparison = undefined; calculatedSettingsSignature = ''; error = ''; try { const market = await loadMarketDataFn(); const latest = latestAvailablePriceDate(market.data.prices, today); if (latest && endDate === today && rates.length === 1 && rates[0].date === today) { rates = rates.map((row) => ({ ...row, date: latest })); endDate = latest; persist(); } const currentSettings = settings(); comparison = calculateComparison({ rates, endDate }, currentSettings, market); calculatedSettingsSignature = historicalSettingsSignature(currentSettings); } catch (cause) { error = cause instanceof Error ? cause.message : 'Historical comparison could not be calculated.'; } finally { loading = false; onLoadingChange?.(false); } };
  $effect(() => { onSubmitReady?.(calculate); });
  $effect(() => { onEndDateChangeReady?.(setEndDate); });
  $effect(() => { onEndDateChange?.(endDate); });
  $effect(() => {
    const currentSettingsSignature = historicalSettingsSignature(settings());
    const settingsChanged = currentSettingsSignature !== previousSettingsSignature;
    previousSettingsSignature = currentSettingsSignature;
    if (active && settingsChanged && calculated && !loading) void calculate();
  });
  $effect(() => {
    const currentComparison = comparison;
    const currentSettingsSignature = calculatedSettingsSignature;
    if (!resultEffectInitialized) { resultEffectInitialized = true; return; }
    onResult?.(currentComparison && currentSettingsSignature === historicalSettingsSignature(settings()) ? { from: currentComparison.from, to: currentComparison.to, scenario: currentComparison[selectedScenario] } : undefined);
  });
</script>

<section class="historical-savings" aria-labelledby="historical-savings-heading">
  <div class="section-title"><div><p class="eyebrow">Historical savings rates</p><h3 id="historical-savings-heading">Compare a Belgian savings account with CSH2 and €STR</h3></div></div>
  <p class="historical-intro">Enter each rate change. The selected deposit schedule is compared with the same CSH2 transactions and gross €STR benchmark over an identical date range. Savings calculations use ACT/365 daily base interest, base credit on 1 January, and locked fidelity premiums paid quarterly.</p>
  <details class="cash-flow-disclosure historical-rate-disclosure" open>
    <summary class="disclosure-summary"><span>Historical rate changes</span><small>{rates.length} {rates.length === 1 ? 'rate' : 'rates'}</small></summary>
    <div class="cash-flow-disclosure-content">
      <div class="historical-rate-head" aria-hidden="true"><span>Effective date</span><span>Base annual rate (%)</span><span>Fidelity premium (%)</span><span></span></div>
      <div class="historical-rate-list" aria-live="polite">{#each rates as row, index (row.id)}<div class="historical-rate-row"><label for={`historical-rate-${row.id}-date`}><span>Rate {index + 1} effective date</span><input id={`historical-rate-${row.id}-date`} aria-label={`Rate ${index + 1} effective date`} type="date" required value={row.date} onchange={(event) => updateRate(row.id, 'date', (event.currentTarget as HTMLInputElement).value)} /></label><label for={`historical-rate-${row.id}-base`}><span>Rate {index + 1} base annual rate (%)</span><input id={`historical-rate-${row.id}-base`} aria-label={`Rate ${index + 1} base annual rate (%)`} type="number" step="0.01" min="-99.99" placeholder="e.g. 0.50" value={row.baseRate} oninput={(event) => updateRate(row.id, 'baseRate', (event.currentTarget as HTMLInputElement).value)}/></label><label for={`historical-rate-${row.id}-fidelity`}><span>Rate {index + 1} fidelity premium (%)</span><input id={`historical-rate-${row.id}-fidelity`} aria-label={`Rate ${index + 1} fidelity premium (%)`} type="number" step="0.01" min="0" placeholder="e.g. 1.50" value={row.fidelityPremium} oninput={(event) => updateRate(row.id, 'fidelityPremium', (event.currentTarget as HTMLInputElement).value)}/></label><button class="delete-button" type="button" aria-label={`Remove historical rate ${index + 1}`} disabled={rates.length === 1} onclick={() => removeRate(row.id)}>×</button></div>{/each}</div>
      <div class="controls historical-rate-actions"><button class="quiet" type="button" disabled={importing} onclick={() => void importRatesFromClipboard()}>{importing ? 'Importing…' : 'Import from clipboard'}</button><button class="quiet" type="button" onclick={addRate}>Add rate change</button></div>
      {#if pendingImport}
        <div class="historical-import-mapping" role="dialog" aria-labelledby="historical-import-mapping-heading">
          <h4 id="historical-import-mapping-heading">Map clipboard columns</h4>
          <p>Select which copied column contains each required field, then confirm the import.</p>
          <div class="historical-import-fields">
            <label for="historical-import-date">Effective date<select id="historical-import-date" aria-label="Clipboard effective date column" value={pendingImport.mapping.date ?? ''} onchange={(event) => setImportMapping('date', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
            <label for="historical-import-base">Base annual rate<select id="historical-import-base" aria-label="Clipboard base annual rate column" value={pendingImport.mapping.base ?? ''} onchange={(event) => setImportMapping('base', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
            <label for="historical-import-premium">Fidelity premium<select id="historical-import-premium" aria-label="Clipboard fidelity premium column" value={pendingImport.mapping.premium ?? ''} onchange={(event) => setImportMapping('premium', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
          </div>
          <div class="historical-import-preview" aria-label="Clipboard table preview"><div class="historical-import-preview-row historical-import-preview-head" style={`--historical-import-columns: ${pendingImport.table.columns.length}`}>{#each pendingImport.table.columns as column}<span>{column}</span>{/each}</div>{#each pendingImport.table.rows.slice(0, 3) as row}<div class="historical-import-preview-row" style={`--historical-import-columns: ${pendingImport.table.columns.length}`}>{#each pendingImport.table.columns as column, index}<span aria-label={column}>{row[index] ?? ''}</span>{/each}</div>{/each}</div>
          {#if calculated && error}<p class="historical-error" role="alert">{error}</p>{/if}
          <div class="controls historical-import-actions"><button type="button" onclick={confirmMappedImport}>Import mapped rates</button><button class="quiet" type="button" onclick={cancelMappedImport}>Cancel</button></div>
        </div>
      {/if}
    </div>
  </details>
  {#if calculated && error}<p class="historical-error" role="alert">{error}</p>{/if}
</section>

<style>
  .historical-savings { display: grid; gap: 16px; }.historical-intro { margin: 0; color: #617169; font-size: .82rem; line-height: 1.5; }.historical-rate-row label { display: block; min-width: 0; color: #64766d; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.historical-rate-head, .historical-rate-row { display: grid; grid-template-columns: 1.15fr 1fr 1fr 40px; align-items: center; gap: 12px; }.historical-rate-head { color: #64766d; font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }.historical-rate-row { margin-top: 10px; }.historical-rate-row input { font-family: inherit; font-size: 1rem; font-weight: 400; letter-spacing: normal; text-transform: none; }.historical-rate-row label > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }.historical-rate-actions { justify-content: center; flex-wrap: wrap; margin-top: 14px; }.historical-error { margin: 0; border-left: 3px solid #a52f24; background: #fff5f3; padding: 10px 12px; color: #8d2f27; font-size: .85rem; }
  .historical-import-mapping { display: grid; gap: 12px; margin-top: 16px; border: 1px solid #dce5df; border-radius: 8px; padding: 14px; background: #f7faf8; }.historical-import-mapping h4, .historical-import-mapping p { margin: 0; }.historical-import-mapping h4 { color: #173d2d; font-size: .95rem; }.historical-import-mapping p { color: #617169; font-size: .82rem; }.historical-import-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.historical-import-fields label { display: grid; gap: 5px; color: #64766d; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.historical-import-fields select { min-width: 0; padding: 9px; font: inherit; color: #26332d; text-transform: none; }.historical-import-preview { overflow-x: auto; border: 1px solid #e1e7e3; background: white; }.historical-import-preview-row { display: grid; grid-template-columns: repeat(var(--historical-import-columns, 1), minmax(100px, 1fr)); min-width: max-content; }.historical-import-preview-row span { padding: 7px 9px; border-right: 1px solid #e1e7e3; font-size: .78rem; }.historical-import-preview-head { background: #edf3ef; color: #52675c; font-weight: 700; }.historical-import-actions { justify-content: flex-start; margin-top: 0; }
  @media (max-width: 760px) { .historical-rate-head { display: none; }.historical-rate-row { grid-template-columns: minmax(0, 1fr) 40px; padding: 10px; border: 1px solid #e1e7e3; border-radius: 7px; background: #fbfcfb; }.historical-rate-row label { grid-column: 1; }.historical-rate-row label > span { position: static; display: block; width: auto; height: auto; margin-bottom: 6px; overflow: visible; clip: auto; }.historical-rate-row .delete-button { grid-column: 2; grid-row: 1 / span 3; height: 42px; align-self: center; }.historical-import-fields { grid-template-columns: 1fr; } }
</style>
