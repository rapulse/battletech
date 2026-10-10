<script lang="ts">
  import { t } from '../i18n/index.js';
  import type { LanceGroup } from '../state/lanceGroups.js';
  import WikiHelp from '../wiki/WikiHelp.svelte';

  /**
   * Заголовок звена в списке парка (шаг 60): «Звено 2 (4/4)». Счётчик стоит у ВСЕХ
   * звеньев, не только у неполного, — иначе короткий хвост читался бы как ошибка
   * показа. Справка про порядок («звенья считаются по позиции») стоит на первом заголовке — кнопкой
   `WikiHelp`, как и остальные «?» экранов; текст лежит в `wiki/glossary.md`.
   * Один компонент на ангар и мехлаб — списки парка должны выглядеть одинаково.
   */
  interface Props {
    group: LanceGroup<unknown>;
    /** Строка справа в той же полосе (кнопка «взять звено» в окне вывода). */
    children?: import('svelte').Snippet;
  }
  const { group, children }: Props = $props();
</script>

<div class="lance-head">
  <span class="lance-title">
    {t('hangar.lanceHead', { n: group.number, have: group.count, size: group.size })}
  </span>
  {#if group.number === 1}<WikiHelp doc="glossary.md" section="звенья парка" label="?" />{/if}
  {#if children}<span class="lance-extra">{@render children()}</span>{/if}
</div>

<style>
  .lance-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 0;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    border-bottom: 1px solid var(--color-border);
  }
  .lance-extra {
    margin-left: auto;
  }
</style>
