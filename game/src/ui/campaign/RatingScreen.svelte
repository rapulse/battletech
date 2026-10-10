<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import { mercBase, mercName } from '../i18n/names.js';
  import { GALAXY, recordChassisDef } from '../../core/campaign/index.js';
  import CompanyEmblem from '../components/CompanyEmblem.svelte';
  import MercenaryEmblem from '../components/MercenaryEmblem.svelte';

  /**
   * Реестр MRBC (вкладка заведена шагом 17b, наполнена шагом 22).
   *
   * Таблица делится по МАСШТАБУ, и это не украшение. Сверху — великие полки
   * Сферы: они не симулируются, работу у роты не отнимают и стоят там, чем они
   * и являются, — потолком карьеры. Ниже — сектор: восемь отрядов, живущих по
   * тем же правилам, что рота игрока, и конкурирующих с ней за ту же биржу.
   *
   * **Экран не считает ничего.** Силу обеих частей даёт ядро одной и той же
   * формулой (`contracts/threat.ts::companyRating` для отрядов,
   * `rivals/registry.ts::forceRating` для полков — то же произведение «класс ×
   * вес × выучка», только парк задан средним). Ровно ради этого вкладку и
   * завели заранее: сила, посчитанная самим экраном, была бы спором с ядром о
   * том, чья формула правильная.
   *
   * Рейтинг не открывает работу и не поднимает оплату (решение 5 шага 22): у
   * репутации три оси, и четвёртая, дублирующая известность, разошлась бы с ней
   * на первом же шаге.
   */

  const rating = $derived(campaign.rating);
  const table = $derived(campaign.ratingTable);
  const bankrupt = $derived(campaign.rivalsBankrupt);

  let picked = $state<string>('player');

  /**
   * Строка роты подводится в вид — но ТОЛЬКО внутри списка сектора.
   *
   * Первая версия экрана прокручивала общий список, и это была ошибка, которую
   * видно с первого захода: обе половины лежали в одном контейнере, прокрутка к
   * строке роты уводила за верхний край Волчьих Драгун вместе с заголовком
   * «Великие полки Сферы», и экран открывался восемью безымянными строками без
   * объяснения, что это. Половины поэтому разведены по СВОИМ контейнерам:
   * реестр не уезжает никогда — он потолок, и весь его смысл в том, чтобы быть
   * на виду.
   */
  let ownRow = $state<HTMLElement | null>(null);
  let scrolled = false;
  $effect(() => {
    // Ровно один раз за заход: повторная прокрутка на каждом такте отнимала бы
    // у игрока список, стоило ему его пролистать. `nearest` вместо `center` —
    // чтобы список не дёргался, когда строка и так видна.
    if (scrolled || ownRow === null) return;
    scrolled = true;
    ownRow.scrollIntoView({ block: 'nearest' });
  });
  const rival = $derived(picked === 'player' ? undefined : campaign.rivalOf(picked));
  const regiment = $derived(picked === 'player' ? undefined : campaign.regimentOf(picked));
  const row = $derived(table.find((r) => r.id === picked));

  /**
   * Название строки таблицы: у отряда реестра MRBC оно берётся из словаря по id реестра (переводится),
   * у вольного отряда («Вольный отряд №7») и у роты игрока — как записано (шаг 64б). Id полка совпадает
   * с id реестра, у отряда сектора id реестра лежит в `Rival.unitId`.
   */
  function unitLabel(rowId: string, stored: string): string {
    const unitId = campaign.regimentOf(rowId) !== undefined ? rowId : (campaign.rivalOf(rowId)?.unitId ?? '');
    return mercName(unitId, stored);
  }

  function systemName(id: string): string {
    const i = GALAXY.index(id);
    return i < 0 ? id : GALAXY.name(i);
  }

  function mechName(recordId: string): string {
    return campaign.mechs.find((m) => m.id === recordId)?.name ?? recordId;
  }

  function pilotName(recordId: string): string {
    const mech = campaign.mechs.find((m) => m.id === recordId);
    if (mech === undefined) return '';
    return campaign.pilotOf(mech)?.callsign ?? t('hangar.noPilot');
  }

  /** Тоннаж парка соперника — то же, чем меряется парк роты на экране роты. */
  const rivalTons = $derived(
    rival === undefined ? 0 : rival.company.mechs.reduce((n, m) => n + recordChassisDef(m).tons, 0),
  );
</script>

<div class="rating">
  <section class="panel panel-scroll table">
    <div class="panel-header">
      <span class="hdr">
        <MercenaryEmblem index={15} size={22} />
        {t('rating.title')}
      </span>
      <span class="badge badge-gold">{t('rating.mrbc')}</span>
    </div>

    <div class="head-row">
      <span class="dim">#</span>
      <span class="dim">{t('rating.company')}</span>
      <span class="dim">{t('rating.where')}</span>
      <span class="dim">{t('rating.force')}</span>
      <span class="dim right">{t('rating.strength')}</span>
    </div>
    <div class="rows">
      {#each table as entry (entry.id)}
        <button
          type="button"
          class="row"
          bind:this={
            () => (entry.isPlayer ? ownRow : null), (el) => { if (entry.isPlayer) ownRow = el; }
          }
          class:own={entry.isPlayer}
          class:here={!entry.isPlayer && entry.here}
          class:selected={picked === entry.id}
          onclick={() => (picked = entry.id)}
        >
          <span class="rank" class:gold={entry.rank === 1}>{entry.rank}</span>
          <span class="who">
            <!--
              Зелёный кружок — «стоит здесь же, где вы». Он редкий и должен быть
              редким: отрядов в Сфере тысячи, миров две тысячи, и встреча — это
              событие, а не фон. Ставится ДО имени, чтобы читаться одним взглядом
              по всему столбцу.
            -->
            {#if entry.here && !entry.isPlayer}
              <span class="dot" title={t('rating.hereHint')}></span>
            {:else}
              <span class="dot-empty"></span>
            {/if}
            {#if entry.isPlayer}
              <CompanyEmblem index={entry.emblem} size={20} />
            {:else if entry.emblem >= 0}
              <MercenaryEmblem index={entry.emblem} size={20} />
            {:else}
              <!-- Вольный отряд: в реестре MRBC не значится, герба у него нет. -->
              <span class="no-emblem" title={t('rating.unregistered')}>·</span>
            {/if}
            <span class="strong" class:glow-cyan={entry.isPlayer} class:dim={!entry.registered}>
              {entry.isPlayer ? entry.name : unitLabel(entry.id, entry.name)}
            </span>
            {#if entry.shattered}
              <span class="warn tiny">{t('rating.shattered')}</span>
            {:else if !entry.isPlayer && entry.contracts > 0}
              <span class="dim tiny">{t('rating.record', { done: entry.wins, taken: entry.contracts })}</span>
            {/if}
          </span>
          <span class="dim small where">{systemName(entry.systemId)}</span>
          <span class="dim small force">
            {#if entry.forceSize === null}
              {entry.force}
            {:else}
              {t(
                entry.forceSize.regiments === 0
                  ? 'rating.forceBattalions'
                  : entry.forceSize.battalions === 0
                    ? 'rating.forceRegiments'
                    : 'rating.forceRegimentsBattalions',
                { regiments: entry.forceSize.regiments, battalions: entry.forceSize.battalions },
              )}
            {/if}
          </span>
          <span class="score right" class:gold={entry.isPlayer}>
            {entry.rating}
            {#if entry.change !== 0}
              <span class="tiny" class:up={entry.change > 0} class:down={entry.change < 0}>
                {entry.change > 0 ? '▲' : '▼'}{Math.abs(entry.change)}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    </div>

    <div class="panel-body">
      <p class="dim small">{t('rating.hint')}</p>
      {#if bankrupt > 0}
        <p class="dim small">{t('rating.bankrupt', { count: bankrupt })}</p>
      {/if}
    </div>
  </section>

  <section class="panel panel-scroll breakdown">
    {#if regiment !== undefined}
      <div class="panel-header">
        <span>{t('rating.dossier')}</span>
        <span class="badge badge-gold">{regiment.cert}</span>
      </div>
      <div class="scroll-area dossier">
        <div class="d-head">
          <MercenaryEmblem index={regiment.emblem} size={44} bordered />
          <span class="d-name strong">{mercName(regiment.id, regiment.name)}</span>
        </div>
        <div class="d-row"><span class="dim">{t('rating.dRating')}</span><span class="gold">{row?.rating ?? '—'}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dBase')}</span><span>{mercBase(regiment.id, regiment.base)}{regiment.holdsWorld ? ` ${t('rating.holdsWorld')}` : ''}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dWhere')}</span><span>{systemName(regiment.systemId)}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dStrength')}</span><span>{t('rating.dStrengthValue', { now: regiment.mechs, full: regiment.fullMechs })}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dRecord')}</span><span>{t('rating.record', { done: regiment.wins, taken: regiment.contracts })}</span></div>
        <p class="dim small note">{t('rating.dRegimentNote')}</p>
      </div>
    {:else if rival === undefined}
      <div class="panel-header">
        <span>{t('rating.byMech')}</span>
        <span class="badge badge-dim" title={t('rating.totalHint')}>{rating.total}</span>
      </div>
      <div class="scroll-area list">
        {#each rating.byMech as entry (entry.recordId)}
          <div class="mech-row" class:idle={entry.idle}>
            <span class="strong">{mechName(entry.recordId)}</span>
            <span class="dim">{pilotName(entry.recordId)}</span>
            {#if entry.idle}
              <span class="dim small">{t('rating.idle')}</span>
            {:else}
              <span class="cyan right">{entry.rating}</span>
            {/if}
          </div>
        {/each}
      </div>
      <div class="panel-body">
        <p class="dim small">{t('rating.totalHint')}</p>
      </div>
    {:else}
      <div class="panel-header">
        <span>{t('rating.dossier')}</span>
        <span class="badge badge-dim">#{row?.rank ?? '—'}</span>
      </div>
      <div class="scroll-area dossier">
        <div class="d-head">
          <MercenaryEmblem index={rival.emblem} size={44} bordered />
          <span class="d-name strong">{mercName(rival.unitId, rival.name)}</span>
        </div>
        <!--
          В досье только то, что рота МОЖЕТ знать: состав виден на поле, место —
          из сводок MRBC, счёт контрактов — публичный реестр. Кассы соперника
          здесь нет и не будет: заглянуть в чужую бухгалтерию наёмник не может,
          а показанное число сделало бы конкуренцию задачей на арифметику.
        -->
        <div class="d-row"><span class="dim">{t('rating.dRating')}</span><span class="gold">{row?.rating ?? '—'}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dWhere')}</span><span>{systemName(rival.systemId)}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dFleet')}</span><span>{t('rating.dFleetValue', { count: rival.company.mechs.length, tons: rivalTons })}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dPilots')}</span><span>{rival.company.pilots.length}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dRecord')}</span><span>{t('rating.record', { done: rival.wins, taken: rival.contracts })}</span></div>
        <div class="d-row"><span class="dim">{t('rating.dTier')}</span><span>{t(`rating.tier.${rival.tier}`)}</span></div>
        <p class="dim small note">{t('rating.dNote')}</p>
      </div>
    {/if}
  </section>
</div>

<style>
  .rating {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  /*
    Панель — сетка из четырёх полос: шапка, реестр, сектор, подпись. Реестру
    отдаётся столько, сколько он занимает (`auto`), сектору — весь остаток
    (`minmax(0, 1fr)`), и прокручиваются они ПОРОЗНЬ. Одна общая прокрутка на
    обе половины — ровно та ошибка, из-за которой экран открывался без
    Волчьих Драгун: список уезжал к строке роты и уносил с собой весь реестр.
  */
  .table {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    overflow: hidden;
  }
  .head-row {
    margin: 0 8px;
  }
  .breakdown {
    overflow: hidden;
  }
  /* Реестр не должен съедать экран целиком: семь строк видны, дальше прокрутка. */
  .rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    min-height: 0;
    padding-bottom: 4px;
  }
  .hdr {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head-row,
  .row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) 130px 96px 104px;
    gap: 10px;
    align-items: center;
    text-align: left;
  }
  /* Зелёный кружок — «стоит здесь же». Пустое место под него держится всегда,
     иначе строки с отрядом и без него разъезжались бы по столбцу. */
  .dot,
  .dot-empty {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot {
    background: #3fb950;
    box-shadow: 0 0 6px rgba(63, 185, 80, 0.8);
  }
  .no-emblem {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    opacity: 0.45;
  }
  .head-row {
    padding: 0 8px 5px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid var(--color-border);
  }
  .row {
    /* Строки уплотнены намеренно: в списке шестнадцать имён и больше, а
       прокрутка к строке роты прячет верх — на первом же скриншоте она увела за
       край Волчьих Драгун. Список обязан помещаться целиком. */
    padding: 3px 8px;
    font-size: 11.5px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .row {
    font: inherit;
    color: inherit;
    width: 100%;
    cursor: pointer;
  }
  .row:hover {
    border-color: var(--color-accent);
  }
  .row.selected {
    border-color: var(--color-accent);
  }
  .row.own {
    background: rgba(57, 197, 187, 0.08);
    border-color: var(--color-accent);
  }
  .row.here {
    border-left: 2px solid var(--color-warn, #d9a441);
  }
  .rank {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
    text-align: center;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .where,
  .force {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .score {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
  }
  .up {
    color: var(--color-accent);
  }
  .down {
    opacity: 0.6;
  }
  .right {
    text-align: right;
  }
  .tiny {
    font-size: 10px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
  }
  .mech-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px 90px;
    gap: 10px;
    align-items: center;
    padding: 6px 9px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    font-size: 11.5px;
  }
  .mech-row.idle {
    opacity: 0.65;
  }

  .dossier {
    padding: 12px;
  }
  .d-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 10px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .d-name {
    font-size: 14px;
  }
  .d-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
    font-size: 11.5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .note {
    margin-top: 12px;
    line-height: 1.5;
  }
  .strong {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 10px;
  }
  p {
    margin: 0 0 4px;
  }
</style>
