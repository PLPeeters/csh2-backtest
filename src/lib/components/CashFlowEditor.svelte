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

<div class="section-title flex items-center justify-between pb-5 gap-5 [@media(width<=760px)]:items-start [@media(width<=760px)]:flex-col [@media(width<=760px)]:gap-3"><div><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Input</p><h3 id="flows-heading">Cash flows</h3></div><button class="quiet bg-white text-[#285747] border-[#cbd7d0]" type="button" onclick={() => controller.loadExample()}>Load example</button></div>
<details class="config-disclosure csv-disclosure bg-surface mb-2.5 border border-solid border-line rounded-[4px]">
  <summary><span>Import a CSV</span><small>Optional</small></summary>
<section class="input-section csv-import [border-top-width:0px] [border-top-style:none] [border-top-color:currentcolor] pt-0 pb-5.5 m-0 px-0" aria-labelledby="csv-heading">
  <div><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Optional</p><h3 id="csv-heading">Import a CSV</h3></div>
  <div class:dragging class="file-dropzone flex items-center min-h-18 mt-3.5 bg-[#fbfcfb] p-3.5 border border-dashed border-[#aebdb5] rounded-[7px] gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col [@media(width<=760px)]:gap-2.5" role="group" aria-label="CSV file drop zone" ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => dragging = false} ondrop={(event) => { event.preventDefault(); dragging = false; loadFile(event.dataTransfer?.files[0]); }}>
    <input bind:this={csvInput} id="csv-file" class="file-input absolute overflow-x-hidden overflow-y-hidden whitespace-nowrap" type="file" accept=".csv,text/csv" onchange={(event) => loadFile(event.currentTarget.files?.[0])} />
    <label class="file-trigger inline-flex items-center min-h-9.5 bg-white text-[#285747] cursor-pointer text-[0.9rem] font-[650] px-[13px] py-0 border border-solid border-[#cbd7d0] rounded-[5px]" for="csv-file">Choose CSV file</label>
    <p class="file-name text-[#617169] text-[0.875rem] m-0" aria-live="polite">{csvName || 'or drop a CSV file here'}</p>
  </div>
  {#if csvRows.length}
    <div id="csv-mapping">
      <div class="csv-mapping-summary flex items-baseline justify-between gap-5 [@media(width<=760px)]:items-start [@media(width<=760px)]:flex-col [@media(width<=760px)]:gap-1"><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Review detected fields</p><p class="csv-preview text-[#617169] text-[0.875rem] m-0">{csvRows.length} data rows found</p></div>
      <div class="csv-map-grid grid grid-cols-2 mt-3.5 gap-3 [@media(width<=760px)]:grid-cols-[1fr]">
        <label>Date column <select bind:value={dateColumn}>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Amount column <select bind:value={amountColumn}>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Description column <select bind:value={descriptionColumn}><option value="">None</option>{#each csvHeaders as header}<option value={header}>{header}</option>{/each}</select></label>
        <label>Date format <select bind:value={dateFormat}><option value="iso">Year-Month-Day</option><option value="dmy">Day-Month-Year</option><option value="mdy">Month-Day-Year</option></select></label>
      </div>
      <div class="csv-import-actions flex justify-end mt-4 [@media(width<=760px)]:[justify-content:stretch]"><button type="button" onclick={importRows}>Add imported cash flows</button></div>
    </div>
  {/if}
</section>
</details>
<section class="input-section cash-flow-section [border-top-width:1px] [border-top-style:solid] [border-top-color:#e3e8e5] pt-0 pb-5.5 px-0" aria-label="Cash-flow entries">
  <div class="cash-flow-disclosure-content p-3.5 [@media(width<=760px)]:p-2.5">
      <div class="controls clear-data-controls flex items-center justify-end mb-3.5 gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><button class="quiet bg-white text-[#285747] border-[#cbd7d0]" type="button" onclick={() => { if (confirm('Clear all saved cash flows, settings, pending CSV data, and results? This cannot be undone.')) { resetCsv(); controller.clear(); } }}>Clear all data</button></div>
      <div class="flow-head grid grid-cols-[1.25fr_1.2fr_68px_40px] items-center text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase pb-2 gap-3 [@media(width<=760px)]:hidden" aria-hidden="true"><span>When</span><span>Amount (EUR)</span><span>Interest</span><span></span></div>
      <div aria-live="polite">
        {#each controller.flows as flow (flow.id)}
          <div class="flow-row grid grid-cols-[1.25fr_1.2fr_68px_40px] items-center mb-2.5 gap-3 [@media(width<=760px)]:grid-cols-[repeat(2,_minmax(0px,_1fr))_32px] [@media(width<=760px)]:items-stretch [@media(width<=760px)]:[border-image-source:none] [@media(width<=760px)]:[border-image-slice:100%] [@media(width<=760px)]:[border-image-width:1] [@media(width<=760px)]:[border-image-outset:0] [@media(width<=760px)]:[border-image-repeat:stretch] [@media(width<=760px)]:bg-white [@media(width<=760px)]:p-2.5 [@media(width<=760px)]:border [@media(width<=760px)]:border-solid [@media(width<=760px)]:border-[#e1e7e3] [@media(width<=760px)]:rounded-[7px] [@media(width<=760px)]:gap-[7px]">
            <label><span class="flow-field-label absolute w-[1px] h-[1px] overflow-x-hidden overflow-y-hidden [@media(width<=760px)]:static [@media(width<=760px)]:w-auto [@media(width<=760px)]:h-auto [@media(width<=760px)]:overflow-x-visible [@media(width<=760px)]:overflow-y-visible [@media(width<=760px)]:block [@media(width<=760px)]:mb-1.5">Date</span><input type="date" required value={flow.date} onchange={(event) => controller.updateFlow(flow.id, 'date', event.currentTarget.value)} /></label>
            <label><span class="flow-field-label absolute w-[1px] h-[1px] overflow-x-hidden overflow-y-hidden [@media(width<=760px)]:static [@media(width<=760px)]:w-auto [@media(width<=760px)]:h-auto [@media(width<=760px)]:overflow-x-visible [@media(width<=760px)]:overflow-y-visible [@media(width<=760px)]:block [@media(width<=760px)]:mb-1.5">Net amount in euro</span><input type="number" step="0.01" placeholder="0.00" required value={signedAmount(flow)} oninput={(event) => controller.updateFlow(flow.id, 'amount', event.currentTarget.value)} /></label>
            <label class="interest-toggle inline-flex items-center justify-start min-h-8.5 cursor-pointer gap-2"><input aria-label="Interest payment" type="checkbox" checked={flow.interestPayment} disabled={flow.type !== 'inflow'} onchange={(event) => controller.updateInterestPayment(flow.id, event.currentTarget.checked)} /><span class="interest-label">Interest payment</span></label>
            <button class="delete-button bg-[#fff7f6] text-[#913a31] text-[1.3rem] p-0 border-[#ead4d0]" type="button" aria-label="Remove cash flow" onclick={() => controller.removeFlow(flow.id)}>×</button>
          </div>
        {/each}
      </div>
      <div class="flow-balance-row grid grid-cols-[1.25fr_1.2fr_68px_40px] -mt-0.5 mb-2.5 mx-0 gap-3 [@media(width<=760px)]:grid-cols-[repeat(2,_minmax(0px,_1fr))_32px] [@media(width<=760px)]:gap-[7px]"><span class="flow-balance-label [grid-column:1] self-center justify-self-end text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] text-right uppercase">Balance</span><output class:negative-balance={controller.accountBalance < 0}>{controller.accountBalance.toLocaleString('en-BE', { style: 'currency', currency: 'EUR' })}</output></div>
      {#if controller.accountBalanceIsNegative}<p class="flow-balance-error text-[0.85rem] font-semibold m-0" role="alert">Account outflows cannot make the running balance negative.</p>{/if}
      <div class="controls flow-controls flex items-center justify-center mt-3.5 gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><button type="button" onclick={() => controller.addFlow()}>+ Add cash flow</button></div>
  </div>
  <div class="cash-flow-actions flex w-full min-w-0 justify-start mt-4.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><div class="interest-controls grid w-full min-w-0 grid-cols-[minmax(0px,_1fr)] items-stretch gap-3">
    <label class="accrued-interest block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Accrued base interest (€)<input type="number" min="0" step="0.01" placeholder="0.00" value={controller.settings.accruedBaseInterest} onchange={(event) => controller.updateSetting('accruedBaseInterest', event.currentTarget.value)} /></label>
    <div class="account-interest-rates grid grid-cols-2 min-w-0 gap-3">
      <label class="account-interest-rate current-account-rate block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Your account base annual rate (%)<input id="current-account-base-rate" type="number" min="-99.99" step="0.01" placeholder="e.g. 0.50" required={controller.settings.fidelityPremiums.length > 0} value={controller.settings.accountBaseInterestRate} oninput={(event) => controller.updateSetting('accountBaseInterestRate', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('accountBaseInterestRate', event.currentTarget.value)} /></label>
      <label class="account-interest-rate current-account-rate block text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase">Your account fidelity premium (%)<input type="number" min="0" step="0.01" placeholder="e.g. 1.50" value={controller.settings.accountFidelityPremium} oninput={(event) => controller.updateSetting('accountFidelityPremium', event.currentTarget.value)} onchange={(event) => controller.setAccountRate('accountFidelityPremium', event.currentTarget.value)} /></label>
    </div>
    <p class="interest-help [flex-basis:100%] -mt-1 mb-0 text-[#617169] text-[0.8rem] leading-[1.45] mx-0">Accrued base interest remains yours after a transfer and is included in today’s missed-earnings comparison.</p>
    <div class="fidelity-premium-editor w-full mt-[13px] [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--v2-border)] pt-[13px]">
      <div class="fidelity-premium-heading"><p class="eyebrow mb-1.5 text-muted text-[0.65rem] font-bold tracking-[0.09em] uppercase">Optional</p><h3>Ongoing fidelity premiums</h3><p>Add one row for every part of your balance currently earning its own fidelity premium.</p></div>
      {#if controller.settings.fidelityPremiums.length}
        <div class="premium-head grid grid-cols-[repeat(3,_minmax(0px,_1fr))_40px] items-center mt-4.5 pb-2 text-[#64766d] text-[0.7rem] font-bold tracking-[0.08em] uppercase gap-3 [@media(width<=760px)]:hidden" aria-hidden="true"><span>Base amount (€)</span><span>Premium earned on</span><span>Final premium payout (€)</span><span></span></div>
        <div aria-live="polite">
          {#each controller.settings.fidelityPremiums as premium, index (premium.id)}
            <div class="premium-row grid grid-cols-[repeat(3,_minmax(0px,_1fr))_40px] items-center mb-2.5 gap-3 [@media(width<=760px)]:grid-cols-[minmax(0px,_1fr)_40px] [@media(width<=760px)]:items-stretch [@media(width<=760px)]:[border-image-source:none] [@media(width<=760px)]:[border-image-slice:100%] [@media(width<=760px)]:[border-image-width:1] [@media(width<=760px)]:[border-image-outset:0] [@media(width<=760px)]:[border-image-repeat:stretch] [@media(width<=760px)]:bg-[#fbfcfb] [@media(width<=760px)]:p-2.5 [@media(width<=760px)]:border [@media(width<=760px)]:border-solid [@media(width<=760px)]:border-[#e1e7e3] [@media(width<=760px)]:rounded-[7px]">
              <label><span class="premium-field-label absolute w-[1px] h-[1px] overflow-x-hidden overflow-y-hidden [@media(width<=760px)]:static [@media(width<=760px)]:w-auto [@media(width<=760px)]:h-auto [@media(width<=760px)]:overflow-x-visible [@media(width<=760px)]:overflow-y-visible [@media(width<=760px)]:block [@media(width<=760px)]:mb-1.5">Fidelity premium {index + 1} base amount in euro</span><input type="number" min="0.01" step="0.01" placeholder="0.00" required value={premium.baseAmount} onchange={(event) => controller.updateFidelityPremium(premium.id, 'baseAmount', event.currentTarget.value)} /></label>
              <label><span class="premium-field-label absolute w-[1px] h-[1px] overflow-x-hidden overflow-y-hidden [@media(width<=760px)]:static [@media(width<=760px)]:w-auto [@media(width<=760px)]:h-auto [@media(width<=760px)]:overflow-x-visible [@media(width<=760px)]:overflow-y-visible [@media(width<=760px)]:block [@media(width<=760px)]:mb-1.5">Fidelity premium {index + 1} earned on</span><input type="date" required value={premium.earnedDate} onchange={(event) => controller.updateFidelityPremium(premium.id, 'earnedDate', event.currentTarget.value)} /></label>
              <label><span class="premium-field-label absolute w-[1px] h-[1px] overflow-x-hidden overflow-y-hidden [@media(width<=760px)]:static [@media(width<=760px)]:w-auto [@media(width<=760px)]:h-auto [@media(width<=760px)]:overflow-x-visible [@media(width<=760px)]:overflow-y-visible [@media(width<=760px)]:block [@media(width<=760px)]:mb-1.5">Fidelity premium {index + 1} final payout in euro</span><input type="number" min="0.01" step="0.01" placeholder="0.00" required value={premium.finalPayoutAmount} onchange={(event) => controller.updateFidelityPremium(premium.id, 'finalPayoutAmount', event.currentTarget.value)} /></label>
              <button class="delete-button bg-[#fff7f6] text-[#913a31] text-[1.3rem] p-0 border-[#ead4d0]" type="button" aria-label={`Remove fidelity premium ${index + 1}`} onclick={() => controller.removeFidelityPremium(premium.id)}>×</button>
            </div>
          {/each}
        </div>
      {/if}
      {#if controller.settings.fidelityPremiums.length}
        <div class="controls premium-controls flex items-center justify-center mt-3.5 gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><button type="button" onclick={addFidelityPremium}>+ Add fidelity premium</button></div>
        <p class="interest-help premium-help [flex-basis:100%] mt-3.5 mb-0 text-[#617169] text-[0.8rem] leading-[1.45] mx-0">
          Your account rates are used to compare whether transferring now or waiting is better.<br>
          <b>Base amount</b> is the balance earning the premium.<br>
          <b>Premium earned on</b> is the date the premium becomes yours.<br>
          <b>Final premium payout</b> is the premium attributable to that base amount once earned.</p>
      {/if}
      {#if !controller.settings.fidelityPremiums.length}
        <div class="controls premium-controls flex items-center justify-center mt-3.5 gap-3.5 [@media(width<=760px)]:items-stretch [@media(width<=760px)]:flex-col"><button type="button" onclick={addFidelityPremium}>+ Add fidelity premium</button></div>
      {/if}
    </div>
  </div></div>
</section>
