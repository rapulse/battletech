<script lang="ts">
  import { skillLevel, talentCap, type Pilot } from '../../core/model/Pilot.js';
  import { tr } from '../../core/log/index.js';
  import { recordChassisDef } from '../../core/campaign/mech/MechRecord.js';
  import { campaign, isWreck, mechStatusOf } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, t } from '../i18n/index.js';
  import PilotPortrait from '../components/PilotPortrait.svelte';
  import MechSilhouette from '../components/MechSilhouette.svelte';
  import { paintOfRecord } from '../components/mechArt.js';
  import AtlasImage from '../components/AtlasImage.svelte';
  import { factionName } from './relations.js';
  import { skillGuide } from './skillGuide.js';

  /**
   * Казармы: кто в роте, кто в лазарете, кого нанять и чему учить.
   *
   * Ни одного правила про навыки здесь нет. Уровень с учётом травм считает
   * `skillLevel`, цену следующего уровня — `levelCost`, а в уровни опыт
   * переводит ядро само (`settleTraining`, до потолка таланта). Экран
   * спрашивает и показывает.
   */

  /**
   * ПЕРЕБОР КАНДИДАТОВ — чистая мультипликация (найм 2026-09-10).
   *
   * Кандидат уже вытянут ядром в момент команды: бросок сделан, деньги списаны,
   * результат лежит в состоянии. Мелькающие лица и имена не решают НИЧЕГО — это
   * показ того, что поиск идёт, и ни одна их строка в игру не попадает. Своего
   * ГПСЧ здесь поэтому нет: кадры листаются счётчиком по кругу.
   */
  let spinning = $state(false);
  let spinFrame = $state(0);
  let spinTimer: ReturnType<typeof setInterval> | null = null;
  let confirmingDismissPilotId = $state<string | null>(null);

  /** Сколько кадров крутить и как быстро. Полторы секунды — успеть прочитать, что идёт поиск. */
  const SPIN_MS = 90;
  const SPIN_FRAMES = 16;

  const pilots = $derived(campaign.pilots);
  const selected = $derived<Pilot | null>(
    pilots.find((p) => p.id === campaign.selectedPilotId) ?? pilots[0] ?? null,
  );
  const selectedMech = $derived(selected === null ? null : campaign.mechOf(selected));

  /** Корпуса без пилота, куда посадить выбранного. Разрушенные не предлагаются. */
  const freeHulls = $derived(campaign.mechs.filter((m) => m.pilotId === null && !isWreck(m)));

  /**
   * Найм: id и цена спрашиваются у стора, доступность — у ядра.
   *
   * Три команды вместо одной (переработка 2026-09-10): дать объявление, взять
   * пришедшего, отпустить. Экран не решает ни одной из этих трёх — он
   * спрашивает `campaign.why` и показывает отказ словами ядра.
   */
  const searchCmd = $derived({ kind: 'searchRecruit', id: campaign.freePilotId() } as const);
  const searchWhy = $derived(campaign.why(searchCmd));
  const recruit = $derived(campaign.recruit);

  function search(): void {
    if (spinTimer !== null) return;
    // Команда исполняется СРАЗУ, до мультипликации: если ядро откажет (нет
    // денег, попытка не подошла), крутить нечего и незачем.
    if (!campaign.run(searchCmd)) return;
    spinning = true;
    spinFrame = 0;
    spinTimer = setInterval(() => {
      spinFrame += 1;
      if (spinFrame < SPIN_FRAMES) return;
      if (spinTimer !== null) clearInterval(spinTimer);
      spinTimer = null;
      spinning = false;
    }, SPIN_MS);
  }

  /** Лицо и имя мелькающего кадра. Оба — заглушки перебора, в игре их нет. */
  const SPIN_FACES = [0, 5, 2, 9, 13, 6, 11, 3, 8, 14, 1, 10, 7, 12, 4, 15];
  const spinFace = $derived(SPIN_FACES[spinFrame % SPIN_FACES.length] ?? 0);

  function statusOf(p: Pilot): 'active' | 'out' | 'ejected' | 'lost' {
    return p.status;
  }

  /** Сколько суток пилоту ещё лежать: срок стоит задачей в очереди, а не полем пилота. */
  function medbayLeft(p: Pilot): number {
    for (const e of campaign.state.queue) {
      if (e.task.kind === 'medbayDone' && e.task.pilotId === p.id) {
        return Math.max(0, e.day - campaign.day);
      }
    }
    return 0;
  }
</script>

<div class="barracks">
  <aside class="panel panel-scroll roster">
    <div class="panel-header">
      <span>{t('barracks.roster')}</span>
      <span class="badge badge-cyan">{pilots.length}</span>
    </div>

    <div class="scroll-area list">
      {#if pilots.length === 0}
        <p class="dim pad">{t('barracks.empty')}</p>
      {/if}
      {#each pilots as p (p.id)}
        {@const status = statusOf(p)}
        {@const mech = campaign.mechOf(p)}
        <button
          class="pick row"
          class:active={selected?.id === p.id}
          onclick={() => {
            campaign.selectedPilotId = p.id;
            confirmingDismissPilotId = null;
          }}
        >
          <PilotPortrait pilot={p} width={40} />
          <span class="who">
            <span class="line">
              <span class="callsign">{p.callsign}</span>
              <span
                class="tiny"
                class:ok={status === 'active'}
                class:gold={status === 'out'}
                class:danger={status === 'lost'}
              >
                {status === 'out' ? daysText(medbayLeft(p)) : t(`barracks.status.${status}`)}
              </span>
            </span>
            {#if status === 'active' && p.injuries > 0}
              <span class="tiny danger">{t('barracks.injuredTag')}</span>
            {/if}
            {#if mech === null}
              <span class="tiny dim">{t('barracks.noMech')}</span>
            {:else}
              {@const mStatus = mechStatusOf(campaign.state, mech)}
              <span
                class="tiny mech-code"
                class:ok={mStatus === 'ready'}
                class:gold={mStatus === 'damaged' || mStatus === 'inWork'}
                class:danger={mStatus === 'critical' || mStatus === 'wreck'}
              >
                {mech.assembly.chassisCode}
              </span>
            {/if}
          </span>
        </button>
      {/each}
    </div>

    <div class="panel-body hire">
      <div class="sec-title">{t('barracks.hire')}</div>

      {#if spinning}
        <!-- Перебор: показывает, что поиск идёт. Ни одно из этих лиц в игру не попадает. -->
        <div class="cand spinning">
          <AtlasImage atlas="pilots" index={spinFace} width={96} bordered />
          <span class="dim tiny">{t('barracks.searching')}</span>
        </div>
      {:else if recruit !== null}
        <div class="cand">
          <PilotPortrait pilot={recruit} width={96} />
          <span class="c-name glow-cyan">{recruit.name}</span>
          <span class="badge badge-gold">{factionName(recruit.affiliation)}</span>
          <span class="badge badge-dim">{t(`origin.${recruit.origin}`)}</span>
          <div class="c-skills">
            {#each campaign.skills as skill (skill.id)}
              {@const level = recruit.skills[skill.id] ?? 1}
              <div class="c-row">
                <span class="dim" title={t(`barracks.role.${skill.id}`)}>{tr(skill.key)}</span>
                <span class="s-bar">
                  {#each Array.from({ length: 10 }, (_, i) => i + 1) as step (step)}
                    <i class:on={step <= level} class:capped={step > (recruit.caps[skill.id] ?? 10)}></i>
                  {/each}
                </span>
                <span class="c-lvl">{level}</span>
              </div>
            {/each}
          </div>
          <div class="c-actions">
            <button class="btn btn-gold btn-sm" onclick={() => campaign.run({ kind: 'hireRecruit' })}>
              {t('barracks.accept')}
            </button>
            <button class="btn btn-danger btn-sm" onclick={() => campaign.run({ kind: 'rejectRecruit' })}>
              {t('barracks.reject')}
            </button>
          </div>
          <p class="dim tiny">{t('barracks.decideHint')}</p>
        </div>
      {:else}
        <button class="btn btn-gold btn-wide" disabled={searchWhy !== null} onclick={search}>
          {t('barracks.searchDo', { sum: cbills(campaign.searchFee) })}
        </button>
        {#if campaign.hireWaitDays > 0}
          <p class="dim tiny">{t('barracks.nextTry', { days: daysText(campaign.hireWaitDays) })}</p>
        {/if}
        {#if searchWhy !== null}<p class="danger tiny">{searchWhy}</p>{/if}
        <p class="dim tiny">{t('barracks.hireHint', { days: daysText(campaign.searchIntervalDays) })}</p>
      {/if}
    </div>
  </aside>

  <main class="panel panel-scroll sheet">
    {#if selected === null}
      <div class="panel-body dim">{t('barracks.empty')}</div>
    {:else}
      {@const dismissCmd = { kind: 'dismissPilot', pilotId: selected.id } as const}
      {@const dismissWhy = campaign.why(dismissCmd)}
      <div class="panel-header">
        <span class="title">
          <!-- Имя и принадлежность рядом: «Марк Хансен · Дом Штайнер» — это и
               есть подпись пилота, о которой просил пользователь. Позывной
               (фамилия или кровное имя) им зовёт боевой журнал. -->
          <span class="glow-cyan">{selected.name}</span>
          <span class="badge badge-gold">{factionName(selected.affiliation)}</span>
          <span class="badge badge-dim" title={t('barracks.origin')}>
            {t(`origin.${selected.origin}`)}
          </span>
        </span>
        <span class="badge" class:badge-ok={selected.status === 'active'} class:badge-gold={selected.status === 'out'}>
          {t(`barracks.status.${selected.status}`)}
        </span>
      </div>

      <div class="scroll-area body">
        <!-- Слева пилот, справа его машина, между ними всё, что их связывает:
             травмы, лечение, посадка. -->
        <div class="top">
          <PilotPortrait pilot={selected} width={130} />
          <div class="facts">
            <!--
              Травмы — пометкой и только когда они есть: ноль травм — обычное
              состояние, строка «Травмы: 0» ничего игроку не говорит.
              ОТПРАВИТЬ В ЛАЗАРЕТ, НЕ ДОЖИДАЯСЬ ПОРОГА. Раненый ветеран лечится
              решением игрока, а не тем, что однажды пострадает сильнее. Цена —
              срок: её и показывает кнопка, чтобы выбор «долечить сейчас или
              взять его в вылет как есть» делался с открытыми числами.
            -->
            {#if selected.injuries > 0}
              <div class="line-c">
                <span class="badge badge-danger">{t('barracks.injuries')}: {selected.injuries}</span>
                {#if selected.status === 'active'}
                  {@const cmd = { kind: 'treatPilot', pilotId: selected.id } as const}
                  {@const why = campaign.why(cmd)}
                  <button
                    class="btn btn-sm btn-gold"
                    disabled={why !== null}
                    title={why ?? t('barracks.treatHint')}
                    onclick={() => campaign.run(cmd)}
                  >
                    {t('barracks.treatDays', { days: daysText(campaign.treatmentDays(selected)) })}
                  </button>
                {/if}
              </div>
            {/if}
            {#if selected.status === 'out'}
              <span class="badge badge-gold">{t('barracks.medbay')}: {daysText(medbayLeft(selected))}</span>
            {/if}
            {#if selected.firstBattle}
              <span class="badge badge-dim">{t('barracks.rookieYes')}</span>
            {/if}

            <div class="mech-line-c">
              <span class="dim tiny">{t('barracks.mech')}</span>
              {#if selectedMech !== null}
                {@const mStatus = mechStatusOf(campaign.state, selectedMech)}
                <span
                  class="mech-code-c"
                  class:ok={mStatus === 'ready'}
                  class:gold={mStatus === 'damaged' || mStatus === 'inWork'}
                  class:danger={mStatus === 'critical' || mStatus === 'wreck'}
                >
                  {selectedMech.assembly.chassisCode} · {recordChassisDef(selectedMech).tons} {t('common.tons')}
                </span>
              {:else}
                <span class="dim">{t('barracks.noMech')}</span>
              {/if}
            </div>

            <div class="hulls">
              {#if selectedMech !== null}
                {@const cmd = { kind: 'assignPilot', recordId: selectedMech.id, pilotId: null } as const}
                <button class="btn btn-sm btn-danger" disabled={campaign.why(cmd) !== null} onclick={() => campaign.run(cmd)}>
                  {t('barracks.unseat')}
                </button>
              {/if}
              {#each freeHulls as m (m.id)}
                {@const cmd = { kind: 'assignPilot', recordId: m.id, pilotId: selected.id } as const}
                {@const why = campaign.why(cmd)}
                <button class="btn btn-sm" disabled={why !== null} title={why ?? t('barracks.assign')} onclick={() => campaign.run(cmd)}>
                  {m.assembly.chassisCode} · {recordChassisDef(m).tons} {t('common.tons')}
                </button>
              {/each}
            </div>
            {#if freeHulls.length === 0 && selectedMech === null}
              <p class="dim tiny">{t('barracks.noFreeHulls')}</p>
            {/if}
          </div>
          <!-- Место под машину держится и без неё: иначе середина уезжает вправо. -->
          <div class="mech-side">
            {#if selectedMech !== null}
              <MechSilhouette
                chassisCode={selectedMech.assembly.chassisCode}
                paint={paintOfRecord(selectedMech)}
                width={130}
                zoomable
              />
              <span class="mech-title">{selectedMech.name}</span>
            {/if}
          </div>
        </div>

        <div class="block">
          <div class="sec-title">{t('barracks.skills')}</div>
          {#each campaign.skills as skill (skill.id)}
            {@const level = skillLevel(selected, skill.id)}
            {@const base = selected.skills[skill.id] ?? 1}
            {@const cap = talentCap(selected, skill.id)}
            {@const xp = selected.xp[skill.id] ?? 0}
            {@const cost = campaign.trainCost(selected, skill.id)}
            {@const guide = skillGuide(skill.id, level, base, cap)}
            <div class="skill" class:idle={guide.idle}>
              <span class="s-name">{tr(skill.key)}</span>
              <span class="s-bar">
                <!-- Потолок таланта свой у каждого: без него все пилоты через
                     N боёв становятся одинаковыми, и найм теряет смысл. -->
                {#each Array.from({ length: 10 }, (_, i) => i + 1) as step (step)}
                  <i class:on={step <= level} class:capped={step > cap}></i>
                {/each}
              </span>
              <span class="s-level" class:danger={level < base}>
                {level}{#if level < base}<span class="tiny"> ({base})</span>{/if}
              </span>
              <span class="s-xp dim tiny" title={t('barracks.trainHint')}>
                {base >= cap ? t('barracks.atCap') : `${xp} / ${cost}`}
              </span>
            </div>
            <!-- Что навык делает и где следующая польза: таблицы ступенчатые, и не
                 каждый уровень что-то меняет (`skillGuide.ts`). -->
            <div class="s-guide" class:idle={guide.idle}>
              <span class="dim">{t(`barracks.role.${skill.id}`)}</span>
              <span>
                {guide.now}{#if guide.next !== ''}<span class="dim"> · </span><span class="gold">{guide.next}</span>{/if}
              </span>
            </div>
          {/each}
          <p class="dim tiny">{t('barracks.trainHint')}</p>
          <p class="dim tiny">{t('barracks.injuryHint')}</p>
        </div>

        <div class="block">
          <div class="sec-title">{t('barracks.dismiss')}</div>
          <p class="dim tiny">{t('barracks.dismissHint')}</p>
          {#if confirmingDismissPilotId === selected.id}
            <div class="confirm-box">
              <p class="warn small">
                {t('barracks.dismissConfirm', { name: selected.name })}
              </p>
              <div class="confirm-actions">
                <button
                  class="btn btn-sm btn-danger"
                  disabled={dismissWhy !== null}
                  onclick={() => {
                    campaign.run(dismissCmd);
                    confirmingDismissPilotId = null;
                  }}
                >
                  {t('barracks.dismissDo')}
                </button>
                <button
                  class="btn btn-sm"
                  onclick={() => (confirmingDismissPilotId = null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          {:else}
            <button
              class="btn btn-danger btn-sm"
              disabled={dismissWhy !== null}
              title={dismissWhy ?? ''}
              onclick={() => (confirmingDismissPilotId = selected.id)}
            >
              {t('barracks.dismissDo')}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .barracks {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .roster,
  .sheet {
    overflow: hidden;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px;
  }
  .pad {
    padding: 12px 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .callsign {
    font-weight: 700;
    font-size: 12.5px;
  }
  .tiny {
    font-size: 10px;
  }
  .mech-code {
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .hire {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  /* Карточка кандидата: то же, что строка пилота, но крупнее и с решением. */
  .cand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 0;
    text-align: center;
  }
  .cand.spinning {
    /* Перебор мигает через прозрачность, а не через смену размера: скачущая
       рамка на 96 пикселях дёргает всю панель. */
    animation: flicker 0.18s linear infinite alternate;
  }
  @keyframes flicker {
    from { opacity: 0.55; }
    to { opacity: 1; }
  }
  .c-name {
    font-size: 13px;
    font-weight: bold;
    font-family: monospace;
  }
  .c-skills {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }
  .c-row {
    display: grid;
    grid-template-columns: 96px 1fr 18px;
    gap: 6px;
    align-items: center;
    font-size: 10.5px;
    text-align: left;
  }
  .c-lvl {
    font-family: monospace;
    color: var(--color-text);
    text-align: right;
  }
  .c-actions {
    display: flex;
    gap: 6px;
    width: 100%;
  }
  .c-actions .btn {
    flex: 1;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 12px;
  }
  .top {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr) 130px;
    gap: 14px;
    align-items: center;
  }
  .facts {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    text-align: center;
  }
  .line-c {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px;
  }
  .mech-line-c {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .mech-code-c {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.5px;
  }
  .mech-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .mech-title {
    font-size: 11.5px;
    font-weight: 700;
    text-align: center;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .skill {
    display: grid;
    grid-template-columns: 150px 1fr 54px 76px;
    gap: 10px;
    align-items: center;
    font-size: 11.5px;
  }
  .s-name {
    font-weight: 700;
  }
  .s-bar {
    display: flex;
    gap: 2px;
  }
  .s-bar > i {
    flex: 1;
    height: 9px;
    background: var(--color-border);
    border-radius: 1px;
  }
  .s-bar > i.on {
    background: var(--color-accent);
  }
  .s-bar > i.capped {
    background: rgba(48, 54, 61, 0.35);
  }
  .s-level {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    text-align: right;
  }
  .s-xp {
    text-align: right;
  }
  .s-guide {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: -3px 0 5px;
    padding-left: 2px;
    font-size: 10.5px;
    line-height: 1.4;
  }
  /* Навык растёт, но правилами не читается: не прятать, но и не звать учить. */
  .skill.idle,
  .s-guide.idle {
    opacity: 0.55;
  }
  .gold {
    color: var(--color-gold);
  }
  .hulls {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 5px;
  }
  .confirm-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: rgba(227, 179, 65, 0.1);
    border: 1px solid var(--color-gold);
    border-radius: 2px;
  }
  .confirm-actions {
    display: flex;
    gap: 6px;
  }
  .confirm-actions button {
    flex: 1;
  }
  .warn {
    color: var(--color-gold);
  }
  .small {
    font-size: 11px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
</style>
