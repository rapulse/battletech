<script lang="ts">
  import { GALAXY, WAR, type BuildingKind } from '../../core/campaign/index.js';
  import { campaign, type RealmWorld } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, signedCbills, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import AtlasImage from '../components/AtlasImage.svelte';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import { BUILDING_INDEX } from './buildingArt.js';
  import PlanetDot from './PlanetDot.svelte';
  import { loyaltyDrift, loyaltyValue } from './loyaltyText.js';
  import { ALERT_SEVERE, worldAlerts } from './worldAlerts.js';
  import RealmIcon from './RealmIcon.svelte';
  import { ALERT_ICON, FOCUS_ICON } from './realmIcons.js';
  import { CAPITAL_INDEX } from './buildingArt.js';

  /**
   * Полная карточка мира державы (шаг 93, вкладка «Миры»): всё, что было на карточке прежнего экрана, — но
   * цифры плитками, постройки сеткой с раскрытием, а пояснения правил — в подсказках. Команды те же.
   */
  let { world: w }: { world: RealmWorld } = $props();

  const B = WAR.buildings;
  const b = $derived(campaign.buildingsView(w.id));
  const g = $derived(campaign.garrisonView(w.id));
  const prices = $derived(campaign.realmPrices);
  const preview = $derived(campaign.focusPreview(w.id));
  const worlds = $derived(campaign.realmWorlds);

  let open = $state<BuildingKind | null>(null);
  let confirmAbandon = $state(false);
  $effect(() => {
    void w.id;
    open = null;
    confirmAbandon = false;
  });

  const openRow = $derived(open === null ? null : (b.rows.find((r) => r.kind === open) ?? null));

  function effectText(kind: BuildingKind): string {
    return t(`realm.world.buildingEffect.${kind}`, {
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
    });
  }

  const loyaltyHint = $derived(
    t('realm.world.loyaltyHint', { below: WAR.loyalty.revoltBelow, incite: WAR.resistance.inciteStanding, welfare: WAR.resistance.welfarePerStep }),
  );
</script>

<div class="card" data-world={w.id}>
  <div class="head">
    <PlanetDot biome={w.biome} size={64} />
    <div class="head-main">
      <div class="name">
        {w.name}
        {#if w.capital}
          <span class="capital" title={t('realm.world.capitalHint')}>
            <AtlasImage atlas="buildings" index={CAPITAL_INDEX} width="26px" />
            <span class="badge badge-gold">{t('realm.world.capital')}</span>
          </span>
        {/if}
      </div>
      <div class="dim tiny">
        {w.sector === null ? t('realm.sector.none') : t('realm.sector.of', { system: GALAXY.name(GALAXY.require(w.sector)) })}
        · <RealmIcon index={FOCUS_ICON[w.focus]} size={14} /> {t(`focus.${w.focus}`)}
      </div>
    </div>
    <div class="head-tools">
      <button class="btn btn-sm" onclick={() => campaign.openRealm('hq', { kind: 'world', id: w.id })}>{t('realm.hq.side.onRealmMap')}</button>
      <button class="btn btn-sm" onclick={() => campaign.showOnMap(w.id)}>{t('realm.hq.onStarmap')}</button>
      {#if g.mechs.length > 0}
        <button class="btn btn-sm" onclick={() => campaign.showGarrison(w.id)} title={t('realm.world.garrisonInHangar')}>
          {t('realm.world.garrisonButton', { count: g.mechs.length })}
        </button>
      {/if}
    </div>
  </div>
  {#if worldAlerts(w).length > 0}
    <div class="alerts">
      {#each worldAlerts(w) as a (a)}
        <span class="alert" class:danger={ALERT_SEVERE[a]} class:gold={!ALERT_SEVERE[a]}><RealmIcon index={ALERT_ICON[a]} size={16} />{t(`realm.hq.alert.${a}`)}</span>
      {/each}
    </div>
  {/if}

  <div class="tiles">
    <div class="tile"><span class="k">{t('realm.world.income')}</span><span class="ok">{cbills(w.income)}</span></div>
    <div class="tile"><span class="k">{t('realm.world.upkeep')}</span><span class="danger">{cbills(w.upkeep)}</span></div>
    <div class="tile">
      <span class="k">{t('realm.hq.net')}</span>
      <span class:ok={w.income - w.upkeep >= 0} class:danger={w.income - w.upkeep < 0}>{signedCbills(w.income - w.upkeep)}</span>
    </div>
    {#if w.loyalty !== null}
      <div class="tile" title={loyaltyHint}>
        <span class="k">{t('realm.world.loyalty')}</span>
        <span class:danger={w.revoltUntil !== null} class:gold={w.revoltUntil === null && w.loyaltyFactor < 1}>
          {loyaltyValue(w.loyalty)} · ×{w.loyaltyFactor.toFixed(2)} · {loyaltyDrift(w.loyaltyDrift)}
        </span>
      </div>
    {/if}
    <div class="tile" title={t('realm.world.capacityHint')}><span class="k">{t('realm.world.capacity')}</span><span>{w.capacity}</span></div>
    <div class="tile" title={t('realm.world.liftHint')}><span class="k">{t('realm.world.lift')}</span><span>{w.lift.toFixed(1)}</span></div>
    <div class="tile"><span class="k">{t('realm.world.development')}</span><span>{w.development} / {w.developmentMax}</span></div>
    <div class="tile"><span class="k">{t('realm.world.ruin')}</span><span class:gold={w.ruined > 0}>{Math.round(w.ruined * 100)} %</span></div>
  </div>

  {#if w.revoltUntil !== null}
    <p class="danger small">{t('realm.world.revoltLine', { faction: factionName(w.formerOwner ?? ''), date: campaign.dateText(w.revoltUntil) })}</p>
  {:else if w.loyaltyPressure === 'incite'}
    <p class="gold small">{t('realm.world.inciteLine', { faction: factionName(w.formerOwner ?? ''), standing: WAR.resistance.inciteStanding })}</p>
  {/if}
  {#each w.threats as th (th.attacker)}
    <div class="threat" title={t('realm.world.threatFrontHint')}>
      <FactionEmblem factionId={th.attacker} size={16} />
      <span class="danger small">{t('realm.world.threatFront', { faction: factionName(th.attacker) })}</span>
    </div>
  {/each}
  {#if w.tributeTo !== null}
    {@const cmd = { kind: 'buyOffTribute', systemId: w.id } as const}
    {@const why = campaign.why(cmd)}
    <div class="row">
      <span class="danger small">
        {t('realm.world.tributeLine', { faction: factionName(w.tributeTo), date: w.tributeUntil === null ? '—' : campaign.dateText(w.tributeUntil) })}
      </span>
      <button class="btn btn-sm btn-gold" disabled={why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>
        {t('realm.world.buyOff', { sum: cbills(campaign.tributePriceAt(w.id)) })}
      </button>
    </div>
  {/if}

  <!-- Постройки сеткой: плитка — состояние; раскрытая — что даёт, цена, срок и кнопка. -->
  <div class="sec" title={t('realm.world.buildingsHint', { min: B.minPoints, refund: Math.round(B.cancelRefund * 100), upkeep: B.upkeepShare * 100, survive: Math.round(B.surviveLoss * 100) })}>
    {t('realm.world.buildingsTitle')} <span class="dim">· {t('realm.world.buildPoints', { points: b.points })}</span>
  </div>
  <div class="bgrid">
    {#each b.rows as row (row.kind)}
      {@const building = b.construction?.kind === row.kind}
      <button
        class="bcell"
        class:built={row.built}
        class:building
        class:open={open === row.kind}
        data-building={row.kind}
        onclick={() => (open = open === row.kind ? null : row.kind)}
      >
        <AtlasImage atlas="buildings" index={BUILDING_INDEX[row.kind]} width="100%" />
        <span class="bname">{t(`realm.world.building.${row.kind}`)}</span>
        {#if building && b.construction !== null}
          <span class="bstate gold">{daysText(b.construction.etaDays)}</span>
        {:else if row.built}
          <span class="bstate ok">✓</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if b.construction !== null}
    {@const c = b.construction}
    <div class="row">
      <span class="gold small">{t(`realm.world.building.${c.kind}`)}</span>
      <span class="dim tiny">{t('realm.world.buildingInProgress', { done: c.progress, work: c.work, eta: daysText(c.etaDays) })}</span>
      <button class="btn btn-sm" onclick={() => campaign.run({ kind: 'cancelBuilding', systemId: w.id })}>
        {t('realm.world.buildingCancel', { sum: cbills(c.refund) })}
      </button>
    </div>
  {/if}
  {#if openRow !== null}
    {@const cmd = { kind: 'startBuilding', systemId: w.id, building: openRow.kind } as const}
    {@const why = openRow.built || b.construction !== null ? null : campaign.why(cmd)}
    <div class="bdetail">
      <div class="strong">{t(`realm.world.building.${openRow.kind}`)}</div>
      <p class="tiny">{effectText(openRow.kind)}</p>
      {#if !openRow.built}
        <p class="dim tiny">
          {t('realm.world.buildingCosts', { sum: cbills(openRow.cost), work: openRow.work, eta: daysText(openRow.etaDays), upkeep: cbills(openRow.upkeep), upkeep10: cbills(openRow.upkeep10) })}
        </p>
        <p class="dim tiny">
          {openRow.kind === 'factory'
            ? t('realm.world.buildingFactoryReturn', { mechs: tn('count.mechsAcc', b.factoryArmy), sum: cbills(b.factorySaving) })
            : t('realm.world.buildingSink', { share: Math.round((openRow.upkeep10 / openRow.cost) * 100) })}
        </p>
        {#if b.construction === null}
          <button class="btn btn-sm btn-gold" disabled={why !== null} onclick={() => campaign.run(cmd)}>{t('realm.world.buildingStart')}</button>
          {#if why !== null}<p class="dim tiny">{why}</p>{/if}
        {/if}
      {:else}
        <p class="ok tiny">{t('realm.world.buildingBuilt')}</p>
      {/if}
    </div>
  {/if}
  {#each b.workshopJobs as job (job.jobId)}
    {@const cmd = { kind: 'cancelJob', jobId: job.jobId } as const}
    <div class="row">
      <span class="dim tiny">{t('realm.world.workshopJob', { mech: job.mech, days: daysText(job.daysLeft) })}</span>
      <button class="btn btn-sm btn-danger" title={t('hangar.job.cancelHint')} disabled={campaign.why(cmd) !== null} onclick={() => campaign.run(cmd)}>✕</button>
    </div>
  {/each}

  <!-- Развитие и фокус -->
  <div class="sec">{t('realm.world.developTitle')}</div>
  {#if w.development >= w.developmentMax}
    <p class="dim tiny">{t('realm.world.developMax')}</p>
  {:else}
    {@const cmd = { kind: 'developWorld', systemId: w.id } as const}
    {@const why = campaign.why(cmd)}
    <div class="row">
      <button class="btn btn-sm btn-primary" disabled={why !== null} title={why ?? t('realm.world.developHint')} onclick={() => campaign.run(cmd)}>
        {t('realm.world.develop', { level: w.development + 1, sum: cbills(w.developCost) })}
      </button>
      {#if why !== null}<span class="dim tiny">{why}</span>{/if}
    </div>
  {/if}
  <div class="sec" title={t('realm.focus.hint', { sum: cbills(prices?.focus ?? 0), days: WAR.focus.changeDays })}>{t('realm.world.focusTitle')}</div>
  {#if w.focusTo !== null}
    <p class="gold small">{t('realm.world.focusPending', { focus: t(`focus.${w.focusTo}`), date: w.focusUntil === null ? '—' : campaign.dateText(w.focusUntil) })}</p>
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
          <td title={t(`focusHint.${p.focus}`)}><RealmIcon index={FOCUS_ICON[p.focus]} size={16} /> {t(`focus.${p.focus}`)}{#if p.focus === w.naturalFocus}<span class="dim" title={t('realm.world.focusNatural', { focus: t(`focus.${w.naturalFocus}`) })}> ◆</span>{/if}</td>
          <td>{cbills(p.income)}</td>
          <td>{cbills(p.upkeep)}</td>
          <td>{p.capacity}</td>
          <td>×{p.defence.toFixed(2)}</td>
          <td class="right">
            {#if p.focus === w.focus}
              <span class="dim tiny">{t('realm.focus.current')}</span>
            {:else}
              <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>{t('realm.focus.pick')}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <!-- Гарнизон из машин роты -->
  <div class="sec" title={t('realm.world.garrisonHint')}>
    {t('realm.world.garrisonTitle')}
    <span class="dim">· {t('realm.world.garrisonCount', { count: g.count, cap: g.cap })}{#if g.depotCap > 0} · {t('realm.world.depotCount', { count: g.depotCount, cap: g.depotCap })}{/if}</span>
  </div>
  {#if g.mechs.length === 0}<p class="dim tiny">{t('realm.world.garrisonEmpty')}</p>{/if}
  {#each g.mechs as m (m.id)}
    {@const cmd = { kind: 'garrisonLoad', recordIds: [m.id] } as const}
    {@const why = campaign.why(cmd)}
    <div class="row">
      <span class="small">{m.name}</span>
      {#if m.arrives !== null}
        <span class="dim tiny">{t('realm.world.garrisonEnRoute', { date: campaign.dateText(m.arrives) })}</span>
      {:else if m.depot}
        <span class="dim tiny">{t('realm.world.depotTag')}</span>
      {:else if !m.fit}
        <span class="gold tiny">{t('realm.world.garrisonUnfit')}</span>
      {/if}
      {#if g.here}
        <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>{t('realm.world.garrisonLoad')}</button>
      {/if}
    </div>
  {/each}
  {#if g.here}
    {#each g.aboard as m (m.id)}
      {@const cmd = { kind: 'garrisonUnload', recordIds: [m.id] } as const}
      {@const why = campaign.why(cmd)}
      <div class="row">
        <span class="small dim">{m.name}</span>
        <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>
          {t(m.depot ? 'realm.world.garrisonStore' : 'realm.world.garrisonUnload')}
        </button>
      </div>
    {/each}
  {:else}
    <p class="dim tiny">{t('realm.world.garrisonAway')}</p>
  {/if}
  <div class="seg">
    {#each ['fight', 'withdraw'] as const as policy (policy)}
      <button
        class="seg-btn"
        class:active={g.policy === policy}
        disabled={g.policy === policy}
        onclick={() => campaign.run({ kind: 'setGarrisonPolicy', systemId: w.id, policy })}
      >
        {t(`realm.world.garrisonPolicy.${policy}`)}
      </button>
    {/each}
  </div>

  <!-- Сектор, закрепление, столица -->
  <div class="sec">{t('realm.sector.title')}</div>
  <div class="row">
    <button class="btn btn-sm" class:btn-gold={w.pinned} title={t('realm.sector.pinHint')} onclick={() => campaign.run({ kind: 'pinWorld', systemId: w.id, pinned: !w.pinned })}>
      {t(w.pinned ? 'realm.sector.unpin' : 'realm.sector.pin')}
    </button>
    {#if w.sector !== null}
      <button class="btn btn-sm" onclick={() => campaign.openRealm('hq', { kind: 'sector', id: w.sector as string })}>
        {t('realm.hq.side.openSector', { name: GALAXY.name(GALAXY.require(w.sector)) })}
      </button>
    {/if}
  </div>
  {#if !w.capital}
    {@const cmd = { kind: 'moveCapital', systemId: w.id } as const}
    {@const why = campaign.why(cmd)}
    <div class="row">
      <button class="btn btn-sm btn-gold" disabled={why !== null} title={why ?? t('realm.world.moveCapitalHint', { days: WAR.domain.capitalMoveCooldownDays })} onclick={() => campaign.run(cmd)}>
        {t('realm.world.moveCapital', { sum: cbills(prices?.capital ?? 0) })}
      </button>
      {#if why !== null}<span class="dim tiny">{why}</span>{/if}
    </div>
    {#if prices?.capitalReadyDay != null && prices.capitalReadyDay > campaign.day}
      <p class="gold tiny">{t('realm.world.capitalReady', { date: campaign.dateText(prices.capitalReadyDay) })}</p>
    {/if}
  {/if}

  <div class="danger-zone">
    {#if confirmAbandon}
      {@const cmd = { kind: 'abandonWorld', systemId: w.id } as const}
      <p class="danger small">
        {t(worlds.length === 1 ? 'realm.world.abandonConfirmLast' : 'realm.world.abandonConfirm', { system: w.name, days: daysText(WAR.domain.abandonHoldDays) })}
      </p>
      <div class="row">
        <button class="btn btn-sm btn-danger" onclick={() => { campaign.run(cmd); confirmAbandon = false; }}>{t('realm.world.abandonDo')}</button>
        <button class="btn btn-sm" onclick={() => (confirmAbandon = false)}>{t('common.cancel')}</button>
      </div>
    {:else}
      {@const why = campaign.why({ kind: 'abandonWorld', systemId: w.id })}
      <button
        class="link-btn"
        disabled={why !== null}
        title={why ?? t('realm.world.abandonHint', { days: daysText(WAR.domain.abandonHoldDays) })}
        onclick={() => (confirmAbandon = true)}
      >
        ⋯ {t('realm.world.abandon')}
      </button>
    {/if}
  </div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .head-main {
    flex: 1;
    min-width: 200px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 700;
  }
  .capital {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .alert {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .alerts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 11px;
  }
  .head-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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
  .sec {
    margin-top: 10px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .threat {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bgrid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .bcell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 0 3px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    cursor: pointer;
    opacity: 0.55;
  }
  .bcell.built {
    opacity: 1;
    border-color: var(--color-ok);
    color: var(--color-text);
  }
  .bcell.building {
    opacity: 0.9;
    border-color: var(--color-gold);
  }
  .bcell.open {
    outline: 2px solid var(--color-border-active);
    opacity: 1;
  }
  .bname {
    font-size: 9.5px;
    line-height: 1.15;
    padding: 0 3px;
    text-align: center;
  }
  .bstate {
    position: absolute;
    right: 2px;
    top: 2px;
    padding: 1px 3px;
    background: rgba(7, 10, 15, 0.8);
    font-size: 9.5px;
    line-height: 1.2;
  }
  .bdetail {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    background: var(--color-panel-sub);
    border-left: 2px solid var(--color-border-active);
  }
  .focus-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .focus-table th,
  .focus-table td {
    padding: 3px 4px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
  }
  .focus-table th {
    color: var(--color-text-dim);
    font-weight: 400;
  }
  .focus-table tr.current td {
    color: var(--color-gold);
  }
  .right {
    text-align: right;
  }
  .seg {
    display: flex;
  }
  .seg-btn {
    padding: 2px 8px;
    font-size: 10.5px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .seg-btn + .seg-btn {
    margin-left: -1px;
  }
  .seg-btn.active {
    position: relative;
    color: var(--color-gold);
    border-color: var(--color-gold);
    cursor: default;
  }
  .danger-zone {
    margin-top: 12px;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .link-btn:hover:not(:disabled) {
    color: var(--color-danger);
  }
  .link-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
