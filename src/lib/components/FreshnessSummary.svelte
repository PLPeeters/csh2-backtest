<script lang="ts">
  import type { CalculationView } from '../types';
  import { relativeUpdatedAt, updatedAt } from '../services/formatters';

  let { view }: { view: CalculationView } = $props();
  let csh2UpdatedAt = $derived(new Date(view.metadata.cachedAt));
  let estrUpdatedAt = $derived(view.rateMetadata.cachedAt ? new Date(view.rateMetadata.cachedAt) : undefined);
  let cpiUpdatedAt = $derived(new Date(view.cpiMetadata.cachedAt));
  let latestCpiMonth = $derived(Object.keys(view.cpiMetadata.indices).sort().at(-1));
</script>

<div class="freshness-summary" aria-label="Data freshness">
  <span class="freshness-label">Data freshness</span>
  <div>CSH2 data last updated <details class="freshness-item"><summary class="timestamp" aria-label={`CSH2 data freshness timestamp ${updatedAt.format(csh2UpdatedAt)}`} title={updatedAt.format(csh2UpdatedAt)} data-tooltip={updatedAt.format(csh2UpdatedAt)}><time datetime={view.metadata.cachedAt}>{relativeUpdatedAt(csh2UpdatedAt)}</time></summary><span class="freshness-exact">{updatedAt.format(csh2UpdatedAt)}</span></details></div>
  <div>{#if estrUpdatedAt}€STR rate last updated <details class="freshness-item"><summary class="timestamp" aria-label={`€STR rate freshness timestamp ${updatedAt.format(estrUpdatedAt)}`} title={updatedAt.format(estrUpdatedAt)} data-tooltip={updatedAt.format(estrUpdatedAt)}><time datetime={view.rateMetadata.cachedAt}>{relativeUpdatedAt(estrUpdatedAt)}</time></summary><span class="freshness-exact">{updatedAt.format(estrUpdatedAt)}</span></details> (source: ECB statistics){:else}€STR rate last update unavailable (source: ECB statistics){/if}</div>
  <div>Belgian CPI last updated <details class="freshness-item"><summary class="timestamp" aria-label={`Belgian CPI freshness timestamp ${updatedAt.format(cpiUpdatedAt)}`} title={updatedAt.format(cpiUpdatedAt)} data-tooltip={updatedAt.format(cpiUpdatedAt)}><time datetime={view.cpiMetadata.cachedAt}>{relativeUpdatedAt(cpiUpdatedAt)}</time></summary><span class="freshness-exact">{updatedAt.format(cpiUpdatedAt)}</span></details> (latest observed month: {latestCpiMonth}; source: Statbel)</div>
</div>
