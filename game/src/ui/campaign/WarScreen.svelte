<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { t, tn } from '../i18n/index.js';
  import { dateOf, factionName } from './relations.js';
  import { GALAXY, WAR } from '../../core/campaign/index.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import WarLogList from './WarLogList.svelte';

  /**
   * Экран войны (шаг 21b, часть D).
   *
   * Отдельная вкладка, а не панель на экране отношений, и это решение
   * пользователя (2026-09-04): отношения — про ОТРЯД («кто как к вам
   * относится»), война — про МИР («кто кого потеснил»). Свести их на один экран
   * значило бы поставить рядом два журнала, которые читаются по-разному и о
   * разном.
   *
   * `ai.md` §2: «ощущение живого мира создаёт не глубина решений, а их связность
   * и видимость». Симуляция, которую игрок не видит, не отличается от
   * случайности, — поэтому этот экран половина работы шага, а не украшение к
   * ней.
   *
   * Здесь ничего не считается. Сводка приходит из событий ядра
   * (`frontMoved`, `warEffort`), направления фондов — из `core/campaign/war/`.
   */

  /** Фильтр ленты (шаг 78): вся война или только строки державы роты — по метке строки, а не второй журнал. */
  const FILTERS = ['all', 'realm'] as const;
  let filter = $state<(typeof FILTERS)[number]>('all');
  const journal = $derived(filter === 'realm' ? campaign.warLog.filter((l) => l.realm === true) : campaign.warLog);
  const economies = $derived(campaign.economies);
  /**
   * Объявленные наступления (шаг 23, часть B) — то, ради чего замысел вообще
   * заводился: до него фракция давила всюду понемногу, и лететь за войной было
   * некуда конкретно. Панель стоит НАД фондами, а не под ними: фонд отвечает на
   * «кто копит», замысел — на «куда пойдёт», и второе для наёмника важнее.
   */
  const plans = $derived(campaign.warPlans);

  /** Действует ли ещё перемирие Тукайида — то самое, из-за которого карта 3053 года статична. */
  const truce = $derived(dateOf(campaign.day).year < WAR.front.truceUntilYear);

  function systemName(id: string): string {
    const i = GALAXY.index(id);
    return i < 0 ? id : GALAXY.name(i);
  }
</script>

<div class="war">
  <section class="panel panel-scroll journal">
    <div class="panel-header">
      <span>{t('war.title')}</span>
      <span class="badge badge-dim">{journal.length}</span>
    </div>
    {#if campaign.hasRealm}
      <div class="filter pad">
        {#each FILTERS as id (id)}
          <button class="btn btn-sm" class:btn-gold={filter === id} onclick={() => (filter = id)}>{t(`war.filter.${id}`)}</button>
        {/each}
      </div>
    {/if}
    <p class="dim small pad truce">
      {truce ? t('war.truce', { year: WAR.front.truceUntilYear }) : t('war.truceOver')}
    </p>
    <div class="scroll-area">
      {#if journal.length === 0}
        <p class="dim small pad">{t('war.empty')}</p>
      {:else}
        <WarLogList lines={journal} />
      {/if}
    </div>
  </section>

  <section class="panel panel-scroll fronts">
    <div class="panel-header">
      <span>{t('war.plans')}</span>
      <span class="badge badge-dim">{plans.length}</span>
    </div>
    <p class="dim small pad">{t('war.plansHint')}</p>
    <div class="plans">
      {#if plans.length === 0}
        <p class="dim small pad">{t('war.noPlans')}</p>
      {:else}
        {#each plans as p (p.factionId)}
          <div class="plan-row">
            <FactionEmblem factionId={p.factionId} size={18} />
            <span class="strong">{factionName(p.factionId)}</span>
            <span class="dim small">
              {t('war.planRow', { defender: factionName(p.against), system: systemName(p.target) })}
            </span>
            <span class="cyan tiny right">{t('war.planTaken', { taken: p.taken })}</span>
          </div>
        {/each}
      {/if}
    </div>
    <div class="panel-header"><span>{t('war.factions')}</span></div>
    <p class="dim small pad">{t('war.factionsHint')}</p>
    <div class="scroll-area">
      {#each economies as row (row.id)}
        {@const fronts = campaign.warFrontsOf(row.id).slice(0, 3)}
        <div class="faction">
          <span class="who">
            <FactionEmblem factionId={row.id} size={20} />
            <span class="strong">{factionName(row.id)}</span>
            <span
              class="small"
              class:gold={row.band === 'strong'}
              class:warn={row.band === 'ruined'}
              class:dim={row.band === 'poor'}
            >
              {t(`starmap.prosperityBand.${row.band}`)}
            </span>
            <span class="dim tiny">{tn('count.worlds', row.worlds)}</span>
          </span>
          {#if fronts.length === 0}
            <span class="dim tiny indent">{t('war.noFunds')}</span>
          {:else}
            {#each fronts as f (f.against)}
              <span class="front indent">
                <span class="dim">→ {factionName(f.against)}</span>
                <span class="bar">
                  <!-- Доля от четырёх декад дохода: столько накапливает фракция,
                       всерьёз готовящаяся к наступлению. Полоса, а не число, по
                       тому же правилу, что достаток и гарнизон. -->
                  <span class="fill" style:width={`${Math.min(100, (f.ticks / 4) * 100)}%`}></span>
                </span>
                <span class="cyan tiny right">{t('war.ticks', { value: f.ticks.toFixed(1) })}</span>
              </span>
            {/each}
          {/if}
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .war {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 460px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .journal,
  .fronts {
    overflow: hidden;
  }
  .truce {
    border-bottom: 1px solid var(--color-border);
    margin: 0;
  }
  .plans {
    border-bottom: 1px solid var(--color-border);
  }
  .plan-row {
    display: grid;
    grid-template-columns: 18px auto minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    padding: 4px 10px;
  }
  .filter {
    display: flex;
    gap: 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .faction {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .indent {
    padding-left: 28px;
  }
  .front {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr) 110px;
    gap: 8px;
    align-items: center;
    font-size: 11px;
  }
  .bar {
    position: relative;
    display: block;
    height: 5px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--color-border);
  }
  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    display: block;
    background: var(--color-warn, #f85149);
  }
  .pad {
    padding: 8px 10px;
  }
  .right {
    text-align: right;
  }
  .small {
    font-size: 11px;
  }
  .tiny {
    font-size: 10px;
  }
  .warn {
    color: var(--color-warn, #f85149);
  }
</style>
