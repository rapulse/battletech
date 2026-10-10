<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { downloadText } from '../../platform/download.js';
  import { t } from '../i18n/index.js';

  let box = $state<HTMLDivElement | null>(null);

  // Подсветка — по тону куска, который назвало ядро (`core/log/phrase.ts`), а не
  // регулярным выражением по русским словам: на другом языке оно не нашло бы ничего.

  // Журнал прокручивается к последней строке сам: за боем следят по хвосту.
  $effect(() => {
    void battle.logs.length;
    if (box !== null) box.scrollTop = box.scrollHeight;
  });

  // Выгрузка отчёта (шаг 29). Содержимое считает ядро
  // (`core/log/battleReport.ts`), файл отдаёт `platform/download.ts`, здесь
  // только кнопка — это и есть граница слоёв.
  function saveText(): void {
    downloadText(battle.reportText(), battle.reportFileName('txt'), 'text/plain;charset=utf-8');
  }

  function saveJson(): void {
    downloadText(battle.reportJson(), battle.reportFileName('json'), 'application/json');
  }
</script>

<div class="log-box">
  <div class="log-header">
    <span>{t('battle.log.title')}</span>
    {#if battle.shots.shots > 0}
      <span class="stats" title={t('battle.log.statsTitle')}>
        {battle.shots.shots}·{battle.shots.hits}·{t('battle.log.avg', { n: battle.shots.avgTarget })}{#if battle.shots.cappedShare > 0}·<span class="capped">{t('battle.log.capped', { n: Math.round(battle.shots.cappedShare * 100) })}</span>{/if}
      </span>
      <span class="dl">
        <button type="button" onclick={saveText} title={t('battle.log.downloadText')}>TXT</button>
        <button type="button" onclick={saveJson} title={t('battle.log.downloadJson')}>JSON</button>
      </span>
    {/if}
  </div>
  <div class="log-content" bind:this={box}>
    {#each battle.logs as line, i (i)}
      <div class="log-entry {line.kind}">{#if line.kind === 'sub'}└ {/if}{#each line.parts as part, j (j)}{#if part.tone === undefined}{part.text}{:else}<span class="hl-{part.tone}">{part.text}</span>{/if}{/each}</div>
    {/each}
  </div>
</div>

<style>
  .log-box {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 140px;
    max-height: 260px;
  }
  .log-header {
    background: #161b22;
    padding: 5px 8px;
    font-size: 10px;
    font-weight: bold;
    color: #8b949e;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .log-header .stats {
    margin-left: auto;
    font-weight: normal;
    letter-spacing: 0;
    color: #6e7681;
    font-family: monospace;
  }
  .log-header .capped {
    color: #ffa657;
  }
  .log-header .dl {
    display: flex;
    gap: 4px;
  }
  .log-header button {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 3px;
    color: #8b949e;
    font-size: 9px;
    font-family: inherit;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    cursor: pointer;
  }
  .log-header button:hover {
    color: #58a6ff;
    border-color: #58a6ff;
  }
  .log-content {
    overflow-y: auto;
    padding: 6px 8px;
    font-family: monospace;
    font-size: 10.5px;
    line-height: 1.5;
    flex: 1;
  }
  .log-entry { color: #c9d1d9; margin-bottom: 1px; word-break: break-word; }
  .log-entry.sys { color: #39c5bb; }
  .log-entry.turn { color: #e3b341; font-weight: bold; }
  .log-entry.sub { color: #8b949e; padding-left: 6px; }
  .log-entry.out { color: #f85149; }

  :global(.hl-hit) { color: #3fb950; font-weight: bold; }
  :global(.hl-miss) { color: #8b949e; }
  :global(.hl-danger) { color: #f85149; font-weight: bold; }
  :global(.hl-warn) { color: #e3b341; font-weight: bold; }
  :global(.hl-crit) { color: #bc8cff; font-weight: bold; }
  :global(.hl-dmg) { color: #f0883e; font-weight: bold; }
</style>
