<script lang="ts">
  import type { CalculationView } from '../types';
  import { relativeUpdatedAt, updatedAt } from '../services/formatters';

  let { view }: { view: CalculationView } = $props();
  let csh2UpdatedAt = $derived(new Date(view.metadata.cachedAt));
  let estrUpdatedAt = $derived(view.rateMetadata.cachedAt ? new Date(view.rateMetadata.cachedAt) : undefined);
  let cpiUpdatedAt = $derived(new Date(view.cpiMetadata.cachedAt));
  let latestCpiMonth = $derived(Object.keys(view.cpiMetadata.indices).sort().at(-1));
</script>

<div class="freshness-summary flex items-center flex-wrap gap-y-[3px] gap-x-3 text-muted text-[0.64rem] leading-[1.35]" aria-label="Data freshness">
  <span class="freshness-label text-ink font-bold tracking-[0.04em] uppercase">Data freshness</span>
  <div>CSH2 data last updated <details class="freshness-item inline-block relative"><summary class="timestamp relative inline-block text-[inherit] cursor-help text-[inherit] font-[inherit]" aria-label={`CSH2 data freshness timestamp ${updatedAt.format(csh2UpdatedAt)}`} title={updatedAt.format(csh2UpdatedAt)} data-tooltip={updatedAt.format(csh2UpdatedAt)}><time datetime={view.metadata.cachedAt}>{relativeUpdatedAt(csh2UpdatedAt)}</time></summary><span class="freshness-exact absolute z-3 right-0 bottom-[calc(100%_+_6px)] w-max max-w-[min(280px,_-32px_+_100vw)] bg-ink text-white text-[0.7rem] leading-[1.3] whitespace-normal px-2 py-1.5 border border-solid border-line rounded-[4px] [@media(width<=600px)]:right-auto [@media(width<=600px)]:left-0">{updatedAt.format(csh2UpdatedAt)}</span></details></div>
  <div>{#if estrUpdatedAt}€STR rate last updated <details class="freshness-item inline-block relative"><summary class="timestamp relative inline-block text-[inherit] cursor-help text-[inherit] font-[inherit]" aria-label={`€STR rate freshness timestamp ${updatedAt.format(estrUpdatedAt)}`} title={updatedAt.format(estrUpdatedAt)} data-tooltip={updatedAt.format(estrUpdatedAt)}><time datetime={view.rateMetadata.cachedAt}>{relativeUpdatedAt(estrUpdatedAt)}</time></summary><span class="freshness-exact absolute z-3 right-0 bottom-[calc(100%_+_6px)] w-max max-w-[min(280px,_-32px_+_100vw)] bg-ink text-white text-[0.7rem] leading-[1.3] whitespace-normal px-2 py-1.5 border border-solid border-line rounded-[4px] [@media(width<=600px)]:right-auto [@media(width<=600px)]:left-0">{updatedAt.format(estrUpdatedAt)}</span></details> (source: ECB statistics){:else}€STR rate last update unavailable (source: ECB statistics){/if}</div>
  <div>Belgian CPI last updated <details class="freshness-item inline-block relative"><summary class="timestamp relative inline-block text-[inherit] cursor-help text-[inherit] font-[inherit]" aria-label={`Belgian CPI freshness timestamp ${updatedAt.format(cpiUpdatedAt)}`} title={updatedAt.format(cpiUpdatedAt)} data-tooltip={updatedAt.format(cpiUpdatedAt)}><time datetime={view.cpiMetadata.cachedAt}>{relativeUpdatedAt(cpiUpdatedAt)}</time></summary><span class="freshness-exact absolute z-3 right-0 bottom-[calc(100%_+_6px)] w-max max-w-[min(280px,_-32px_+_100vw)] bg-ink text-white text-[0.7rem] leading-[1.3] whitespace-normal px-2 py-1.5 border border-solid border-line rounded-[4px] [@media(width<=600px)]:right-auto [@media(width<=600px)]:left-0">{updatedAt.format(cpiUpdatedAt)}</span></details> (latest observed month: {latestCpiMonth}; source: Statbel)</div>
</div>
