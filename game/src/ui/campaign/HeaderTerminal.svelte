<script lang="ts">
  import { campaign, isSharedScreen, type Screen, type RealmTab } from '../state/campaign.svelte.js';
  import { enterBattleScreen } from '../state/battleScreen.js';
  import { cbills, days as daysText, t } from '../i18n/index.js';
  import CompanyEmblem from '../components/CompanyEmblem.svelte';
  import ProgressBadge from './ProgressBadge.svelte';

  /**
   * Командная шапка: кто мы, где мы, какое сегодня число и сколько в кассе.
   *
   * Все четыре величины читаются у ядра через стор и НИ ОДНА не считается
   * здесь: содержание роты — `payrollAmount`, дата — `dateOf`, оценка —
   * `companyRating`. Шапка это показывает.
   */

  interface CompanyTabDef {
    readonly id: Screen;
    readonly key: string;
  }

  interface RealmTabDef {
    readonly id: string;
    readonly screen: Screen;
    readonly realmTab: RealmTab | null;
    readonly key: string;
  }

  /**
   * Вкладки роты в порядке рабочего цикла: чиню → переоснащаю → набираю людей →
   * закупаюсь → беру работу → смотрю, чего стою.
   */
  const COMPANY_TABS: readonly CompanyTabDef[] = [
    { id: 'hangar', key: 'app.nav.hangar' },
    { id: 'mechlab', key: 'app.nav.mechlab' },
    { id: 'barracks', key: 'app.nav.barracks' },
    { id: 'market', key: 'app.nav.market' },
    { id: 'starmap', key: 'app.nav.starmap' },
    { id: 'contracts', key: 'app.nav.contracts' },
    { id: 'relations', key: 'app.nav.relations' },
    { id: 'war', key: 'app.nav.war' },
    { id: 'rating', key: 'app.nav.rating' },
    { id: 'company', key: 'app.nav.company' },
  ];

  /**
   * Вкладки державы (шаг 72) — только когда у роты есть мир: до первого мира экрану нечего
   * показывать, а путь к нему идёт через звёздную карту. Штаб (карта державы, шаг 93) → миры →
   * армия и фронты → дипломатия → карта Сферы → хроника войн; «(А)» — прежний экран, оставлен для
   * сравнения до решения пользователя.
   * Карта и «Война» есть в обоих наборах: роте они нужны для контрактов, державе — для фронтов.
   */
  const REALM_TABS: readonly RealmTabDef[] = [
    { id: 'hq', screen: 'realm', realmTab: 'hq', key: 'realm.tab.hq' },
    { id: 'worlds', screen: 'realm', realmTab: 'worlds', key: 'realm.tab.worlds' },
    { id: 'forces', screen: 'realm', realmTab: 'forces', key: 'realm.tab.forces' },
    { id: 'diplomacy', screen: 'realm', realmTab: 'diplomacy', key: 'realm.tab.diplomacy' },
    { id: 'starmap', screen: 'starmap', realmTab: null, key: 'app.nav.starmap' },
    { id: 'war', screen: 'war', realmTab: null, key: 'app.nav.war' },
    { id: 'legacy', screen: 'realm', realmTab: 'legacy', key: 'realm.tab.legacy' },
  ];

  /** Режим шапки выводится из открытого экрана (`campaign.scope`). */
  const activeScope = $derived(campaign.scope);

  function isRealmTabActive(tabDef: RealmTabDef): boolean {
    if (campaign.screen !== tabDef.screen) return false;
    return tabDef.realmTab === null || campaign.realmTab === tabDef.realmTab;
  }

  function selectCompanyTab(screen: Screen): void {
    if (isSharedScreen(screen)) campaign.openShared(screen, 'company');
    else campaign.screen = screen;
  }

  function selectRealmTab(tabDef: RealmTabDef): void {
    if (tabDef.realmTab !== null) campaign.setRealmTab(tabDef.realmTab);
    else if (isSharedScreen(tabDef.screen)) campaign.openShared(tabDef.screen, 'realm');
  }

  /** Куда летим и сколько осталось. `null` — рота на стоянке. */
  const trip = $derived(campaign.destination);

  /** Есть ли в роте раненый пилот, который ещё не отправлен в лазарет. */
  const needsMedic = $derived(campaign.pilots.some((p) => p.status === 'active' && p.injuries > 0));

  /**
   * Держава на фронте, и мир роты стоит участком (шаг 72a): его могут отнять.
   * Набеги значка не зажигают — они идут постоянно и флага не меняют.
   */
  const realmUnderFire = $derived(
    campaign.hasRealm && campaign.realmWorlds.some((w) => w.threats.length > 0),
  );

  let logModalOpen = $state(false);
  let logIndex = $state(0);
  let logFilter = $state<'all' | 'money' | 'warn' | 'info'>('all');

  function openLog(): void {
    logModalOpen = true;
  }

  function closeLog(): void {
    logModalOpen = false;
  }

  function prevLog(): void {
    if (campaign.logs.length > 0) {
      logIndex = Math.min(campaign.logs.length - 1, logIndex + 1);
    }
  }

  function nextLog(): void {
    if (campaign.logs.length > 0) {
      logIndex = Math.max(0, logIndex - 1);
    }
  }

  const clampedIndex = $derived(campaign.logs.length === 0 ? 0 : Math.min(logIndex, campaign.logs.length - 1));
  const currentLog = $derived(campaign.logs[clampedIndex] ?? null);

  const moneyCount = $derived(campaign.logs.filter((l) => l.kind === 'money').length);
  const warnCount = $derived(campaign.logs.filter((l) => l.kind === 'warn').length);
  const infoCount = $derived(campaign.logs.filter((l) => l.kind === 'info').length);

  const filteredLogs = $derived.by(() => {
    if (logFilter === 'all') return campaign.logs;
    return campaign.logs.filter((l) => l.kind === logFilter);
  });
</script>

<header class="terminal-header">
  <div class="status-bar">
    <button class="unit" onclick={() => campaign.toMenu()} title={t('common.back')}>
      <CompanyEmblem index={campaign.emblem} size={34} bordered />
      <span class="unit-meta">
        <span class="unit-name glow-cyan">{campaign.companyName}</span>
        <span class="unit-sub dim">
          {t('header.commander', { callsign: campaign.commander })} · {t('header.ship')}
        </span>
      </span>
    </button>

    <div class="place">
      <div class="place-row">
        <span class="dim">{t('header.system')}:</span>
        {#if trip !== null}
          <span class="gold">
            {t('header.travelling', { system: trip.name, days: daysText(trip.daysLeft) })}
          </span>
        {:else}
          <span class="cyan strong">{campaign.system.name}</span>
        {/if}
      </div>
      <div class="place-row">
        <span class="dim">{t('header.date')}:</span>
        <!-- Ширина даты и номера дня закреплена: «1 мая» → «28 сентября» не сдвигает кнопки дней. -->
        <span class="strong date">{campaign.date}</span>
        <span class="dim day-no">({t('header.day', { day: campaign.day })})</span>
        <span class="steps" class:running={campaign.advancing !== null}>
          {#each [1, 7, 30] as n (n)}
            <!-- Пока считается мир, все три кнопки выключены, а нажатая крутит значок поверх надписи: клик прошёл, ждать. -->
            <button
              class="step"
              class:busy={campaign.advancing === n}
              aria-busy={campaign.advancing === n}
              disabled={campaign.advancing !== null || !campaign.can({ kind: 'advance', days: n })}
              onclick={() => void campaign.advanceDays(n)}
            >
              <span class="step-label">{t(`header.advance${n}`)}</span>
              {#if campaign.advancing === n}<span class="spinner" aria-hidden="true"></span>{/if}
            </button>
          {/each}
        </span>
      </div>
    </div>

    <div class="money">
      <div class="money-row">
        <span class="dim small">{t('header.cbills')}</span>
        <span class="sum glow-gold" class:danger={campaign.cbills < 0}>
          {cbills(campaign.cbills)}
        </span>
      </div>
      <span class="upkeep">{t('header.upkeep', { sum: cbills(campaign.upkeep) })}</span>
    </div>

    <div class="tools">
      {#if campaign.bankrupt}
        <span class="badge badge-danger">{t('header.bankrupt')}</span>
      {/if}
      {#if campaign.storageFailed}
        <span class="badge badge-danger" title={t('app.menu.storageFailed')}>IndexedDB</span>
      {/if}
      <ProgressBadge />
      <!--
        Дискета — выгрузка в файл, а не сохранение: кампания и так пишется в
        хранилище браузера после каждой команды. Слово — в подсказке, чтобы
        шапка не росла вширь.
      -->
      <button
        class="btn btn-sm save-btn"
        onclick={() => campaign.exportFile()}
        title={`${t('save.export')}\n${t('save.exportHint')}`}
        aria-label={t('save.export')}
      >
        💾
      </button>
      <button class="btn btn-sm" onclick={() => campaign.openSettings()} title={t('header.settingsHint')}>
        {t('header.settings')}
      </button>
      <a
        href="./wiki.html"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-sm wiki-btn"
        title={t('header.wikiHint')}
      >
        {t('header.wiki')}
      </a>
    </div>
  </div>

  <div class="nav-row" class:realm-scope={activeScope === 'realm'}>
    <!--
      Режим шапки (рота / держава) — в начале строки вкладок, вне её прокрутки:
      он решает, какие вкладки в строке, и на узком экране не уезжает вместе с
      ними. Значки режима, который сейчас не на экране, видны на его кнопке.
    -->
    {#if campaign.hasRealm}
      <div class="scope-switch" role="tablist" aria-label={t('app.nav.scopeSwitch')}>
        <button
          class="scope-btn scope-company"
          class:active={activeScope === 'company'}
          onclick={() => campaign.setScope('company')}
          title={t('app.nav.scopeCompanyHint')}
          role="tab"
          aria-selected={activeScope === 'company'}
        >
          {t('app.nav.scopeCompany')}
          {#if needsMedic}
            <span class="medic-icon" title={t('app.nav.barracksInjuredHint')}>✚</span>
          {/if}
        </button>
        <button
          class="scope-btn scope-realm"
          class:active={activeScope === 'realm'}
          onclick={() => campaign.setScope('realm')}
          title={t('app.nav.scopeRealmHint')}
          role="tab"
          aria-selected={activeScope === 'realm'}
        >
          {t('app.nav.scopeRealm')}
          {#if realmUnderFire}
            <span class="medic-icon" title={t('app.nav.realmUnderFireHint')}>⚔</span>
          {/if}
        </button>
      </div>
    {/if}
    <nav class="tabs">
      <!--
        `data-screen` — адрес вкладки для сквозной проверки. Номер в списке для
        этого не годится: список растёт, и смоук начинает жать не туда молча
        (найдено при добавлении экранов шага 17b). Видимый текст тоже не
        годится — он приходит из словаря и меняется вместе с ним. Вкладки
        державы ведут на один экран и различаются `data-realm-tab`.
      -->
      {#if activeScope === 'company'}
        {#each COMPANY_TABS as tab (tab.id)}
          <button
            class="tab"
            data-screen={tab.id}
            class:active={campaign.screen === tab.id}
            onclick={() => selectCompanyTab(tab.id)}
          >
            {t(tab.key)}
            {#if tab.id === 'barracks' && needsMedic}
              <span class="medic-icon" title={t('app.nav.barracksInjuredHint')}>✚</span>
            {/if}
          </button>
        {/each}
      {:else}
        {#each REALM_TABS as tab (tab.id)}
          <button
            class="tab tab-realm"
            data-screen={tab.screen}
            data-realm-tab={tab.realmTab ?? undefined}
            class:active={isRealmTabActive(tab)}
            onclick={() => selectRealmTab(tab)}
          >
            {t(tab.key)}
            {#if tab.id === 'hq' && realmUnderFire}
              <span class="medic-icon" title={t('app.nav.realmUnderFireHint')}>⚔</span>
            {/if}
          </button>
        {/each}
      {/if}

      <!--
        Бой и разбор — не места, куда ходят по вкладке: в бой выводит контракт, а
        разбор открывается сам по возвращении. Вкладки для них рисуются только
        когда есть что показать, иначе это две кнопки в никуда.
        Если есть разбор — бой уже отыгран, кнопку «Бой» скрываем, чтобы случайно не нажать.
      -->
      {#if campaign.deployed && !campaign.hasDebrief}
        <button
          class="tab alarm"
          data-screen="battle"
          class:active={campaign.screen === 'battle'}
          onclick={enterBattleScreen}
        >
          {t('app.nav.battle')}
        </button>
      {/if}
      {#if campaign.hasDebrief}
        <button
          class="tab alarm"
          data-screen="debrief"
          class:active={campaign.screen === 'debrief'}
          onclick={() => (campaign.screen = 'debrief')}
        >
          {t('app.nav.debrief')}
        </button>
      {/if}
    </nav>
  </div>

  <div class="ticker">
    <button class="ticker-tag-btn" onclick={openLog} title={t('header.logOpenFull')}>
      <span class="ticker-tag">{t('header.log')} //</span>
    </button>
    {#if campaign.logs.length === 0}
      <span class="dim ticker-empty">{t('header.logEmpty')}</span>
    {:else}
      <div class="ticker-nav">
        <button
          class="ticker-arrow"
          disabled={clampedIndex >= campaign.logs.length - 1}
          onclick={prevLog}
          title={t('header.logPrev')}
          aria-label={t('header.logPrev')}
        >
          ▲
        </button>
        <span class="ticker-pos dim">
          {clampedIndex + 1}/{campaign.logs.length}
        </span>
        <button
          class="ticker-arrow"
          disabled={clampedIndex <= 0}
          onclick={nextLog}
          title={t('header.logNext')}
          aria-label={t('header.logNext')}
        >
          ▼
        </button>
      </div>
      {#if currentLog !== null}
        <button
          class="ticker-body"
          onclick={openLog}
          title={t('header.logOpenFull')}
        >
          <span class="ticker-day dim">[{t('header.logDayBadge', { day: currentLog.day })}]</span>
          <span
            class="ticker-text"
            class:gold={currentLog.kind === 'money'}
            class:danger={currentLog.kind === 'warn'}
          >
            {currentLog.text}
          </span>
        </button>
      {/if}
    {/if}
  </div>
</header>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && logModalOpen) closeLog(); }} />

{#if logModalOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeLog();
    }}
  >
    <div class="modal log-modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="panel-header log-header">
        <div class="log-title-wrap">
          <span class="log-title">📜 {t('header.logTitle')}</span>
          <span class="badge badge-cyan">{t('header.logEvents', { count: campaign.logs.length })}</span>
        </div>
        <button class="btn btn-sm" onclick={closeLog} title={t('header.logClose')}>✕</button>
      </div>

      <div class="log-filter-bar">
        <button
          class="log-filter-tab"
          class:active={logFilter === 'all'}
          onclick={() => (logFilter = 'all')}
        >
          {t('header.logFilterAll')}
          <span class="badge badge-dim">{campaign.logs.length}</span>
        </button>
        <button
          class="log-filter-tab"
          class:active={logFilter === 'money'}
          onclick={() => (logFilter = 'money')}
        >
          {t('header.logFilterMoney')}
          <span class="badge badge-gold">{moneyCount}</span>
        </button>
        <button
          class="log-filter-tab"
          class:active={logFilter === 'warn'}
          onclick={() => (logFilter = 'warn')}
        >
          {t('header.logFilterWarn')}
          <span class="badge badge-danger">{warnCount}</span>
        </button>
        <button
          class="log-filter-tab"
          class:active={logFilter === 'info'}
          onclick={() => (logFilter = 'info')}
        >
          {t('header.logFilterInfo')}
          <span class="badge badge-cyan">{infoCount}</span>
        </button>
      </div>

      <div class="log-list">
        {#if filteredLogs.length === 0}
          <div class="log-empty dim">{t('header.logEmptyFilter')}</div>
        {:else}
          {#each filteredLogs as entry, idx (idx)}
            <div
              class="log-item"
              class:item-money={entry.kind === 'money'}
              class:item-warn={entry.kind === 'warn'}
            >
              <div class="log-item-meta">
                <span class="log-item-day dim">
                  {t('header.logDayBadge', { day: entry.day })}
                </span>
                {#if entry.kind === 'money'}
                  <span class="badge badge-gold">{t('header.logKindMoney')}</span>
                {:else if entry.kind === 'warn'}
                  <span class="badge badge-danger">{t('header.logKindWarn')}</span>
                {:else}
                  <span class="badge badge-cyan">{t('header.logKindInfo')}</span>
                {/if}
              </div>
              <div
                class="log-item-text"
                class:gold={entry.kind === 'money'}
                class:danger={entry.kind === 'warn'}
              >
                {entry.text}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div class="panel-header log-footer">
        <span class="dim small">{t('header.logFooterHint')}</span>
        <button class="btn btn-primary btn-sm" onclick={closeLog}>{t('header.logClose')}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .terminal-header {
    display: flex;
    flex-direction: column;
    background: var(--color-panel);
    border-bottom: 2px solid var(--color-border);
    flex-shrink: 0;
    z-index: 20;
  }

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .unit {
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .unit:hover .unit-name {
    color: #fff;
  }
  .unit-meta {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .unit-name {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .unit-sub {
    font-size: 10.5px;
  }

  .place {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .place-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    white-space: nowrap;
  }
  .strong {
    font-weight: 700;
  }
  .small {
    font-size: 10px;
  }

  .steps {
    display: inline-flex;
    gap: 3px;
    margin-left: 6px;
  }
  .date {
    display: inline-block;
    min-width: 17ch;
  }
  .day-no {
    display: inline-block;
    min-width: 12ch;
  }
  .step {
    position: relative;
    padding: 2px 7px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }
  .step:hover:not(:disabled) {
    background: var(--color-border);
    color: #fff;
  }
  .step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  /* Пока считается мир, курсор не меняется: расчёт короткий, смена курсора только мелькает. */
  .steps.running .step:disabled {
    cursor: pointer;
  }
  /* Нажатая кнопка во время расчёта — яркая, а не погашенная, как соседние: видно, что считается она. */
  .step.busy:disabled {
    opacity: 1;
    border-color: var(--color-accent);
  }
  /* Значок встаёт поверх скрытой надписи: размер кнопки не меняется, строка не дёргается. */
  .step.busy .step-label {
    visibility: hidden;
  }
  .spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border: 1.5px solid var(--color-accent);
    border-right-color: transparent;
    border-radius: 50%;
    animation: step-spin 0.7s linear infinite;
  }
  @keyframes step-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .money {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.25;
  }
  .money-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sum {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    color: var(--color-gold);
  }
  .sum.danger {
    color: var(--color-danger);
  }
  .upkeep {
    font-size: 10.5px;
    color: var(--color-text-dim);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nav-row {
    display: flex;
    background: var(--color-panel-sub);
    border-bottom: 1px solid var(--color-border);
    transition: background 0.15s ease;
  }
  /* В режиме державы строка чуть отдаёт золотом — режим читается боковым зрением. */
  .nav-row.realm-scope {
    background: linear-gradient(rgba(227, 179, 65, 0.06), rgba(227, 179, 65, 0.06)), var(--color-panel-sub);
  }
  .tabs {
    display: flex;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  .tab {
    padding: 8px 22px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .tab:hover {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.03);
  }
  .tab.active {
    color: var(--color-accent);
    background: var(--color-panel);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  /* Держава — золотом, как её кнопка в переключателе режима. */
  .tab.tab-realm.active {
    color: var(--color-gold);
    box-shadow: inset 0 -2px 0 var(--color-gold);
  }
  .medic-icon {
    display: inline-block;
    margin-left: 5px;
    color: var(--color-danger);
    font-weight: 800;
  }
  .tab.alarm {
    color: var(--color-gold);
  }
  .tab.alarm.active {
    color: var(--color-gold);
    box-shadow: inset 0 -2px 0 var(--color-gold);
  }

  /* --- переключатель режима (рота / держава): одна плашка из двух половин --- */
  .scope-switch {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 10px;
    background: #090c10;
    border-right: 1px solid var(--color-border);
  }
  .scope-btn {
    display: inline-flex;
    align-items: center;
    padding: 5px 16px;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 0;
    color: var(--color-text-dim);
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  /* Половины делят общую рамку; активная — поверх, чтобы её цветная рамка была целой. */
  .scope-btn + .scope-btn {
    margin-left: -1px;
  }
  .scope-btn.active {
    position: relative;
    z-index: 1;
  }
  .scope-btn:hover:not(.active) {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.05);
  }
  .scope-btn.active.scope-company {
    color: var(--color-accent);
    background: rgba(57, 197, 187, 0.15);
    border-color: var(--color-accent);
    text-shadow: 0 0 6px var(--glow-cyan);
  }
  .scope-btn.active.scope-realm {
    color: var(--color-gold);
    background: rgba(227, 179, 65, 0.15);
    border-color: var(--color-gold);
    text-shadow: 0 0 6px var(--glow-gold);
  }

  .ticker {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 14px;
    background: #090c10;
    border-bottom: 1px solid var(--color-border);
    font-size: 11px;
    color: var(--color-text-dim);
  }
  .ticker-tag-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
    display: flex;
    align-items: center;
  }
  .ticker-tag-btn:hover .ticker-tag {
    color: #fff;
    text-shadow: 0 0 8px var(--glow-gold);
  }
  .ticker-tag {
    color: var(--color-gold);
    font-weight: 700;
    flex-shrink: 0;
    transition: color 0.15s ease;
  }
  .ticker-empty {
    font-size: 11px;
  }
  .ticker-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 0 3px;
  }
  .ticker-arrow {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 8px;
    color: var(--color-accent);
    cursor: pointer;
    line-height: 1;
  }
  .ticker-arrow:hover:not(:disabled) {
    color: #fff;
  }
  .ticker-arrow:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
  .ticker-pos {
    font-family: var(--font-mono);
    font-size: 9.5px;
    padding: 0 3px;
    user-select: none;
  }
  .ticker-body {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .ticker-body:hover .ticker-text {
    text-decoration: underline;
  }
  .ticker-day {
    font-family: var(--font-mono);
    font-size: 10px;
    flex-shrink: 0;
  }
  .ticker-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
  }

  /* --- модальное окно журнала --- */
  .log-modal {
    width: 740px;
    max-width: 92vw;
    height: 580px;
    max-height: 86vh;
  }
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .log-title-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .log-title {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }
  .log-filter-bar {
    display: flex;
    gap: 4px;
    background: var(--color-panel-sub);
    border-bottom: 1px solid var(--color-border);
    padding: 4px 10px;
  }
  .log-filter-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--color-text-dim);
    font-family: var(--font-display);
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .log-filter-tab:hover {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.04);
  }
  .log-filter-tab.active {
    color: var(--color-accent);
    border-color: var(--color-border);
    background: var(--color-panel);
  }
  .log-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    background: #070a0e;
  }
  .log-empty {
    text-align: center;
    padding: 40px 16px;
    font-size: 12px;
  }
  .log-item {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 7px 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    font-size: 12px;
    line-height: 1.4;
  }
  .log-item.item-money {
    border-left: 3px solid var(--color-gold);
  }
  .log-item.item-warn {
    border-left: 3px solid var(--color-danger);
  }
  .log-item-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .log-item-day {
    font-family: var(--font-mono);
    font-size: 10.5px;
    min-width: 62px;
  }
  .log-item-text {
    flex: 1;
    word-break: break-word;
  }
  .log-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--color-border);
    border-bottom: none;
  }

  .wiki-btn {
    text-decoration: none;
    border-color: rgba(57, 197, 187, 0.4);
    color: var(--color-accent);
  }
  .wiki-btn:hover {
    border-color: var(--color-accent);
    color: #ffffff;
  }
</style>
