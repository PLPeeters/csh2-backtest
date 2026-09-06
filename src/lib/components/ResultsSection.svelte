<script lang="ts">
  import type { BacktestController } from '../state/backtest.svelte';
  import ComparisonResults from './ComparisonResults.svelte';
  let { controller }: { controller: BacktestController } = $props();
</script>
<section id="results" aria-live="polite">
  {#if controller.view}
    <ComparisonResults comparisonView={controller.view} accountLabel="Account" />
  {/if}
</section>
