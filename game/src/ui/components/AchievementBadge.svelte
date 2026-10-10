<script lang="ts">
  import type { AchievementDef } from '../../core/data/index.js';
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Значок достижения (шаг 69) — ячейка атласа `ui/achievements.jpg`.
   *
   * Закрытый значок — тот же рисунок, погашенный фильтром, а не отдельная
   * картинка: второй набор из 25 «серых» ячеек разошёлся бы с первым при
   * первой же перерисовке. Скрытый и закрытый — знак вопроса вместо рисунка:
   * картинка выдала бы условие не хуже подсказки.
   */
  let {
    def,
    unlocked,
    size = 56,
    title = '',
  }: {
    def: AchievementDef;
    unlocked: boolean;
    size?: number;
    title?: string;
  } = $props();

  const concealed = $derived(!unlocked && def.hidden);
</script>

<div class="badge" class:locked={!unlocked} style:width="{size}px" style:height="{size}px" {title}>
  {#if concealed}
    <span class="mystery" style:font-size="{Math.round(size * 0.5)}px">?</span>
  {:else}
    <AtlasImage atlas="achievements" index={def.icon} width={size} />
  {/if}
</div>

<style>
  .badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-bg);
  }
  .badge:not(.locked) {
    border-color: rgba(227, 179, 65, 0.55);
    box-shadow: 0 0 6px rgba(227, 179, 65, 0.18);
  }
  .locked :global(.atlas) {
    filter: grayscale(1) brightness(0.45);
  }
  .mystery {
    color: var(--color-text-dim);
    font-weight: 700;
    line-height: 1;
  }
</style>
