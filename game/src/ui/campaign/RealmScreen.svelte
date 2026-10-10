<script lang="ts">
  import { campaign, type RealmWorld } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, signedCbills, t, tn } from '../i18n/index.js';
  import { factionName } from './relations.js';
  import { tr } from '../../core/log/index.js';
  import {
    FRONT_STANCES,
    GOVERNOR_PRIORITIES,
    PLAYER_ACTOR_ID,
    REPUTATION,
    RIVALS,
    WAR,
    type BuildingKind,
    type GovernorPriority,
    type WarGoal,
  } from '../../core/campaign/index.js';
  import type { CampaignCommand } from '../../core/campaign/commands/types.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import PlanetDisc from '../components/PlanetDisc.svelte';
  import AtlasImage from '../components/AtlasImage.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';
  import WarLogList from './WarLogList.svelte';

  /** Ячейка постройки в атласе `buildings` (`tools/pack_ui_atlases.py`). */
  const BUILDING_INDEX: Readonly<Record<BuildingKind, number>> = {
    workshop: 0,
    depot: 1,
    barracks: 2,
    defence: 3,
    spaceport: 4,
    factory: 5,
    drill: 6,
  };

  /**
   * Экран державы (шаг 72): миры роты, их доход, фокус и развитие, полевая
   * армия и дипломатия с соседями.
   *
   * Вкладка появляется, когда у роты есть хоть один мир (`campaign.hasRealm`):
   * до того здесь нечего показывать, а путь к первому миру живёт на звёздной
   * карте, где рота стоит.
   *
   * Экран ничего не считает и ничего не решает сам. Числа приходят из ядра
   * через стор (`campaign.realm*`), доступность кнопки — из `campaign.why`, то
   * есть из того же `execute`, который исполнит команду. Второй копии правил
   * державы здесь нет — ровно поэтому у выключенной кнопки рядом стоит причина
   * словами ядра, а не догадка экрана.
   */

  /**
   * Прежний экран державы — вкладка «(А)» шага 93: оставлен как есть для сравнения с новым Штабом и
   * уберётся отдельным решением пользователя. Подвкладки у него свои, шапка ими не управляет.
   */
  type Tab = 'overview' | 'worlds' | 'sectors' | 'army' | 'diplomacy';
  const TABS: readonly Tab[] = ['overview', 'worlds', 'sectors', 'army', 'diplomacy'];
  let tab = $state<Tab>('overview');
  function setTab(next: Tab): void {
    tab = next;
  }

  const summary = $derived(campaign.realm);
  const worlds = $derived(campaign.realmWorlds);
  const prices = $derived(campaign.realmPrices);
  const army = $derived(campaign.realmArmy);
  const offensives = $derived(campaign.realmOffensives);
  const neighbours = $derived(campaign.realmNeighbours);
  const vassals = $derived(campaign.realmVassals);
  const wars = $derived(campaign.realmWars);
  const regiments = $derived(campaign.greatRegiments);
  const title = $derived(campaign.realmTitle);
  /** Война, у которой раскрыт список полков для найма (шаг 89). */
  let openHire = $state<string | null>(null);
  const sectors = $derived(campaign.realmSectors);
  /** Назначение губернатора (шаг 88): центр, пилот и приоритет — одной командой. */
  let pickCenter = $state<string | null>(null);
  let pickPilot = $state<string | null>(null);
  let pickPriority = $state<GovernorPriority>('income');
  const appointCmd = $derived<CampaignCommand | null>(
    pickCenter === null || pickPilot === null
      ? null
      : { kind: 'appointGovernor', centerId: pickCenter, pilotId: pickPilot, priority: pickPriority },
  );
  const appointWhy = $derived(appointCmd === null ? null : campaign.why(appointCmd));
  const pct = (v: number): string => `${Math.round(v * 100)} %`;
  /** Навыки губернатора, которые дают бонус сектору (шаг 88): присутствие, техника, тактика. */
  const skillsText = (p: { presence: number; tech: number; tactics: number }): string =>
    `${tr('skill.presence')} ${p.presence} · ${tr('skill.tech')} ${p.tech} · ${tr('skill.tactics')} ${p.tactics}`;
  /** Что делает приоритет — из данных (`realm.priorities`), а не пересказом: порядок стройки, развитие, фокус. */
  function priorityHint(pr: GovernorPriority): string {
    const rule = WAR.realm.priorities[pr];
    const parts = [t('realm.sector.orderLine', { list: rule.buildings.map((k) => t(`realm.world.building.${k}`)).join(' → ') })];
    if (rule.develop) parts.push(t('realm.sector.developLine'));
    if (rule.focus !== null) parts.push(t('realm.sector.focusLine', { focus: t(`focus.${rule.focus}`) }));
    return parts.join(' ');
  }
  /** Последние строки сводки войны с меткой «держава» (шаг 78) — та же лента, что на экране войны. */
  const feed = $derived(campaign.warLog.filter((l) => l.realm === true).slice(0, 10));
  /** Сосед, которому объявляют войну (шаг 76): решение крупное — в два нажатия. */
  let confirmWar = $state<string | null>(null);
  /** Цель войны (шаг 81), выбирается во втором нажатии: вид и миры у границы. */
  let goalKind = $state<WarGoal['kind']>('worlds');
  let goalPick = $state<string[]>([]);
  const goal = $derived<WarGoal>(goalKind === 'humiliation' ? { kind: 'humiliation' } : { kind: goalKind, systems: goalPick });

  function openDeclare(factionId: string): void {
    confirmWar = factionId;
    goalKind = 'worlds';
    goalPick = [];
  }

  function toggleGoal(id: string): void {
    goalPick = goalPick.includes(id) ? goalPick.filter((x) => x !== id) : [...goalPick, id];
  }

  let selectedId = $state<string | null>(null);
  const world = $derived<RealmWorld | null>(
    worlds.find((w) => w.id === selectedId) ?? worlds[0] ?? null,
  );
  const preview = $derived(world === null ? [] : campaign.focusPreview(world.id));

  function runCmd(cmd: CampaignCommand): void {
    campaign.run(cmd);
  }

  const ARMY_STEPS = [1, 4, 12] as const;
  /** Взнос кассы в военный фонд (шаг 80): три ступени, как у набора армии. */
  const FUND_STEPS = [1_000_000, 5_000_000, 20_000_000] as const;
  /** Сверх этой доли нормы готовность театра не растёт (`logistics.ts::theaterReadiness`). */
  const THEATER_USEFUL = 1.5;
  let armyStep = $state<number>(4);
  const raiseCmd = $derived<CampaignCommand>({ kind: 'raiseRegiment', mechs: armyStep });
  const disbandCmd = $derived<CampaignCommand>({ kind: 'raiseRegiment', mechs: -armyStep });
  const raiseTake = $derived(Math.max(0, Math.min(armyStep, army.cap - army.total)));
  const disbandTake = $derived(Math.min(armyStep, army.total));
  const raiseWhy = $derived(campaign.why(raiseCmd));
  const disbandWhy = $derived(campaign.why(disbandCmd));

  /**
   * Тревоги (отладка 2026-10-03): разорение — с порога, с которого оно мешает развитию (`development.ruinBlock`), а не
   * с долей процента; лояльность — когда она падает и ниже вдвое от порога восстания, пока мир ещё можно удержать.
   */
  /** Прибавки титула — только ненулевые (отладка 2026-10-03: строка показывала «секторов +0»). */
  function titleBonusList(b: { loyalty: number; points: number; sectors: number }): string {
    const parts: string[] = [];
    if (b.loyalty > 0) parts.push(t('realm.title.bonusLoyalty', { value: b.loyalty }));
    if (b.points > 0) parts.push(t('realm.title.bonusPoints', { value: b.points }));
    if (b.sectors > 0) parts.push(t('realm.title.bonusSectors', { value: b.sectors }));
    return parts.join(', ');
  }
  /**
   * Фонд против врагов без участка фронта (отладка 2026-10-03): `placeWarFund` копит и на них (решение шага 26 для
   * фракций), но держава роты их не достаёт — одной строкой, а не семью «фонд против Медведи / Кошки / …».
   */
  const frontFoes = $derived(new Set(army.theaters.map((th) => th.against)));
  const farFunds = $derived(army.funds.filter((f) => !frontFoes.has(f.against)));

  function ruinAlert(w: RealmWorld): boolean {
    return w.ruined >= WAR.development.ruinBlock;
  }
  function loyaltyAlert(w: RealmWorld): boolean {
    return w.revoltUntil === null && w.loyalty !== null && w.loyaltyDrift < 0 && w.loyalty < 2 * WAR.loyalty.revoltBelow;
  }

  let openNeighbour = $state<string | null>(null);
  /** Мир, от которого отказываются (шаг 75): отказ необратим, поэтому в два нажатия. */
  let confirmAbandon = $state<string | null>(null);
</script>

<div class="realm">
  <nav class="subtabs panel">
    {#each TABS as id (id)}
      <button class="subtab" class:active={tab === id} data-legacy-tab={id} onclick={() => setTab(id)}>
        {t(`realm.tab.${id}`)}
      </button>
    {/each}
  </nav>

  {#if worlds.length === 0}
    <section class="panel panel-body">
      <p class="dim">{t('realm.empty')}</p>
    </section>
  {:else if tab === 'overview'}
    <div class="cols">
      <section class="panel">
        <div class="panel-header">
          <span>{t('realm.balance.title')}</span>
          <span class="spacer"></span>
          <WikiHelp doc="domain.md" align="right" label="?" />
        </div>
        <div class="panel-body stack">
          <div class="row-kv"><span>{t('realm.balance.worlds')}</span><span>{tn('count.worlds', summary.worlds)}</span></div>
          <!-- Титул державы (шаг 89): по числу миров сейчас, прибавки копятся, ничего не запрещает. -->
          {#if title !== null}
            <div class="row-kv" title={t('realm.title.hint')}>
              <span>{t('realm.title.label')}</span><span class="gold">{t(`realm.title.name.${title.id}`)}</span>
            </div>
            {#if title.bonus.loyalty > 0 || title.bonus.points > 0 || title.bonus.sectors > 0}
              <p class="dim tiny">
                {t('realm.title.bonus', { list: titleBonusList(title.bonus) })}
              </p>
            {/if}
            {#if title.next !== null}
              <p class="dim tiny">{t('realm.title.next', { title: t(`realm.title.name.${title.next.id}`), worlds: tn('count.worlds', title.next.worlds) })}</p>
            {/if}
          {/if}
          <div class="row-kv"><span>{t('realm.balance.income')}</span><span class="ok">{signedCbills(summary.income)}</span></div>
          <div class="row-kv"><span>{t('realm.balance.upkeep')}</span><span class="danger">{signedCbills(-summary.upkeep)}</span></div>
          {#if summary.army > 0}
            <div class="row-kv"><span>{t('realm.balance.army')}</span><span class="danger">{signedCbills(-summary.army)}</span></div>
          {/if}
          {#if summary.buildings > 0}
            <div class="row-kv"><span>{t('realm.balance.buildings')}</span><span class="danger">{signedCbills(-summary.buildings)}</span></div>
          {/if}
          {#if summary.fund > 0}
            <div class="row-kv"><span>{t('realm.balance.fund')}</span><span class="cyan">{signedCbills(-summary.fund)}</span></div>
          {/if}
          <div class="row-kv">
            <span title={t('realm.balance.flowsHint')}>{t('realm.balance.flows')}</span>
            <span class:ok={summary.flows > 0} class:danger={summary.flows < 0}>{signedCbills(summary.flows)}</span>
          </div>
          <div class="row-kv total">
            <span>{t('realm.balance.net')}</span>
            <span class:ok={summary.net >= 0} class:danger={summary.net < 0}>{signedCbills(summary.net)}</span>
          </div>
          <p class="dim tiny">{t('realm.balance.hint')}</p>
        </div>

        <div class="panel-header"><span>{t('realm.alerts.title')}</span></div>
        <div class="panel-body stack">
          {#each worlds.filter((w) => w.threats.length > 0 || w.tributeTo !== null || ruinAlert(w) || w.revoltUntil !== null || loyaltyAlert(w)) as w (w.id)}
            <button class="pick" onclick={() => { selectedId = w.id; setTab('worlds'); }}>
              <span class="strong">{w.name}</span>
              {#if w.revoltUntil !== null}
                <span class="danger tiny">· {t('realm.world.revoltShort', { date: campaign.dateText(w.revoltUntil) })}</span>
              {/if}
              {#if w.tributeTo !== null}
                <span class="danger tiny">· {t('realm.world.paysTribute', { faction: factionName(w.tributeTo) })}</span>
              {/if}
              {#if loyaltyAlert(w)}
                <span class="danger tiny">· {t('realm.world.loyaltyFalling', { value: Math.round(w.loyalty ?? 0), below: WAR.loyalty.revoltBelow })}</span>
              {/if}
              {#if ruinAlert(w)}
                <span class="gold tiny">· {t('realm.world.ruined', { percent: Math.round(w.ruined * 100) })}</span>
              {/if}
              {#each w.threats as th (th.attacker)}
                <span class="danger tiny">· {t('realm.world.threatFront', { faction: factionName(th.attacker) })}</span>
              {/each}
            </button>
          {:else}
            <p class="dim tiny">{t('realm.alerts.none')}</p>
          {/each}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header"><span>{t('realm.status.title')}</span></div>
        <div class="panel-body stack">
          <p class="gold small">{t('realm.status.front')}</p>
          <p class="small">{t('realm.status.enemies')}</p>
          <p class="small">{t('realm.status.army')}</p>
          <p class="dim tiny">{t('realm.status.diplomacy')}</p>
        </div>
      </section>
    </div>
  {:else if tab === 'worlds'}
    <div class="cols worlds-cols">
      <section class="panel panel-scroll">
        <div class="panel-header">
          <span>{t('realm.world.list')}</span>
          <span class="badge badge-dim">{worlds.length}</span>
          <span class="spacer"></span>
          <WikiHelp doc="domain.md" section="4. Развитие и фокус" align="right" label="?" />
        </div>
        <div class="scroll-area list">
          {#each worlds as w (w.id)}
            <button class="pick" class:active={world?.id === w.id} onclick={() => (selectedId = w.id)}>
              <span class="pick-line">
                <span class="strong">{w.name}</span>
                {#if w.capital}<span class="badge badge-gold">{t('realm.world.capital')}</span>{/if}
                {#if w.threats.length > 0 || w.tributeTo !== null || w.revoltUntil !== null}<span class="danger">⚠</span>{/if}
              </span>
              <span class="pick-line dim tiny">
                <span>
                  {t(`focus.${w.focus}`)} · {t('realm.world.devShort', { level: w.development })}
                  {#if w.loyalty !== null}· <span class:danger={w.revoltUntil !== null}>{t('realm.world.loyaltyShort', { value: Math.round(w.loyalty) })}</span>{/if}
                </span>
                <span class:ok={w.income >= w.upkeep} class:danger={w.income < w.upkeep}>{signedCbills(w.income - w.upkeep)}</span>
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if world !== null}
        {@const w = world}
        {@const g = campaign.garrisonView(w.id)}
        {@const b = campaign.buildingsView(w.id)}
        {@const B = WAR.buildings}
        {@const pinCmd = { kind: 'pinWorld', systemId: w.id, pinned: !w.pinned } as const}
        <section class="panel panel-scroll">
          <div class="panel-header">
            <span>{w.name}</span>
            <span class="head-tools">
              {#if w.capital}<span class="badge badge-gold">{t('realm.world.capital')}</span>{/if}
              {#if g.mechs.length > 0}
                <button class="btn btn-sm" onclick={() => campaign.showGarrison(w.id)} title={t('realm.world.garrisonInHangar')}>
                  {t('realm.world.garrisonButton', { count: g.mechs.length })}
                </button>
              {/if}
              <button class="btn btn-sm" onclick={() => campaign.showOnMap(w.id)}>{t('realm.onMap')}</button>
            </span>
          </div>
          <div class="scroll-area panel-body stack">
            <div class="world-head">
              <div class="disc"><PlanetDisc biome={w.biome} width={150} /></div>
              <div class="grid">
                <div class="kv"><span class="kv-k">{t('realm.world.income')}</span><span class="kv-v ok">{cbills(w.income)}</span></div>
                <div class="kv"><span class="kv-k">{t('realm.world.upkeep')}</span><span class="kv-v danger">{cbills(w.upkeep)}</span></div>
                <div class="kv" title={t('realm.world.capacityHint')}><span class="kv-k">{t('realm.world.capacity')}</span><span class="kv-v">{w.capacity}</span></div>
                <div class="kv" title={t('realm.world.liftHint')}><span class="kv-k">{t('realm.world.lift')}</span><span class="kv-v">{w.lift.toFixed(1)}</span></div>
                <div class="kv"><span class="kv-k">{t('realm.world.development')}</span><span class="kv-v">{w.development} / {w.developmentMax}</span></div>
                <div class="kv"><span class="kv-k">{t('realm.world.ruin')}</span><span class="kv-v" class:gold={w.ruined > 0}>{Math.round(w.ruined * 100)} %</span></div>
                {#if w.loyalty !== null}
                  <div
                    class="kv"
                    title={t('realm.world.loyaltyHint', {
                      below: WAR.loyalty.revoltBelow,
                      incite: WAR.resistance.inciteStanding,
                      welfare: WAR.resistance.welfarePerStep,
                    })}
                  >
                    <span class="kv-k">{t('realm.world.loyalty')}</span>
                    <span class="kv-v" class:danger={w.revoltUntil !== null} class:gold={w.revoltUntil === null && w.loyaltyFactor < 1}>
                      {t('realm.world.loyaltyValue', {
                        value: Math.round(w.loyalty),
                        factor: w.loyaltyFactor.toFixed(2),
                        drift: `${w.loyaltyDrift >= 0 ? '+' : '−'}${Math.abs(Math.round(w.loyaltyDrift * 10) / 10)}`,
                      })}
                    </span>
                  </div>
                {/if}
              </div>
            </div>
            {#if w.revoltUntil === null && w.loyaltyPressure === 'incite'}
              <p class="gold small">
                {t('realm.world.inciteLine', { faction: factionName(w.formerOwner ?? ''), standing: WAR.resistance.inciteStanding })}
              </p>
            {/if}
            {#if w.revoltUntil !== null}
              <p class="danger small">
                {t('realm.world.revoltLine', {
                  faction: factionName(w.formerOwner ?? ''),
                  date: campaign.dateText(w.revoltUntil),
                })}
              </p>
            {/if}
            <!-- Сектор и закрепление (шаг 88): закреплённый мир губернатор не трогает, бонус его — остаётся. -->
            <div class="sec-title">{t('realm.sector.title')}</div>
            <p class="tiny">
              {w.sector === null
                ? t('realm.sector.none')
                : t('realm.sector.of', { system: worlds.find((x) => x.id === w.sector)?.name ?? w.sector })}
            </p>
            <div class="action">
              <button class="btn btn-sm" class:btn-gold={w.pinned} onclick={() => runCmd(pinCmd)}>
                {t(w.pinned ? 'realm.sector.unpin' : 'realm.sector.pin')}
              </button>
              <span class="dim tiny">{t('realm.sector.pinHint')}</span>
            </div>
            <div class="sec-title">{t('realm.world.capital')}</div>
            {#if w.capital}
              <p class="dim tiny">{t('realm.world.capitalHint')}</p>
            {:else}
              {@const cmd = { kind: 'moveCapital', systemId: w.id } as const}
              {@const why = campaign.why(cmd)}
              <div class="action">
                <button class="btn btn-sm btn-gold" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                  {t('realm.world.moveCapital', { sum: cbills(prices?.capital ?? 0) })}
                </button>
                {#if why !== null}<span class="dim tiny">{why}</span>{/if}
              </div>
              <p class="dim tiny">{t('realm.world.moveCapitalHint', { days: WAR.domain.capitalMoveCooldownDays })}</p>
              {#if prices?.capitalReadyDay != null && prices.capitalReadyDay > campaign.day}
                <p class="gold tiny">{t('realm.world.capitalReady', { date: campaign.dateText(prices.capitalReadyDay) })}</p>
              {/if}
            {/if}

            {#if w.threats.length > 0}
              <div class="sec-title">{t('realm.world.threats')}</div>
              {#each w.threats as th (th.attacker)}
                <div class="threat">
                  <FactionEmblem factionId={th.attacker} size={16} />
                  <span class="danger small">{t('realm.world.threatFront', { faction: factionName(th.attacker) })}</span>
                </div>
              {/each}
              <p class="dim tiny">{t('realm.world.threatFrontHint')}</p>
            {/if}

            <!-- Гарнизон из машин роты (шаг 86b): дерётся за мир при нападении фронта и бьёт восстание. -->
            <div class="sec-title">{t('realm.world.garrisonTitle')}</div>
            <!-- Предел гарнизона и склада (шаг 87): звено без казарм, рота с ними; склад — машины без пилота. -->
            <p class="dim tiny">
              {t('realm.world.garrisonCount', { count: g.count, cap: g.cap })}{#if g.depotCap > 0}
                · {t('realm.world.depotCount', { count: g.depotCount, cap: g.depotCap })}{/if}
            </p>
            {#if g.mechs.length === 0}
              <p class="dim tiny">{t('realm.world.garrisonEmpty')}</p>
            {/if}
            {#each g.mechs as m (m.id)}
              {@const cmd = { kind: 'garrisonLoad', recordIds: [m.id] } as const}
              {@const why = campaign.why(cmd)}
              <div class="action">
                <span class="small">{m.name}</span>
                {#if m.arrives !== null}
                  <span class="dim tiny">{t('realm.world.garrisonEnRoute', { date: campaign.dateText(m.arrives) })}</span>
                {:else if m.depot}
                  <span class="dim tiny">{t('realm.world.depotTag')}</span>
                {:else if !m.fit}
                  <span class="gold tiny">{t('realm.world.garrisonUnfit')}</span>
                {/if}
                {#if g.here}
                  <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                    {t('realm.world.garrisonLoad')}
                  </button>
                {/if}
              </div>
            {/each}
            {#if g.here}
              {#each g.aboard as m (m.id)}
                {@const cmd = { kind: 'garrisonUnload', recordIds: [m.id] } as const}
                {@const why = campaign.why(cmd)}
                <div class="action">
                  <span class="small dim">{m.name}</span>
                  <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                    {t(m.depot ? 'realm.world.garrisonStore' : 'realm.world.garrisonUnload')}
                  </button>
                  {#if why !== null}<span class="dim tiny">{why}</span>{/if}
                </div>
              {/each}
            {:else}
              <p class="dim tiny">{t('realm.world.garrisonAway')}</p>
            {/if}
            <div class="action">
              {#each ['fight', 'withdraw'] as const as policy (policy)}
                {@const cmd = { kind: 'setGarrisonPolicy', systemId: w.id, policy } as const}
                <button class="btn btn-sm" class:btn-gold={g.policy === policy} onclick={() => runCmd(cmd)}>
                  {t(`realm.world.garrisonPolicy.${policy}`)}
                </button>
              {/each}
            </div>
            <p class="dim tiny">{t('realm.world.garrisonHint')}</p>

            <!-- Постройки мира (шаг 87): очередь стройки, срок по мощности мира, эффект в числах ядра. -->
            <div class="sec-title">{t('realm.world.buildingsTitle')}</div>
            <p class="dim tiny">{t('realm.world.buildPoints', { points: b.points })}</p>
            {#if b.construction !== null}
              {@const c = b.construction}
              {@const cmd = { kind: 'cancelBuilding', systemId: w.id } as const}
              <div class="building-cur">
                <div class="building-cur-icon">
                  <AtlasImage atlas="buildings" index={BUILDING_INDEX[c.kind]} width="36px" />
                </div>
                <div class="building-cur-body">
                  <div class="action">
                    <span class="small gold">{t(`realm.world.building.${c.kind}`)}</span>
                    <span class="dim tiny">
                      {t('realm.world.buildingInProgress', { done: c.progress, work: c.work, eta: daysText(c.etaDays) })}
                    </span>
                    <button class="btn btn-sm" onclick={() => runCmd(cmd)}>
                      {t('realm.world.buildingCancel', { sum: cbills(c.refund) })}
                    </button>
                  </div>
                </div>
              </div>
            {/if}
            {#each b.rows as row (row.kind)}
              {@const cmd = { kind: 'startBuilding', systemId: w.id, building: row.kind } as const}
              {@const why = row.built || b.construction !== null ? null : campaign.why(cmd)}
              <div class="building" class:built={row.built}>
                <div class="building-row">
                  <div class="building-thumb" class:built={row.built}>
                    <AtlasImage atlas="buildings" index={BUILDING_INDEX[row.kind]} width="52px" />
                  </div>
                  <div class="building-main">
                    <div class="action">
                      <span class="small" class:ok={row.built}>{t(`realm.world.building.${row.kind}`)}</span>
                      {#if row.built}
                        <span class="ok tiny">{t('realm.world.buildingBuilt')}</span>
                      {:else if b.construction === null}
                        <button class="btn btn-sm btn-gold" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                          {t('realm.world.buildingStart')}
                        </button>
                      {/if}
                    </div>
                    <p class="dim tiny">
                      {t(`realm.world.buildingEffect.${row.kind}`, {
                        bays: B.workshopBays,
                        cost: Math.round(B.workshopCost * 100),
                        days: Math.round(B.workshopDays * 100),
                        slots: B.depotSlots,
                        cap: B.garrisonCapBarracks,
                        base: B.garrisonCap,
                        loyalty: B.barracksLoyalty,
                        fee: Math.round(B.barracksHireFee * 100),
                        mult: B.orbitalDefence,
                        from: t(`market.class.${b.marketFrom}`),
                        to: t(`market.class.${b.marketTo}`),
                        cut: Math.round(B.factoryArmyCut * 100),
                        floor: Math.round(B.factoryArmyFloor * 100),
                        price: Math.round(B.factoryMechPrice * 100),
                        barracksArmy: B.barracksArmy,
                        factoryArmy: B.factoryArmy,
                        drillArmy: B.drillArmy,
                        barracksCut: Math.round(B.barracksUpkeepCut * 100),
                        drillCut: Math.round(B.drillUpkeepCut * 100),
                        sector: B.sectorUpkeepFactor,
                        trade: Math.round(B.spaceportTradeShare * 1000) / 10,
                      })}
                    </p>
                    {#if !row.built}
                      <p class="dim tiny">
                        {t('realm.world.buildingCosts', {
                          sum: cbills(row.cost),
                          work: row.work,
                          eta: daysText(row.etaDays),
                          upkeep: cbills(row.upkeep),
                          upkeep10: cbills(row.upkeep10),
                        })}
                      </p>
                      <p class="dim tiny">
                        {row.kind === 'factory'
                          ? t('realm.world.buildingFactoryReturn', {
                              mechs: tn('count.mechsAcc', b.factoryArmy),
                              sum: cbills(b.factorySaving),
                            })
                          : t('realm.world.buildingSink', { share: Math.round((row.upkeep10 / row.cost) * 100) })}
                      </p>
                    {/if}
                    {#if why !== null}<p class="dim tiny">{why}</p>{/if}
                  </div>
                </div>
              </div>
            {/each}
            {#each b.workshopJobs as job (job.jobId)}
              {@const cmd = { kind: 'cancelJob', jobId: job.jobId } as const}
              <div class="action">
                <span class="dim tiny">{t('realm.world.workshopJob', { mech: job.mech, days: daysText(job.daysLeft) })}</span>
                <button
                  class="btn btn-sm btn-danger"
                  title={t('hangar.job.cancelHint')}
                  disabled={campaign.why(cmd) !== null}
                  onclick={() => runCmd(cmd)}
                >
                  ✕
                </button>
              </div>
            {/each}
            <p class="dim tiny">
              {t('realm.world.buildingsHint', {
                min: B.minPoints,
                refund: Math.round(B.cancelRefund * 100),
                upkeep: B.upkeepShare * 100,
                survive: Math.round(B.surviveLoss * 100),
              })}
            </p>

            {#if w.tributeTo !== null}
              {@const cmd = { kind: 'buyOffTribute', systemId: w.id } as const}
              {@const why = campaign.why(cmd)}
              <div class="sec-title">{t('realm.world.tribute')}</div>
              <p class="danger small">
                {t('realm.world.tributeLine', {
                  faction: factionName(w.tributeTo),
                  date: w.tributeUntil === null ? '—' : campaign.dateText(w.tributeUntil),
                })}
              </p>
              <div class="action">
                <button class="btn btn-sm btn-gold" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                  {t('realm.world.buyOff', { sum: cbills(campaign.tributePriceAt(w.id)) })}
                </button>
                {#if why !== null}<span class="dim tiny">{why}</span>{/if}
              </div>
            {/if}

            <div class="sec-title">{t('realm.world.abandonTitle')}</div>
            {#if confirmAbandon === w.id}
              {@const cmd = { kind: 'abandonWorld', systemId: w.id } as const}
              <div class="confirm">
                <p class="danger small">
                  {t(worlds.length === 1 ? 'realm.world.abandonConfirmLast' : 'realm.world.abandonConfirm', {
                    system: w.name,
                    days: daysText(WAR.domain.abandonHoldDays),
                  })}
                </p>
                <div class="action">
                  <button class="btn btn-sm btn-danger" onclick={() => { runCmd(cmd); confirmAbandon = null; }}>
                    {t('realm.world.abandonDo')}
                  </button>
                  <button class="btn btn-sm" onclick={() => (confirmAbandon = null)}>{t('common.cancel')}</button>
                </div>
              </div>
            {:else}
              {@const why = campaign.why({ kind: 'abandonWorld', systemId: w.id })}
              <div class="action">
                <button class="btn btn-sm btn-danger" disabled={why !== null} title={why ?? ''} onclick={() => (confirmAbandon = w.id)}>
                  {t('realm.world.abandon')}
                </button>
                {#if why !== null}<span class="dim tiny">{why}</span>{/if}
              </div>
              <p class="dim tiny">{t('realm.world.abandonHint', { days: daysText(WAR.domain.abandonHoldDays) })}</p>
            {/if}

            <div class="sec-title">{t('realm.world.developTitle')}</div>
            {#if w.development >= w.developmentMax}
              <p class="dim tiny">{t('realm.world.developMax')}</p>
            {:else}
              {@const cmd = { kind: 'developWorld', systemId: w.id } as const}
              {@const why = campaign.why(cmd)}
              <div class="action">
                <button class="btn btn-sm btn-primary" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                  {t('realm.world.develop', { level: w.development + 1, sum: cbills(w.developCost) })}
                </button>
                {#if why !== null}<span class="dim tiny">{why}</span>{/if}
              </div>
              <p class="dim tiny">{t('realm.world.developHint')}</p>
            {/if}

            <div class="sec-title">{t('realm.world.focusTitle')}</div>
            <p class="small">
              {t('realm.world.focusNow', { focus: t(`focus.${w.focus}`) })}
              {#if w.focus !== w.naturalFocus}
                <span class="dim tiny">({t('realm.world.focusNatural', { focus: t(`focus.${w.naturalFocus}`) })})</span>
              {/if}
            </p>
            {#if w.focusTo !== null}
              <p class="gold small">
                {t('realm.world.focusPending', {
                  focus: t(`focus.${w.focusTo}`),
                  date: w.focusUntil === null ? '—' : campaign.dateText(w.focusUntil),
                })}
              </p>
            {/if}
            <table class="focus-table">
              <thead>
                <tr>
                  <th>{t('realm.focus.col.focus')}</th>
                  <th>{t('realm.focus.col.income')}</th>
                  <th>{t('realm.focus.col.upkeep')}</th>
                  <th title={t('realm.world.capacityHint')}>{t('realm.focus.col.capacity')}</th>
                  <th title={t('realm.focus.defenceHint')}>{t('realm.focus.col.defence')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each preview as p (p.focus)}
                  {@const cmd = { kind: 'setWorldFocus', systemId: w.id, focus: p.focus } as const}
                  {@const why = campaign.why(cmd)}
                  <tr class:current={p.focus === w.focus}>
                    <td title={t(`focusHint.${p.focus}`)}>{t(`focus.${p.focus}`)}</td>
                    <td>{cbills(p.income)}</td>
                    <td>{cbills(p.upkeep)}</td>
                    <td>{p.capacity}</td>
                    <td>×{p.defence.toFixed(2)}</td>
                    <td class="right">
                      {#if p.focus === w.focus}
                        <span class="dim tiny">{t('realm.focus.current')}</span>
                      {:else}
                        <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                          {t('realm.focus.pick')}
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <p class="dim tiny">
              {t('realm.focus.hint', { sum: cbills(prices?.focus ?? 0), days: WAR.focus.changeDays })}
            </p>
          </div>
        </section>
      {/if}
    </div>
  {:else if tab === 'sectors'}
    <!-- Секторы и губернаторы (шаг 88): губернатор отдаёт те же команды, что игрок, — строками сводки «держава». -->
    <div class="cols">
      <section class="panel panel-scroll">
        <div class="panel-header">
          <span>{t('realm.sector.list')}</span>
          <span class="badge badge-dim">{t('realm.sector.limit', { used: sectors.used, limit: sectors.limit })}</span>
          <span class="spacer"></span>
          <WikiHelp doc="domain.md" section="4б. Секторы, губернаторы и стойки фронтов (шаг 88)" align="right" label="?" />
        </div>
        <div class="scroll-area panel-body stack">
          <p class="dim tiny">
            {t('realm.sector.hint', { jumps: tn('count.jumps', WAR.realm.sectorJumps), per: tn('count.worlds', WAR.realm.worldsPerSector) })}
          </p>
          {#each sectors.sectors as x (x.center)}
            <div class="sec-title">{x.centerName}</div>
            {#if x.governor === null}
              <p class="danger tiny">{t('realm.sector.vacant')}</p>
            {:else}
              <p class="small">
                {t('realm.sector.governor', { pilot: x.governor.callsign, skills: skillsText(x.governor) })}
              </p>
              <p class="dim tiny">
                {t('realm.sector.bonus', {
                  loyalty: x.governor.bonus.loyalty.toFixed(1),
                  points: x.governor.bonus.points,
                  defence: pct(x.governor.bonus.defence - 1),
                })}
              </p>
            {/if}
            <div class="action-row">
              {#each GOVERNOR_PRIORITIES as pr (pr)}
                <button
                  class="btn btn-sm"
                  class:btn-gold={x.priority === pr}
                  disabled={x.priority === pr}
                  title={priorityHint(pr)}
                  onclick={() => runCmd({ kind: 'setSectorPriority', centerId: x.center, priority: pr })}
                >
                  {t(`realm.sector.priority.${pr}`)}
                </button>
              {/each}
            </div>
            <p class="tiny">
              {t('realm.sector.worlds', {
                list: x.worlds.map((v) => (v.pinned ? `${v.name} (${t('realm.sector.pinnedMark')})` : v.name)).join(', '),
              })}
            </p>
            <div class="action-row">
              <button class="btn btn-sm btn-danger" onclick={() => runCmd({ kind: 'releaseGovernor', centerId: x.center })}>
                {t('realm.sector.release')}
              </button>
            </div>
          {:else}
            <p class="dim tiny">{t('realm.sector.empty')}</p>
          {/each}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header"><span>{t('realm.sector.appoint')}</span></div>
        <div class="panel-body stack">
          <div class="sec-title">{t('realm.sector.reserve')}</div>
          <p class="dim tiny">{t('realm.sector.reserveHint')}</p>
          <div class="action-row">
            {#each sectors.reserveSteps as step (step)}
              <button
                class="btn btn-sm"
                class:btn-gold={sectors.reserve === step}
                disabled={sectors.reserve === step}
                onclick={() => runCmd({ kind: 'setRealmReserve', amount: step })}
              >
                {cbills(step)}
              </button>
            {/each}
          </div>
          <div class="sec-title">{t('realm.sector.center')}</div>
          <div class="action-row">
            {#each sectors.centers as c (c.id)}
              <button class="btn btn-sm" class:btn-gold={pickCenter === c.id} onclick={() => (pickCenter = c.id)}>{c.name}</button>
            {/each}
          </div>
          <div class="sec-title">{t('realm.sector.pilot')}</div>
          <div class="action-row">
            {#each sectors.pilots as p (p.id)}
              <button
                class="btn btn-sm"
                class:btn-gold={pickPilot === p.id}
                title={skillsText(p)}
                onclick={() => (pickPilot = p.id)}
              >
                {p.callsign}
              </button>
            {/each}
          </div>
          <div class="sec-title">{t('realm.sector.priorityTitle')}</div>
          <div class="action-row">
            {#each GOVERNOR_PRIORITIES as pr (pr)}
              <button class="btn btn-sm" class:btn-gold={pickPriority === pr} title={priorityHint(pr)} onclick={() => (pickPriority = pr)}>
                {t(`realm.sector.priority.${pr}`)}
              </button>
            {/each}
          </div>
          <div class="action-row">
            <button
              class="btn btn-sm btn-gold"
              disabled={appointCmd === null || appointWhy !== null}
              title={appointWhy ?? t('realm.sector.appointHint')}
              onclick={() => appointCmd !== null && runCmd(appointCmd)}
            >
              {t('realm.sector.appointGo')}
            </button>
          </div>
          {#if appointWhy !== null}<p class="dim tiny">{appointWhy}</p>{/if}
        </div>
      </section>
    </div>
  {:else if tab === 'army'}
    <div class="cols">
      <section class="panel">
        <div class="panel-header">
          <span>{t('realm.army.title')}</span>
          <WikiHelp doc="glossary.md" section="полевая армия и гарнизон" align="right" label="?" />
        </div>
        <div class="panel-body stack">
          <div class="grid">
            <div class="kv"><span class="kv-k">{t('realm.army.total')}</span><span class="kv-v">{army.total}</span></div>
            <div class="kv"><span class="kv-k">{t('realm.army.reserve')}</span><span class="kv-v">{army.reserve}</span></div>
            <div class="kv" title={t('realm.army.capHint')}><span class="kv-k">{t('realm.army.cap')}</span><span class="kv-v">{army.cap}</span></div>
            <div class="kv"><span class="kv-k">{t('realm.army.capacity')}</span><span class="kv-v">{army.capacity}</span></div>
          </div>
          <div class="meter cyan"><i style:width={`${army.cap > 0 ? Math.min(100, (army.total / army.cap) * 100) : 0}%`}></i></div>
          <p class="dim tiny">{t('realm.army.capHint')}</p>
          <p class="dim tiny">
            {t('realm.army.capParts', {
              capacity: army.capParts.capacity,
              draft: army.capParts.draft,
              buildings: army.capParts.buildings,
              title: Math.round(army.capParts.title * 100),
            })}
          </p>
          <p class="dim tiny">
            {t('realm.army.upkeepLine', {
              sum: cbills(army.upkeep.total),
              mechs: tn('count.mechs', army.upkeep.mechs),
              cut: Math.round((1 - army.upkeep.factor) * 100),
            })}
          </p>
          {#if army.total > army.cap}
            <p class="gold tiny">
              {t('realm.army.overCap', { mechs: tn('count.mechs', army.total - army.cap), sum: cbills((army.total - army.cap) * army.mechUpkeep) })}
            </p>
          {/if}

          <div class="sec-title">{t('realm.army.orders')}</div>
          <div class="steps">
            {#each ARMY_STEPS as n (n)}
              <button class="btn btn-sm" class:btn-primary={armyStep === n} onclick={() => (armyStep = n)}>
                {tn('count.mechs', n)}
              </button>
            {/each}
          </div>
          <div class="action">
            <button class="btn btn-sm btn-primary" disabled={raiseWhy !== null} title={raiseWhy ?? ''} onclick={() => runCmd(raiseCmd)}>
              {t('realm.army.raise', { mechs: tn('count.mechsAcc', raiseTake), sum: cbills(campaign.regimentPriceOf(raiseTake)) })}
            </button>
            {#if raiseWhy !== null}<span class="dim tiny">{raiseWhy}</span>{/if}
          </div>
          <div class="action">
            <button class="btn btn-sm btn-danger" disabled={disbandWhy !== null} title={disbandWhy ?? ''} onclick={() => runCmd(disbandCmd)}>
              {t('realm.army.disband', { mechs: tn('count.mechsAcc', disbandTake), sum: cbills(campaign.regimentRefundOf(disbandTake)) })}
            </button>
            {#if disbandWhy !== null}<span class="dim tiny">{disbandWhy}</span>{/if}
          </div>
          <p class="dim tiny">{t('realm.army.priceHint', { sum: cbills(army.mechPrice), upkeep: cbills(army.mechUpkeep) })}</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header"><span>{t('realm.army.theaters')}</span></div>
        <div class="panel-body stack">
          <p class="dim tiny">{t('realm.army.theatersHint')}</p>
          {#each army.theaters as th (th.against)}
            <div class="threat">
              <FactionEmblem factionId={th.against} size={16} />
              <span class="small">{t('realm.army.theaterRow', { faction: factionName(th.against) })}</span>
              <span class="small right" class:cyan={th.reference <= 0 || th.mechs <= th.reference * THEATER_USEFUL} class:gold={th.reference > 0 && th.mechs > th.reference * THEATER_USEFUL}>
                {th.reference > 0
                  ? t('realm.army.theaterNorm', { mechs: tn('count.mechs', th.mechs), norm: th.reference })
                  : tn('count.mechs', th.mechs)}
              </span>
            </div>
          {:else}
            <p class="dim tiny">{t('realm.army.noTheaters')}</p>
          {/each}
          {#if army.theaters.some((th) => th.reference > 0)}
            <p class="dim tiny">{t('realm.army.theaterNormHint', { share: THEATER_USEFUL })}</p>
          {/if}

          <div class="sec-title">{t('realm.army.budget')}</div>
          <p class="dim tiny">{t('realm.army.budgetHint')}</p>
          <div class="steps">
            {#each army.warSteps as share (share)}
              {@const cmd = { kind: 'setWarBudget', share } as const}
              {@const why = campaign.why(cmd)}
              <button
                class="btn btn-sm"
                class:btn-primary={army.warShare === share}
                disabled={army.warShare === share || why !== null}
                title={why ?? ''}
                onclick={() => runCmd(cmd)}
              >
                {t('realm.army.budgetStep', { percent: Math.round(share * 100) })}
              </button>
            {/each}
          </div>
          {#each army.funds.filter((f) => frontFoes.has(f.against)) as f (f.against)}
            <div class="threat">
              <FactionEmblem factionId={f.against} size={16} />
              <span class="small">
                {t('realm.army.fundRow', { faction: factionName(f.against), sum: cbills(f.amount), push: f.push.toFixed(2) })}
              </span>
            </div>
          {:else}
            {#if farFunds.length === 0}
              <p class="dim tiny">{t('realm.army.noFunds')}</p>
            {/if}
          {/each}
          {#if farFunds.length > 0}
            <p class="dim tiny">
              {t('realm.army.fundFar', {
                count: farFunds.length,
                sum: cbills(farFunds.reduce((s, f) => s + f.amount, 0)),
                percent: Math.round(WAR.economy.idleRelease * 100),
              })}
            </p>
          {/if}

          <div class="sec-title">{t('realm.army.fundTitle')}</div>
          <p class="dim tiny">{t('realm.army.fundHint')}</p>
          <div class="steps">
            {#each FUND_STEPS as amount (amount)}
              {@const cmd = { kind: 'fundWar', amount } as const}
              {@const why = campaign.why(cmd)}
              <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => runCmd(cmd)}>
                {t('realm.army.fundStep', { sum: cbills(amount) })}
              </button>
            {/each}
          </div>
        </div>
      </section>
    </div>
  {:else if tab === 'diplomacy'}
    <div class="cols">
      <section class="panel panel-scroll">
        <div class="panel-header">
          <span>{t('realm.dip.neighbours')}</span>
          <span class="badge badge-dim">{neighbours.length}</span>
          <span class="spacer"></span>
          <WikiHelp doc="domain.md" section="7. Дипломатия" align="right" label="?" />
        </div>
        <div class="scroll-area panel-body stack">
          {#each neighbours as nb (nb.factionId)}
            {@const truce = { kind: 'proposePact', factionId: nb.factionId, pact: 'truce' } as const}
            {@const trade = { kind: 'proposePact', factionId: nb.factionId, pact: 'trade' } as const}
            {@const protect = { kind: 'offerProtectorate', factionId: nb.factionId } as const}
            {@const truceWhy = campaign.why(truce)}
            {@const tradeWhy = campaign.why(trade)}
            {@const protectWhy = campaign.why(protect)}
            <div class="neighbour">
              <div class="nb-head">
                <FactionEmblem factionId={nb.factionId} size={20} />
                <span class="strong">{factionName(nb.factionId)}</span>
                <span class="dim tiny">{t('realm.dip.standing', { value: Math.round(nb.standing) })}</span>
                {#if nb.vassal}<span class="badge badge-gold">{t('realm.dip.vassal')}</span>{/if}
                {#if nb.payingUs > 0}<span class="badge badge-ok">{t('realm.dip.payingUs', { count: nb.payingUs })}</span>{/if}
                {#if nb.atWar}<span class="badge badge-danger">{t('realm.dip.atWar')}</span>{/if}
                {#if nb.alarm > 0}
                  <span
                    class="badge badge-gold"
                    title={t('realm.dip.alarmHint', {
                      coalition: WAR.resistance.coalitionStanding,
                      declare: WAR.playerWar.aiDeclareStanding,
                      pact: REPUTATION.diplomacy.minStanding,
                    })}
                  >
                    {t('realm.dip.alarm', { value: (Math.round(nb.alarm * 10) / 10).toFixed(1) })}
                  </span>
                {/if}
                <span class="spacer"></span>
                <button class="btn btn-sm" onclick={() => (openNeighbour = openNeighbour === nb.factionId ? null : nb.factionId)}>
                  {tn('count.worlds', nb.systems.length)} {openNeighbour === nb.factionId ? '▴' : '▾'}
                </button>
              </div>

              {#if nb.pact !== null}
                <p class="cyan tiny">
                  {t('realm.dip.pactActive', { pact: t(`realm.pact.${nb.pact.kind}`), date: campaign.dateText(nb.pact.untilDay) })}
                </p>
              {:else}
                <div class="action-row">
                  <button class="btn btn-sm" disabled={truceWhy !== null} title={truceWhy ?? t('realm.dip.truceHint')} onclick={() => runCmd(truce)}>
                    {t('realm.dip.truce')}
                  </button>
                  <button class="btn btn-sm" disabled={tradeWhy !== null} title={tradeWhy ?? t('realm.dip.tradeHint')} onclick={() => runCmd(trade)}>
                    {t('realm.dip.trade')}
                  </button>
                  <span class="dim tiny">{prices === null ? '' : cbills(prices.pact)}</span>
                </div>
                {#if truceWhy !== null && truceWhy === tradeWhy}<p class="dim tiny">{truceWhy}</p>{/if}
              {/if}

              {#if !nb.atWar}
                {@const warCmd = { kind: 'declareWar', factionId: nb.factionId } as const}
                {@const warWhy = campaign.why(warCmd)}
                {#if confirmWar === nb.factionId}
                  {@const goalCmd = { kind: 'declareWar', factionId: nb.factionId, goal } as const}
                  {@const goalWhy = campaign.why(goalCmd)}
                  <p class="danger small">{t('realm.dip.declareConfirm', { faction: factionName(nb.factionId), days: daysText(WAR.playerWar.minWarDays) })}</p>
                  <!-- Цель войны (шаг 81): её выдаёт мир, который предложит уставший противник. -->
                  <div class="sec-title">{t('realm.dip.goal')}</div>
                  <div class="action-row">
                    <button class="btn btn-sm" class:btn-gold={goalKind === 'worlds'} onclick={() => (goalKind = 'worlds')}>{t('realm.dip.goalWorlds')}</button>
                    <button class="btn btn-sm" class:btn-gold={goalKind === 'tribute'} onclick={() => (goalKind = 'tribute')}>{t('realm.dip.goalTribute')}</button>
                    <button class="btn btn-sm" class:btn-gold={goalKind === 'humiliation'} onclick={() => (goalKind = 'humiliation')}>{t('realm.dip.goalHumiliation')}</button>
                  </div>
                  {#if goalKind === 'humiliation'}
                    <p class="dim tiny">{t('realm.dip.goalHumiliationHint')}</p>
                  {:else}
                    <p class="dim tiny">
                      {goalKind === 'worlds'
                        ? t('realm.dip.goalWorldsHint')
                        : t('realm.dip.goalTributeHint', { decades: WAR.diplomacy.tributeDecades })}
                      {t('realm.dip.goalPick', { max: WAR.playerWar.goalWorldsMax })}
                    </p>
                    <div class="systems">
                      {#each nb.systems.filter((x) => !x.capital) as sys (sys.id)}
                        {@const picked = goalPick.includes(sys.id)}
                        <label class="sys-row small">
                          <input
                            type="checkbox"
                            checked={picked}
                            disabled={!picked && goalPick.length >= WAR.playerWar.goalWorldsMax}
                            onchange={() => toggleGoal(sys.id)}
                          />
                          {sys.name}
                        </label>
                      {/each}
                    </div>
                  {/if}
                  <div class="action-row">
                    <button class="btn btn-sm btn-danger" disabled={goalWhy !== null} title={goalWhy ?? ''} onclick={() => { runCmd(goalCmd); confirmWar = null; }}>
                      {t('realm.dip.declareDo')}
                    </button>
                    <button class="btn btn-sm" onclick={() => (confirmWar = null)}>{t('common.cancel')}</button>
                  </div>
                  {#if goalWhy !== null && goalWhy !== warWhy}<p class="dim tiny">{goalWhy}</p>{/if}
                {:else}
                  <div class="action-row">
                    <button class="btn btn-sm btn-danger" disabled={warWhy !== null} title={warWhy ?? t('realm.dip.declareHint')} onclick={() => openDeclare(nb.factionId)}>
                      {t('realm.dip.declare')}
                    </button>
                  </div>
                  {#if warWhy !== null && nb.pact === null}<p class="dim tiny">{warWhy}</p>{/if}
                {/if}
              {/if}

              {#if !nb.vassal}
                <div class="action-row">
                  <button class="btn btn-sm btn-gold" disabled={protectWhy !== null} title={protectWhy ?? t('realm.dip.protectHint')} onclick={() => runCmd(protect)}>
                    {t('realm.dip.protect')}
                  </button>
                  <span class="dim tiny">{prices === null ? '' : cbills(prices.protectorate)}</span>
                </div>
                {#if protectWhy !== null}<p class="dim tiny">{protectWhy}</p>{/if}
              {/if}

              {#if openNeighbour === nb.factionId}
                <div class="systems">
                  {#each nb.systems as sys (sys.id)}
                    {@const cmd = { kind: 'demandTribute', systemId: sys.id } as const}
                    {@const why = campaign.why(cmd)}
                    <div class="sys-row">
                      <span class="small">{sys.name}</span>
                      {#if sys.capital}<span class="badge badge-dim">{t('realm.dip.capital')}</span>{/if}
                      {#if sys.tributeTo !== null}
                        <span class="tiny" class:ok={sys.tributeTo === PLAYER_ACTOR_ID} class:dim={sys.tributeTo !== PLAYER_ACTOR_ID}>
                          {sys.tributeTo === PLAYER_ACTOR_ID ? t('realm.dip.paysUs') : t('realm.dip.paysOther', { faction: factionName(sys.tributeTo) })}
                        </span>
                      {/if}
                      <span class="spacer"></span>
                      <button class="btn btn-sm" title={t('realm.onMap')} onclick={() => campaign.showOnMap(sys.id)}>◎</button>
                      <button class="btn btn-sm" disabled={why !== null} title={why ?? t('realm.dip.demandHint')} onclick={() => runCmd(cmd)}>
                        {t('realm.dip.demand', { sum: cbills(campaign.tributePriceAt(sys.id)) })}
                      </button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <p class="dim tiny">{t('realm.dip.noNeighbours')}</p>
          {/each}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header"><span>{t('realm.dip.rules')}</span></div>
        <div class="panel-body stack">
          <!-- Войны державы (шаг 76): счёт и условия мира — те же, что исполнит команда. -->
          <div class="sec-title">{t('realm.war.title')}</div>
          {#each wars as w (w.factionId)}
            <div class="threat">
              <FactionEmblem factionId={w.factionId} size={16} />
              <span class="small">{factionName(w.factionId)}</span>
              <span class="dim tiny">{t('realm.war.since', { date: campaign.dateText(w.since), won: w.won, lost: w.lost })}</span>
            </div>
            <!-- Стойка фронта (шаг 88): политика отдаёт приказ и мир теми же командами, что кнопки ниже. -->
            <div class="action-row" title={t('realm.stance.hint', { odds: Math.round(WAR.realm.stanceMinOdds * 100) })}>
              <span class="dim tiny">{t('realm.stance.title')}</span>
              {#each FRONT_STANCES as st (st)}
                <button
                  class="btn btn-sm"
                  class:btn-gold={w.stance === st}
                  disabled={w.stance === st}
                  onclick={() => runCmd({ kind: 'setFrontStance', factionId: w.factionId, stance: st })}
                >
                  {t(`realm.stance.${st}`)}
                </button>
              {/each}
            </div>
            {#if w.stance === 'advance'}
              <p class="dim tiny">
                {w.stanceTarget === null
                  ? t('realm.stance.noTarget', { odds: Math.round(WAR.realm.stanceMinOdds * 100) })
                  : t('realm.stance.target', { system: w.stanceTarget })}
              </p>
            {:else if w.stance === 'yield'}
              <p class="dim tiny">{t('realm.stance.yieldLine')}</p>
            {/if}
            <!-- Наём великого полка (шаг 89): только против врага, с которым идёт война; цена — из кассы разом. -->
            {#each regiments.filter((g) => g.hire?.against === w.factionId) as g (g.id)}
              <p class="tiny ok">
                {t('realm.hire.serving', { regiment: g.name, system: g.hire?.system ?? '', date: campaign.dateText(g.hire?.until ?? 0) })}
              </p>
            {/each}
            <button class="btn btn-sm" title={t('realm.hire.hint', { decades: RIVALS.regiment.hire.termDecades })} onclick={() => (openHire = openHire === w.factionId ? null : w.factionId)}>
              {t('realm.hire.open')}
            </button>
            {#if openHire === w.factionId}
              <div class="systems">
                {#each regiments.filter((g) => g.hire === null) as g (g.id)}
                  {@const cmd = { kind: 'hireGreatRegiment', regimentId: g.id, against: w.factionId } as const}
                  {@const why = campaign.why(cmd)}
                  <div class="sys-row">
                    <span class="small">{g.name}</span>
                    <span class="dim tiny">{tn('count.mechs', g.mechs)}</span>
                    <span class="spacer"></span>
                    <button class="btn btn-sm" disabled={why !== null} title={why ?? t('realm.hire.hint', { decades: RIVALS.regiment.hire.termDecades })} onclick={() => runCmd(cmd)}>
                      {t('realm.hire.button', { sum: cbills(g.price) })}
                    </button>
                  </div>
                {:else}
                  <p class="dim tiny">{t('realm.hire.none')}</p>
                {/each}
              </div>
            {/if}
            {#if w.terms.kind !== 'noPolitics'}
              <!-- Цель и усталость сторон (шаг 81): по ним фракция предлагает мир, на пределе он заключается сам. -->
              <p class="tiny">
                {w.goal === null
                  ? t('realm.war.goalNone')
                  : w.goal.kind === 'worlds'
                    ? t('realm.war.goalWorlds', { systems: w.goal.systems.join(', ') })
                    : w.goal.kind === 'tribute'
                      ? t('realm.war.goalTribute', { systems: w.goal.systems.join(', ') })
                      : t('realm.war.goalHumiliation')}
              </p>
              <!-- Цель фракции (шаг 83): у войны, объявленной державе по угрозе. -->
              {#if w.foeGoal.length > 0}
                <p class="danger tiny">{t('realm.war.foeGoal', { systems: w.foeGoal.join(', ') })}</p>
              {/if}
              <div class="fatigue" title={t('realm.war.fatigueHint', { threshold: Math.round(WAR.playerWar.fatigueThreshold * 100) })}>
                <span class="dim tiny">
                  {t('realm.war.fatigue', { realm: Math.round(w.fatigue * 100), faction: factionName(w.factionId), foe: Math.round(w.foeFatigue * 100) })}
                </span>
                <div class="fbar"><div class="fbar-fill" style:width="{w.fatigue * 100}%"></div></div>
                <div class="fbar"><div class="fbar-fill foe" style:width="{w.foeFatigue * 100}%"></div></div>
              </div>
            {/if}
            {#if w.offerUntil !== null}
              <p class="ok tiny">{t('realm.war.offer', { date: campaign.dateText(w.offerUntil) })}</p>
            {/if}
            {#if w.terms.kind === 'tooEarly'}
              <p class="dim tiny">{t('realm.war.tooEarly', { date: campaign.dateText(w.terms.readyDay) })}</p>
            {:else if w.terms.kind === 'noPolitics'}
              <p class="dim tiny">{t('realm.war.noPolitics')}</p>
            {:else if w.terms.kind === 'free'}
              <div class="action-row">
                <button
                  class="btn btn-sm btn-gold"
                  title={w.terms.offered
                    ? ''
                    : t(w.terms.yields === true ? 'realm.war.peaceYieldHint' : 'realm.war.peaceFreeHint', { days: daysText(w.truceDays) })}
                  onclick={() => runCmd({ kind: 'makePeace', factionId: w.factionId })}
                >
                  {w.terms.offered
                    ? t('realm.war.peaceGoal')
                    : w.terms.yields === true
                      ? t('realm.war.peaceYield')
                      : t('realm.war.peaceFree')}
                </button>
                {#if w.protectorate}
                  <button
                    class="btn btn-sm btn-gold"
                    title={t('realm.war.peaceProtectorateHint')}
                    onclick={() => runCmd({ kind: 'makePeace', factionId: w.factionId, protectorate: true })}
                  >
                    {t('realm.war.peaceProtectorate')}
                  </button>
                {/if}
              </div>
            {:else if w.terms.kind === 'pay'}
              {@const payWhy = campaign.why({ kind: 'makePeace', factionId: w.factionId })}
              <div class="action-row">
                <button class="btn btn-sm btn-gold" disabled={payWhy !== null} title={payWhy ?? t('realm.war.peacePayHint', { days: daysText(w.truceDays) })} onclick={() => runCmd({ kind: 'makePeace', factionId: w.factionId })}>
                  {t('realm.war.peacePay', { sum: cbills(w.terms.cost) })}
                </button>
                {#if w.terms.cede !== undefined}
                  {@const cedeId = w.terms.cede}
                  <button class="btn btn-sm btn-danger" title={t('realm.war.peaceCedeHint')} onclick={() => runCmd({ kind: 'makePeace', factionId: w.factionId, cede: true })}>
                    {t('realm.war.peaceCede', { system: worlds.find((x) => x.id === cedeId)?.name ?? cedeId })}
                  </button>
                {/if}
              </div>
              {#if payWhy !== null}<p class="dim tiny">{payWhy}</p>{/if}
            {/if}
            {#if w.terms.kind === 'free' || w.terms.kind === 'pay'}
              <!-- Что мир перенесёт из рук в руки (шаг 81) — тот же `peaceOutcome`, что исполнит команда. -->
              {#if w.outcome.gained.length > 0}<p class="ok tiny">{t('realm.war.outGained', { systems: w.outcome.gained.join(', ') })}</p>{/if}
              {#if w.outcome.tributaries.length > 0}<p class="ok tiny">{t('realm.war.outTributaries', { systems: w.outcome.tributaries.join(', ') })}</p>{/if}
              {#if w.outcome.humiliation}<p class="ok tiny">{t('realm.war.outHumiliation')}</p>{/if}
              {#if w.outcome.returned.length > 0}<p class="danger tiny">{t('realm.war.outReturned', { systems: w.outcome.returned.join(', ') })}</p>{/if}
              {#if w.outcome.ceded.length > 0}<p class="danger tiny">{t('realm.war.outCeded', { systems: w.outcome.ceded.join(', ') })}</p>{/if}
            {/if}
          {:else}
            <p class="dim tiny">{t('realm.war.none')}</p>
          {/each}

          <div class="sec-title">{t('realm.offensive.title')}</div>
          <p class="dim tiny">{t('realm.offensive.hint')}</p>
          {#if offensives.fronts.length > 0}
            <p class="small">{t('realm.offensive.fund', { fund: cbills(offensives.fund) })}</p>
          {/if}
          {#each offensives.fronts as o (o.factionId)}
            <div class="threat">
              <FactionEmblem factionId={o.factionId} size={16} />
              <span class="small">{factionName(o.factionId)}</span>
            </div>
            <p class="dim tiny">{t('realm.offensive.frontCost', { sum: cbills(o.cost), mechs: tn('count.mechs', o.mechs) })}</p>
            {#each o.targets as tg, k (tg.id)}
              <div class="action-row">
                <button
                  class="btn btn-sm btn-danger"
                  disabled={tg.why !== null}
                  title={tg.why ?? t('realm.offensive.oddsHint')}
                  onclick={() => runCmd({ kind: 'orderOffensive', systemId: tg.id })}
                >
                  {t('realm.offensive.order', { system: tg.name, odds: Math.round(tg.odds * 100) })}
                </button>
              </div>
              {#if tg.lance > 0}
                <p class="dim tiny">{t('realm.offensive.company', { mechs: tn('count.mechs', tg.lance) })}</p>
              {/if}
              {#if tg.readyDay !== null}
                {#if k === 0 || o.targets[k - 1]?.readyDay !== tg.readyDay}
                  <p class="dim tiny">{t('realm.offensive.ready', { date: campaign.dateText(tg.readyDay) })}</p>
                {/if}
              {:else if tg.why !== null && (k === 0 || o.targets[k - 1]?.why !== tg.why)}
                <!-- Одна и та же причина под каждой кнопкой (отладка 2026-10-03) — один раз; у кнопки она в подсказке. -->
                <p class="dim tiny">{tg.why}</p>
              {/if}
            {/each}
          {:else}
            <p class="dim tiny">{t('realm.offensive.none')}</p>
          {/each}

          <div class="sec-title">{t('realm.feed.title')}</div>
          {#if feed.length === 0}
            <p class="dim tiny">{t('realm.feed.empty')}</p>
          {:else}
            <WarLogList lines={feed} />
          {/if}

          <p class="small">{t('realm.dip.rules1')}</p>
          <p class="small">{t('realm.dip.rules2')}</p>
          <p class="dim tiny">{t('realm.dip.rulesNote')}</p>
          {#if vassals.length > 0}
            <div class="sec-title">{t('realm.dip.vassals')}</div>
            {#each vassals as v (v)}
              <div class="threat">
                <FactionEmblem factionId={v} size={16} />
                <span class="small">{factionName(v)}</span>
              </div>
            {/each}
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .realm {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .subtabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    flex-shrink: 0;
  }
  .subtab {
    font-family: var(--font-display);
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .subtab:hover {
    color: var(--color-text);
    border-color: var(--color-border);
  }
  .subtab.active {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.1);
  }
  .spacer {
    flex: 1;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  /* Ячейка сетки ограничена высотой экрана (`.panel` — `min-height: 0`), и
     содержимое выше неё вылезало за фон панели. Панель без своей `scroll-area`
     прокручивается целиком. */
  .cols > .panel:not(.panel-scroll) {
    overflow-y: auto;
  }
  .worlds-cols {
    grid-template-columns: 300px minmax(0, 1fr);
    overflow: hidden;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stack p {
    margin: 0;
    line-height: 1.5;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }
  .pick-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .total {
    border-top: 1px solid var(--color-border);
    padding-top: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    flex: 1;
  }
  .world-head {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--color-danger);
    border-radius: 2px;
  }
  .head-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .disc {
    flex: 0 0 150px;
  }
  .building {
    border-left: 2px solid var(--color-border);
    padding-left: 8px;
  }
  .building.built {
    border-left-color: var(--color-ok);
  }
  .building-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .building-thumb {
    flex: 0 0 52px;
    width: 52px;
    aspect-ratio: 1;
    border-radius: 2px;
    overflow: hidden;
    border: 1px solid var(--color-border);
    background: var(--color-panel-sub);
    opacity: 0.65;
    transition: opacity 0.15s ease, border-color 0.15s ease;
  }
  .building-thumb.built {
    opacity: 1;
    border-color: var(--color-ok);
  }
  .building-main {
    flex: 1;
    min-width: 0;
  }
  .building-cur {
    display: flex;
    gap: 8px;
    align-items: center;
    border: 1px solid var(--color-gold);
    border-radius: 2px;
    padding: 6px 8px;
    background: rgba(227, 179, 65, 0.05);
  }
  .building-cur-icon {
    flex: 0 0 36px;
    width: 36px;
    aspect-ratio: 1;
    border-radius: 2px;
    overflow: hidden;
    border: 1px solid var(--color-gold);
    background: var(--color-panel-sub);
  }
  .building-cur-body {
    flex: 1;
    min-width: 0;
  }
  .threat {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .action,
  .action-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .steps {
    display: flex;
    gap: 6px;
  }
  .focus-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .focus-table th {
    text-align: left;
    font-size: 10px;
    color: var(--color-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 4px;
    border-bottom: 1px solid var(--color-border);
  }
  .focus-table td {
    padding: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .focus-table tr.current td {
    color: var(--color-accent);
  }
  .neighbour {
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .nb-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .systems {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid var(--color-border);
    padding-top: 6px;
  }
  .sys-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* Усталость сторон войны (шаг 81): держава — акцентом, противник — цветом опасности. */
  .fatigue {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fbar {
    height: 4px;
    background: var(--color-border);
  }
  .fbar-fill {
    height: 100%;
    background: var(--color-accent);
  }
  .fbar-fill.foe {
    background: var(--color-danger);
  }
  .right {
    text-align: right;
    margin-left: auto;
  }
  .small {
    font-size: 11.5px;
  }
</style>
