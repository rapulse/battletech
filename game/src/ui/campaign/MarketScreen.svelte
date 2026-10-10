<script lang="ts">
  import { isWarehousePart, type WarehouseEntry } from '../../core/campaign/company/types.js';
  import {
    ITEM_FAMILIES,
    itemFamilyOf,
    itemKindOf,
    type ItemFamily,
  } from '../../core/campaign/market/pricing.js';
  import { recordChassisDef, recordQuality } from '../../core/campaign/mech/MechRecord.js';
  import { EQUIPMENT, WEAPONS, equipment, weapon } from '../../core/data/tables.js';
  import { CHASSIS_CATALOG } from '../../core/data/index.js';
  import { stackOrder, stackWarehouse, type WarehouseStack } from './warehouseStacks.js';
  import ItemIcon from '../components/ItemIcon.svelte';
  import { tr } from '../../core/log/index.js';
  import { campaign, completenessOf } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, equipmentHint, t } from '../i18n/index.js';
  import { dropshipName } from '../i18n/names.js';
  import MechSilhouette from '../components/MechSilhouette.svelte';
  import { type MechLot } from '../../core/campaign/market/mechs.js';
  import { makePlatform, validateAssembly, weightClassOf } from '../../core/rules/construction.js';
  import { mechArtFullUrl, paintOfFaction, pickMechArt } from '../components/mechArt.js';

  /**
   * Рынок и склад роты.
   *
   * Ассортимент ВЫВОДИТСЯ, а не хранится (решение 2026-09-02): в дельте системы
   * лежит только факт покупки, сам список считается из сида мира и декады. Цены
   * тоже не считаются здесь: наценка за глушь, спред выкупа и спрос — всё в
   * `market/stock.ts`, экран их показывает.
   *
   * **Машины продаются целиком** (шаг 19a) — отдельной витриной, а не строкой
   * в общей ленте: корпус стоит в десятки раз дороже узла, и вперемешку с
   * реакторами его не видно. Купленная машина приходит подержанной и без
   * пилота; доукомплектовать её — в мехлабе.
   */

  /**
   * Прилавок: установки или машины целиком (шаг 19a).
   *
   * Две витрины, а не одна лента: машина стоит в десятки раз дороже установки, и
   * вперемешку с ними её просто не видно. Обе выводятся одинаково — из сида
   * мира и декады, — и обе вычёркиваются одним списком купленного. Реакторов и
   * каркасов на прилавке нет: их заказывают из ангара, а снятые лежат на складе.
   */
  type Counter = 'parts' | 'mechs' | 'dropships';
  let counter = $state<Counter>('parts');
  let inspectingLot = $state<MechLot | null>(null);

  const market = $derived(campaign.market);
  const stock = $derived(campaign.stock);
  /**
   * ФИЛЬТР ВИТРИНЫ ПО РОДАМ (шаг 40, часть Б).
   *
   * Сплошной список лотов не считывался взглядом: чтобы понять, лежит ли на
   * витрине что-то энергетическое, приходилось читать её целиком. Вкладки
   * фильтруют по тому же роду, по которому нарисованы иконки, — второго деления
   * ассортимента на экране не заводится.
   *
   * Склад роты добавляет к ним вкладку узлов (`PartFamily`): снятые реактор и
   * каркас лежат там, а на витрине их нет.
   */
  let family = $state<'all' | ItemFamily>('all');

  /** Пустая вкладка не показывается: кнопка, за которой ничего нет, только мешает. */
  const familiesHere = $derived(
    (['all', ...ITEM_FAMILIES] as const).filter(
      (f) => f === 'all' || stock.some((lot) => itemFamilyOf(lot.itemId) === f),
    ),
  );
  const shownStock = $derived(family === 'all' ? stock : stock.filter((lot) => itemFamilyOf(lot.itemId) === family));
  const mechLots = $derived(campaign.mechStock);
  const warehouse = $derived(campaign.warehouse);

  /**
   * ТЕ ЖЕ ВКЛАДКИ РОДОВ НА СКЛАДЕ РОТЫ.
   *
   * Полка растёт быстрее витрины: на неё ложатся трофеи, закупки и всё снятое
   * при переоснащении, — и она оставалась последним сплошным списком в игре,
   * когда витрина и мехлаб уже делились по родам. Деление берётся то же самое
   * (`market/pricing.ts::itemFamilyOf` плюс отдельная вкладка узлов): три
   * разных способа разложить один и тот же ассортимент — это три места, где
   * купленное ищется не там, где лежит.
   *
   * Своя переменная, а не общая с витриной: игрок смотрит на витрине
   * «Энергетическое», а на складе — «Всё», и навязывать одному экрану выбор,
   * сделанный для другого, значит терять его при каждом переключении.
   */
  type PartFamily = 'all' | ItemFamily | 'node';
  let shelfFamily = $state<PartFamily>('all');
  const SHELF_FAMILIES: readonly PartFamily[] = ['all', ...ITEM_FAMILIES, 'node'];

  function familyOfEntry(entry: WarehouseEntry): PartFamily {
    return isWarehousePart(entry) ? 'node' : itemFamilyOf(entry.itemId);
  }

  const shelfFamiliesHere = $derived(
    SHELF_FAMILIES.filter((f) => f === 'all' || warehouse.some((w) => familyOfEntry(w) === f)),
  );
  const shownWarehouse = $derived(
    shelfFamily === 'all' ? warehouse : warehouse.filter((w) => familyOfEntry(w) === shelfFamily),
  );
  /**
   * Склад стопками (`warehouseStacks.ts`): одинаковые записи — одна строка с числом.
   * Записи, занятые работой цеха, в стопку к свободным не идут: их нельзя продать,
   * и кнопка «Продать» на общей стопке отказывала бы при живом остатке.
   */
  const shownStacks = $derived(
    stackWarehouse(shownWarehouse, (w) => (campaign.reservedPartIds.has(w.id) ? 'work' : ''), stackOrder(itemName)),
  );
  const atMarket = $derived(!campaign.travelling);

  const selected = $derived<WarehouseEntry | null>(
    warehouse.find((w) => w.id === campaign.selectedPartId) ?? warehouse[0] ?? null,
  );

  /**
   * Команду отдаёт запись, которая уйдёт со склада (продана или взята в работу), —
   * выбор переезжает на следующую из той же стопки, иначе после каждой продажи
   * подсветка перескакивала бы на первую строку списка.
   */
  function keepSelection(stack: WarehouseStack<WarehouseEntry>): void {
    const next = stack.entries[1];
    if (next !== undefined && (selected === null || stack.entries.some((e) => e.id === selected.id))) {
      campaign.selectedPartId = next.id;
    }
  }

  /** Имя складской записи или лота: у узла — класс и тоннаж, у установки — её название. */
  function itemName(itemId: string): string {
    return WEAPONS.has(itemId) ? tr(weapon(itemId).key) : tr(equipment(itemId).key);
  }

  /**
   * Строка под названием установки: чем она полезна.
   *
   * Повторять вид («Орудие» под значком «Орудие») бессмысленно — покупателю
   * нужны числа, по которым он решает. Все они лежат в `data/weapons.json` и
   * `data/equipment.json`, и берутся оттуда, а не переписываются сюда.
   */
  function itemFacts(itemId: string): string {
    if (WEAPONS.has(itemId)) {
      const w = weapon(itemId);
      return t('market.weaponFacts', {
        damage: w.damage * (w.shots > 1 ? w.shots : 1),
        short: w.short,
        medium: w.medium,
        long: w.long,
        heat: w.heat,
        mass: w.mass,
        slots: w.slots,
      });
    }
    const e = equipment(itemId);
    return t('market.equipmentFacts', { mass: e.mass, slots: e.slots });
  }

  /** Машины, на которые этот узел вообще встанет: тот же тоннаж и тот же тир. */
  function fittingMechs(entry: WarehouseEntry) {
    return campaign.mechs.filter((m) => campaign.fitsMech(entry, m));
  }
</script>

<div class="market">
  <main class="panel panel-scroll">
    <div class="panel-header">
      <span>{t('market.counter', { system: campaign.system.name })}</span>
      <span class="hdr-right">
        <span class="badge badge-dim">{t(`market.class.${market.marketClass}`)}</span>
        <span class="badge badge-gold">{t('market.priceFactor', { value: market.priceFactor.toFixed(2) })}</span>
      </span>
    </div>

    <div class="tabs">
      <button class="tab" class:active={counter === 'parts'} onclick={() => (counter = 'parts')}>
        {t('market.buy')} ({stock.length})
      </button>
      <button class="tab" class:active={counter === 'mechs'} onclick={() => (counter = 'mechs')}>
        {t('market.mechs')} ({mechLots.length})
      </button>
      <button class="tab" class:active={counter === 'dropships'} onclick={() => (counter = 'dropships')}>
        {t('market.shipyard')}
      </button>
    </div>

    <div class="scroll-area lots">
      {#if !atMarket}
        <p class="dim pad">{t('reject.notAtMarket')}</p>
      {:else if counter === 'dropships'}
        <div class="pad shipyard-view">
          <p class="dim tiny">{t('market.shipyardDesc')}</p>

          <div class="ship-card current">
            <span class="ship-header">
              <span class="dim tiny">{t('market.currentShip')}:</span>
              <span class="glow-cyan strong">{dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name)}</span>
              <span class="badge badge-dim">{t(`hangar.shipClass.${campaign.dropshipDef.class}`)}</span>
            </span>
            <div class="ship-specs dim small">
              <span>{t('hangar.fleet')}: {campaign.aboardCount} / {campaign.mechCapacity}</span>
              <span>{t('hangar.hangarSlots')}: {campaign.mechCapacity} / {campaign.dropshipDef.mechCapacity}</span>
              <span>{t('hangar.bays')}: {campaign.bays} / {campaign.dropshipDef.maxBays}</span>
              <span>{t('market.shipUpkeep', { sum: cbills(campaign.dropshipDef.shipRent) })}</span>
            </div>
          </div>

          {#if campaign.nextDropshipDef !== null}
            {@const nextShip = campaign.nextDropshipDef}
            {@const shipCmd = { kind: 'upgradeDropship' } as const}
            {@const shipWhy = campaign.why(shipCmd)}
            <div class="ship-card next">
              <span class="ship-header">
                <span class="dim tiny">{t('market.nextShip')}:</span>
                <span class="gold strong">{dropshipName(nextShip.id, nextShip.name)}</span>
                <span class="badge badge-gold">{t(`hangar.shipClass.${nextShip.class}`)}</span>
              </span>
              <div class="ship-specs dim small">
                <span>{t('market.nextShipCapacity', { min: nextShip.minMechs, max: nextShip.mechCapacity })}</span>
                <span>{t('market.nextShipBays', { min: nextShip.minBays, max: nextShip.maxBays })}</span>
                <span>{t('market.shipUpkeep', { sum: cbills(nextShip.shipRent) })}</span>
              </div>
              <div class="ship-actions">
                <span class="gold strong">{cbills(nextShip.upgradeCost)}</span>
                <button
                  class="btn btn-sm btn-gold"
                  disabled={shipWhy !== null}
                  title={shipWhy ?? ''}
                  onclick={() => campaign.run(shipCmd)}
                >
                  {t('hangar.upgradeShip', { ship: dropshipName(nextShip.id, nextShip.name) })}
                </button>
              </div>
              {#if shipWhy !== null}
                <span class="dim tiny warning-text">{shipWhy}</span>
              {/if}
            </div>
          {:else}
            <p class="dim small pad">{t('reject.dropshipMaxed')}</p>
          {/if}
        </div>
      {:else if counter === 'mechs'}
        <p class="dim pad tiny">
          {t('market.mechsOccupancy', { count: campaign.aboardCount, max: campaign.mechCapacity, ship: dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name) })}
          {t('market.mechsHint')}
        </p>
        {#if mechLots.length === 0}
          <p class="dim pad">{t('market.mechsEmpty')}</p>
        {/if}
        {#each mechLots as lot (lot.id)}
          {@const cmd = { kind: 'buyMech', lotId: lot.id } as const}
          {@const why = campaign.why(cmd)}
          {@const kit = completenessOf(lot.record)}
          <div class="lot">
            <button
              type="button"
              class="lot-preview-btn"
              onclick={() => (inspectingLot = lot)}
              title="{t('market.inspectMech')} · {lot.record.name}"
            >
              <MechSilhouette
                chassisCode={lot.record.assembly.chassisCode}
                name={lot.record.name}
                paint={paintOfFaction(campaign.ownerHere)}
                width={46}
              />
            </button>
            <span class="lot-body">
              <span class="lot-head">
                <button
                  type="button"
                  class="lot-name-btn glow-cyan strong"
                  onclick={() => (inspectingLot = lot)}
                  title="{t('market.inspectMech')} · {lot.record.name}"
                >
                  {lot.record.name}
                </button>
                <span class="badge badge-dim">{lot.record.assembly.chassisCode}</span>
                <span class="badge badge-dim">{recordChassisDef(lot.record).tons} {t('common.tons')}</span>
                <span class="badge badge-dim">{t(`role.${lot.record.assembly.role}`)}</span>
                <span class="badge badge-dim">{t(`quality.${recordQuality(lot.record).reactor}`)}</span>
              </span>
              <span class="lot-sub dim">
                {t('market.lotValue', { sum: cbills(lot.value) })} ·
                {t('market.lotOutfit', { pct: Math.round(kit.share * 100) })}
              </span>
            </span>
            <span class="lot-buy">
              <span class="gold strong">{cbills(lot.price)}</span>
              <button
                class="btn btn-sm btn-primary"
                disabled={why !== null}
                title={why ?? ''}
                onclick={() => campaign.run(cmd)}
              >
                {t('market.buyMech')}
              </button>
            </span>
          </div>
        {/each}
      {:else if stock.length === 0}
        <p class="dim pad">{t('market.empty')}</p>
      {/if}

      {#if counter === 'parts' && stock.length > 0}
        <div class="family-tabs">
          {#each familiesHere as f (f)}
            <button class="chip" class:active={family === f} onclick={() => (family = f)}>
              {t(`market.family.${f}`)}
            </button>
          {/each}
        </div>
      {/if}

      {#each counter === 'parts' ? shownStock : [] as lot (lot.id)}
        {@const cmd = { kind: 'buyPart', lotId: lot.id } as const}
        {@const why = campaign.why(cmd)}
        <div class="lot">
          <span class="lot-body" title={equipmentHint(lot.itemId) || undefined}>
            <span class="lot-head">
              <ItemIcon itemId={lot.itemId} />
              <span class="glow-cyan strong">{itemName(lot.itemId)}</span>
              <span class="badge badge-dim">{t(`market.kind.${lot.kind}`)}</span>
            </span>
            <span class="lot-sub dim">{itemFacts(lot.itemId)}</span>
          </span>
          <span class="lot-buy">
            <span class="gold strong">{cbills(lot.price)}</span>
            <button class="btn btn-sm btn-primary" disabled={why !== null} onclick={() => campaign.run(cmd)}>
              {t('market.buy')}
            </button>
          </span>
        </div>
      {/each}
    </div>
  </main>

  <aside class="panel panel-scroll">
    <div class="panel-header">
      <span>{t('market.warehouse')} ({warehouse.length})</span>
    </div>

    <div class="scroll-area side">
      {#if warehouse.length === 0}
        <p class="dim">{t('market.warehouseEmpty')}</p>
      {:else}
        <div class="family-tabs">
          {#each shelfFamiliesHere as f (f)}
            <button
              class="chip"
              class:active={shelfFamily === f}
              onclick={() => (shelfFamily = f)}
            >
              {t(`market.family.${f}`)}
            </button>
          {/each}
        </div>
      {/if}
      {#each shownStacks as stack (stack.key)}
        {@const entry = stack.head}
        {@const active = stack.entries.some((e) => e.id === selected?.id)}
        {@const sellCmd = { kind: 'sellPart', partId: entry.id } as const}
        {@const sellWhy = campaign.why(sellCmd)}
        <div class="entry" class:active>
          <button class="entry-pick" onclick={() => (campaign.selectedPartId = entry.id)}>
            <span class="entry-head" title={!isWarehousePart(entry) ? (equipmentHint(entry.itemId) || undefined) : undefined}>
              {#if stack.count > 1}<span class="stack-count">{t('common.stack', { count: stack.count })}</span>{/if}
              {#if isWarehousePart(entry)}
                <span class="strong">{t(`hangar.${entry.node}`)}</span>
                <span class="badge badge-dim">{t(`quality.${entry.quality}`)}</span>
              {:else}
                <span class="strong">{itemName(entry.itemId)}</span>
                <ItemIcon itemId={entry.itemId} />
                <span class="badge badge-dim">{t(`market.kind.${itemKindOf(entry.itemId)}`)}</span>
              {/if}
            </span>
            <span class="dim tiny">
              {#if isWarehousePart(entry)}
                {t('market.forTons', { tons: entry.sourceTonnage, tier: entry.tier })}
                {#if entry.wear > 0}· {t('hangar.wear')} {Math.round(entry.wear)}{/if}
              {:else}
                {itemFacts(entry.itemId)}
              {/if}
            </span>
          </button>

          <div class="entry-actions">
            <button
              class="btn btn-sm"
              disabled={sellWhy !== null}
              title={sellWhy ?? t('market.sellHint')}
              onclick={() => {
                keepSelection(stack);
                campaign.run(sellCmd);
              }}
            >
              {t('market.sell')} · {cbills(campaign.sellPriceOf(entry))}
            </button>
          </div>

          <!--
            Установка со склада — только для УЗЛОВ: `InstallPart` принимает
            реактор и каркас, орудия ставит мехлаб. Поэтому кнопка
            рисуется лишь там, где ей есть что делать.
          -->
          {#if isWarehousePart(entry) && active}
            {@const fits = fittingMechs(entry)}
            {#if fits.length > 0}
              <div class="install">
                <span class="dim tiny">{t('market.installTo')}</span>
                {#each fits as m (m.id)}
                  {@const cmd = { kind: 'installPart', recordId: m.id, partId: entry.id } as const}
                  {@const why = campaign.why(cmd)}
                  {@const plan = campaign.installCost(entry, m)}
                  <button
                    class="btn btn-sm btn-primary"
                    disabled={why !== null}
                    title={why ?? ''}
                    onclick={() => {
                      keepSelection(stack);
                      campaign.run(cmd);
                    }}
                  >
                    {m.name} · {cbills(plan.cost)} · {daysText(plan.days)}
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </aside>
</div>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && inspectingLot !== null) inspectingLot = null;
  }}
/>

{#if inspectingLot !== null}
  {@const lot = inspectingLot}
  {@const mech = lot.record}
  {@const def = recordChassisDef(mech)}
  {@const quality = recordQuality(mech)}
  {@const validation = validateAssembly(mech.assembly)}
  {@const kit = completenessOf(mech)}
  {@const isClan = mech.assembly.techBase === 'clan'}
  {@const bandKey = `weightClass.${weightClassOf(def.tons)}`}
  {@const chassisEntry = CHASSIS_CATALOG.get(mech.assembly.chassisCode)}
  {@const platform = makePlatform(def.techBase, def.tons, def.reactorTier, def.frameTier, quality, chassisEntry?.locomotion ?? 'H')}
  {@const jumpJets = mech.assembly.items.filter((it) => it.kind === 'jump_jet').length}
  {@const picked = pickMechArt(mech.assembly.chassisCode)}
  {@const cmd = { kind: 'buyMech', lotId: lot.id } as const}
  {@const why = campaign.why(cmd)}
  {@const alphaDamage = def.mounts.reduce((sum, m) => {
    const w = WEAPONS.get(m.weapon);
    return sum + (w ? w.damage * (w.shots > 1 ? w.shots : 1) : 0);
  }, 0)}
  {@const eqItems = mech.assembly.items.filter((it) => !WEAPONS.has(it.id))}

  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) inspectingLot = null;
    }}
  >
    <div class="modal inspect-modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="panel-header">
        <span class="title">
          <span class="glow-cyan">{mech.name}</span>
          <span class="badge badge-dim">{mech.assembly.chassisCode}</span>
          <span class="badge badge-dim">{t(bandKey)}</span>
          <span class="badge badge-dim">{def.tons} {t('common.tons')}</span>
          <span class="badge badge-dim">{t(`role.${mech.assembly.role}`)}</span>
          <span class="badge badge-dim">{t(`quality.${quality.reactor}`)}</span>
          <span class="badge" class:badge-cyan={isClan} class:badge-dim={!isClan}>
            {t(isClan ? 'common.techClan' : 'common.techSphere')}
          </span>
        </span>
        <button class="btn btn-sm" onclick={() => (inspectingLot = null)}>{t('common.close')}</button>
      </div>

      <div class="inspect-body">
        <div class="inspect-left">
          {#if picked !== null}
            <div class="inspect-art-wrap">
              <img
                src={mechArtFullUrl(picked, paintOfFaction(campaign.ownerHere))}
                alt={mech.name}
                class="inspect-art"
              />
            </div>
          {:else}
            <div class="inspect-art-wrap empty"></div>
          {/if}

          <div class="inspect-specs">
            <div class="spec-row">
              <span class="dim">{t('market.inspectLabelMovement')}</span>
              <span class="strong">{t('market.inspectWalkRun', { walk: platform.walkMP, run: platform.runMP })}</span>
            </div>
            <div class="spec-row">
              <span class="dim">{t('market.inspectLabelJump')}</span>
              <span class="strong">
                {jumpJets > 0 ? t('market.inspectJumpVal', { jump: jumpJets }) : t('market.inspectNoJump')}
              </span>
            </div>
            <div class="spec-row">
              <span class="dim">{t('market.inspectLabelCooling')}</span>
              <span class="strong">
                {t('market.inspectCoolingVal', { dissipation: validation.heatDissipation, sinks: def.heatSinks })}
              </span>
            </div>
            <div class="spec-row">
              <span class="dim">{t('market.inspectLabelAlpha')}</span>
              <span class="strong">
                <span class="cyan">{t('market.inspectDamage', { damage: alphaDamage })}</span>
                <span class="dim"> / </span>
                <span class:gold={validation.heatAlpha > validation.heatDissipation}>
                  {t('market.inspectHeat', { heat: validation.heatAlpha })}
                </span>
              </span>
            </div>
            <div class="spec-row">
              <span class="dim">{t('market.inspectLabelArmor')}</span>
              <span class="strong">
                {t('market.inspectArmorVal', {
                  armor: validation.totalArmor,
                  max: validation.maxArmor,
                  pct: Math.round((validation.totalArmor / Math.max(1, validation.maxArmor)) * 100),
                })}
              </span>
            </div>
            <div class="spec-row">
              <span class="dim">{t('hangar.completeness')}</span>
              <span class="strong">{Math.round(kit.share * 100)} %</span>
            </div>
          </div>
        </div>

        <div class="inspect-right">
          <div class="inspect-section">
            <div class="sec-title">{t('market.inspectWeapons')} ({def.mounts.length})</div>
            {#if def.mounts.length === 0}
              <p class="dim tiny pad">{t('market.inspectNoWeapons')}</p>
            {:else}
              <div class="inspect-items-list">
                {#each def.mounts as m, i (i)}
                  {@const w = weapon(m.weapon)}
                  <div class="inspect-item-card">
                    <ItemIcon itemId={m.weapon} size={16} />
                    <div class="inspect-item-content">
                      <div class="inspect-item-head">
                        <span class="strong">{tr(w.key)}</span>
                        <span class="badge badge-dim">{t(`zone.${m.zone}`)}</span>
                      </div>
                      <div class="inspect-item-details dim tiny">
                        <span>{t('market.inspectDamage', { damage: w.damage * (w.shots > 1 ? w.shots : 1) })}</span>
                        <span class="dim">·</span>
                        <span>{t('market.inspectRange', { short: w.short, medium: w.medium, long: w.long })}</span>
                        <span class="dim">·</span>
                        <span>{t('market.inspectHeat', { heat: w.heat })}</span>
                        {#if m.ammo !== null}
                          <span class="dim">·</span>
                          <span class="gold strong">{t('market.inspectAmmoCount', { shots: m.ammo })}</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="inspect-section">
            <div class="sec-title">{t('market.inspectEquipment')}</div>
            <div class="inspect-items-list">
              <div class="inspect-item-card">
                <ItemIcon itemId="engine" size={16} />
                <div class="inspect-item-content">
                  <div class="inspect-item-head">
                    <span class="strong">{t('market.inspectReactor', { rating: def.reactorTier, quality: t(`quality.${quality.reactor}`) })}</span>
                    <span class="badge badge-dim">{t('zone.torso')}</span>
                  </div>
                  <div class="inspect-item-details dim tiny">
                    <span>{t('market.equipmentFacts', { mass: Math.round(platform.reactorMass * 10) / 10, slots: 6 })}</span>
                  </div>
                </div>
              </div>

              <div class="inspect-item-card">
                <ItemIcon itemId="structure" size={16} />
                <div class="inspect-item-content">
                  <div class="inspect-item-head">
                    <span class="strong">{t('market.inspectFrame', { tons: def.tons, quality: t(`quality.${quality.frame}`) })}</span>
                  </div>
                  <div class="inspect-item-details dim tiny">
                    <span>{t('market.equipmentFacts', { mass: Math.round(platform.frameMass * 10) / 10, slots: 0 })}</span>
                  </div>
                </div>
              </div>

              {#if eqItems.length === 0}
                <p class="dim tiny pad">{t('market.inspectNoEquipment')}</p>
              {:else}
                {#each eqItems as it, idx (idx)}
                  {@const defEq = EQUIPMENT.get(it.id)}
                  {@const name = defEq ? tr(defEq.key) : it.id}
                  <div class="inspect-item-card">
                    <ItemIcon itemId={it.id} size={16} />
                    <div class="inspect-item-content">
                      <div class="inspect-item-head">
                        <span class="strong">{name}</span>
                        <span class="badge badge-dim">{t(`zone.${it.zone}`)}</span>
                      </div>
                      <div class="inspect-item-details dim tiny">
                        {#if defEq?.category === 'ammo' && defEq.shots}
                          <span>{t('market.inspectAmmoCount', { shots: defEq.shots })}</span>
                          <span class="dim">·</span>
                        {/if}
                        {#if defEq}
                          <span>{t('market.equipmentFacts', { mass: defEq.mass, slots: defEq.slots })}</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>

      <div class="inspect-footer">
        <div class="inspect-price-info">
          <span class="dim tiny">{t('market.lotValue', { sum: cbills(lot.value) })}</span>
          <span class="gold strong text-lg">{cbills(lot.price)}</span>
        </div>
        <div class="inspect-actions">
          <button class="btn" onclick={() => (inspectingLot = null)}>
            {t('common.close')}
          </button>
          <button
            class="btn btn-primary"
            disabled={why !== null}
            title={why ?? ''}
            onclick={() => {
              campaign.run(cmd);
              inspectingLot = null;
            }}
          >
            {t('market.buyMech')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Вкладки родов: узкая полоса под шапкой витрины (шаг 40). */
  .family-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--color-border);
  }
  .chip {
    padding: 2px 8px;
    font-size: 0.75rem;
    color: var(--color-text-dim);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    cursor: pointer;
  }
  .chip.active {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .market {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .hdr-right {
    display: flex;
    gap: 6px;
  }
  .lots {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px;
  }
  .pad {
    padding: 14px 4px;
    line-height: 1.5;
  }
  .lot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 11px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .lot-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    /* Силуэт встал первым ребёнком лота, и без роста тела кнопка покупки
       перестала бы держаться правого края. */
    flex: 1;
  }
  .lot-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }
  .lot-sub {
    font-size: 10.5px;
  }
  .lot-buy {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .strong {
    font-weight: 700;
  }
  .tiny {
    font-size: 10px;
  }

  .tabs {
    display: flex;
    background: var(--color-panel-sub);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    padding: 8px 6px;
    background: none;
    border: none;
    border-right: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--color-text);
  }
  .tab.active {
    color: var(--color-accent);
    background: var(--color-panel);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .entry.active {
    border-color: var(--color-accent);
  }
  .entry-pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .entry-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .stack-count {
    color: var(--color-accent);
    font-weight: 600;
  }
  .entry-actions {
    display: flex;
    gap: 6px;
  }
  .install {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--color-border);
  }
  .shipyard-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ship-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .ship-card.next {
    border-color: rgba(227, 179, 65, 0.4);
    background: rgba(227, 179, 65, 0.05);
  }
  .ship-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .ship-specs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    line-height: 1.4;
  }
  .ship-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .warning-text {
    color: #e3a841;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }

  .lot-preview-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    line-height: 0;
    transition: transform 0.12s ease, filter 0.12s ease;
    border-radius: 2px;
  }
  .lot-preview-btn:hover {
    transform: scale(1.05);
    filter: brightness(1.2);
  }
  .lot-preview-btn:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }
  .lot-name-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .lot-name-btn:hover {
    color: #fff;
    text-decoration: underline;
  }

  /* --- модальное окно осмотра робота --- */
  .modal.inspect-modal {
    width: min(880px, 94vw);
    max-height: min(86vh, 700px);
    display: flex;
    flex-direction: column;
  }

  .inspect-modal .title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .inspect-body {
    display: grid;
    grid-template-columns: 290px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .inspect-left {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
  }

  .inspect-art-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 8px;
    min-height: 200px;
    max-height: 250px;
  }

  .inspect-art {
    max-height: 234px;
    max-width: 100%;
    width: auto;
    object-fit: contain;
  }

  .inspect-art-wrap.empty {
    aspect-ratio: 3 / 4;
    background: var(--color-panel-sub);
  }

  .inspect-specs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 9px 11px;
    font-size: 11.5px;
  }

  .spec-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .inspect-right {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    min-height: 0;
    padding-right: 4px;
  }

  .inspect-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .inspect-items-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .inspect-item-card {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: 6px 10px;
  }

  .inspect-item-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .inspect-item-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .inspect-item-details {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11px;
  }

  .inspect-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--color-panel-sub);
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .inspect-price-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inspect-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .text-lg {
    font-size: 15px;
  }

  @media (max-width: 700px) {
    .inspect-body {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .inspect-art-wrap {
      max-height: 180px;
    }
  }
</style>
