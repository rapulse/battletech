<script lang="ts">
  import { battle } from './state/battle.svelte.js';
  import { campaign } from './state/campaign.svelte.js';
  import { intelSurpriseText } from './state/intelText.js';
  import Header from './components/Header.svelte';
  import TacticalCanvas from './components/TacticalCanvas.svelte';
  import UnitCard from './components/UnitCard.svelte';
  import PhaseHint from './components/PhaseHint.svelte';
  import GeneratorControls from './components/GeneratorControls.svelte';
  import VisualLayers from './components/VisualLayers.svelte';
  import CombatLog from './components/CombatLog.svelte';
  import { t } from './i18n/index.js';

  /**
   * Рабочее место боя — то, чем оно было и до шага 17, теперь одним из режимов
   * приложения, а не всем приложением.
   *
   * Две роли, и различие между ними не косметическое:
   *
   * — **свободный бой** (песочница): карта генерируется здесь, вкладка
   *   «Генератор» на месте, «Начать заново» бросает новый сид;
   * — **бой по контракту**: карта, биом, состав и оба сида пришли из кампании
   *   (`BattleBrief`). Генератор в этом режиме не рисуется ВОВСЕ, а не
   *   выключается: перегенерировать карту посреди контракта — это переиграть
   *   контракт, и выключенная кнопка обещала бы, что когда-нибудь можно.
   *
   * `onFinish` — единственный выход из боя по контракту: бой отдаёт итог
   * кампании и не знает, что она с ним сделает.
   */
  let {
    onFinish,
    onExit,
    title,
    subtitle,
  }: {
    title?: string;
    subtitle?: string;
    /** Бой по контракту окончен: наверх уходит признак организованного отхода. */
    onFinish?: (withdrew: boolean) => void;
    /** Выход из песочницы. */
    onExit?: () => void;
  } = $props();

  /** Сколько ходов висит плашка «разведка ошиблась»: после третьего хода её снимают. */
  const INTEL_NOTICE_TURNS = 3;

  let activeTab = $state<'tactical' | 'generator' | 'layers'>('tactical');

  const contract = $derived(battle.contractMode);
  let canvas = $state<ReturnType<typeof TacticalCanvas> | null>(null);

  function regenerate(): void {
    // Игрок явно попросил начать заново — законное место для случайности
    // (как и `randomSeed()` в GeneratorControls.svelte для сида карты, тот же
    // диапазон — 6 цифр с запасом на коллизии при частых перезапусках).
    // Карта (`battle.options.seed`) при этом не трогается: чтобы перегенерировать
    // именно её, поле «Семя» в генераторе меняют отдельно, ДО этой кнопки.
    battle.regenerate(undefined, Math.floor(Math.random() * 900_000) + 100_000);
    canvas?.centerMap?.();
  }

  let legend = $derived(battle.terrainLegend());

  /*
    Исход боя по контракту — свёрнутая строка статуса (решение пользователя
    2026-09-15). Раньше блок был развёрнут всегда: сдвигал карточку машины вниз
    и держал кнопку отхода под рукой без подтверждения. Теперь короткий цветной
    заголовок виден сразу, а подробности и кнопка — только после щелчка по нему:
    раскрытие и есть подтверждение.

    Раскрыт блок только для того статуса, при котором его раскрыли. Статус
    меняется и в ход противника: без этого раскрытое «отвести звено» тихо
    подменилось бы другой кнопкой на том же месте под курсором.
  */
  type OutcomeStatus = 'fight' | 'objective' | 'won' | 'lost' | 'draw';

  const status = $derived.by((): OutcomeStatus => {
    if (battle.finished) {
      // Кто удержал поле, решает ядро (`buildOutcome`), здесь только подпись.
      const winner = battle.outcome().winner;
      return winner === 'player' ? 'won' : winner === 'opfor' ? 'lost' : 'draw';
    }
    return battle.objectiveMet ? 'objective' : 'fight';
  });

  /*
    Конец боя раскрывает блок сам: делать на поле больше нечего, а внутри одна
    кнопка — к разбору, и случайное нажатие ничего не ломает. Свернуть его
    игрок всё равно может (`collapsedFor`).
  */
  const battleOver = $derived(status === 'won' || status === 'lost' || status === 'draw');

  let openFor = $state<OutcomeStatus | null>(null);
  let collapsedFor = $state<OutcomeStatus | null>(null);
  const outcomeOpen = $derived(battleOver ? collapsedFor !== status : openFor === status);

  /*
    Отвод звена — с подтверждением (шаг 65). Вопрос снимается, когда статус боя или
    раскрытие блока меняются: он относится к тому положению машин, где его задали.
  */
  let confirmingWithdraw = $state(false);
  $effect(() => {
    void status;
    void outcomeOpen;
    confirmingWithdraw = false;
  });

  /*
    Подсветка зоны выхода (шаг 65): видна только тогда, когда игрок раскрыл блок
    «Исход боя» в контракте и видит кнопку «ОТВЕСТИ ЗВЕНО» — чтобы показать, куда
    выводить машины. При сворачивании блока или окончании боя подсветка убирается.
  */
  $effect(() => {
    battle.showExitZone = Boolean(contract && outcomeOpen && status === 'fight');
    return () => {
      battle.showExitZone = false;
    };
  });


  const withdrawWarning = $derived.by((): string => {
    const { inZone, stranded } = battle.exitReading;
    const total = inZone + stranded;
    if (stranded === 0) return t('battle.workspace.withdrawAll', { total });
    if (inZone === 0) return t('battle.workspace.withdrawNone', { total });
    return t('battle.workspace.withdrawSome', { inZone, total, lost: stranded });
  });

  function confirmWithdraw(): void {
    confirmingWithdraw = false;
    if (battle.evacuate()) onFinish?.(true);
  }

  function toggleOutcome(): void {
    if (battleOver) collapsedFor = outcomeOpen ? status : null;
    else openFor = outcomeOpen ? null : status;
  }
</script>

<div class="app-layout">
  <Header title={title ?? undefined} subtitle={subtitle ?? undefined} />

  <main class="workspace">
    <TacticalCanvas bind:this={canvas} />

    <aside class="sidebar">
      {#if contract && campaign.intelSurprise !== null && battle.turn <= INTEL_NOTICE_TURNS}
        <!--
          Шаг 61: разведка ошиблась именно в этом вылете. Стоит над вкладками правого меню, а не
          в шапке (строка шапки длинная и уехала бы), и снимается после третьего хода: к нему
          игрок уже прочёл. Красная — только когда противник сильнее обещанного.
        -->
        <div class="intel-notice" class:hot={campaign.intelSurprise.actual > campaign.intelSurprise.declared}>
          <span class="intel-label">{t('battle.workspace.intel')}</span>
          {intelSurpriseText(campaign.intelSurprise, 'battle')}
        </div>
      {/if}
      <div class="tabs">
        <button class="tab" class:active={activeTab === 'tactical'} onclick={() => (activeTab = 'tactical')}>
          {t('battle.workspace.tabTactical')}
        </button>
        {#if !contract}
          <button class="tab" class:active={activeTab === 'generator'} onclick={() => (activeTab = 'generator')}>
            {t('battle.workspace.tabGenerator')}
          </button>
        {/if}
        <button class="tab" class:active={activeTab === 'layers'} onclick={() => (activeTab = 'layers')}>
          {t('battle.workspace.tabLayers')}
        </button>
      </div>

      <div class="sidebar-content">
        {#if contract}
          <div class="panel-section outcome">
            <button
              class="outcome-toggle {status}"
              aria-expanded={outcomeOpen}
              onclick={toggleOutcome}
            >
              <span class="outcome-label">{t('battle.workspace.outcome')}</span>
              <span class="outcome-status">{t(`battle.workspace.status.${status}`)}</span>
              <span class="outcome-caret">{outcomeOpen ? '△' : '▽'}</span>
            </button>

            {#if outcomeOpen}
              {#if status === 'fight'}
                {#if confirmingWithdraw}
                  <!--
                    Предупреждение до нажатия «да»: сколько машин в зоне выхода, а сколько
                    останется на поле и будет потеряно. Числа считает ядро (`exitReading`).
                  -->
                  <p class="outcome-hint warn">{withdrawWarning}</p>
                  <div class="confirm-row">
                    <button class="outcome-btn danger" onclick={confirmWithdraw}>
                      {t('battle.workspace.withdrawYes')}
                    </button>
                    <button class="outcome-btn" onclick={() => (confirmingWithdraw = false)}>
                      {t('battle.workspace.withdrawNo')}
                    </button>
                  </div>
                {:else}
                  <p class="outcome-hint">{t('battle.workspace.fightHint')}</p>
                  <button class="outcome-btn danger" onclick={() => (confirmingWithdraw = true)}>
                    {t('battle.workspace.withdraw')}
                  </button>
                {/if}
              {:else if status === 'objective'}
                <p class="outcome-hint ok">{t('battle.workspace.objectiveHint')}</p>
                <button class="outcome-btn primary" onclick={() => onFinish?.(false)}>
                  {t('battle.workspace.finishWin')}
                </button>
              {:else}
                <p class="outcome-hint {status === 'won' ? 'ok' : ''}">
                  {#if status === 'won'}
                    {t('battle.workspace.wonHint')}
                  {:else if status === 'lost'}
                    {t('battle.workspace.lostHint')}
                  {:else}
                    {t('battle.workspace.drawHint')}
                  {/if}
                </p>
                <button class="outcome-btn primary" onclick={() => onFinish?.(false)}>
                  {t('battle.workspace.toDebrief')}
                </button>
              {/if}
            {/if}
          </div>
        {:else if onExit !== undefined}
          <div class="panel-section">
            <button class="outcome-btn" onclick={() => onExit?.()}>{t('battle.workspace.exitMenu')}</button>
          </div>
        {/if}

        {#if activeTab === 'tactical'}
          <UnitCard />
        {:else if activeTab === 'generator' && !contract}
          <GeneratorControls onGenerate={regenerate} />
        {:else}
          <VisualLayers />
        {/if}


        <div class="panel-section">
          <h4 class="section-title">{t('battle.workspace.legendTitle')}</h4>
          <!-- Числа берутся из data/terrain.json, а не переписаны в разметку:
               переписанное число живёт своей жизнью и однажды разойдётся. -->
          <div class="legend-list">
            {#each legend as row (row.key)}
              <div class="legend-row">
                <span class="swatch {row.key}"></span>
                <span>{t(row.cover > 0 ? 'battle.workspace.legendRowCover' : 'battle.workspace.legendRow', row)}</span>
              </div>
            {/each}
            <div class="legend-row">
              <span class="swatch hill"></span>
              <span>{t('battle.workspace.legendHill')}</span>
            </div>
          </div>
        </div>

        {#if activeTab === 'tactical'}
          <PhaseHint />
        {/if}

        <CombatLog />
      </div>
    </aside>
  </main>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body) {
    margin: 0; padding: 0;
    background: #0d1117; color: #e6edf3;
    font-family: 'Share Tech Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden; height: 100vh; user-select: none;
    -webkit-font-smoothing: antialiased;
  }
  :global(::-webkit-scrollbar) { width: 6px; height: 6px; }
  :global(::-webkit-scrollbar-track) { background: #0d1117; }
  :global(::-webkit-scrollbar-thumb) { background: #30363d; border-radius: 3px; }
  :global(::-webkit-scrollbar-thumb:hover) { background: #58a6ff; }

  .app-layout { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; }
  .workspace { flex: 1; display: flex; position: relative; overflow: hidden; min-height: 0; }
  .sidebar {
    width: 360px; flex-shrink: 0;
    background: #0d1117; border-left: 1px solid #30363d;
    display: flex; flex-direction: column; overflow: hidden; z-index: 8;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.4);
  }
  .intel-notice {
    flex-shrink: 0; padding: 8px 12px; background: rgba(227, 179, 65, 0.1);
    border-bottom: 1px solid #30363d; color: #e3b341;
    font-family: monospace; font-size: 11px; line-height: 1.45;
  }
  .intel-notice.hot { background: rgba(248, 81, 73, 0.12); color: #f85149; }
  .intel-label { font-weight: bold; margin-right: 4px; }
  .tabs { display: flex; background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0; }
  .tab {
    flex: 1; padding: 10px 4px; background: none; border: none;
    border-bottom: 2px solid transparent; color: #8b949e;
    font-family: monospace; font-size: 11px; font-weight: bold; cursor: pointer;
    transition: all 0.15s;
  }
  .tab:hover { color: #e6edf3; background: rgba(255, 255, 255, 0.03); }
  .tab.active { color: #39c5bb; border-bottom-color: #39c5bb; background: rgba(57, 197, 187, 0.08); }
  .sidebar-content {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 12px; min-height: 0;
  }
  .panel-section {
    padding: 12px; background: #161b22;
    border: 1px solid #30363d; border-radius: 6px; flex-shrink: 0;
  }
  .section-title {
    margin: 0 0 10px 0; font-size: 11px; color: #8b949e;
    letter-spacing: 0.5px; font-family: monospace;
  }
  .legend-list { display: flex; flex-direction: column; gap: 6px; }
  .legend-row {
    display: flex; align-items: center; gap: 8px;
    font-size: 10px; color: #c9d1d9; font-family: monospace;
  }
  .swatch {
    width: 12px; height: 12px; border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.15); flex-shrink: 0;
  }
  .outcome { display: flex; flex-direction: column; gap: 8px; }
  .outcome-toggle {
    display: flex; align-items: baseline; gap: 6px; width: 100%;
    padding: 0; background: none; border: none; cursor: pointer; text-align: left;
    font-family: monospace; font-size: 11px; font-weight: bold; letter-spacing: 0.5px;
  }
  .outcome-label { color: #8b949e; flex-shrink: 0; }
  .outcome-status { flex: 1; color: #c9d1d9; }
  .outcome-caret { color: #8b949e; }
  .outcome-toggle:hover .outcome-caret { color: #39c5bb; }
  /* Цвет статуса — то, что привлекает взгляд без раскрытия. */
  .outcome-toggle.objective .outcome-status,
  .outcome-toggle.won .outcome-status { color: #5cd6a0; }
  .outcome-toggle.lost .outcome-status,
  .outcome-toggle.draw .outcome-status { color: #e3b341; }
  .outcome-hint { margin: 0; font-size: 10px; line-height: 1.5; color: #8b949e; font-family: monospace; }
  .outcome-hint.ok { color: #5cd6a0; }
  .outcome-btn {
    flex: 1; padding: 8px 10px; cursor: pointer;
    background: #21262d; border: 1px solid #30363d; color: #e6edf3;
    font-family: monospace; font-size: 11px; font-weight: bold; letter-spacing: 1px;
  }
  .outcome-btn:hover { border-color: #58a6ff; color: #fff; }
  .outcome-btn.primary { background: rgba(57, 197, 187, 0.15); border-color: #39c5bb; color: #39c5bb; }
  .outcome-hint.warn { color: #e3b341; }
  .confirm-row { display: flex; gap: 6px; }
  .confirm-row .outcome-btn { flex: 1; }
  .outcome-btn.danger { background: rgba(248, 81, 73, 0.15); border-color: #f85149; color: #f85149; }
  .swatch.plain { background: #6c9e47; }
  .swatch.lightWoods { background: #439445; }
  .swatch.heavyWoods { background: #1d4825; }
  .swatch.rough { background: #6b665c; }
  .swatch.water { background: #2574a9; }
  .swatch.hill { background: #5f8e3c; }
</style>
