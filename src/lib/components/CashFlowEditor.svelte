<script lang="ts">
  import Papa from 'papaparse';
  import { detectCsvMapping, mapImportedRows } from '../../cash-flow-csv.mjs';
  import { createFlowId } from '../services/storage';
  import type { BacktestController } from '../state/backtest.svelte';
  import type { CashFlowDraft, CashFlowType } from '../types';

  let { controller }: { controller: BacktestController } = $props();
  let csvRows = $state<Record<string, string>[]>([]);
  let csvHeaders = $state<string[]>([]);
  let csvName = $state('');
  let dateColumn = $state('');
  let amountColumn = $state('');
  let descriptionColumn = $state('');
  let dateFormat = $state('dmy');
  let dragging = $state(false);
  let csvInput = $state<HTMLInputElement>();

  function resetCsv() { csvRows = []; csvHeaders = []; csvName = ''; dateColumn = ''; amountColumn = ''; descriptionColumn = ''; if (csvInput) csvInput.value = ''; }
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
        descriptionColumn = detected.descriptionColumn;
        dateFormat = detected.dateFormat;
      }
    });
  }
  function importRows() {
    const mapped = mapImportedRows(csvRows, { dateColumn, amountColumn, descriptionColumn, dateFormat });
    if (!mapped.flows.length) return;
    const imported = mapped.flows.map((flow: { date: string; type: CashFlowType; amount: number; interestPayment: boolean }) => ({ ...flow, id: createFlowId(), amount: String(flow.amount) }));
    const untouched = controller.flows.length === 1 && !controller.flows[0].date && !controller.flows[0].amount;
    controller.replaceFlows(untouched ? imported : ([...controller.flows, ...imported] as CashFlowDraft[]).toSorted((a, b) => a.date.localeCompare(b.date)));
    resetCsv();
  }
  function addFidelityPremium() {
    controller.addFidelityPremium();
  }
  function signedAmount(flow: CashFlowDraft) {
    if (!flow.amount.trim()) return '';
    const numeric = Number(flow.amount);
    if (!Number.isFinite(numeric)) return flow.amount;
    return flow.type === 'outflow' ? `-${Math.abs(numeric)}` : `${Math.abs(numeric)}`;
  }
</script>

<div class="section-title"><div><p class="eyebrow">Input</p><h3 id="flows-heading">Cash flows</h3></div><button class="quiet" type="button" onclick={() => controller.loadExample()}>Load example</button></div>
<details class="config-disclosure csv-disclosure">
  <summary><span>Import a CSV</span><small>Optional</small></summary>
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
        <label>Description column <select bind:value={descriptionColumn}><option value="">None</option>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Date format <select bind:value={dateFormat}><option value="iso">Year-Month-Day</option><option value="dmy">Day-Month-Year</option><option value="mdy">Month-Day-Year</option></select></label>
      </div>
      <div class="csv-import-actions"><button type="button" onclick={importRows}>Add imported cash flows</button></div>
    </div>
  {/if}
</section>
</details>
<section class="input-section cash-flow-section" aria-label="Cash-flow entries">
  <div class="cash-flow-disclosure-content">
      <div class="controls clear-data-controls"><button class="quiet" type="button" onclick={() => { if (confirm('Clear all saved cash flows, settings, pending CSV data, and results? This cannot be undone.')) { resetCsv(); controller.clear(); } }}>Clear all data</button></div>
      <div class="flow-head" aria-hidden="true"><span>When</span><span>Amount (EUR)</span><span>Interest</span><span></span></div>
      <div aria-live="polite">
        {#each controller.flows as flow (flow.id)}
          <div class="flow-row">
            <label><span class="flow-field-label">Date</span><input type="date" required value={flow.date} onchange={(event) => controller.updateFlow(flow.id, 'date', event.currentTarget.value)} /></label>
            <label><span class="flow-field-label">Net amount in euro</span><input type="number" step="0.01" placeholder="0.00" required value={signedAmount(flow)} oninput={(event) => controller.updateFlow(flow.id, 'amount', event.currentTarget.value)} /></label>
            <label class="interest-toggle"><input aria-label="Interest payment" type="checkbox" checked={flow.interestPayment} disabled={flow.type !== 'inflow'} onchange={(event) => controller.updateInterestPayment(flow.id, event.currentTarget.checked)} /></label>
            <button class="delete-button" type="button" aria-label="Remove cash flow" onclick={() => controller.removeFlow(flow.id)}>×</button>
          </div>
        {/each}
      </div>
      <div class="flow-balance-row"><span class="flow-balance-label">Balance</span><output class:negative-balance={controller.accountBalance < 0}>{controller.accountBalance.toLocaleString('en-BE', { style: 'currency', currency: 'EUR' })}</output></div>
      {#if controller.accountBalanceIsNegative}<p class="flow-balance-error" role="alert">Account outflows cannot make the running balance negative.</p>{/if}
      <div class="controls flow-controls"><button type="button" onclick={() => controller.addFlow()}>+ Add cash flow</button></div>
  </div>
  <div class="cash-flow-actions"><div class="interest-controls">
    <label class="accrued-interest">Accrued base interest (€)<input type="number" min="0" step="0.01" placeholder="0.00" value={controller.settings.accruedBaseInterest} onchange={(event) => controller.updateSetting('accruedBaseInterest', event.currentTarget.value)} /></label>
    <div class="account-interest-rates">
      <label class="account-interest-rate current-account-rate">Your account base annual rate (%)<input id="current-account-base-rate" type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" required={controller.settings.fidelityPremiums.length > 0} value={controller.settings.accountBaseInterestRate} oninput={(event) => controller.updateSetting('accountBaseInterestRate', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('accountBaseInterestRate', event.currentTarget.value)} /></label>
      <label class="account-interest-rate current-account-rate">Your account fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.accountFidelityPremium} oninput={(event) => controller.updateSetting('accountFidelityPremium', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('accountFidelityPremium', event.currentTarget.value)} /></label>
    </div>
    <p class="interest-help">Accrued base interest remains yours after a transfer and is included in today’s missed-earnings comparison.</p>
    <div class="fidelity-premium-editor">
      <div class="fidelity-premium-heading"><p class="eyebrow">Optional</p><h3>Ongoing fidelity premiums</h3><p>Add one row for every part of your balance currently earning its own fidelity premium.</p></div>
      {#if controller.settings.fidelityPremiums.length}
        <div class="premium-head" aria-hidden="true"><span>Base amount (€)</span><span>Premium earned on</span><span>Final premium payout (€)</span><span></span></div>
        <div aria-live="polite">
          {#each controller.settings.fidelityPremiums as premium, index (premium.id)}
            <div class="premium-row">
              <label><span class="premium-field-label">Fidelity premium {index + 1} base amount in euro</span><input type="number" min="0.01" step="0.01" placeholder="0.00" required value={premium.baseAmount} onchange={(event) => controller.updateFidelityPremium(premium.id, 'baseAmount', event.currentTarget.value)} /></label>
              <label><span class="premium-field-label">Fidelity premium {index + 1} earned on</span><input type="date" required value={premium.earnedDate} onchange={(event) => controller.updateFidelityPremium(premium.id, 'earnedDate', event.currentTarget.value)} /></label>
              <label><span class="premium-field-label">Fidelity premium {index + 1} final payout in euro</span><input type="number" min="0.01" step="0.01" placeholder="0.00" required value={premium.finalPayoutAmount} onchange={(event) => controller.updateFidelityPremium(premium.id, 'finalPayoutAmount', event.currentTarget.value)} /></label>
              <button class="delete-button" type="button" aria-label={`Remove fidelity premium ${index + 1}`} onclick={() => controller.removeFidelityPremium(premium.id)}>×</button>
            </div>
          {/each}
        </div>
      {/if}
      {#if controller.settings.fidelityPremiums.length}
        <div class="controls premium-controls"><button type="button" onclick={addFidelityPremium}>+ Add fidelity premium</button></div>
        <p class="interest-help premium-help">
          Your account rates are used to compare whether transferring now or waiting is better.<br>
          <b>Base amount</b> is the balance earning the premium.<br>
          <b>Premium earned on</b> is the date the premium becomes yours.<br>
          <b>Final premium payout</b> is the premium attributable to that base amount once earned.</p>
      {/if}
      {#if !controller.settings.fidelityPremiums.length}
        <div class="controls premium-controls"><button type="button" onclick={addFidelityPremium}>+ Add fidelity premium</button></div>
      {/if}
    </div>
  </div></div>
</section>
