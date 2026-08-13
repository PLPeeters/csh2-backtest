<script lang="ts">
  import Papa from 'papaparse';
  import { detectCsvMapping, mapImportedRows } from '../../cash-flow-csv.mjs';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { CashFlowDraft, CashFlowType } from '../types';

  let { controller }: { controller: BacktestController } = $props();
  let csvRows = $state<Record<string, string>[]>([]);
  let csvHeaders = $state<string[]>([]);
  let csvName = $state('');
  let dateColumn = $state('');
  let amountColumn = $state('');
  let dateFormat = $state('dmy');
  let dragging = $state(false);
  let csvInput = $state<HTMLInputElement>();

  function resetCsv() { csvRows = []; csvHeaders = []; csvName = ''; if (csvInput) csvInput.value = ''; }
  function loadFile(file?: File) {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete({ data, meta, errors }) {
        if (errors.length || !meta.fields?.length) return;
        csvRows = data;
        csvHeaders = meta.fields;
        csvName = file.name;
        const detected = detectCsvMapping(data, meta.fields);
        dateColumn = detected.dateColumn;
        amountColumn = detected.amountColumn;
        dateFormat = detected.dateFormat;
      }
    });
  }
  function importRows() {
    const mapped = mapImportedRows(csvRows, { dateColumn, amountColumn, dateFormat });
    if (!mapped.flows.length) return;
    const imported = mapped.flows.map((flow: { date: string; type: CashFlowType; amount: number }) => ({ ...flow, id: crypto.randomUUID(), amount: String(flow.amount), interestPayment: false }));
    const untouched = controller.flows.length === 1 && !controller.flows[0].date && !controller.flows[0].amount;
    controller.replaceFlows(untouched ? imported : ([...controller.flows, ...imported] as CashFlowDraft[]).toSorted((a, b) => a.date.localeCompare(b.date)));
    resetCsv();
  }
</script>

<div class="section-title"><div><p class="eyebrow">Input</p><h2 id="flows-heading">Cash flows</h2></div><button class="quiet" type="button" onclick={() => controller.loadExample()}>Load example</button></div>
<section class="input-section csv-import" aria-labelledby="csv-heading">
  <div><p class="eyebrow">Optional</p><h3 id="csv-heading">Import a CSV</h3></div>
  <div class:dragging class="file-dropzone" role="group" aria-label="CSV file drop zone" ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={(event) => { event.preventDefault(); dragging = false; loadFile(event.dataTransfer?.files[0]); }}>
    <input bind:this={csvInput} id="csv-file" class="file-input" type="file" accept=".csv,text/csv" onchange={(event) => loadFile(event.currentTarget.files?.[0])} />
    <label class="file-trigger" for="csv-file">Choose CSV file</label>
    <p class="file-name" aria-live="polite">{csvName || 'or drop a CSV file here'}</p>
  </div>
  {#if csvRows.length}
    <div id="csv-mapping">
      <div class="csv-mapping-summary"><p class="eyebrow">Review detected fields</p><p class="csv-preview">{csvRows.length} data rows found</p></div>
      <div class="csv-map-grid">
        <label>Date column <select bind:value={dateColumn}>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Amount column <select bind:value={amountColumn}>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Date format <select bind:value={dateFormat}><option value="iso">Year-Month-Day</option><option value="dmy">Day-Month-Year</option><option value="mdy">Month-Day-Year</option></select></label>
      </div>
      <div class="csv-import-actions"><button type="button" onclick={importRows}>Add imported cash flows</button></div>
    </div>
  {/if}
</section>
<section class="input-section cash-flow-section" aria-label="Cash-flow entries">
  <div class="controls clear-data-controls"><button class="quiet" type="button" onclick={() => { if (confirm('Clear all saved cash flows, settings, pending CSV data, and results? This cannot be undone.')) { resetCsv(); controller.clear(); } }}>Clear all data</button></div>
  <div class="flow-head" aria-hidden="true"><span>Date</span><span>Direction</span><span>Net amount (€)</span><span>Interest</span><span></span></div>
  <div aria-live="polite">
    {#each controller.flows as flow (flow.id)}
      <div class="flow-row">
        <label><span class="sr-only">Date</span><input type="date" required value={flow.date} onchange={(event) => controller.updateFlow(flow.id, 'date', event.currentTarget.value)} /></label>
        <label><span class="sr-only">Direction</span><select value={flow.type} onchange={(event) => controller.updateFlow(flow.id, 'type', event.currentTarget.value)}><option value="inflow">Inflow</option><option value="outflow">Outflow</option></select></label>
        <label><span class="sr-only">Net amount in euro</span><input type="number" min="0.01" step="0.01" placeholder="0.00" required value={flow.amount} onchange={(event) => controller.updateFlow(flow.id, 'amount', event.currentTarget.value)} /></label>
        <label class="interest-payment"><input type="checkbox" checked={flow.interestPayment} disabled={flow.type !== 'inflow'} onchange={(event) => controller.updateInterestPayment(flow.id, event.currentTarget.checked)} /><span class="sr-only">Interest payment</span></label>
        <button class="delete-button" type="button" aria-label="Remove cash flow" onclick={() => controller.removeFlow(flow.id)}>×</button>
      </div>
    {/each}
  </div>
  <div class="controls flow-controls"><button class="quiet" type="button" onclick={() => controller.addFlow()}>Add cash flow</button></div>
  <div class="cash-flow-actions"><div class="interest-controls">
    <label class="accrued-interest">Unpaid accrued interest (€)<input type="number" min="0" step="0.01" placeholder="0.00" value={controller.settings.unpaidAccruedInterest} onchange={(event) => controller.updateSetting('unpaidAccruedInterest', event.currentTarget.value)} /></label>
    <div class="payout-interest-fields"><label class="accrued-interest">Future interest payout on<input type="date" value={controller.settings.interestPayoutDate} onchange={(event) => controller.updateSetting('interestPayoutDate', event.currentTarget.value)} /></label><label class="accrued-interest">Future interest payout (€)<input type="number" min={Math.max(0.01, Number(controller.settings.unpaidAccruedInterest) || 0)} step="0.01" placeholder="0.00" value={controller.settings.interestPayoutAmount} onchange={(event) => controller.updateSetting('interestPayoutAmount', event.currentTarget.value)} /></label></div>
    <p class="interest-help">Optional. The future payout amount includes the unpaid accrued interest and cannot be smaller.</p>
  </div></div>
</section>
