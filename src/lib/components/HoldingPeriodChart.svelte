<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';

  export interface HoldingPeriodMilestone {
    name: string;
    label: string;
    days?: number;
    matches?: Array<{ label: string; days: number; showLabel?: boolean }>;
    matchingIntervals?: Array<{ startDay: number; endDay: number }>;
    kind: 'break-even' | 'account' | 'overnight';
  }

  let { milestones, maximumDays }: { milestones: HoldingPeriodMilestone[]; maximumDays?: number } = $props();
  let chartElement: HTMLDivElement;
  let labelLanes = $state<Record<string, number>>({});
  let labelsBelow = $state<Record<string, boolean>>({});
  let labelsFacingLeft = $state<Record<string, boolean>>({});
  const labelElements = new SvelteMap<string, HTMLElement>();
  let layoutFrame: number | undefined;

  const daysPerMonth = 365.2425 / 12;
  const niceMonthStep = (maximumMonths: number) => {
    const target = maximumMonths / 4;
    const shortSteps = [3, 4, 6, 12];
    if (target <= 12) return shortSteps.reduce((best, step) =>
      Math.abs(step - target) < Math.abs(best - target) ? step : best
    );
    const years = Math.max(1, Math.round(target / 12));
    return years * 12;
  };

  const milestoneMatches = (milestone: HoldingPeriodMilestone) => milestone.matches ?? (milestone.days === undefined ? [] : [{ label: milestone.label, days: milestone.days }]);
  const hasTimeline = (milestone: HoldingPeriodMilestone) => milestoneMatches(milestone).length > 0 || Boolean(milestone.matchingIntervals?.length);
  const labelLaneStep = 22;
  const labelKey = (milestoneIndex: number, matchIndex: number) => `${milestoneIndex}:${matchIndex}`;
  const labelLane = (milestoneIndex: number, matchIndex: number) => labelLanes[labelKey(milestoneIndex, matchIndex)] ?? 0;
  const labelIsBelow = (milestoneIndex: number, matchIndex: number) => labelsBelow[labelKey(milestoneIndex, matchIndex)] ?? false;
  const labelFacesLeft = (milestoneIndex: number, matchIndex: number) => labelsFacingLeft[labelKey(milestoneIndex, matchIndex)] ?? false;
  const labelOffset = (milestoneIndex: number, matchIndex: number) => 10 + labelLane(milestoneIndex, matchIndex) * labelLaneStep;
  const trackHeight = (milestone: HoldingPeriodMilestone, milestoneIndex: number) => {
    const maximumLane = Math.max(0, ...milestoneMatches(milestone).map((_, matchIndex) => labelLane(milestoneIndex, matchIndex)));
    return 58 + maximumLane * labelLaneStep * 2;
  };
  let displayedMaximumDays = $derived(Math.max(1, maximumDays ?? 0, ...milestones.flatMap((milestone) => [
    ...milestoneMatches(milestone).map((match) => match.days),
    ...(milestone.matchingIntervals ?? []).map((interval) => interval.endDay)
  ])));
  let displayedMaximumMonths = $derived(displayedMaximumDays / daysPerMonth);
  let tickStep = $derived(niceMonthStep(displayedMaximumMonths));
  let scaleMaximum = $derived(Math.max(tickStep, Math.ceil(displayedMaximumMonths / tickStep) * tickStep));
  let ticks = $derived(Array.from({ length: Math.round(scaleMaximum / tickStep) + 1 }, (_, index) => index * tickStep));
  const positionForDays = (days: number) => `${((days / daysPerMonth) / scaleMaximum) * 100}%`;
  const markerPositionForDays = (days: number) => `calc(${positionForDays(days)} - 1.5px)`;
  const flagLeftForDays = (days: number) => `calc(${positionForDays(days)} - 1.5px)`;
  const flagRightForDays = (days: number) => `calc(${100 - ((days / daysPerMonth) / scaleMaximum) * 100}% - 1.5px)`;
  let ariaLabel = $derived(`Minimum holding periods in months. ${milestones.map((milestone) => `${milestone.name}: ${milestoneMatches(milestone).map((match) => match.label).join(', ') || milestone.label}`).join('. ')}.`);

  const layoutLabels = () => {
    layoutFrame = undefined;
    const nextLanes: Record<string, number> = {};
    const nextLabelsBelow: Record<string, boolean> = {};
    const nextLabelsFacingLeft: Record<string, boolean> = {};
    milestones.forEach((milestone, milestoneIndex) => {
      const measuredLabels: Array<{ matchIndex: number; left: number; right: number }> = [];
      milestoneMatches(milestone).forEach((match, matchIndex) => {
        if (match.showLabel === false) return;
        const key = labelKey(milestoneIndex, matchIndex);
        const element = labelElements.get(key);
        if (!element?.parentElement) return;
        const bounds = element.getBoundingClientRect();
        const anchorX = labelFacesLeft(milestoneIndex, matchIndex) ? bounds.right - 1.5 : bounds.left + 1.5;
        const rightFacingLeft = anchorX - 1.5;
        const facesLeft = rightFacingLeft + bounds.width > element.parentElement.getBoundingClientRect().right;
        nextLabelsFacingLeft[key] = facesLeft;
        measuredLabels.push({
          matchIndex,
          left: facesLeft ? anchorX + 1.5 - bounds.width : rightFacingLeft,
          right: facesLeft ? anchorX + 1.5 : rightFacingLeft + bounds.width
        });
      });
      const laneEnds: [number[], number[]] = [[], []];
      let previousLabel: { left: number; right: number; below: boolean } | undefined;
      measuredLabels
        .forEach(({ matchIndex, left, right }) => {
          const overlapsPrevious = previousLabel !== undefined && left < previousLabel.right + 12 && right > previousLabel.left - 12;
          const below = overlapsPrevious && previousLabel !== undefined ? !previousLabel.below : false;
          nextLabelsBelow[labelKey(milestoneIndex, matchIndex)] = below;
          previousLabel = { left, right, below };
        });
      measuredLabels
        .sort((left, right) => left.left - right.left)
        .forEach(({ matchIndex, left, right }) => {
          const below = nextLabelsBelow[labelKey(milestoneIndex, matchIndex)];
          const side: 0 | 1 = below ? 1 : 0;
          let lane = laneEnds[side].findIndex((end) => left >= end + 12);
          if (lane === -1) lane = laneEnds[side].length;
          const key = labelKey(milestoneIndex, matchIndex);
          nextLanes[key] = lane;
          laneEnds[side][lane] = right;
        });
    });
    const currentKeys = Object.keys(labelLanes);
    const nextKeys = Object.keys(nextLanes);
    if (currentKeys.length !== nextKeys.length || nextKeys.some((key) => labelLanes[key] !== nextLanes[key])) labelLanes = nextLanes;
    const currentBelowKeys = Object.keys(labelsBelow);
    const nextBelowKeys = Object.keys(nextLabelsBelow);
    if (currentBelowKeys.length !== nextBelowKeys.length || nextBelowKeys.some((key) => labelsBelow[key] !== nextLabelsBelow[key])) labelsBelow = nextLabelsBelow;
    const currentDirectionKeys = Object.keys(labelsFacingLeft);
    const nextDirectionKeys = Object.keys(nextLabelsFacingLeft);
    if (currentDirectionKeys.length !== nextDirectionKeys.length || nextDirectionKeys.some((key) => labelsFacingLeft[key] !== nextLabelsFacingLeft[key])) labelsFacingLeft = nextLabelsFacingLeft;
  };

  const scheduleLabelLayout = () => {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layoutLabels);
  };

  const registerLabel = (element: HTMLElement, key: string) => {
    let currentKey = key;
    labelElements.set(currentKey, element);
    scheduleLabelLayout();
    return {
      update(nextKey: string) {
        if (nextKey !== currentKey) {
          labelElements.delete(currentKey);
          currentKey = nextKey;
          labelElements.set(currentKey, element);
        }
        scheduleLabelLayout();
      },
      destroy() {
        labelElements.delete(currentKey);
        scheduleLabelLayout();
      }
    };
  };

  let labelLayoutSignature = $derived(`${scaleMaximum}|${milestones.map((milestone) => milestoneMatches(milestone).map((match) => `${match.days}:${match.label}:${match.showLabel}`).join(',')).join('|')}`);
  $effect(() => {
    void labelLayoutSignature;
    void labelsBelow;
    void labelsFacingLeft;
    scheduleLabelLayout();
  });

  onMount(() => {
    const observer = new ResizeObserver(scheduleLabelLayout);
    observer.observe(chartElement);
    void document.fonts?.ready.then(scheduleLabelLayout);
    return () => {
      observer.disconnect();
      if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
    };
  });
</script>

<div bind:this={chartElement} class="holding-period-chart" role="img" aria-label={ariaLabel}>
  <div class="holding-period-rows" aria-hidden="true">
    {#each milestones as milestone, milestoneIndex}
      <div class="holding-period-row">
        <span class="holding-period-row-label">{milestone.name}</span>
        <div class="holding-period-track" style:height={`${trackHeight(milestone, milestoneIndex)}px`}>
          {#if hasTimeline(milestone)}<span class="holding-period-track-line"></span>{/if}
          {#each milestone.matchingIntervals ?? [] as interval}
            <span class={`holding-period-progress holding-period-${milestone.kind}`} style:left={positionForDays(interval.startDay)} style:width={positionForDays(interval.endDay - interval.startDay)}></span>
          {/each}
          {#each milestoneMatches(milestone) as match, matchIndex}
            {@const facesLeft = labelFacesLeft(milestoneIndex, matchIndex)}
            {@const below = labelIsBelow(milestoneIndex, matchIndex)}
            <span class={`holding-period-marker holding-period-${milestone.kind}`} style:left={markerPositionForDays(match.days)}></span>
            {#if match.showLabel !== false}<span class:below class={`holding-period-flag-pole holding-period-${milestone.kind}`} style:left={markerPositionForDays(match.days)} style:--flag-offset={`${labelOffset(milestoneIndex, matchIndex)}px`}></span><span use:registerLabel={labelKey(milestoneIndex, matchIndex)} class:faces-left={facesLeft} class:below class={`holding-period-value holding-period-${milestone.kind}`} style:left={!facesLeft ? flagLeftForDays(match.days) : undefined} style:right={facesLeft ? flagRightForDays(match.days) : undefined} style:--flag-offset={`${labelOffset(milestoneIndex, matchIndex)}px`} style:bottom={!below ? `calc(50% + ${labelOffset(milestoneIndex, matchIndex)}px)` : undefined} style:top={below ? `calc(50% + ${labelOffset(milestoneIndex, matchIndex)}px)` : undefined}>{match.label}</span>{/if}
          {/each}
          {#if !milestoneMatches(milestone).length}<span class="holding-period-unavailable">{milestone.label}</span>{/if}
        </div>
      </div>
    {/each}
    <div class="holding-period-axis-row">
      <span class="holding-period-axis-title">Months</span>
      <div class="holding-period-axis">
        {#each ticks as tick, index}
          <span class="holding-period-tick" style:left={`${(tick / scaleMaximum) * 100}%`}></span>
          <span class:first={index === 0} class:last={index === ticks.length - 1} class="holding-period-axis-label" style:left={`${(tick / scaleMaximum) * 100}%`}>{tick.toLocaleString('en-BE')}</span>
        {/each}
      </div>
    </div>
  </div>
</div>
