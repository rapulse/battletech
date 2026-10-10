<script lang="ts">
  import { FACTIONS } from '../../core/campaign/galaxy/index.js';
  import { recordChassisDef, type MechRecord } from '../../core/campaign/mech/MechRecord.js';
  import { fieldOnly, type Contract } from '../../core/campaign/contracts/board.js';
  import { landingFullRatio } from '../../core/campaign/contracts/landing.js';
  import { missionField } from '../../core/campaign/contracts/intel.js';
  import { ECONOMY } from '../../core/data/index.js';
  import { CONTRACTS } from '../../core/campaign/contracts/schema.js';
import { contractObjective } from '../../core/campaign/contracts/active.js';
import { tr } from '../../core/log/index.js';
import { crippleQuota } from '../../core/rules/objective.js';
  import { campaign, mechStatusOf } from '../state/campaign.svelte.js';
  import { lanceGroups, takeLance, type LanceGroup, type SkipReason } from '../state/lanceGroups.js';
  import { enterBattleScreen } from '../state/battleScreen.js';
  import { atonementGain } from '../../core/campaign/reputation/accrual.js';
  import { PLAYER_ACTOR_ID, WAR } from '../../core/campaign/war/index.js';
  import { cbills, days as daysText, t, tn } from '../i18n/index.js';
  import { dropshipName, factionFullName } from '../i18n/names.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import LanceHead from '../components/LanceHead.svelte';
  import MissionHolo from '../components/MissionHolo.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';
  import { standingBand } from './relations.js';
  import { homeKind } from './homeWork.js';

  /**
   * Биржа контрактов: что предлагают здесь и сейчас, и во что это обойдётся.
   *
   * Всё, что показано, вычисляется ядром: список — `availableContracts`,
   * разведданные — `contractIntel`, оценка сил — `contracts/threat.ts`. Экран
   * не считает ни оплату, ни сложность: посчитанная здесь «сложность» была бы
   * второй формулой рядом с настоящей и однажды разошлась бы с ней.
   */

  const offers = $derived(campaign.contracts);

  /** Прибавка лояльности за победу в работе дома (шаг 85): у подавления восстания — ещё `revoltWin`. */
  function homeGain(c: Contract): number {
    return WAR.loyalty.win + (c.revolt === true ? WAR.loyalty.revoltWin : 0);
  }
  /** Награда работы державы строкой: лояльность дома или право флага на мире врага (шаг 90). */
  function homeRewardText(c: Contract): string {
    if (c.warWork !== true) return t('contracts.homeReward', { gain: homeGain(c) });
    const won = campaign.state.deltas[c.systemId]?.realmWon ?? 0;
    return t('contracts.warWorkReward', { won, need: WAR.domain.conquerWins });
  }
  /** Что порог доступности вычеркнул из списка (шаг 20). */
  const blocked = $derived(campaign.blocked);
  const active = $derived(campaign.activeContract);

  let deploying = $state(false);
  let lance = $state<string[]>([]);

  const selected = $derived<Contract | null>(
    offers.find((c) => c.id === campaign.selectedContractId) ?? offers[0] ?? null,
  );

  const deployable = $derived(campaign.deployable);

  /**
   * Оценка сил считается против ФАКТИЧЕСКИ отмеченного звена, а не против
   * всего парка: противник материализуется на вылете, под то, что вывели
   * (`contracts/opfor.ts::buildOpfor`).
   */
  /**
   * Задача боя словами. Переводится ЗДЕСЬ, а не в ядре: ядро знает «продержись
   * шесть ходов», а как это назвать по-русски — дело показа.
   */
  function objectiveText(contract: Contract): string {
    const units = contract.opforUnits;
    const task = contractObjective(contract);
    // Укреплённая работа (шаг 73d): цель названа поимённо — игрок обязан знать,
    // за что берётся, ДО подписи.
    if (task.kind === 'destroyTargets' || task.kind === 'protectTargets') {
      const targets = (contract.fortified?.targets ?? []).map((k) => tr(`emplacement.${k}`)).join(', ');
      return task.kind === 'destroyTargets'
        ? t('mission_objective.destroyTargets', { targets })
        : t('mission_objective.protectTargets', { rounds: task.rounds, targets });
    }
    if (task.kind === 'hold') return t('mission_objective.hold', { rounds: task.rounds });
    if (task.kind === 'cripple') {
      // ЧИСЛОМ МАШИН, А НЕ ДОЛЕЙ (шаг 56). «Вывести 65 % машин противника»
      // против двойки читалось как «выбить обе» и ею же и было, пока квоту не
      // ограничили; доля же на экране вводила в заблуждение и после починки —
      // игрок считал проценты в уме и получал не то число. Считает ту же
      // функцию, что и условие победы в бою (`rules/objective.ts`).
      return t('mission_objective.cripple', {
        out: crippleQuota(task.share, units),
        total: units,
      });
    }
    return t('mission_objective.destroy', { total: units });
  }

  const previewLance = $derived(
    lance.length > 0
      ? deployable.filter((m) => lance.includes(m.id))
      : [...deployable]
          .sort((a, b) => recordChassisDef(b).tons - recordChassisDef(a).tons)
          .slice(0, Math.min(campaign.lanceSize, campaign.maxDeploy)),
  );

  function factionName(id: string): string {
    return factionFullName(id, FACTIONS.get(id)?.name ?? id);
  }

  function factionColor(id: string): string {
    return FACTIONS.get(id)?.color ?? '#8b949e';
  }

  /** Черепа сложности: отношение оценок, огрублённое до пяти ступеней. */
  function skulls(contract: Contract): number {
    const { ours, allies, theirs } = campaign.odds(contract, previewLance);
    if (ours <= 0) return 5;
    // Звено нанимателя (шаг 73b) дерётся рядом — сложность считается от суммы.
    const ratio = theirs / (ours + allies);
    // 3.1 — под простую оценку (`odds`): 85 % побед в полном бою у неё при
    // отношении 0.78, у прежней тоннажной — при 0.63 (`pnpm threatcalib`,
    // 2026-09-23, одна выборка). 2.5 × 0.78 / 0.63 ≈ 3.1 — череп значит ту же
    // опасность, что и до шага 68.
    return Math.max(1, Math.min(5, Math.round(ratio * 3.1)));
  }

  /**
   * Звено, которое игрок отметил в окне высадки, — и только оно. Запасного
   * «звена по умолчанию» здесь нет: при пустом выборе окно показывало оценку и
   * плату за самые тяжёлые машины, хотя выбрано было ноль (2026-09-23).
   * `previewLance` с запасным звеном остаётся карточкам списка — там это оценка
   * того, что рота вывела бы.
   */
  const chosenLance = $derived(deployable.filter((m) => lance.includes(m.id)));

  /** Оценка и доступность вылета для окна высадки: обе спрашиваются у ядра. */
  const deployOdds = $derived(
    active === null ? { ours: 0, allies: 0, theirs: 0 } : campaign.odds(active, chosenLance),
  );
  const deployWhy = $derived(campaign.why({ kind: 'deploy', recordIds: lance }));
  /** Отдать бой штабу: та же проверка вылета плюс запрет для работы «только на поле» (шаг 74). */
  const autoWhy = $derived(campaign.why({ kind: 'deploy', recordIds: lance, auto: true }));
  /** Цена высадки (шаг 67): пересчитывается с каждым изменением звена — выбор без цены правила не делает. */
  const deployLanding = $derived(
    active === null || chosenLance.length === 0 ? null : campaign.landing(active, chosenLance),
  );

  /**
   * Цвет платы за высадку (решение пользователя 2026-09-23): до 20 % гонорара —
   * зелёный, до 65 % — жёлтый, дальше — красный. Плата во весь гонорар — работа
   * даром, и это обязано читаться с первого взгляда, а не белой строкой.
   */
  const LANDING_GREEN_UP_TO = 0.2;
  const LANDING_GOLD_UP_TO = 0.65;
  function landingTone(share: number): 'ok' | 'gold' | 'danger' {
    if (share <= LANDING_GREEN_UP_TO) return 'ok';
    if (share <= LANDING_GOLD_UP_TO) return 'gold';
    return 'danger';
  }

  /**
   * Сколько машин выйдет на поле при авторасчёте — от этого зависит, сколько он
   * займёт: с 2026-09-09 штаб отыгрывает бой полностью, а не считает его
   * быстрым расчётом (`campaign.svelte.ts::autoResolve`).
   */
  const autoUnits = $derived(
    active === null ? 0 : chosenLance.length + campaign.intelOf(active).expectedUnits,
  );

  /** Окно высадки открывается с пустым выбором: состав собирает сам игрок (решение 2026-09-23). */
  function openDeploy(): void {
    lance = [];
    lanceNote = null;
    deploying = true;
  }

  /** Что сказала последняя кнопка звена, если набор не поместился под потолок судна. */
  let lanceNote = $state<string | null>(null);

  function toggle(id: string): void {
    lanceNote = null;
    lance = lance.includes(id) ? lance.filter((x) => x !== id) : [...lance, id];
  }

  const SKIP_ORDER: readonly SkipReason[] = ['stationed', 'wreck', 'inWork', 'noPilot'];

  function candidatesOf(group: LanceGroup<MechRecord>) {
    return group.mechs.map((m) => ({ id: m.id, skip: campaign.skipReasonOf(m) }));
  }

  /** «Не годны: в цеху: 1, без пилота: 1» — почему кнопка звена взяла не всех. */
  function skippedText(group: LanceGroup<MechRecord>): string | null {
    const counts = takeLance(candidatesOf(group), [], campaign.maxDeploy).skipped;
    const parts = SKIP_ORDER.flatMap((r) => {
      const count = counts[r];
      return count === undefined ? [] : [t(`contracts.lanceSkip.${r}`, { count })];
    });
    return parts.length === 0 ? null : t('contracts.lanceSkipped', { parts: parts.join(', ') });
  }

  function takeGroup(group: LanceGroup<MechRecord>): void {
    const r = takeLance(candidatesOf(group), lance, campaign.maxDeploy);
    lance = [...r.lance];
    lanceNote =
      r.overflow > 0 ? t('contracts.lanceOverflow', { count: r.overflow, max: campaign.maxDeploy }) : null;
  }

  function launch(): void {
    if (campaign.deploy(lance) === null) return;
    deploying = false;
    // Бой собирает `enterBattleScreen` — тот же вход, что и у кнопки «вернуться
    // на поле». Двух путей на экран боя нет намеренно: разошлись бы они молча.
    enterBattleScreen();
  }

  /**
   * Отдать стычку штабу: тот же `Deploy`, но вместо поля — расчёт
   * (`core/campaign/bridge/fastResolve.ts`). Экран сам оказывается на разборе,
   * потому что `autoResolve` доводит дело ровно до того места, где кончается
   * отыгранный бой, — до выбора трофеев.
   */
  async function autoResolve(): Promise<void> {
    if (await campaign.autoResolve(lance)) deploying = false;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') deploying = false;
  }}
/>

<div class="contracts">
  {#if active !== null}
    {@const deadline = campaign.deadlineDay ?? campaign.day}
    <div class="active-banner">
      <div class="ab-left">
        <span class="badge badge-gold">{t('contracts.active')}</span>
        <span class="ab-name glow-cyan">{t(`mission.${active.mission}`)}</span>
        <span class="dim">
          {t('contracts.employer')}: {factionName(active.employer)} ·
          {t('contracts.target')}: {factionName(active.target)}
        </span>
      </div>
      <div class="ab-right">
        <span class="badge badge-dim">
          {t('contracts.deadlineLeft', { days: daysText(Math.max(0, deadline - campaign.day)) })}
        </span>
        {#if active.atonement === true}
          <span class="badge badge-gold">{t('contracts.atonement')}</span>
        {:else if active.employer === PLAYER_ACTOR_ID}
          <span class="badge badge-gold">{t(`contracts.${homeKind(active)}`)}</span>
        {:else}
          <span class="badge badge-cyan">{cbills(active.payout)}</span>
        {/if}
        {#if campaign.hasDebrief}
          <button class="btn btn-gold" onclick={() => (campaign.screen = 'debrief')}>
            {t('app.nav.debrief')}
          </button>
        {:else if campaign.deployed}
          <button class="btn btn-gold" onclick={enterBattleScreen}>
            {t('battle.title')}
          </button>
        {:else}
          <button class="btn btn-primary" disabled={deployable.length === 0} onclick={openDeploy}>
            {t('contracts.deploy')}
          </button>
          <button
            class="btn btn-danger btn-sm"
            title={t('contracts.abandonHint')}
            disabled={!campaign.can({ kind: 'abandonContract' })}
            onclick={() => campaign.run({ kind: 'abandonContract' })}
          >
            {t('contracts.abandon')}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="split">
    <main class="panel panel-scroll">
      <div class="panel-header">
        <span>{t('contracts.board', { system: campaign.system.name })}</span>
        <div class="header-right">
          <span class="badge badge-cyan">{t('contracts.count', { count: offers.length })}</span>
          <WikiHelp doc="glossary.md" section="контракты и биржа" align="right" label="?" />
        </div>
      </div>
      <div class="scroll-area offers">
        {#if offers.length === 0}
          <p class="dim pad">{t('contracts.empty')}</p>
        {/if}
        <!--
          Порог, молча стирающий половину списка, читается как пустая биржа, а
          не как последствие выбора стороны (шаг 20). Экран обязан сказать:
          работа здесь есть, но этот наниматель её вам не даст.
        -->
        {#if blocked.atWar > 0}
          <!-- Наниматель воюет с державой роты (шаг 79): закрыта вся его работа, и причина — не отношение. -->
          <p class="danger pad small">
            {t('contracts.blockedAtWar', { count: blocked.atWar, faction: factionName(blocked.employer) })}
          </p>
        {/if}
        {#if blocked.count > blocked.atWar}
          <p class="dim pad small">
            {t('contracts.blocked', { count: blocked.count - blocked.atWar })}
          </p>
        {/if}
        {#each offers as c (c.id)}
          <button
            class="pick offer"
            class:active={selected?.id === c.id}
            onclick={() => (campaign.selectedContractId = c.id)}
          >
            <span class="thumb"><MissionHolo mission={c.mission} width={104} /></span>
            <span class="offer-body">
              <span class="offer-head">
                <span class="glow-cyan strong">{t(`mission.${c.mission}`)}</span>
                <span class="skulls gold">{'◆'.repeat(skulls(c))}<span class="dim">{'◇'.repeat(5 - skulls(c))}</span></span>
              </span>
              <span class="parties">
                <FactionEmblem factionId={c.employer} size={17} />
                <span>{factionName(c.employer)}</span>
                <span class="dim">→</span>
                <FactionEmblem factionId={c.target} size={17} />
                <span style:color={factionColor(c.target)}>{factionName(c.target)}</span>
              </span>
              <span class="offer-foot">
                <!--
                  РАЗМЕР РАБОТЫ В СТРОКЕ СПИСКА (шаг 44). Это первое, что нужно
                  игроку, чтобы выбирать: черепа говорят «тяжело», но не говорят
                  ПОЧЕМУ — двенадцать лёгких машин и четвёрка штурмовых дают
                  похожие черепа и требуют разного отряда.
                -->
                <span class="badge badge-dim">{t(`scale.${c.scale}`)}</span>
                {#if c.stakes === 'sector'}
                  <span class="badge badge-gold">{t('contracts.stakesSector')}</span>
                {/if}
                <span class="cyan">{t('contracts.force', { units: c.opforUnits, tons: c.opforTons })}</span>
                <!--
                  Достоверность сводки (шаг 57). Стоит ВПЛОТНУЮ к составу, а не в
                  подробностях: два числа слева — это обещание нанимателя, и
                  насколько ему верить, игрок обязан видеть там же, где читает
                  само обещание.
                -->
                <span class="badge" class:badge-gold={c.intel < 0.6} class:badge-dim={c.intel >= 0.6}>
                  {t('contracts.intelShort', { percent: Math.round(c.intel * 100) })}
                </span>
                <!--
                  Поле противника (шаг 73a) — рядом со сводкой: засада и есть та
                  часть противника, которую сводка не насчитала.
                -->
                <!--
                  Звено нанимателя (шаг 73b) — в строке списка: гонорар и доля
                  трофеев уже уменьшены, и без значка это читалось бы как
                  дешёвая работа без причины.
                -->
                {#if c.allies !== undefined}
                  <span class="badge badge-cyan" title={t('contracts.alliesHint')}>
                    {t('contracts.alliesBadge', { mechs: tn('count.mechs', c.allies.units), percent: Math.round(c.allies.share * 100) })}
                  </span>
                {/if}
                {#if c.fortified !== undefined}
                  <span class="badge badge-gold" title={t('contracts.fortifiedHint')}>{t('contracts.fortified')}</span>
                {/if}
                <!-- Работа «только на поле» (шаг 74): штабу не отдаётся, гонорар с надбавкой. -->
                {#if fieldOnly(c)}
                  <span
                    class="badge badge-gold"
                    title={t('contracts.fieldOnlyHint', { percent: Math.round(CONTRACTS.fieldOnly.payBonus * 100) })}
                  >
                    {t('contracts.fieldOnly')}
                  </span>
                {/if}
                {#if missionField(c.mission) === 'enemy'}
                  <span class="badge badge-dim" title={t('contracts.enemyFieldHint')}>
                    {t('contracts.enemyField')}
                  </span>
                {/if}
                <!-- Искупление платит отношением, а не деньгами: гонорар 0 и
                     трофеи 0 % в строке читались бы как ошибка биржи. -->
                {#if c.atonement === true}
                  <span class="badge badge-gold">{t('contracts.atonement')}</span>
                  <span class="ok strong">{t('contracts.atonementReward', { gain: atonementGain(c.mission) })}</span>
                {:else if c.employer === PLAYER_ACTOR_ID}
                  <!-- Работа дома (шаг 85): держава себе не платит, плата — лояльность мира. -->
                  <span class="badge badge-gold">{t(`contracts.${homeKind(c)}`)}</span>
                  <span class="ok strong">{homeRewardText(c)}</span>
                  <span class="cyan">
                    {t('contracts.salvageShare')}: {Math.round(c.salvageShare * 100)} %
                  </span>
                {:else}
                  <span class="gold strong">{cbills(c.payout)}</span>
                  <span class="cyan">
                    {t('contracts.salvageShare')}: {Math.round(c.salvageShare * 100)} %
                  </span>
                {/if}
                <span class="dim">{daysText(c.durationDays)}</span>
              </span>
            </span>
          </button>
        {/each}
      </div>
    </main>

    <aside class="panel panel-scroll">
      <div class="panel-header"><span>{t('contracts.intel')}</span></div>
      <div class="scroll-area dossier">
        {#if selected === null}
          <p class="dim">{t('contracts.empty')}</p>
        {:else}
          {@const intel = campaign.intelOf(selected)}
          {@const odds = campaign.odds(selected, previewLance)}
          <MissionHolo mission={selected.mission} />

          <!--
            Задача боя (шаг 19b) — то, чем тип миссии отличается НА ПОЛЕ, а не
            только числами контракта. Читается из тех же данных, что исполняет
            бой (`data/contracts.json` → `missions[].objective`), поэтому
            разойтись с настоящим условием победы не может.
          -->
          <p class="objective" title={t('contracts.sameObjectiveWhy')}>
            {t('contracts.sameObjective', {
              task: objectiveText(selected),
            })}
          </p>
          {#if selected.stakes === 'sector'}
            <!--
              Ставку сектора игрок обязан видеть ДО подписи (шаг 44e): исход
              такой работы меняет флаг на звёздной карте, и узнать об этом после
              разбора — значит узнать поздно.
            -->
            <p class="objective stakes">
              {selected.mission === 'defense'
                ? t('contracts.stakesSectorDefense')
                : t('contracts.stakesSectorAssault')}
            </p>
          {/if}

          <div class="block">
            <div class="sec-title">{t('contracts.mission')}</div>
            <div class="grid2">
              <div class="kv">
                <span class="kv-k">{t('contracts.employer')}</span>
                <span class="kv-v">{factionName(selected.employer)}</span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.target')}</span>
                <span class="kv-v" style:color={factionColor(selected.target)}>
                  {factionName(selected.target)}
                </span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.opforType')}</span>
                <span class="kv-v cyan">{t(`opfor.${intel.opforType}`)}</span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.opforUnits')}</span>
                <span class="kv-v">
                  {intel.expectedUnits}
                  {#if intel.unitsRange[0] !== intel.unitsRange[1]}
                    <span class="dim small">
                      {t('contracts.intelRange', { from: intel.unitsRange[0], to: intel.unitsRange[1] })}
                    </span>
                  {/if}
                </span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.opforTons')}</span>
                <span class="kv-v gold">
                  {t('contracts.opforTonsValue', { tons: intel.tonnageCap })}
                  {#if intel.tonsRange[0] !== intel.tonsRange[1]}
                    <span class="dim small">
                      {t('contracts.intelRange', { from: intel.tonsRange[0], to: intel.tonsRange[1] })}
                    </span>
                  {/if}
                </span>
              </div>
              <!--
                ДОСТОВЕРНОСТЬ СВОДКИ (шаг 57). Два числа выше — обещание
                нанимателя, а не факт: на поле выйдет то, что разыграется на
                вылете. Предупредить об этом ДО подписи — условие честности
                механики, ровно как с оценкой сил.
              -->
              <div class="kv" title={t('contracts.intelHint')}>
                <span class="kv-k">{t('contracts.intelReliability')}</span>
                <span class="kv-v" class:gold={intel.reliability < 0.6} class:ok={intel.reliability >= 0.8}>
                  {t('contracts.intelPercent', { percent: Math.round(intel.reliability * 100) })}
                </span>
              </div>
              <!--
                ШАНС, ЧТО СОСТАВ НЕ СОЙДЁТСЯ (2026-09-21). Полосы выше после
                вероятностного округления стоят почти у каждой работы, и сами по
                себе сводку на 95 % от сводки на 50 % уже не отличают. Отличает
                это число, и без него достоверность читалась бы украшением.
              -->
              <div class="kv" title={t('contracts.intelMissHint')}>
                <span class="kv-k">{t('contracts.intelMiss')}</span>
                <span class="kv-v" class:gold={intel.missChance >= 0.5}>
                  {t('contracts.intelPercent', { percent: Math.round(intel.missChance * 100) })}
                </span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.scale')}</span>
                <span class="kv-v cyan">{t(`scale.${intel.scale}`)}</span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.biome')}</span>
                <span class="kv-v gold">{t(`biome.${selected.biome}`)}</span>
              </div>
              <div class="kv">
                <span class="kv-k">{t('contracts.duration')}</span>
                <span class="kv-v">{daysText(selected.durationDays)}</span>
              </div>
            </div>
            <div class="quality-row" title={t('contracts.opforQualityHint')}>
              <span class="dim">{t('contracts.opforQuality')}:</span>
              {#if intel.quality === null}
                <span class="gold">{t('contracts.opforQualityUnknown')}</span>
              {:else}
                {#each intel.quality as q (q)}
                  <span class="badge badge-dim">{t(`quality.${q}`)}</span>
                {/each}
              {/if}
            </div>
          </div>

          <div class="block" title={t('contracts.threatHint')}>
            <div class="sec-title">{t('contracts.threat')}</div>
            <div class="row-kv">
              <span>{t('contracts.threatOurs')}</span>
              <span class="cyan">{odds.ours}</span>
            </div>
            {#if odds.allies > 0 && selected.allies !== undefined}
              <div class="row-kv" title={t('contracts.alliesHint')}>
                <span>{t('contracts.alliesRow', { mechs: tn('count.mechs', selected.allies.units) })}</span>
                <span class="cyan">{odds.allies}</span>
              </div>
            {/if}
            <div class="row-kv">
              <span>{t('contracts.threatTheirs')}</span>
              <span
                class:danger={odds.theirs > odds.ours + odds.allies}
                class:ok={odds.theirs <= odds.ours + odds.allies}
              >
                {odds.theirs}
              </span>
            </div>
          </div>

          {#if selected.atonement === true}
            <div class="block">
              <div class="sec-title">{t('contracts.atonement')}</div>
              <div class="row-kv">
                <span>{t('contracts.payout')}</span>
                <span class="ok">{t('contracts.atonementReward', { gain: atonementGain(selected.mission) })}</span>
              </div>
              <p class="dim small">{t('contracts.atonementHint')}</p>
            </div>
          {:else if selected.employer === PLAYER_ACTOR_ID}
            <div class="block">
              <div class="sec-title">{t(`contracts.${homeKind(selected)}`)}</div>
              <div class="row-kv">
                <span>{t('contracts.payout')}</span>
                <span class="ok">{homeRewardText(selected)}</span>
              </div>
              <div class="row-kv">
                <span>{t('contracts.salvageShare')}</span>
                <span class="cyan">
                  {t('contracts.salvageShareValue', { percent: Math.round(selected.salvageShare * 100) })}
                </span>
              </div>
              <p class="dim small">{t(`contracts.${homeKind(selected)}Hint`)}</p>
            </div>
          {:else}
          <div class="block">
            <div class="sec-title">{t('contracts.payout')}</div>
            <div class="row-kv">
              <span>{t('contracts.payout')}</span><span class="gold">{cbills(selected.payout)}</span>
            </div>
            <div class="row-kv">
              <span>{t('contracts.advance')}</span><span class="ok">+{cbills(selected.advance)}</span>
            </div>
            <div class="row-kv">
              <span>{t('contracts.penalty')}</span><span class="danger">−{cbills(selected.penalty)}</span>
            </div>
            <div class="row-kv">
              <span>{t('contracts.salvageShare')}</span>
              <span class="cyan">
                {t('contracts.salvageShareValue', { percent: Math.round(selected.salvageShare * 100) })}
              </span>
            </div>
          </div>
          {/if}

          <!--
            Как контракт повлияет на ОБЕ стороны — ДО подписи (шаг 20).

            Принципиально, а не украшение: игрок выбирает сторону осознанно, а
            не узнаёт о последствиях постфактум (`reputation.md`). Числа берутся
            у той же функции, что и настоящее начисление, и с упором в край
            шкалы: обещать «−15», когда у цели уже −100, значило бы врать ровно
            там, где весь смысл в честности.
          -->
          <div class="block">
            <div class="sec-title">{t('contracts.consequences')}</div>
            {#each campaign.previewOf(selected) as row (row.factionId)}
              <div class="row-kv">
                <span class="who">
                  <FactionEmblem factionId={row.factionId} size={16} />
                  <span>{factionName(row.factionId)}</span>
                </span>
                <span class:ok={row.delta > 0} class:danger={row.delta < 0}>
                  {row.delta > 0 ? '+' : ''}{Math.round(row.delta)}
                  <span class="dim">
                    · {t(`relations.band.${standingBand(campaign.standingWith(row.factionId) + row.delta)}`)}
                  </span>
                </span>
              </div>
            {/each}
            <p class="dim small">{t('contracts.consequencesHint')}</p>
          </div>

          {@const cmd = { kind: 'takeContract', contractId: selected.id } as const}
          {@const why = campaign.why(cmd)}
          <button
            class="btn btn-primary btn-wide sign"
            title={t('contracts.takeHint')}
            disabled={why !== null}
            onclick={() => campaign.run(cmd)}
          >
            {t('contracts.take')}
          </button>
          {#if why !== null}<p class="danger small">{why}</p>{/if}
        {/if}
      </div>
    </aside>
  </div>
</div>

{#if deploying && active !== null}
  <!--
    Закрывает щелчок ПО ФОНУ, а не всплывший из окна: проверка `target === currentTarget`
    вместо `stopPropagation` на самом окне — так у окна не появляется обработчика
    щелчка, которого у него по смыслу нет.
  -->
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) deploying = false;
    }}
  >
    <div class="modal deploy" role="dialog" aria-modal="true" tabindex="-1">
      <div class="panel-header">
        <span>{t('contracts.deployTitle')}</span>
        <span class="badge badge-cyan">
          {t('contracts.selected', { count: lance.length, max: campaign.maxDeploy })}
        </span>
      </div>
      <div class="panel-body deploy-body">
        <p class="dim small">{t('contracts.deployHint', { max: campaign.maxDeploy, dropship: dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name) })}</p>
        <div class="deploy-list">
          {#each lanceGroups(campaign.mechs, campaign.lanceSize) as group (group.number)}
            {@const skipped = skippedText(group)}
            <LanceHead {group}>
              <button class="btn btn-sm" title={t('contracts.takeLanceHint')} onclick={() => takeGroup(group)}>
                {t('contracts.takeLance', { n: group.number })}
              </button>
            </LanceHead>
            {#if skipped !== null}<p class="warn small">{skipped}</p>{/if}
            {#each group.mechs as m (m.id)}
              {@const ok = deployable.some((d) => d.id === m.id)}
              {@const pilot = campaign.pilotOf(m)}
              <button
                class="pick deploy-row"
                class:active={lance.includes(m.id)}
                disabled={!ok}
                onclick={() => toggle(m.id)}
              >
                <span class="strong">{m.name}</span>
                <span class="badge badge-dim">{m.assembly.chassisCode}</span>
                <span class="dim">{t('hangar.tons', { tons: recordChassisDef(m).tons })}</span>
                <span class="dim">{pilot?.callsign ?? t('hangar.noPilot')}</span>
                {#if !ok}<span class="danger small">{t('contracts.notDeployable')}</span>{/if}
              </button>
            {/each}
          {/each}
        </div>
        {#if lanceNote !== null}<p class="warn small">{lanceNote}</p>{/if}

        <div class="row-kv">
          <span>{t('contracts.threat')}</span>
          <span>
            <span class="cyan">{deployOdds.ours}</span>
            {#if deployOdds.allies > 0}
              <span class="dim" title={t('contracts.alliesHint')}>+ {deployOdds.allies}</span>
            {/if}
            <span class="dim"> / </span>
            <span class:danger={deployOdds.theirs > deployOdds.ours + deployOdds.allies}>{deployOdds.theirs}</span>
          </span>
        </div>
        <!-- «Оценка сил» не видит повреждений (шаг 90, notes §10zu п. 1): одна строка, сама оценка не меняется. -->
        {#if chosenLance.some((m) => ['damaged', 'critical'].includes(mechStatusOf(campaign.state, m)))}
          <p class="warn small">{t('contracts.deployDamaged')}</p>
        {/if}
        {#if deployLanding !== null}
          <div class="row-kv">
            <span>{t('contracts.landing')}</span>
            {#if deployLanding.fee > 0}
              <span class={landingTone(deployLanding.share)}>
                {deployLanding.share >= 1
                  ? t('contracts.landingAll', { sum: cbills(deployLanding.fee) })
                  : t('contracts.landingFee', {
                      sum: cbills(deployLanding.fee),
                      share: Math.round(deployLanding.share * 100),
                    })}
              </span>
            {:else}
              <span class="ok">{t('contracts.landingFree')}</span>
            {/if}
          </div>
          <div class="row-kv">
            <span>{t('contracts.landingRatio')}</span>
            <span class={landingTone(deployLanding.share)}>
              {t('contracts.landingRatioValue', { ratio: deployLanding.feeRatio.toFixed(2) })}
            </span>
          </div>
          <p class="dim small">
            {t(deployOdds.allies > 0 ? 'contracts.landingHintAllies' : 'contracts.landingHint', {
              norm: deployLanding.allowance.toFixed(2),
              theirs: deployLanding.theirs.toFixed(2),
              base: ECONOMY.sortie.landing.norm,
              normPct: Math.round(ECONOMY.sortie.landing.norm * 100),
              anchor: ECONOMY.sortie.landing.anchorRatio,
              anchorPct: Math.round(ECONOMY.sortie.landing.anchorShare * 100),
              full: landingFullRatio(),
            })}
          </p>
        {/if}

        <div class="deploy-actions">
          <button class="btn" onclick={() => (deploying = false)}>{t('common.cancel')}</button>
          <button
            class="btn"
            title={autoWhy ?? t('contracts.autoResolveHint')}
            disabled={autoWhy !== null || campaign.resolving}
            onclick={autoResolve}
          >
            {campaign.resolving ? t('contracts.autoResolveBusy') : t('contracts.autoResolve')}
          </button>
          <button class="btn btn-primary" disabled={deployWhy !== null} onclick={launch}>
            {t('contracts.toBattle')}
          </button>
        </div>
        {#if deployWhy !== null}<p class="danger small">{deployWhy}</p>{/if}
        {#if deployWhy === null && autoWhy !== null}<p class="dim small">{autoWhy}</p>{/if}
        {#if campaign.resolving}
          <p class="dim small">{t('contracts.autoResolveBusyWhy')}</p>
        {:else if autoUnits >= 24 && deployWhy === null}
          <!--
            Честное предупреждение о времени: штаб отыгрывает бой целиком, и на
            двух дюжинах машин это десятки секунд. Молчаливая пауза читалась бы
            как зависание.
          -->
          <p class="dim small">{t('contracts.autoResolveSlow')}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .contracts {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }

  .active-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 14px;
    background: rgba(227, 179, 65, 0.08);
    border: 1px solid var(--color-gold);
    border-radius: 2px;
    flex-shrink: 0;
  }
  .ab-left,
  .ab-right {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .ab-name {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 10px;
    flex: 1;
    overflow: hidden;
  }

  .header-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .header-right :global(.wiki-help-wrapper) {
    text-transform: none;
    letter-spacing: normal;
  }

  .offers {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px;
  }
  .pad {
    padding: 14px 4px;
    line-height: 1.5;
  }
  .offer {
    display: flex;
    gap: 11px;
    align-items: stretch;
  }
  .thumb {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .offer-body {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 5px;
    flex: 1;
    min-width: 0;
  }
  .offer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .strong {
    font-weight: 700;
  }
  .stakes {
    color: var(--c-gold, #d9a441);
  }

  .skulls {
    letter-spacing: 2px;
    font-size: 11px;
  }
  .parties {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    min-width: 0;
  }
  .offer-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
  }

  .dossier {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 12px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 11px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .objective {
    margin: -4px 0 0;
    padding: 6px 9px;
    font-size: 10.5px;
    line-height: 1.5;
    border-left: 2px solid var(--color-border);
    cursor: help;
  }
  .quality-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-top: 4px;
  }
  .sign {
    padding: 11px;
    font-size: 13px;
  }
  .small {
    font-size: 10.5px;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }

  .deploy {
    width: 520px;
  }
  .deploy-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .deploy-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 320px;
    overflow-y: auto;
  }
  .deploy-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 40px 120px;
    gap: 8px;
    align-items: center;
    font-size: 11.5px;
  }
  .deploy-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
