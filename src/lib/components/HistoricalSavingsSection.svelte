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

<section class="historical-savings grid gap-4" aria-labelledby="historical-savings-heading">
  <div class="section-title flex items-center justify-between pb-5 gap-5 [@media(width<=760px)]:items-start [@media(width<=760px)]:flex-col [@media(width<=760px)]:gap-3"><div><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Historical savings rates</p><h3 id="historical-savings-heading">Compare a Belgian savings account with CSH2 and €STR</h3></div></div>
  <p class="historical-intro text-[#617169] text-[0.82rem] leading-[1.5] m-0">Enter each rate change. The selected deposit schedule is compared with the same CSH2 transactions and gross €STR benchmark over an identical date range. Savings calculations use ACT/365 daily base interest, base credit on 1 January, and locked fidelity premiums paid quarterly.</p>
  <div class="historical-rate-heading flex items-center justify-between min-h-9.5 [border-bottom-width:1px] [border-bottom-style:solid] [border-bottom-color:var(--v2-border,_#d8e1db)] [color:var(--v2-navy,_#173d2d)] px-[11px] py-0 gap-3"><h4>Historical rate changes</h4><small>{rates.length} {rates.length === 1 ? 'rate' : 'rates'}</small></div>
  <div class="historical-rate-content">
      <div class="historical-rate-head grid grid-cols-[1.15fr_1fr_1fr_40px] items-center text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase [border-top-width:1px] [border-right-width:1px] [border-bottom-width:0px] [border-left-width:1px] [border-top-style:solid] [border-right-style:solid] [border-bottom-style:none] [border-left-style:solid] [border-top-color:var(--v2-border,_#d8e1db)] [border-right-color:var(--v2-border,_#d8e1db)] [border-bottom-color:currentcolor] [border-left-color:var(--v2-border,_#d8e1db)] [border-top-left-radius:4px] [border-top-right-radius:4px] [border-bottom-right-radius:0px] [border-bottom-left-radius:0px] pt-2 pb-[7px] bg-[#f7faf8] m-0 px-2.5 gap-3 [@media(width<=760px)]:hidden [@media(761px<=width<=1300px)]:grid-cols-[minmax(112px,_1.2fr)_minmax(0px,_1fr)_minmax(0px,_1fr)_24px] [@media(761px<=width<=1300px)]:gap-1 [@media(width>1300px)]:grid-cols-[minmax(120px,_1.2fr)_minmax(0px,_1fr)_minmax(0px,_1fr)_28px] [@media(width>1300px)]:gap-1.5 [@media(width>=761px)]:tracking-[0.06em] [@media(width>=761px)]:min-h-8" aria-hidden="true"><span>Effective from</span><span>Base rate (%)</span><span>Fidelity (%)</span><span></span></div>
      <div class="historical-rate-list" aria-live="polite">{#each rates as row, index (row.id)}<div class="historical-rate-row grid grid-cols-[1.15fr_1fr_1fr_40px] items-center [border-top-width:1px] [border-right-width:1px] [border-bottom-width:0px] [border-left-width:1px] [border-top-style:solid] [border-right-style:solid] [border-bottom-style:none] [border-left-style:solid] [border-top-color:var(--v2-border,_#d8e1db)] [border-right-color:var(--v2-border,_#d8e1db)] [border-bottom-color:currentcolor] [border-left-color:var(--v2-border,_#d8e1db)] [background:var(--v2-surface,_#fff)] m-0 px-2.5 py-[5px] gap-3 [@media(width<=760px)]:grid-cols-[minmax(0px,_1fr)_40px] [@media(width<=760px)]:[border-bottom-width:1px] [@media(width<=760px)]:[border-bottom-style:solid] [@media(width<=760px)]:[border-bottom-color:var(--v2-border,_#d8e1db)] [@media(width<=760px)]:[border-image-source:none] [@media(width<=760px)]:[border-image-slice:100%] [@media(width<=760px)]:[border-image-width:1] [@media(width<=760px)]:[border-image-outset:0] [@media(width<=760px)]:[border-image-repeat:stretch] [@media(width<=760px)]:mb-2 [@media(width<=760px)]:py-2.5 [@media(width<=760px)]:rounded-[4px] [@media(761px<=width<=1300px)]:grid-cols-[minmax(112px,_1.2fr)_minmax(0px,_1fr)_minmax(0px,_1fr)_24px] [@media(761px<=width<=1300px)]:px-1.5 [@media(761px<=width<=1300px)]:gap-1 [@media(width>1300px)]:grid-cols-[minmax(120px,_1.2fr)_minmax(0px,_1fr)_minmax(0px,_1fr)_28px] [@media(width>1300px)]:gap-1.5"><label for={`historical-rate-${row.id}-date`}><span>Rate {index + 1} effective date</span><input id={`historical-rate-${row.id}-date`} aria-label={`Rate ${index + 1} effective date`} type="date" required value={row.date} onchange={(event) => updateRate(row.id, 'date', (event.currentTarget as HTMLInputElement).value)} /></label><label for={`historical-rate-${row.id}-base`}><span>Rate {index + 1} base annual rate (%)</span><input id={`historical-rate-${row.id}-base`} aria-label={`Rate ${index + 1} base annual rate (%)`} type="number" step="0.01" min="-99.99" placeholder="e.g. 0.50" value={row.baseRate} oninput={(event) => updateRate(row.id, 'baseRate', (event.currentTarget as HTMLInputElement).value)}/></label><label for={`historical-rate-${row.id}-fidelity`}><span>Rate {index + 1} fidelity premium (%)</span><input id={`historical-rate-${row.id}-fidelity`} aria-label={`Rate ${index + 1} fidelity premium (%)`} type="number" step="0.01" min="0" placeholder="e.g. 1.50" value={row.fidelityPremium} oninput={(event) => updateRate(row.id, 'fidelityPremium', (event.currentTarget as HTMLInputElement).value)}/></label><button class="delete-button bg-[#fff7f6] text-[#913a31] text-[1.3rem] p-0 border-[#ead4d0]" type="button" aria-label={`Remove historical rate ${index + 1}`} disabled={rates.length === 1} onclick={() => removeRate(row.id)}>×</button></div>{/each}</div>
      <div class="controls historical-rate-actions grid items-center justify-between flex-wrap mt-[9px] grid-cols-[minmax(0px,_1fr)] gap-2 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col [@media(width<=760px)]:mt-2.5"><button class="historical-add-rate w-full min-h-9.5 bg-transparent [color:var(--v2-green,_#24644d)] border border-dashed [border-color:var(--v2-green,_#24644d)]" type="button" onclick={addRate}>Add rate change</button><button class="quiet historical-import-button bg-white text-[#285747] justify-self-start mb-2 border-[#cbd7d0]" type="button" disabled={importing} onclick={() => void importRatesFromClipboard()}>{importing ? 'Importing…' : 'Import from clipboard'}</button></div>
      {#if pendingImport}
        <div class="historical-import-mapping grid mt-4 bg-[#f7faf8] p-3.5 border border-solid border-[#dce5df] rounded-[8px] gap-3" role="dialog" aria-labelledby="historical-import-mapping-heading">
          <h4 id="historical-import-mapping-heading">Map clipboard columns</h4>
          <p>Select which copied column contains each required field, then confirm the import.</p>
          <div class="historical-import-fields grid grid-cols-3 gap-2.5 [@media(width<=760px)]:grid-cols-[1fr]">
            <label for="historical-import-date">Effective date<select id="historical-import-date" aria-label="Clipboard effective date column" value={pendingImport.mapping.date ?? ''} onchange={(event) => setImportMapping('date', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
            <label for="historical-import-base">Base annual rate<select id="historical-import-base" aria-label="Clipboard base annual rate column" value={pendingImport.mapping.base ?? ''} onchange={(event) => setImportMapping('base', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
            <label for="historical-import-premium">Fidelity premium<select id="historical-import-premium" aria-label="Clipboard fidelity premium column" value={pendingImport.mapping.premium ?? ''} onchange={(event) => setImportMapping('premium', (event.currentTarget as HTMLSelectElement).value)}><option value="">Choose a column</option>{#each pendingImport.table.columns as column, index}<option value={index}>{column}</option>{/each}</select></label>
          </div>
          <div class="historical-import-preview overflow-x-auto bg-white border border-solid border-[#e1e7e3]" aria-label="Clipboard table preview"><div class="historical-import-preview-row historical-import-preview-head grid grid-cols-[repeat(var(--historical-import-columns,_1),_minmax(100px,_1fr))] min-w-max bg-[#edf3ef] text-[#52675c] font-bold" style={`--historical-import-columns: ${pendingImport.table.columns.length}`}>{#each pendingImport.table.columns as column}<span>{column}</span>{/each}</div>{#each pendingImport.table.rows.slice(0, 3) as row}<div class="historical-import-preview-row grid grid-cols-[repeat(var(--historical-import-columns,_1),_minmax(100px,_1fr))] min-w-max" style={`--historical-import-columns: ${pendingImport.table.columns.length}`}>{#each pendingImport.table.columns as column, index}<span aria-label={column}>{row[index] ?? ''}</span>{/each}</div>{/each}</div>
          {#if calculated && error}<p class="historical-error [border-left-width:3px] [border-left-style:solid] [border-left-color:#a52f24] bg-[#fff5f3] text-[#8d2f27] text-[0.85rem] m-0 px-3 py-2.5" role="alert">{error}</p>{/if}
          <div class="controls historical-import-actions flex items-center justify-start mt-0 gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><button type="button" onclick={confirmMappedImport}>Import mapped rates</button><button class="quiet bg-white text-[#285747] border-[#cbd7d0]" type="button" onclick={cancelMappedImport}>Cancel</button></div>
        </div>
      {/if}
  </div>
  {#if calculated && error}<p class="historical-error [border-left-width:3px] [border-left-style:solid] [border-left-color:#a52f24] bg-[#fff5f3] text-[#8d2f27] text-[0.85rem] m-0 px-3 py-2.5" role="alert">{error}</p>{/if}
</section>

<style>

  .historical-rate-row label { display: block; min-width: 0; color: #64766d; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.historical-rate-row input { font-family: inherit; font-size: 1rem; font-weight: 400; letter-spacing: normal; text-transform: none; }.historical-rate-row label > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }.historical-import-mapping h4, .historical-import-mapping p { margin: 0; }.historical-import-mapping h4 { color: #173d2d; font-size: .95rem; }.historical-import-mapping p { color: #617169; font-size: .82rem; }.historical-import-fields label { display: grid; gap: 5px; color: #64766d; font-size: .7rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }.historical-import-fields select { min-width: 0; padding: 9px; font: inherit; color: #26332d; text-transform: none; }.historical-import-preview-row span { padding: 7px 9px; border-right: 1px solid #e1e7e3; font-size: .78rem; }
  @media (max-width: 760px) {.historical-rate-row label { grid-column: 1; }.historical-rate-row label > span { position: static; display: block; width: auto; height: auto; margin-bottom: 6px; overflow: visible; clip: auto; }.historical-rate-row .delete-button { grid-column: 2; grid-row: 1 / span 3; height: 42px; align-self: center; } }

  /* Compact ledger treatment shared in spirit with the cash-flow editor. */
  .historical-rate-heading h4 { margin: 0; font-size: .77rem; font-weight: 700; }
  .historical-rate-heading small { color: var(--v2-muted, #617169); font-size: .68rem; font-weight: 500; }
  .historical-rate-row:last-child { border-bottom: 1px solid var(--v2-border, #d8e1db); border-radius: 0 0 4px 4px; }
  .historical-rate-row + .historical-rate-row { border-top-color: #e5ebe7; }
  .historical-rate-row input { min-height: 30px; border-color: transparent; border-radius: 3px; background: transparent; padding: 0 5px; }
  .historical-rate-row input:focus { border-color: var(--v2-green, #24644d); background: #fff; }
  .historical-rate-row input[type="number"] { text-align: right; }
  .historical-rate-row .delete-button { min-height: 30px; border-color: transparent; background: transparent; font-size: 1.2rem; }
  .historical-rate-row .delete-button:hover { border-color: #dfbdb6; background: #faeae7; }
  .historical-add-rate::before { content: '+ '; }
  .historical-add-rate:hover { border-color: var(--v2-green, #24644d); background: #f1f7f3; }
  @media (min-width: 761px) {
    .historical-rate-head > span:nth-child(2), .historical-rate-head > span:nth-child(3) { text-align: right; }
    .historical-rate-row > label:nth-child(2), .historical-rate-row > label:nth-child(3) { text-align: right; }
    .historical-rate-row .delete-button { justify-self: center; }
  }
  @media (max-width: 760px) {
    .historical-rate-row + .historical-rate-row { border-top-color: var(--v2-border, #d8e1db); }
    .historical-rate-row input { min-height: 38px; border-color: var(--v2-border, #d8e1db); background: #fff; padding: 0 8px; }
  }

</style>
