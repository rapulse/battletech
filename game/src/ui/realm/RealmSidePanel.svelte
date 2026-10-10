<script lang="ts">
  import { GALAXY } from '../../core/campaign/galaxy/index.js';
  import { WAR } from '../../core/campaign/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, signedCbills, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import AtlasImage from '../components/AtlasImage.svelte';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import PlanetDot from './PlanetDot.svelte';
  import { loyaltyDrift, loyaltyValue } from './loyaltyText.js';
  import { BUILDING_INDEX } from './buildingArt.js';
  import type { MapLens, MapSelection } from './RealmMap.svelte';
  import WarLogList from '../campaign/WarLogList.svelte';
  import type { TodoItem } from './realmTodo.js';
  import GovernorPicker from './GovernorPicker.svelte';
  import RealmMoment from './RealmMoment.svelte';
  import SideSector from './SideSector.svelte';
  import SideWar from './SideWar.svelte';
  import { ALERT_SEVERE, worldAlerts } from './worldAlerts.js';
  import RealmIcon from './RealmIcon.svelte';
  import { ALERT_ICON, DIPLOMACY_ICON, GOVERNOR_ICON, PRIORITY_ICON, TITLE_ICON, TITLE_LOCKED } from './realmIcons.js';
  import { CAPITAL_INDEX } from './buildingArt.js';

  /**
   * Правая колонка Штаба (шаг 93): держава, когда ничего не выбрано, или выбранное на карте и в
   * списке. Здесь — главное о выбранном; полная карточка мира — во вкладке «Миры».
   */
  let {
    selection,
    todo,
    onclear,
    onshow,
    onlens,
  }: {
    selection: MapSelection;
    todo: readonly TodoItem[];
    onclear: () => void;
    /** Выбрать систему или сектор и подвезти к нему карту. */
    onshow: (kind: 'world' | 'foreign' | 'sector', i: number) => void;
    onlens: (lens: MapLens) => void;
  } = $props();

  const feed = $derived(campaign.warLog.filter((l) => l.realm === true).slice(0, 10));

  /** Строка «Требует решения» → что открыть: мир, соседа или линзу карты. */
  function act(item: TodoItem): void {
    switch (item.kind) {
      case 'world':
        onshow('world', GALAXY.require(item.worldId));
        return;
      case 'vacant':
        onshow('sector', GALAXY.require(item.center));
        return;
      case 'peace':
      case 'pact': {
        const sys = campaign.realmNeighbours.find((n) => n.factionId === item.factionId)?.systems[0];
        if (sys !== undefined) onshow('foreign', GALAXY.require(sys.id));
        return;
      }
      case 'idle':
        onlens('build');
        return;
      case 'slots':
        onlens('sector');
        return;
    }
  }

  function todoText(item: TodoItem): string {
    switch (item.kind) {
      case 'world':
        return `${item.name}: ${t(`realm.hq.alert.${item.alert}`)}`;
      case 'vacant':
        return t('realm.hq.todo.vacant', { sector: GALAXY.name(GALAXY.require(item.center)) });
      case 'peace':
        return t('realm.hq.todo.peace', { faction: factionName(item.factionId), date: campaign.dateText(item.until) });
      case 'pact':
        return t('realm.hq.todo.pact', { faction: factionName(item.factionId), date: campaign.dateText(item.until) });
      case 'slots':
        return t('realm.hq.todo.slots', { n: item.free });
      case 'idle':
        return t('realm.hq.todo.idle', { n: item.count });
    }
  }

  /** Значок строки: тревога мира — её значок; пост и слот сектора — губернатор; мир и договор — перемирие. */
  function todoIcon(item: TodoItem): number {
    switch (item.kind) {
      case 'world':
        return ALERT_ICON[item.alert];
      case 'vacant':
      case 'slots':
        return GOVERNOR_ICON;
      case 'peace':
      case 'pact':
        return DIPLOMACY_ICON.truce;
      case 'idle':
        return PRIORITY_ICON.development;
    }
  }

  function todoSevere(item: TodoItem): boolean {
    return (item.kind === 'world' && ALERT_SEVERE[item.alert]) || item.kind === 'vacant';
  }

  const summary = $derived(campaign.realm);
  const title = $derived(campaign.realmTitle);
  const army = $derived(campaign.realmArmy);
  const fund = $derived(campaign.realmOffensives.fund);

  const world = $derived(
    selection?.kind === 'world' ? (campaign.realmWorlds.find((w) => w.id === GALAXY.id(selection.i)) ?? null) : null,
  );
  const buildings = $derived(world === null ? null : campaign.buildingsView(world.id));
  const garrison = $derived(world === null ? null : campaign.garrisonView(world.id));

  const sectorCenter = $derived(selection?.kind === 'sector' ? GALAXY.id(selection.i) : null);
  const sectors = $derived(campaign.realmSectors);
  /** Новый сектор с центром на этом мире: мир вне секторов и предел ещё не выбран. */
  const canFound = $derived(world !== null && world.sector === null && sectors.used < sectors.limit);

  const foreignId = $derived(selection?.kind === 'foreign' ? GALAXY.id(selection.i) : null);
  const foreignOwner = $derived(selection?.kind === 'foreign' ? (campaign.owners[selection.i] ?? GALAXY.ownerId(selection.i)) : null);
  const neighbour = $derived(
    foreignOwner === null ? null : (campaign.realmNeighbours.find((n) => n.factionId === foreignOwner) ?? null),
  );

  /** Статьи итога полосами: ширина — доля от дохода, самой крупной статьи. */
  const lines = $derived([
    { key: 'income', value: summary.income },
    { key: 'upkeep', value: -summary.upkeep },
    { key: 'army', value: -summary.army },
    { key: 'buildings', value: -summary.buildings },
    { key: 'flows', value: summary.flows },
    { key: 'fund', value: -summary.fund },
  ].filter((l) => l.value !== 0));
  const scale = $derived(Math.max(1, ...lines.map((l) => Math.abs(l.value))));

  /** Прибавки титула — только ненулевые: лояльность, очки стройки, секторы (армия — на полосе потолка). */
  const titleBonus = $derived.by((): string => {
    if (title === null) return '';
    const b = title.bonus;
    const parts: string[] = [];
    if (b.loyalty > 0) parts.push(t('realm.title.bonusLoyalty', { value: b.loyalty }));
    if (b.points > 0) parts.push(t('realm.title.bonusPoints', { value: b.points }));
    if (b.sectors > 0) parts.push(t('realm.title.bonusSectors', { value: b.sectors }));
    return parts.join(', ');
  });

  /** Лестница титулов: пройденные — знаком, следующий — тусклым знаком, дальние — замком. */
  const ladder = $derived(
    WAR.realm.titles.map((x, n) => {
      const reached = summary.worlds >= x.worlds;
      const next = !reached && (n === 0 || summary.worlds >= (WAR.realm.titles[n - 1]?.worlds ?? 0));
      return { id: x.id, worlds: x.worlds, reached, next, current: x.id === title?.id };
    }),
  );

  const titleProgress = $derived(
    title === null || title.next === null ? 1 : summary.worlds / (summary.worlds + title.next.worlds),
  );
</script>

<div class="side panel panel-scroll">
  {#if selection !== null}
    <button class="back" onclick={onclear}>← {t('realm.hq.back')}</button>
  {/if}

  {#if sectorCenter !== null}
    <div class="scroll-area body" data-side="sector">
      <SideSector center={sectorCenter} onshow={(i) => onshow('world', i)} />
    </div>
  {:else if world !== null && buildings !== null && garrison !== null}
    <div class="scroll-area body" data-side="world">
      <div class="world-head">
        <PlanetDot biome={world.biome} size={44} />
        <div>
          <div class="strong big world-name">
            {world.name}
            {#if world.capital}<span title={t('realm.world.capitalHint')}><AtlasImage atlas="buildings" index={CAPITAL_INDEX} width="22px" /></span>{/if}
          </div>
          <div class="dim tiny">
            {world.sector === null ? t('realm.hq.outside') : t('realm.sector.of', { system: GALAXY.name(GALAXY.require(world.sector)) })}
          </div>
        </div>
      </div>
      {#if worldAlerts(world).length > 0}
        <div class="alerts">
          {#each worldAlerts(world) as a (a)}
            <span class="alert" class:danger={ALERT_SEVERE[a]} class:warn={!ALERT_SEVERE[a]}><RealmIcon index={ALERT_ICON[a]} size={16} />{t(`realm.hq.alert.${a}`)}</span>
          {/each}
        </div>
      {/if}
      <div class="tiles">
        <div class="tile"><span class="k">{t('realm.world.income')}</span><span class="ok">{cbills(world.income)}</span></div>
        <div class="tile"><span class="k">{t('realm.world.upkeep')}</span><span class="danger">{cbills(world.upkeep)}</span></div>
        <div class="tile">
          <span class="k">{t('realm.hq.net')}</span>
          <span class:ok={world.income - world.upkeep >= 0} class:danger={world.income - world.upkeep < 0}>{signedCbills(world.income - world.upkeep)}</span>
        </div>
        <div class="tile">
          <span class="k">{t('realm.world.loyalty')}</span>
          <span>{world.loyalty === null ? '—' : loyaltyValue(world.loyalty)}{#if world.loyalty !== null}&nbsp;· {loyaltyDrift(world.loyaltyDrift)}{/if}</span>
        </div>
        <div class="tile"><span class="k">{t('realm.world.capacity')}</span><span>{world.capacity}</span></div>
        <div class="tile"><span class="k">{t('realm.world.development')}</span><span>{world.development} / {world.developmentMax}</span></div>
      </div>

      <div class="sec">{t('realm.hq.buildings')}</div>
      <div class="bgrid">
        {#each buildings.rows as row (row.kind)}
          {@const building = buildings.construction?.kind === row.kind}
          <div class="bcell" class:built={row.built} class:building title={t(`realm.world.building.${row.kind}`)}>
            <AtlasImage atlas="buildings" index={BUILDING_INDEX[row.kind]} width="100%" />
            {#if building && buildings.construction !== null}
              <span class="bstate gold">{daysText(buildings.construction.etaDays)}</span>
            {:else if row.built}
              <span class="bstate ok">✓</span>
            {/if}
          </div>
        {/each}
      </div>

      <div class="sec">{t('realm.hq.garrison')}</div>
      <p class="small">{t('realm.hq.garrisonLine', { count: garrison.count, cap: garrison.cap, depot: garrison.depotCount, depotCap: garrison.depotCap })}</p>

      {#if world.threats.length > 0}
        <div class="sec">{t('realm.hq.threats')}</div>
        {#each world.threats as th (th.attacker)}
          <p class="small danger">⚔ {factionName(th.attacker)}</p>
        {/each}
      {/if}

      {#if world.sector !== null}
        <button class="link-btn" onclick={() => onshow('sector', GALAXY.require(world.sector as string))}>
          {t('realm.hq.side.openSector', { name: GALAXY.name(GALAXY.require(world.sector)) })} →
        </button>
      {:else if canFound}
        <div class="sec">{t('realm.hq.side.newSector')}</div>
        <GovernorPicker center={world.id} />
      {/if}

      <div class="actions">
        <button class="btn btn-sm btn-primary" onclick={() => campaign.openRealm('worlds', { kind: 'world', id: world.id })}>{t('realm.hq.side.details')}</button>
        <button class="btn btn-sm" onclick={() => campaign.showOnMap(world.id)}>{t('realm.hq.onStarmap')}</button>
      </div>
    </div>
  {:else if foreignId !== null && foreignOwner !== null}
    <div class="scroll-area body" data-side="foreign">
      <div class="world-head">
        <FactionEmblem factionId={foreignOwner} size={44} />
        <div>
          <div class="strong big">{GALAXY.name(GALAXY.require(foreignId))}</div>
          <div class="dim tiny">{factionName(foreignOwner)}</div>
        </div>
      </div>
      {#if neighbour !== null}
        <p class="small">{t('realm.dip.standing', { value: Math.round(neighbour.standing) })}</p>
        {#if neighbour.atWar}<p class="small danger">{t('realm.dip.atWar')}</p>{/if}
        {#if neighbour.pact !== null}
          <p class="small cyan">{t('realm.dip.pactActive', { pact: t(`realm.pact.${neighbour.pact.kind}`), date: campaign.dateText(neighbour.pact.untilDay) })}</p>
        {/if}
      {/if}
      <SideWar factionId={foreignOwner} systemId={foreignId} />
      <div class="actions">
        <button class="btn btn-sm btn-primary" onclick={() => campaign.openRealm('diplomacy', { kind: 'foreign', id: foreignId as string })}>
          {t('realm.hq.side.diplomacy')}
        </button>
        <button class="btn btn-sm" onclick={() => campaign.showOnMap(foreignId)}>{t('realm.hq.onStarmap')}</button>
      </div>
    </div>
  {:else}
    <div class="scroll-area body" data-side="realm">
      {#if title !== null}
        <div class="title-block" title={t('realm.title.hint')}>
          <AtlasImage atlas="realm_titles" index={TITLE_ICON[title.id] ?? TITLE_LOCKED} width="56px" />
          <div class="title-main">
            <div class="title-row">
              <span class="gold strong big">{t(`realm.title.name.${title.id}`)}</span>
              <span class="dim tiny">{tn('count.worlds', summary.worlds)}</span>
            </div>
            {#if title.next !== null}
              <div class="bar"><div class="fill gold-fill" style:width="{titleProgress * 100}%"></div></div>
              <p class="dim tiny">{t('realm.title.next', { title: t(`realm.title.name.${title.next.id}`), worlds: tn('count.worlds', title.next.worlds) })}</p>
            {/if}
          </div>
        </div>
        <div class="ladder">
          {#each ladder as step (step.id)}
            <span
              class="step"
              class:reached={step.reached}
              class:current={step.current}
              class:next={step.next}
              title="{t(`realm.title.name.${step.id}`)} · {tn('count.worlds', step.worlds)}"
            >
              <AtlasImage atlas="realm_titles" index={step.reached || step.next ? (TITLE_ICON[step.id] ?? TITLE_LOCKED) : TITLE_LOCKED} width="28px" />
            </span>
          {/each}
        </div>
        {#if titleBonus !== ''}<p class="dim tiny">{t('realm.title.bonus', { list: titleBonus })}</p>{/if}
      {/if}

      <div class="sec" title={t('realm.balance.hint')}>{t('realm.balance.title')}</div>
      {#each lines as l (l.key)}
        <div class="line" title={l.key === 'flows' ? t('realm.balance.flowsHint') : undefined}>
          <span class="lk">{t(`realm.balance.${l.key}`)}</span>
          <div class="lbar"><div class="fill" class:neg={l.value < 0} style:width="{(Math.abs(l.value) / scale) * 100}%"></div></div>
          <span class="lv" class:ok={l.value > 0} class:danger={l.value < 0}>{signedCbills(l.value)}</span>
        </div>
      {/each}
      <div class="line total">
        <span class="lk">{t('realm.balance.net')}</span>
        <span></span>
        <span class="lv" class:ok={summary.net >= 0} class:danger={summary.net < 0}>{signedCbills(summary.net)}</span>
      </div>

      <div class="sec">{t('realm.army.title')}</div>
      <div class="tiles">
        <div class="tile"><span class="k">{t('realm.army.total')}</span><span>{army.total} / {army.cap}</span></div>
        <div class="tile"><span class="k">{t('realm.hq.warFund')}</span><span class="cyan">{cbills(fund)}</span></div>
      </div>

      <div class="sec">{t('realm.hq.todo.title')}</div>
      {#if todo.length === 0}
        <p class="dim tiny">{t('realm.hq.todo.none')}</p>
      {:else}
        <div class="todo">
          {#each todo as item, n (n)}
            <button class="todo-row" data-todo={item.kind} onclick={() => act(item)}>
              <RealmIcon index={todoIcon(item)} size={18} />
              <span class:danger={todoSevere(item)}>{todoText(item)}</span>
            </button>
          {/each}
        </div>
      {/if}

      <RealmMoment />
      <div class="sec">{t('realm.feed.title')}</div>
      {#if feed.length === 0}
        <p class="dim tiny">{t('realm.feed.empty')}</p>
      {:else}
        <WarLogList lines={feed} compact />
      {/if}
    </div>
  {/if}
</div>

<style>
  .side {
    height: 100%;
  }
  .back {
    align-self: flex-start;
    margin: 8px 10px 0;
    padding: 2px 8px;
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .back:hover {
    color: var(--color-text);
  }
  .body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .world-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .big {
    font-size: 14px;
  }
  .sec {
    margin-top: 8px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .alerts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
  }
  .warn {
    color: var(--color-gold);
  }
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 7px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .k {
    font-size: 9.5px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .bgrid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .bcell {
    position: relative;
    border: 1px solid var(--color-border);
    opacity: 0.35;
    line-height: 0;
  }
  .bcell.built {
    opacity: 1;
    border-color: var(--color-ok);
  }
  .bcell.building {
    opacity: 0.85;
    border-color: var(--color-gold);
  }
  .bstate {
    position: absolute;
    right: 2px;
    bottom: 2px;
    padding: 1px 3px;
    background: rgba(7, 10, 15, 0.8);
    font-size: 9.5px;
    line-height: 1.2;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .title-block {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .title-main {
    flex: 1;
    min-width: 0;
  }
  .ladder {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }
  .step {
    line-height: 0;
    opacity: 0.35;
    filter: grayscale(1);
  }
  .step.reached {
    opacity: 1;
    filter: none;
  }
  .step.next {
    opacity: 0.55;
  }
  .step.current {
    outline: 1px solid var(--color-gold);
    outline-offset: 1px;
  }
  .alert {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .world-name {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .bar,
  .lbar {
    height: 5px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
  }
  .fill {
    height: 100%;
    background: var(--color-ok);
  }
  .fill.neg {
    background: var(--color-danger);
  }
  .gold-fill {
    background: var(--color-gold);
  }
  .line {
    display: grid;
    grid-template-columns: 1fr 70px auto;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .lk {
    color: var(--color-text-dim);
  }
  .lv {
    font-family: var(--font-mono);
    text-align: right;
  }
  .todo {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .todo-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .todo-row:hover {
    border-color: var(--color-border-active);
  }
  .link-btn {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    font-size: 11px;
    cursor: pointer;
  }
  .line.total {
    margin-top: 2px;
    padding-top: 4px;
    border-top: 1px solid var(--color-border);
    font-weight: 700;
  }
</style>
