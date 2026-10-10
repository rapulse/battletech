<script lang="ts">
  import { ECONOMY } from '../../core/data/index.js';
  import { isVital, zoneFromId, type ZoneId } from '../../core/model/HitZone.js';
  import { recordChassisDef } from '../../core/campaign/mech/MechRecord.js';
  import { GALAXY } from '../../core/campaign/galaxy/catalog.js';
  import { replacePartPlan, zoneRepairPlan } from '../../core/campaign/company/jobs.js';
  import { restoreJob } from '../../core/campaign/mech/repair.js';
  import { scrapPlan } from '../../core/campaign/market/pricing.js';
  import { EQUIPMENT, REPAIR, WEAPONS, equipment, weapon } from '../../core/data/tables.js';

  // Названия боевых терминов лежат в словаре ядра (`core/log/dictionary.ts`) — он старше
  // интерфейсного и общий с боевым журналом. Второго словаря для оружия нет.
  import { tr } from '../../core/log/index.js';
  import {
    campaign,
    completenessOf,
    isWreck,
    mechStatusOf,
    zoneLinesOf,
  } from '../state/campaign.svelte.js';
  import { fleetPlaces, placeGroups } from '../state/fleetPlaces.js';
  import { cbills, days as daysText, equipmentHint, t } from '../i18n/index.js';
  import { dropshipName } from '../i18n/names.js';
  import FleetPlacePicker from '../components/FleetPlacePicker.svelte';
  import LanceHead from '../components/LanceHead.svelte';
  import MechSilhouette from '../components/MechSilhouette.svelte';
  import { paintOfRecord } from '../components/mechArt.js';
  import NodeInspector from '../components/NodeInspector.svelte';
  import Paperdoll from '../components/Paperdoll.svelte';
  import PilotPortrait from '../components/PilotPortrait.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';

  /**
   * Ангар: парк роты, полоса стапелей и пульт цеха.
   *
   * СПИСОК ПАРКА И СТАПЕЛИ РАЗВЕДЕНЫ (решение 2026-09-02). В макете это была
   * одна колонка из четырёх слотов, часть которых «заблокирована до улучшения
   * цеха». В игре ничего такого нет: `bays` — это сколько машин одновременно
   * стоит В РАБОТЕ, а сам парк не ограничен ничем. Слева поэтому две вещи, а
   * не одна: сколько машин есть и что чинится сейчас.
   *
   * Лестница цеха пришла шагом 19a и стоит под полосой стапелей: решение
   * «расширить» принимается, глядя ровно на неё. Покупка машин — на рынке,
   * переоснащение — в мехлабе: ангар остаётся про то, что с машиной случилось,
   * а не про то, какой её собрать.
   *
   * НИ ОДНА кнопка не решает сама, доступна ли она: спрашивается `canExecute`
   * (через `campaign.can`), и отказ показывается словами ядра.
   */

  let confirmingSellMechId = $state<string | null>(null);

  /**
   * Перетаскивание в списке парка (правка на порядок/звенья). Порядок —
   * порядок самого `company.mechs`, и кнопки списка его не считают: они
   * просто переставляют id и отдают готовый массив команде `reorderMechs`.
   * Свой ГПСЧ здесь не нужен — это не бросок, а решение игрока мышью.
   */
  let dragMechId = $state<string | null>(null);
  let dragOverMechId = $state<string | null>(null);

  function onMechDragStart(e: DragEvent, id: string): void {
    dragMechId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }
  function onMechDragOver(e: DragEvent, id: string): void {
    if (dragMechId === null) return;
    e.preventDefault();
    dragOverMechId = id;
  }
  function onMechDrop(e: DragEvent, targetId: string): void {
    e.preventDefault();
    const id = dragMechId;
    dragMechId = null;
    dragOverMechId = null;
    if (id === null || id === targetId) return;
    const order = campaign.mechs.map((m) => m.id);
    const from = order.indexOf(id);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, id);
    campaign.run({ kind: 'reorderMechs', order });
  }
  function onMechDragEnd(): void {
    dragMechId = null;
    dragOverMechId = null;
  }
  /** Место списка парка: корабль или мир гарнизона (`fleetPlaces.ts`). */
  const placeOf = (id: string): string | null => campaign.postOf(id)?.systemId ?? null;
  const places = $derived(fleetPlaces(campaign.mechs, placeOf, (id) => GALAXY.name(GALAXY.require(id))));
  /** Выбранный мир, если на нём ещё есть машины; иначе корабль. */
  const place = $derived(places.some((p) => p.id === campaign.hangarPlace) ? campaign.hangarPlace : null);
  const shownGroups = $derived(placeGroups(campaign.mechs, campaign.lanceSize, place, placeOf));
  const shownIds = $derived(shownGroups.flatMap((g) => g.mechs.map((m) => m.id)));
  // Выбранная машина вне показанного списка (сменили место, машину забрали
  // на корабль) — выбор переходит на первую видимую, а не висит невидимым.
  $effect(() => {
    if (shownIds.length > 0 && !shownIds.includes(campaign.selectedMechId ?? '')) {
      campaign.selectedMechId = shownIds[0]!;
    }
  });

  const mech = $derived(campaign.selectedMech);
  const zone = $derived(campaign.selectedZone);
  const zoneIdx = $derived(zoneFromId(zone));
  const job = $derived(mech === null ? null : campaign.jobOf(mech.id));

  const chassis = $derived(mech === null ? null : recordChassisDef(mech));

  const zoneDestroyed = $derived(mech?.condition.zones[zoneIdx]?.destroyed === true);

  const repairPlanHere = $derived(mech === null ? null : zoneRepairPlan(mech, zone));
  /** Смета «починить всё» (шаг 39) — на показанный список (корабль или один мир) и на выбранную машину. */
  const fleetPlan = $derived(campaign.repairAllPlan(shownIds));
  const mechPlan = $derived(mech === null ? null : campaign.repairAllPlan([mech.id]));
  const replacePlanHere = $derived(mech === null ? null : replacePartPlan(mech, zone));
  // Цена и срок там, где работа встанет (шаг 87): в наземном цехе мира ремонт дешевле и быстрее.
  const repairQuote = $derived(
    mech === null || repairPlanHere === null
      ? null
      : campaign.jobQuote(mech.id, 'repairZone', repairPlanHere.cost, repairPlanHere.days),
  );
  const replaceQuote = $derived(
    mech === null || replacePlanHere === null
      ? null
      : campaign.jobQuote(mech.id, 'replacePart', replacePlanHere.cost, replacePlanHere.days),
  );
  const scrap = $derived(mech === null ? null : scrapPlan(mech));
  /** Комплектность: чего на машине нет против того, что держит корпус. */
  const kit = $derived(mech === null ? null : completenessOf(mech));
  const zones = $derived(mech === null ? [] : zoneLinesOf(mech));

  const replaceChance = $derived(Math.round(ECONOMY.replacePart.successChance * 100));
  /** Следующая ступень лестницы цеха и идущая перестройка — считает ядро (шаг 19a). */
  const nextBay = $derived(campaign.nextBayStep);
  const bayWork = $derived(campaign.bayUpgradeDaysLeft);
  const nextSlot = $derived(campaign.nextHangarStep);
  const slotWork = $derived(campaign.hangarUpgradeDaysLeft);

  /** Прыжковых ускорителей на машине: гексы прыжка считает бой, здесь — сколько их стоит. */
  const jumpJets = $derived(
    chassis?.equipment?.filter((e) => equipment(e.id).category === 'jump_jet').length ?? 0,
  );

  /** Установки выбранной зоны с их номером: номер — ключ к состоянию (боезапас, выбитость). */
  const mountsHere = $derived(
    (chassis?.mounts ?? [])
      .map((m, i) => ({ ...m, i }))
      .filter((m) => m.zone === zone),
  );

  /** Оборудование и боеприпасы выбранной зоны из сборки машины. */
  const itemsHere = $derived(
    (mech?.assembly.items ?? [])
      .map((item, i) => ({ ...item, i }))
      .filter((item) => item.zone === zone && item.kind !== 'weapon' && !WEAPONS.has(item.id)),
  );

  const equipmentHere = $derived(
    itemsHere.filter((item) => item.kind !== 'ammo' && EQUIPMENT.get(item.id)?.category !== 'ammo'),
  );

  const ammoHere = $derived(
    itemsHere.filter((item) => item.kind === 'ammo' || EQUIPMENT.get(item.id)?.category === 'ammo'),
  );

  const totalZoneItems = $derived(mountsHere.length + itemsHere.length);
</script>

<div class="hangar">
  <!-- Левая колонка: парк роты и полоса стапелей в единой панели -->
  <aside class="panel panel-scroll left">
    <div class="scroll-area">
      <div class="panel-header">
        <span>{t('hangar.fleet')}</span>
        <span class="badge badge-cyan">{campaign.aboardCount} / {campaign.mechCapacity}</span>
      </div>
      <FleetPlacePicker {places} {place} />
      <!--
        ПОЧИНИТЬ ВСЁ ЗВЕНО (шаг 39). После боя три-четыре машины возвращаются с
        мелкими повреждениями на разных зонах, и привести их в паспорт стоило от
        десяти до двадцати одинаковых кликов. Это UI поверх той же команды
        `repairZone`: экран ставит те же наряды, которые игрок поставил бы
        руками, и ядро о существовании кнопки не знает вовсе.

        Оторванных конечностей кнопка не трогает НИКОГДА: оторванный узел —
        отдельное взвешенное решение с шансом провала и понижением класса
        каркаса, и превращать его в побочный эффект пакетной кнопки нельзя. Про
        них честно предупреждает бейдж рядом.
      -->
      {#if fleetPlan.zones.length > 0 || fleetPlan.tornLimbs > 0}
        <div class="repair-all">
          {#if fleetPlan.zones.length > 0}
            <button class="btn btn-primary btn-wide" onclick={() => campaign.repairAll(shownIds)}>
              {t('hangar.repairAll')} · {cbills(fleetPlan.cost)} · {t('hangar.action.duration', {
                days: daysText(fleetPlan.days),
              })}
            </button>
            {#if fleetPlan.cost > campaign.state.company.cbills}
              <p class="danger small">
                {t('hangar.repairAllShort', {
                  need: cbills(fleetPlan.cost),
                  have: cbills(campaign.state.company.cbills),
                })}
              </p>
            {/if}
          {/if}
          {#if fleetPlan.tornLimbs > 0}
            <p class="warn small">{t('hangar.repairAllTorn', { count: fleetPlan.tornLimbs })}</p>
          {/if}
        </div>
      {/if}
      <div class="list">
        {#if campaign.mechs.length === 0}
          <p class="empty dim">{t('hangar.noMechs')}</p>
        {/if}
        {#each shownGroups as group (group.number)}
          {#if place === null}<LanceHead {group} />{/if}
          {#each group.mechs as m (m.id)}
            {@const status = mechStatusOf(campaign.state, m)}
            {@const pilot = campaign.pilotOf(m)}
            {@const wearPct = Math.round((Math.max(m.wear.reactor, m.wear.frame) / REPAIR.wear.threshold) * 100)}
            <button
              class="pick mech-card"
              class:active={m.id === campaign.selectedMechId}
              class:dragging={dragMechId === m.id}
              class:drag-over={dragOverMechId === m.id && dragMechId !== m.id}
              draggable="true"
              ondragstart={(e) => onMechDragStart(e, m.id)}
              ondragover={(e) => onMechDragOver(e, m.id)}
              ondragleave={() => (dragOverMechId = dragOverMechId === m.id ? null : dragOverMechId)}
              ondrop={(e) => onMechDrop(e, m.id)}
              ondragend={onMechDragEnd}
              onclick={() => (campaign.selectedMechId = m.id)}
              title="{m.name} · {t(`hangar.status.${status}`)}"
            >
              <!--
                Полоса износа: накладная, не двигает картинку и текст ни на
                пиксель (абсолютная, ширина сверх паддинга кнопки). Растёт
                снизу — как отвод здоровья в бою, тот же язык полос. Видна
                только с 30 %: ниже это шум, реактор и каркас изнашиваются
                бои напролёт, а внимания заслуживает только то, что уже
                близко к ступени (порог деградации — 100, `data/repair.json`).
              -->
              {#if wearPct > 30}
                <span
                  class="wear-bar"
                  style:height="{Math.min(100, wearPct)}%"
                  title={t('hangar.action.wearBarHint', { pct: wearPct })}
                ></span>
              {/if}
              <MechSilhouette chassisCode={m.assembly.chassisCode} paint={paintOfRecord(m)} width={38} />
              <span class="mech-body">
                <span class="mech-line">
                  <span
                    class="mech-name"
                    class:ok={status === 'ready'}
                    class:gold={status === 'damaged' || status === 'inWork'}
                    class:danger={status === 'critical' || status === 'wreck'}
                  >
                    {m.name}
                  </span>
                  <span class="cyan mech-stat">{t('hangar.tons', { tons: recordChassisDef(m).tons })}</span>
                </span>
                <span class="mech-line small dim">
                  <span class="mech-code">{m.assembly.chassisCode}</span>
                  <span class="mech-pilot">{pilot === null ? t('hangar.noPilot') : pilot.callsign}</span>
                </span>
              </span>
            </button>
          {/each}
        {/each}
      </div>

      <div class="panel-header bays-header">
        <span>{t('hangar.bays')}</span>
        <span class="badge badge-dim">
          {campaign.bayStands.filter((b) => b !== null).length} / {campaign.bays}
          <span class="dim">({t('hangar.baysMaxShip', { max: campaign.dropshipDef.maxBays })})</span>
        </span>
      </div>
      <div class="panel-body bay-list">
        <!--
          Ячейка полосы — МАШИНА, а не работа: столько же, сколько считает ядро
          (`hasBayFor`). Работы этой машины идут строками внутри ячейки, каждая
          со своей отменой, — иначе «Починить всё звено» размазывало один
          Javelin по трём стапелям (плейтест 2026-09-16).
        -->
        {#each campaign.bayStands as bay, i (i)}
          <div class="bay" class:busy={bay !== null}>
            <span class="bay-no">№{i + 1}</span>
            {#if bay === null}
              <span class="dim bay-free">{t('hangar.bayFree')}</span>
            {:else}
              <span class="bay-body">
                <span class="bay-line">
                  <span class="bay-mech">{bay.mech}</span>
                  <span class="gold">{daysText(bay.daysLeft)}</span>
                </span>
                {#each bay.jobs as job (job.jobId)}
                  <span class="bay-job">
                    <span class="dim small bay-work">
                      {job.zone === null
                        ? t(`hangar.job.${job.work}`)
                        : t('hangar.bayJobZone', {
                            work: t(`hangar.job.${job.work}`),
                            zone: t(`zone.${job.zone}`),
                          })}
                    </span>
                    <button
                      class="btn btn-sm btn-danger"
                      title={t('hangar.job.cancelHint')}
                      disabled={!campaign.can({ kind: 'cancelJob', jobId: job.jobId })}
                      onclick={() => campaign.run({ kind: 'cancelJob', jobId: job.jobId })}
                    >
                      ✕
                    </button>
                  </span>
                {/each}
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <!--
        Лестница цеха (шаг 19a). Стоит здесь, а не в отдельном экране: `bays` —
        это про полосу стапелей, и решение «расширить» принимается, глядя ровно
        на неё. Перестройка НЕ занимает стапель — место не может занимать само
        себя, — поэтому строка живёт под полосой, а не в ней.
      -->
      <div class="panel-body bay-upgrade">
        {#if bayWork !== null}
          <span class="dim tiny">{t('hangar.upgradeBaysWorking', { days: daysText(bayWork) })}</span>
        {:else if nextBay === null}
          <span class="dim tiny">
            {#if campaign.bays >= campaign.dropshipDef.maxBays}
              {t('hangar.upgradeBaysShipMax', { ship: dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name), max: campaign.dropshipDef.maxBays })}
            {:else}
              {t('hangar.upgradeBaysMax')}
            {/if}
          </span>
        {:else}
          {@const cmd = { kind: 'upgradeBays' } as const}
          {@const why = campaign.why(cmd)}
          <button
            class="btn btn-sm"
            disabled={why !== null}
            title={why ?? ''}
            onclick={() => campaign.run(cmd)}
          >
            {t('hangar.upgradeBays')}
          </button>
          <span class="dim tiny">
            {t('hangar.upgradeBaysHint', {
              to: nextBay.to,
              sum: cbills(nextBay.cost),
              days: daysText(nextBay.days),
            })}
          </span>
        {/if}
      </div>

      <!--
        Ячейки ангара (шаг 75): та же лестница и та же очередь, что у цеха, —
        поэтому и строка того же вида, сразу под ней. Открытые ячейки — это и
        парк роты, и потолок вылета.
      -->
      <div class="panel-body bay-upgrade">
        {#if slotWork !== null}
          <span class="dim tiny">{t('hangar.upgradeHangarWorking', { days: daysText(slotWork) })}</span>
        {:else if nextSlot === null}
          <span class="dim tiny">
            {#if campaign.nextDropshipDef !== null}
              {t('hangar.upgradeHangarShipMax', { ship: dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name), max: campaign.dropshipDef.mechCapacity })}
            {:else}
              {t('hangar.upgradeHangarMax')}
            {/if}
          </span>
        {:else}
          {@const cmd = { kind: 'upgradeHangar' } as const}
          {@const why = campaign.why(cmd)}
          <button
            class="btn btn-sm"
            disabled={why !== null}
            title={why ?? ''}
            onclick={() => campaign.run(cmd)}
          >
            {t('hangar.upgradeHangar')}
          </button>
          <span class="dim tiny">
            {t('hangar.upgradeHangarHint', {
              to: nextSlot.to,
              sum: cbills(nextSlot.cost),
              days: daysText(nextSlot.days),
            })}
          </span>
        {/if}
      </div>

      <!--
        Экстренный заём Гильдии наёмников (шаг 35). Показывается только когда он
        уместен: либо рота на мели и Гильдия готова дать, либо долг уже висит и
        игрок обязан его видеть. В хорошие времена строки нет вовсе — это
        страховка от тупика, а не постоянная кнопка «взять денег».
      -->
      {#if campaign.loan !== undefined}
        <div class="panel-body">
          <span class="badge badge-danger">{t('hangar.loanDebt')}</span>
          <span class="dim tiny">
            {t('hangar.loanDebtHint', {
              debt: cbills(campaign.loan.debt),
              installment: cbills(campaign.loan.installment),
            })}
          </span>
        </div>
      {:else if campaign.canTakeLoan}
        <div class="panel-body">
          <button class="btn btn-sm" onclick={() => campaign.run({ kind: 'takeLoan' })}>
            {t('hangar.loanTake')}
          </button>
          <span class="dim tiny">{t('hangar.loanTakeHint', { sum: cbills(campaign.loanPrincipal) })}</span>
        </div>
      {/if}

      <!-- Десантный корабль и верфь -->
      <div class="panel-body dropship-info">
        <div class="dropship-line">
          <span class="dim small">{t('hangar.dropship')}:</span>
          <span class="glow-cyan bold">{dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name)}</span>
          <span class="badge badge-dim tiny">{t(`hangar.shipClass.${campaign.dropshipDef.class}`)}</span>
        </div>
        <div class="dim tiny dropship-desc">
          {t('hangar.dropshipCapacity', {
            open: campaign.mechCapacity,
            mechs: campaign.dropshipDef.mechCapacity,
            bays: campaign.dropshipDef.maxBays,
          })}
        </div>
        {#if campaign.nextDropshipDef !== null}
          {@const nextShip = campaign.nextDropshipDef}
          {@const shipCmd = { kind: 'upgradeDropship' } as const}
          {@const shipWhy = campaign.why(shipCmd)}
          <div class="dropship-upgrade-card">
            <button
              class="btn btn-sm btn-gold"
              disabled={shipWhy !== null}
              title={shipWhy ?? ''}
              onclick={() => campaign.run(shipCmd)}
            >
              {t('hangar.upgradeShip', { ship: dropshipName(nextShip.id, nextShip.name) })}
            </button>
            <span class="dim tiny">
              {cbills(nextShip.upgradeCost)} • {t('hangar.upgradeShipSpecs', { min: nextShip.minMechs, mechs: nextShip.mechCapacity, bays: nextShip.maxBays })}
            </span>
          </div>
          {#if !campaign.isAtShipyard}
            <span class="dim tiny warning-text">{t('hangar.shipyardNeeded')}</span>
          {/if}
        {/if}
      </div>
    </div>
  </aside>

  <!-- Центр: выбранная машина -->
  <main class="panel panel-scroll center">
    {#if mech === null || chassis === null}
      <div class="panel-body dim">{t('hangar.pickMech')}</div>
    {:else}
      {@const pilot = campaign.pilotOf(mech)}
      <div class="panel-header">
        <span class="title">
          <span class="glow-cyan">{mech.name}</span>
          <span class="badge badge-dim">{mech.assembly.chassisCode}</span>
          <span class="badge badge-dim">{t('hangar.tons', { tons: chassis.tons })}</span>
          <span class="badge badge-gold">{t('hangar.value', { sum: cbills(campaign.valueOf(mech)) })}</span>
          <!--
            Переоснащение живёт на своём экране, а не здесь: ангар про то, что с
            машиной СЛУЧИЛОСЬ, мехлаб — про то, какой её собрать. Кнопка просто
            переносит выбор машины туда же.
          -->
          <button class="btn btn-sm" onclick={() => (campaign.screen = 'mechlab')}>
            {t('hangar.toMechlab')}
          </button>
        </span>
        <span class="pilot-tag">
          {#if pilot === null}
            <span class="dim">{t('hangar.noPilot')}</span>
          {:else}
            <PilotPortrait pilot={pilot} width={26} />
            <span>{t('hangar.pilot')}: <b>{pilot.callsign}</b></span>
          {/if}
        </span>
      </div>

      <div class="scroll-area mech-grid">
        <div class="doll">
          <Paperdoll {zones} selectable bind:selected={campaign.selectedZone} />
          <div class="zone-list">
            {#each zones as z (z.id)}
              {@const hull = z.hullArmor ?? z.maxArmor}
              {@const totalHp = z.maxArmor + z.maxStructure}
              {@const leftRatio = totalHp === 0 ? 0 : (z.armor + z.structure) / totalHp}
              {@const zoneId = z.id as ZoneId}
              {@const usedSlots = kit?.slotsUsed[zoneId] ?? 0}
              {@const totalSlots = kit?.slotsTotal[zoneId] ?? 0}
              <button
                class="pick zone-row"
                class:active={z.id === zone}
                onclick={() => (campaign.selectedZone = z.id as ZoneId)}
                title={t('hangar.zoneRowTitle', {
                  label: z.label,
                  armor: z.armor,
                  maxArmor: z.maxArmor,
                  hull,
                  structure: z.structure,
                  maxStructure: z.maxStructure,
                  slots: usedSlots,
                  totalSlots,
                })}
              >
                <span class="dim">{z.label}</span>
                {#if z.destroyed}
                  <span class="danger">{t('hangar.status.critical')}</span>
                {:else}
                  <span class="zone-nums">
                    <span
                      class:ok={leftRatio >= 0.75}
                      class:gold={leftRatio >= 0.4 && leftRatio < 0.75}
                      class:danger={leftRatio < 0.4}
                    >
                      {z.armor}/{z.maxArmor}/{hull}
                    </span>
                    <span class="dim">({usedSlots}/{totalSlots})</span>
                  </span>
                {/if}
              </button>
            {/each}
          </div>

          <div class="zone-legend">
            <span class="dim small">{t('hangar.zoneLegend')}</span>
            <WikiHelp doc="glossary.md" section="броня и ячейки зон" label="?" />
          </div>
        </div>

        <div class="engineering">
          <div class="sec-title sec-title-help">
            <span>{t('hangar.mounted', { zone: t(`zone.${zone}`) })}</span>
            <!--
              Справка на весь верх инженерного блока: установки в зоне,
              комплектность и тактические характеристики. Про реактор и каркас
              рассказывает своя справка ниже — одна статья на два разных
              вопроса отвечала обоим наполовину.
            -->
            <WikiHelp doc="glossary.md" section="сводка машины" align="right" label="?" />
          </div>
          {#if totalZoneItems === 0}
            <p class="dim small">{t('hangar.mountedEmpty')}</p>
          {:else}
            <div class="mounts">
              {#each mountsHere as m (m.i)}
                <span
                  class="mount weapon"
                  class:broken={zoneDestroyed || mech.condition.destroyedMounts[m.i] === true}
                  title={t('hangar.mountWeaponHint', { name: tr(weapon(m.weapon).key) })}
                >
                  {tr(weapon(m.weapon).key)}
                  {#if mech.condition.ammo[m.i] !== null}
                    <b>{mech.condition.ammo[m.i]}</b>
                  {/if}
                </span>
              {/each}
              {#each equipmentHere as item (item.i)}
                {@const def = EQUIPMENT.get(item.id)}
                {@const name = def ? tr(def.key) : item.id}
                <span
                  class="mount equipment"
                  class:broken={zoneDestroyed}
                  title={equipmentHint(item.id, name)}
                >
                  {name}
                </span>
              {/each}
              {#each ammoHere as item (item.i)}
                {@const def = EQUIPMENT.get(item.id)}
                {@const name = def ? tr(def.key) : item.id}
                <span
                  class="mount ammo"
                  class:broken={zoneDestroyed}
                  title={def?.shots
                    ? t('hangar.mountAmmoShots', { name, shots: def.shots })
                    : t('hangar.mountAmmoHint', { name })}
                >
                  {name}
                  {#if def?.shots}
                    <b>{def.shots}</b>
                  {/if}
                </span>
              {/each}
            </div>
          {/if}

          <div class="sec-title" title={t('hangar.completenessHint')}>{t('hangar.completeness')}</div>
          {#if kit !== null}
            {@const armorShort = kit.armorMax - kit.armor}
            <div class="kit">
              <div class="row-kv">
                <span>{t('hangar.armorCarried')}</span>
                <span class:gold={armorShort > 0} class:ok={armorShort === 0}>
                  {t('hangar.armorCarriedValue', {
                    now: kit.armor,
                    max: kit.armorMax,
                    percent: Math.round(kit.share * 100),
                  })}
                </span>
              </div>
              <div class="meter" class:danger={kit.share < 0.7}>
                <i style:width="{Math.round(kit.share * 100)}%"></i>
              </div>
              <div class="row-kv">
                <span>{t('hangar.payload')}</span>
                <span>
                  {t('hangar.payloadValue', {
                    now: kit.mass.toFixed(1),
                    max: kit.massMax.toFixed(1),
                    free: kit.freeMass.toFixed(1),
                  })}
                </span>
              </div>
              <div class="row-kv">
                <span>{t('hangar.slots', { zone: t(`zone.${zone}`) })}</span>
                <span>
                  {t('hangar.slotsValue', {
                    now: kit.slotsUsed[zone] ?? 0,
                    max: kit.slotsTotal[zone] ?? 0,
                  })}
                </span>
              </div>
              <div class="row-kv">
                <span>{t('hangar.heatBalance')}</span>
                <span
                  class:danger={kit.heatRatio > 1}
                  class:ok={kit.heatRatio <= 1}
                >
                  {t('hangar.heatBalanceValue', { ratio: kit.heatRatio.toFixed(2) })}
                </span>
              </div>
            </div>
          {/if}

          <div class="sec-title">{t('hangar.specs')}</div>
          <div class="specs">
            <div class="kv">
              <span class="kv-k">{t('hangar.heatSinks')}</span>
              <span class="kv-v">{t('hangar.heatSinksValue', { value: chassis.heatSinks })}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('hangar.jumpJets')}</span>
              <span class="kv-v">{t('hangar.jumpJetsValue', { value: jumpJets })}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('hangar.role')}</span>
              <span class="kv-v cyan">{t(`role.${mech.assembly.role}`)}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('hangar.battlesLabel')}</span>
              <span class="kv-v">{mech.battles}</span>
            </div>
          </div>

          <!--
            Справка у самих узлов, а не только у шапки инженерного блока: до неё
            приходилось догадываться, что «Каркас» и «Реактор» объясняются
            подсказкой, висящей четырьмя заголовками выше.
          -->
          <div class="sec-title sec-title-help">
            <span>{t('hangar.nodes')}</span>
            <WikiHelp doc="glossary.md" section="узлы и каркас" align="right" label="?" />
          </div>
          <NodeInspector {mech} />
        </div>
      </div>
    {/if}
  </main>

  <!-- Правая колонка: пульт цеха -->
  <aside class="panel panel-scroll workshop">
    <div class="panel-header"><span>{t('hangar.workshop')}</span></div>
    <!-- Та же кнопка, но на одну машину: чинить звено целиком нужно не всегда. -->
    {#if mechPlan !== null && (mechPlan.zones.length > 0 || mechPlan.tornLimbs > 0)}
      <div class="repair-all">
        {#if mechPlan.zones.length > 0 && mech !== null}
          {@const id = mech.id}
          <button class="btn btn-wide" onclick={() => campaign.repairAll([id])}>
            {t('hangar.repairMech')} · {cbills(mechPlan.cost)} · {t('hangar.action.duration', {
              days: daysText(mechPlan.days),
            })}
          </button>
        {/if}
        {#if mechPlan.tornLimbs > 0}
          <p class="warn small">{t('hangar.repairAllTorn', { count: mechPlan.tornLimbs })}</p>
        {/if}
      </div>
    {/if}
    <div class="scroll-area actions">
      {#if mech === null}
        <p class="dim">{t('hangar.pickMech')}</p>
      {:else if job !== null}
        <div class="job-card">
          <div class="row-kv">
            <span class="gold">{t('hangar.job.inProgress')}</span>
            <span>{t(`hangar.job.${job.work}`)}</span>
          </div>
          <div class="meter">
            <i style:width="{Math.max(4, 100 - ((job.day - campaign.day) / Math.max(1, job.day - campaign.day + 1)) * 100)}%"></i>
          </div>
          <span class="dim small">{daysText(Math.max(0, job.day - campaign.day))}</span>
          <button
            class="btn btn-danger btn-wide btn-sm"
            title={t('hangar.job.cancelHint')}
            disabled={!campaign.can({ kind: 'cancelJob', jobId: job.jobId })}
            onclick={() => campaign.run({ kind: 'cancelJob', jobId: job.jobId })}
          >
            {t('hangar.job.cancel')}
          </button>
        </div>
      {:else}
        <!-- Ремонт зоны либо полевая замена: это разные работы, и какая из них
             доступна, решает состояние зоны, а не игрок. -->
        {#if zoneDestroyed}
          {@const cmd = { kind: 'replacePart', recordId: mech.id, zone } as const}
          {@const why = campaign.why(cmd)}
          <div class="act">
            <div class="row-kv">
              <span class="cyan">{t('hangar.action.replacePart', { zone: t(`zone.${zone}`) })}</span>
              <span class="gold">{t('hangar.action.cost', { sum: cbills(replaceQuote?.cost ?? 0) })}</span>
            </div>
            <p class="dim small">{t('hangar.action.replacePartDesc', { chance: replaceChance })}</p>
            {#if isVital(zoneIdx)}
              <p class="danger small">{t('hangar.action.unrepairable')}</p>
            {:else}
              <button class="btn btn-primary btn-wide" disabled={why !== null} onclick={() => campaign.run(cmd)}>
                {t('hangar.action.replacePartDo')} · {t('hangar.action.duration', {
                  days: daysText(replaceQuote?.days ?? 0),
                })}
              </button>
              {#if why !== null}<p class="danger small">{why}</p>{/if}
            {/if}
          </div>
        {:else}
          {@const cmd = { kind: 'repairZone', recordId: mech.id, zone } as const}
          {@const why = campaign.why(cmd)}
          <div class="act">
            <div class="row-kv">
              <span class="cyan">{t('hangar.action.repairZone', { zone: t(`zone.${zone}`) })}</span>
              <span class="gold">{t('hangar.action.cost', { sum: cbills(repairQuote?.cost ?? 0) })}</span>
            </div>
            <p class="dim small">{t('hangar.action.repairZoneDesc')}</p>
            {#if repairPlanHere && repairPlanHere.jobs.length > 0}
              <div class="repair-breakdown">
                {#each repairPlanHere.jobs as job}
                  {@const q = campaign.jobQuote(mech.id, 'repairZone', job.cost, job.days)}
                  <div class="row-kv small dim">
                    <span>{t(`hangar.repairBreakdown.${job.kind}`, { amount: job.amount ?? 0 })}</span>
                    <span class="gold">{cbills(q.cost)} · {daysText(q.days)}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <button class="btn btn-primary btn-wide" disabled={why !== null} onclick={() => campaign.run(cmd)}>
              {#if (repairPlanHere?.jobCount ?? 0) === 0}
                {t('hangar.action.nothingToRepair')}
              {:else}
                {t('hangar.action.repairZoneDo')} · {t('hangar.action.duration', {
                  days: daysText(repairQuote?.days ?? 0),
                })}
              {/if}
            </button>
            {#if why !== null && (repairPlanHere?.jobCount ?? 0) > 0}<p class="danger small">{why}</p>{/if}
          </div>
        {/if}

        <!--
          Износ и класс: одной кнопкой на оба узла. Реактор и каркас изнашиваются
          КАЖДЫЙ ОТ СВОЕГО (`mech/wear.ts`: реактор — от жары и собственных
          критов, каркас — от пробитой структуры и оторванных зон) и потому
          обычно расходятся, а не идут парой, — но это разница СТАТЕЙ износа, не
          повод держать для них два отдельных наряда стапеля. Кнопка запускает
          РОВНО ТУ ЖЕ команду `restoreWorn` для каждого узла, у которого есть
          что снимать: цена и срок за узел без вклада не растут (`restoreJob`
          отдаёт 0 C-Bills за нетронутый узел), так что переплаты за чужой
          износ здесь нет.
        -->
        {@const reactorJob = restoreJob(mech, 'reactor')}
        {@const frameJob = restoreJob(mech, 'frame')}
        {@const reactorCmd = { kind: 'restoreWorn', recordId: mech.id, node: 'reactor' } as const}
        {@const frameCmd = { kind: 'restoreWorn', recordId: mech.id, node: 'frame' } as const}
        {@const reactorWhy = reactorJob.possible ? campaign.why(reactorCmd) : null}
        {@const frameWhy = frameJob.possible ? campaign.why(frameCmd) : null}
        {@const anyWorn = reactorJob.possible || frameJob.possible}
        {@const restoreBlocked = reactorWhy ?? frameWhy}
        {@const reactorQuote = campaign.jobQuote(mech.id, 'restoreWorn', reactorJob.cost, reactorJob.days)}
        {@const frameQuote = campaign.jobQuote(mech.id, 'restoreWorn', frameJob.cost, frameJob.days)}
        {@const restoreCost = reactorQuote.cost + frameQuote.cost}
        {@const restoreDays = Math.max(
          reactorJob.possible ? reactorQuote.days : 0,
          frameJob.possible ? frameQuote.days : 0,
        )}
        <div class="act">
          <div class="row-kv">
            <span class="cyan">{t('hangar.action.restoreWorn')}</span>
            <span class="gold">{t('hangar.action.cost', { sum: cbills(restoreCost) })}</span>
          </div>
          <p class="dim small">{t('hangar.action.restoreWornDesc')}</p>
          <button
            class="btn btn-wide"
            disabled={!anyWorn || restoreBlocked !== null}
            onclick={() => {
              if (reactorJob.possible) campaign.run(reactorCmd);
              if (frameJob.possible) campaign.run(frameCmd);
            }}
          >
            {#if !anyWorn}
              {t('hangar.action.noWear')}
            {:else}
              {t('hangar.action.restoreWornDo')} · {t('hangar.action.duration', { days: daysText(restoreDays) })}
            {/if}
          </button>
          {#if restoreBlocked !== null && anyWorn}<p class="danger small">{restoreBlocked}</p>{/if}
        </div>

        {@const scrapCmd = { kind: 'scrapMech', recordId: mech.id } as const}
        {@const scrapWhy = campaign.why(scrapCmd)}
        <div class="act danger-act">
          <div class="row-kv">
            <span class="danger">{t('hangar.action.scrapMech')}</span>
            <span class="gold">{t('hangar.action.cost', { sum: cbills(scrap?.cost ?? 0) })}</span>
          </div>
          <p class="dim small">{t('hangar.action.scrapMechDesc')}</p>
          <button
            class="btn btn-danger btn-wide"
            class:btn-primary={isWreck(mech)}
            disabled={scrapWhy !== null}
            onclick={() => campaign.run(scrapCmd)}
          >
            {t('hangar.action.scrapMechDo')} · {t('hangar.action.duration', {
              days: daysText(scrap?.days ?? 0),
            })}
          </button>
          {#if scrapWhy !== null}<p class="danger small">{scrapWhy}</p>{/if}
        </div>

        {@const sellCmd = { kind: 'sellMech', recordId: mech.id } as const}
        {@const sellWhy = campaign.why(sellCmd)}
        {@const sellPrice = campaign.sellPriceOfMech(mech)}
        <div class="act sell-act">
          <div class="row-kv">
            <span class="gold strong">{t('hangar.action.sellMech')}</span>
            <span class="gold strong">{t('hangar.action.payout', { sum: cbills(sellPrice) })}</span>
          </div>
          <p class="dim small">{t('hangar.action.sellMechDesc')}</p>
          {#if confirmingSellMechId === mech.id}
            <div class="confirm-box">
              <p class="warn small">
                {t('hangar.action.sellMechConfirm', { name: mech.name, sum: cbills(sellPrice) })}
              </p>
              <div class="confirm-actions">
                <button
                  class="btn btn-sm btn-danger"
                  onclick={() => {
                    campaign.run(sellCmd);
                    confirmingSellMechId = null;
                  }}
                >
                  {t('hangar.action.sellMechDo')}
                </button>
                <button
                  class="btn btn-sm"
                  onclick={() => (confirmingSellMechId = null)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          {:else}
            <button
              class="btn btn-sm btn-wide"
              disabled={sellWhy !== null}
              onclick={() => (confirmingSellMechId = mech.id)}
            >
              {t('hangar.action.sellMechDo')} · +{cbills(sellPrice)}
            </button>
          {/if}
          {#if sellWhy !== null}<p class="danger small">{sellWhy}</p>{/if}
        </div>
      {/if}
    </div>
  </aside>
</div>

<style>
  .hangar {
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 320px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }

  .left,
  .center,
  .workshop {
    overflow: hidden;
  }

  .bays-header {
    border-top: 1px solid var(--color-border);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }
  .empty {
    padding: 12px 4px;
    font-size: 11.5px;
  }
  .mech-card {
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-align: left;
    width: 100%;
    overflow: hidden;
  }
  /* Растёт от низа кнопки, паддинг не трогает — накладная полоса, а не колонка. */
  .wear-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 3px;
    background: var(--color-gold);
    box-shadow: 0 0 4px rgba(227, 179, 65, 0.7);
  }
  /* Перетаскивание списка парка: сама карточка тускнеет, цель наведения светится рамкой. */
  .mech-card.dragging {
    opacity: 0.4;
  }
  .mech-card.drag-over {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.08);
  }
  .mech-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .mech-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-weight: 700;
    font-size: 12px;
  }
  .mech-line.small {
    font-size: 10.5px;
    font-weight: 600;
  }
  .mech-name,
  .mech-code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .mech-stat,
  .mech-pilot {
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .bay-upgrade {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .dropship-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.15);
  }
  .dropship-line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dropship-desc {
    line-height: 1.35;
  }
  .dropship-upgrade-card {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
    padding: 6px 8px;
    background: rgba(227, 179, 65, 0.05);
    border: 1px dashed rgba(227, 179, 65, 0.3);
    border-radius: 2px;
  }
  .warning-text {
    color: #e3a841;
  }

  .bay-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .bay {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 9px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    min-height: 38px;
  }
  .bay.busy {
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.08);
    /* Работ у машины может быть несколько: номер стапеля держится за верхнюю строку. */
    align-items: flex-start;
  }
  .bay-no {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 800;
    color: var(--color-text-dim);
  }
  .bay-free {
    font-size: 10.5px;
    letter-spacing: 1px;
  }
  .bay-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 3px;
  }
  .bay-job {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .bay-work {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bay-line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11.5px;
    font-weight: 700;
  }
  .bay-mech {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 15px;
  }
  .pilot-tag {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--color-text);
  }

  .mech-grid {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    gap: 14px;
    padding: 12px;
  }
  .doll {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .zone-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .zone-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 700;
  }
  .zone-legend {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 8px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    font-size: 10px;
  }

  .engineering {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .sec-title-help {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sec-title-help :global(.wiki-help-wrapper) {
    text-transform: none;
    letter-spacing: normal;
  }
  .small {
    font-size: 10.5px;
  }
  .kit {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 11px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .zone-nums {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .specs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 6px;
  }
  .mounts {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .mount {
    padding: 3px 7px;
    background: rgba(57, 197, 187, 0.1);
    border: 1px solid var(--color-accent);
    border-radius: 2px;
    color: var(--color-accent);
    font-size: 10.5px;
    font-weight: 700;
  }
  .mount.equipment {
    border-color: #bc8cff;
    color: #bc8cff;
    background: rgba(188, 140, 255, 0.1);
  }
  .mount.ammo {
    border-color: var(--color-gold);
    color: var(--color-gold);
    background: rgba(227, 179, 65, 0.1);
  }
  .mount.broken {
    border-color: var(--color-danger);
    color: var(--color-danger);
    background: rgba(248, 81, 73, 0.1);
    text-decoration: line-through;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px;
  }
  .act,
  .job-card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .repair-all {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--color-border);
  }
  .repair-breakdown {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    border-left: 2px solid var(--color-accent);
  }
  .job-card {
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.08);
  }
  .danger-act {
    border-color: rgba(248, 81, 73, 0.4);
  }
  .sell-act {
    border-color: rgba(227, 179, 65, 0.4);
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
  p {
    margin: 0;
    line-height: 1.45;
  }
</style>
