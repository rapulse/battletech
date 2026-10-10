<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { formatDate, t } from '../i18n/index.js';
  import { dateOf, factionName, standingBand } from './relations.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';

  /**
   * Экран отношений (шаг 20, часть D).
   *
   * Отдельная вкладка, а не строка в «Роте», и это решение плана шага 20:
   * отношения — двадцать акторов с историей, а не одно число рядом с гербом.
   *
   * Здесь ничего не считается. Оси, шкала и журнал приходят из ядра
   * (`core/campaign/reputation/`), причём журнал — из событий, а не из второго
   * списка в состоянии. Экран решает ровно одно: что показать числом, а что
   * словом (решение 2026-09-03, вопрос 2 плана): в журнале — точные величины,
   * в списке фракций — и число, и слово, потому что список читают глазами, а
   * сравнивают по числу.
   */

  const rep = $derived(campaign.reputation);
  const rows = $derived(campaign.standings);
  const journal = $derived(campaign.repLog);

  /**
   * Достаток фракций (шаг 21a, часть D) — столбцом в том же списке, а не
   * отдельным экраном.
   *
   * Список фракций уже здесь, и разводить «кто как к вам относится» и «кто чем
   * богат» по разным вкладкам значило бы заставлять игрока сличать два списка
   * глазами. Полоса, а не казна: наёмник читает сводки MRBC.
   */
  const wealth = $derived(new Map(campaign.economies.map((e) => [e.id, e])));
</script>

<div class="relations">
  <section class="panel panel-scroll list-panel">
    <div class="panel-header">
      <span>{t('relations.title')}</span>
      <span class="badge badge-dim">{rows.length}</span>
    </div>
    <div class="head-row">
      <span class="dim">{t('relations.faction')}</span>
      <span class="dim">{t('relations.bandColumn')}</span>
      <span class="dim">{t('relations.wealth')}</span>
      <span class="dim right">{t('relations.value')}</span>
    </div>
    <div class="scroll-area">
      {#each rows as row (row.id)}
        {@const w = wealth.get(row.id)}
        <div class="row" class:zero={row.standing === 0}>
          <span class="who">
            <FactionEmblem factionId={row.id} size={22} />
            <span class="strong">{factionName(row.id)}</span>
          </span>
          <span class="band">
            <span class="bar">
              <span
                class="fill"
                class:up={row.standing > 0}
                class:down={row.standing < 0}
                style:width={`${Math.abs(row.standing) / 2}%`}
              ></span>
            </span>
            <span class="dim small">{t(`relations.band.${standingBand(row.standing)}`)}</span>
          </span>
          <span
            class="small wealth"
            class:gold={w?.band === 'strong'}
            class:warn={w?.band === 'ruined'}
            class:dim={w === undefined || w.band === 'poor'}
            title={t('relations.economyHint')}
          >
            {w === undefined ? '—' : t(`starmap.prosperityBand.${w.band}`)}
          </span>
          <span class="right" class:cyan={row.standing > 0} class:warn={row.standing < 0}>
            {row.standing > 0 ? '+' : ''}{Math.round(row.standing)}
          </span>
        </div>
      {/each}
    </div>
  </section>

  <div class="side">
    <section class="panel axes">
      <div class="panel-header"><span>{t('relations.axes')}</span></div>
      <div class="panel-body">
        <div class="axis">
          <span class="dim">{t('relations.fame')}</span>
          <span class="bar">
            <span class="fill up" style:width={`${rep.fame}%`}></span>
          </span>
          <span class="cyan right">{Math.round(rep.fame)}</span>
        </div>
        <p class="dim small">{t('relations.fameHint')}</p>
        <div class="axis">
          <span class="dim">{t('relations.reliability')}</span>
          <span class="bar">
            <span class="fill up" style:width={`${rep.reliability}%`}></span>
          </span>
          <span class="cyan right">{Math.round(rep.reliability)}</span>
        </div>
        <p class="dim small">{t('relations.reliabilityHint')}</p>
      </div>
    </section>

    <section class="panel panel-scroll journal">
      <div class="panel-header">
        <span>{t('relations.journal')}</span>
        <span class="badge badge-dim">{journal.length}</span>
      </div>
      <div class="scroll-area">
        {#if journal.length === 0}
          <p class="dim small pad">{t('relations.journalEmpty')}</p>
        {:else}
          {#each journal as line, i (`${line.day}-${line.factionId}-${i}`)}
            <div class="entry">
              <span class="dim small">{formatDate(dateOf(line.day))}</span>
              <span class="strong">{factionName(line.factionId)}</span>
              <span class="dim small">{t(`relations.source.${line.source}`)}</span>
              <span class="right" class:cyan={line.delta > 0} class:warn={line.delta < 0}>
                {line.delta > 0 ? '+' : ''}{line.delta}
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .relations {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .side {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
  }
  .list-panel,
  .journal {
    overflow: hidden;
  }
  .head-row,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 170px 90px 70px;
    gap: 10px;
    align-items: center;
  }
  .head-row {
    padding: 0 10px 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid var(--color-border);
  }
  .row {
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .row.zero {
    opacity: 0.55;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .band {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wealth {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .axis {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr) 40px;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  .bar {
    position: relative;
    display: block;
    flex: 1;
    height: 6px;
    min-width: 60px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    display: block;
  }
  .fill.up {
    background: var(--color-accent);
  }
  .fill.down {
    background: var(--color-warn, #f85149);
  }
  .entry {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 92px 56px;
    gap: 8px;
    align-items: center;
    padding: 5px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .pad {
    padding: 10px;
  }
  .right {
    text-align: right;
  }
  .small {
    font-size: 11px;
  }
  .warn {
    color: var(--color-warn, #f85149);
  }
</style>
