<script lang="ts">
  import { EQUIPMENT, WEAPONS, equipment, weapon } from '../../core/data/tables.js';
  import { tr } from '../../core/log/index.js';
  import { Rng } from '../../core/rng/index.js';
  import { ZONE_IDS, type ZoneId } from '../../core/model/HitZone.js';
  import { isWreck, recordChassisDef } from '../../core/campaign/mech/MechRecord.js';
  import { stripBlockAt, type RefitBlocker } from '../../core/campaign/company/refit.js';
  import {
    ITEM_FAMILIES,
    isSupplyItem,
    itemFamilyOf,
    itemKindOf,
    type ItemFamily,
  } from '../../core/campaign/market/pricing.js';
  import { isWarehousePart, type WarehouseItem } from '../../core/campaign/company/types.js';
  import {
    AMMO_FOR_WEAPON,
    armorPointsPerTon,
    ASSEMBLY_ROLES,
    generateAssembly,
    getChassisCatalogEntry,
    mountIssue,
    type AssemblyRole,
    type MechAssembly,
    type MountedItem,
  } from '../../core/rules/construction.js';
  import { campaign, mechStatusOf } from '../state/campaign.svelte.js';
  import { fleetPlaces, placeGroups } from '../state/fleetPlaces.js';
  import { GALAXY } from '../../core/campaign/galaxy/catalog.js';
  import { cbills, days as daysText, equipmentHint, t } from '../i18n/index.js';
  import { stackOrder, stackWarehouse } from './warehouseStacks.js';
  import ItemIcon from '../components/ItemIcon.svelte';
  import ZonePicker from '../components/ZonePicker.svelte';
  import FleetPlacePicker from '../components/FleetPlacePicker.svelte';
  import LanceHead from '../components/LanceHead.svelte';
  import MechSilhouette from '../components/MechSilhouette.svelte';
  import { paintOfRecord } from '../components/mechArt.js';
  import RepaintPanel from './RepaintPanel.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';

  /**
   * Мехлаб: переоснащение машины роты (шаг 19a).
   *
   * **Экран не знает правил сборки.** Ни массы, ни ячеек, ни обязательного
   * боекомплекта он не считает: чертёж собирается как обычные данные
   * (`MechAssembly`), а годен ли он — отвечает ядро (`campaign.refit` →
   * `company/refit.ts` → `validateAssembly`). Отсюда и вид экрана: справа не
   * «правила», а ОТЧЁТ валидатора и наряд цеха с ценой и сроком.
   *
   * **Ставится только то, что лежит на складе.** Список слева — склад роты, и
   * позиции, занятые другими работами цеха, оттуда убраны ядром. Снятое
   * возвращается на склад, но не сразу: пока работа не подошла по сроку, машина
   * остаётся прежней, а склад — прежним.
   *
   * **Чертёж живёт только на экране.** Пока игрок не нажал «Поставить в цех»,
   * ни одна команда не выполнена, и уход с экрана просто теряет черновик. Это
   * не забывчивость, а то же правило, что и везде: состояние меняется только
   * командой.
   */

  const mech = $derived(campaign.selectedMech);

  /**
   * Место списка парка (`fleetPlaces.ts`): в мехлабе из миров — только те, где
   * стоит цех. Машину гарнизона переоснащают и красят на стапеле цеха её мира
   * (`baySite`, шаг 87); без цеха работа с ней здесь невозможна.
   */
  const placeOf = (id: string): string | null => campaign.postOf(id)?.systemId ?? null;
  const places = $derived(
    fleetPlaces(campaign.mechs, placeOf, (id) => GALAXY.name(GALAXY.require(id)), (id) => campaign.hasWorkshop(id)),
  );
  const place = $derived(places.some((p) => p.id === campaign.hangarPlace) ? campaign.hangarPlace : null);
  const shownGroups = $derived(placeGroups(campaign.mechs, campaign.lanceSize, place, placeOf));
  $effect(() => {
    const shown = shownGroups.flatMap((g) => g.mechs);
    if (shown.length > 0 && !shown.some((m) => m.id === campaign.selectedMechId)) {
      campaign.selectedMechId = shown[0]!.id;
    }
  });

  /** Перетаскивание в списке парка — та же команда и та же логика, что в ангаре. */
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

  /** Черновик чертежа. `null` — экран показывает то, что стоит на машине. */
  let draft = $state<MechAssembly | null>(null);
  /** Машина, для которой собран черновик: смена машины сбрасывает его. */
  let draftFor = $state<string | null>(null);

  /** Переоснащение на стапеле: сборка, за которую уже заплачено, и срок. */
  const pending = $derived(mech === null ? null : campaign.pendingRefit(mech.id));
  const hasDraft = $derived(mech !== null && draftFor === mech.id && draft !== null);
  /**
   * Экран показывает сборку из цеха, а не черновик. Без черновика это важнее
   * сборки машины: она до конца работы прежняя, и после «Поставить в цех» экран
   * откатывался к ней, будто изменения не применились.
   */
  const showingPending = $derived(pending !== null && !hasDraft);

  const target = $derived<MechAssembly | null>(
    mech === null ? null : hasDraft && draft !== null ? draft : (pending?.assembly ?? mech.assembly),
  );

  const plan = $derived(mech === null || target === null ? null : campaign.refit(mech, target));
  const report = $derived(plan?.report ?? null);

  /**
   * ЦВЕТ ЗАЛПА в строке тепла (плейтест 2026-09-15) — правило машины, а не порог
   * экрана (`core/rules/heat.ts`): отключение — тепло выше предела, остывает
   * машина за ход только на отвод.
   *   - зелёный: залп не выше отвода — всё уходит за ход, жми каждый ход;
   *   - жёлтый: выше отвода, но в пределе — остаток копится;
   *   - красный: выше предела — отключение в этом же ходу.
   */
  const heatTone = $derived<'ok' | 'gold' | 'danger'>(
    report === null || report.heatAlpha <= report.heatDissipation
      ? 'ok'
      : report.heatAlpha <= report.heatLimit
        ? 'gold'
        : 'danger',
  );
  /**
   * Сколько полных залпов подряд машина выдержит, если залп выше отвода. Каждый
   * добавляет к остатку «залп − отвод», отключение — когда остаток перерос запас
   * корпуса: t·(залп − отвод) > запас. Без прыжков и местности.
   */
  const safeVolleys = $derived(
    report === null || report.heatAlpha <= report.heatDissipation
      ? 0
      : Math.floor(report.heatReserve / (report.heatAlpha - report.heatDissipation)),
  );
  /**
   * Подробная расшифровка строки тепла — во всплывающей подсказке: сама строка
   * держит только числа («залп 15 [р. 10 + охл. 10] к. 3»), чтобы влезать в
   * ширину наряда одной строкой (решение пользователя 2026-09-15).
   */
  const heatTitle = $derived(
    report === null
      ? ''
      : `${t(`mechlab.heatTone.${heatTone}`, {
          alpha: report.heatAlpha,
          sink: report.heatDissipation,
          reserve: report.heatReserve,
          limit: report.heatLimit,
          left: report.heatAlpha - report.heatDissipation,
          volleys: safeVolleys,
        })}\n${t('mechlab.heatBreakdown', {
          sink: report.heatDissipation,
          reactor: report.heatReactor,
          sinks: report.heatDissipation - report.heatReactor,
          reserve: report.heatReserve,
          limit: report.heatLimit,
        })}`,
  );
  const refittable = $derived(mech === null ? false : campaign.refittable(mech));
  const wreck = $derived(mech !== null && isWreck(mech));

  /**
   * Почему позицию из этой зоны нельзя снять — правило ядра (`stripBlockAt`).
   * У исправной машины снимать можно отовсюду; у побитой — только из целых зон
   * без выбитых ячеек, и кнопка у остальных гаснет с объяснением, а не
   * разрешает нажать и отказывает потом общей фразой (плейтест 2026-09-15).
   */
  function blockOf(zone: ZoneId): 'zoneDestroyed' | 'slotsDestroyed' | null {
    return mech === null || refittable ? null : stripBlockAt(mech, zone);
  }

  /** Причина демонтажа словами — ядро отдаёт её данными (`RefitBlocker`). */
  function blockerText(b: RefitBlocker): string {
    if (b.kind === 'armor') return t('mechlab.blocker.armor');
    return t(`mechlab.blocker.${b.kind}`, { item: itemName(b.id), zone: t(`zone.${b.zone}`) });
  }

  /**
   * Замечание валидатора или плана словами — ядро отдаёт его данными (шаг 52):
   * id установок и зон в параметрах, здесь они становятся названиями.
   */
  function issueText(issue: { readonly kind: string; readonly params: Readonly<Record<string, string | number>> }): string {
    const { item, items, zone } = issue.params;
    return t(`mechlab.issue.${issue.kind}`, {
      ...issue.params,
      ...(typeof item === 'string' ? { item: itemName(item) } : {}),
      ...(typeof items === 'string' ? { items: items.split(',').map(itemName).join(', ') } : {}),
      ...(typeof zone === 'string' ? { zone: t(`zone.${zone}`) } : {}),
    });
  }

  /** Позиции чертежа по зонам — то, что видно в колонке зон. */
  const byZone = $derived.by(() => {
    const out = new Map<ZoneId, MountedItem[]>();
    for (const zone of ZONE_IDS) out.set(zone as ZoneId, []);
    for (const item of target?.items ?? []) out.get(item.zone)?.push(item);
    return out;
  });

  /** Склад роты за вычетом занятого другими работами и уже поставленного в чертёж. */
  const shelf = $derived.by(() => {
    const reserved = campaign.reservedPartIds;
    const taken = new Set(plan?.partIds ?? []);
    return campaign.warehouse.filter(
      (w): w is WarehouseItem => !isWarehousePart(w) && !reserved.has(w.id) && !taken.has(w.id),
    );
  });

  /**
   * ФИЛЬТР СКЛАДА ПО РОДАМ — тот же, что на витрине рынка (шаг 40, часть Б).
   *
   * Склад роты к этому шагу перерос сплошной список: трофеи, закупки и снятое
   * при переоснащении лежат вперемешку, и найти в нём нужное орудие глазами
   * стало дороже, чем собрать сборку. Деление берётся из ядра
   * (`market/pricing.ts::itemFamilyOf`), а не заводится своё: рынок и мехлаб
   * обязаны делить ассортимент одинаково, иначе купленное на витрине
   * «Энергетическое» ищется в мехлабе непонятно где.
   *
   * Узлов (`sort === 'node'`) на этой полке нет вовсе — их ставит не мехлаб, а
   * ремонт, — поэтому вкладки узлов здесь тоже нет.
   */
  type ShelfFamily = 'all' | ItemFamily;
  let family = $state<ShelfFamily>('all');

  const FAMILIES: readonly ShelfFamily[] = ['all', ...ITEM_FAMILIES];
  /** Пустая вкладка не показывается: кнопка, за которой ничего нет, только мешает. */
  const familiesHere = $derived(
    FAMILIES.filter((f) => f === 'all' || shelf.some((w) => itemFamilyOf(w.itemId) === f)),
  );
  const shownShelf = $derived(
    family === 'all' ? shelf : shelf.filter((w) => itemFamilyOf(w.itemId) === family),
  );
  /** Одинаковые установки — одной строкой с числом (`warehouseStacks.ts`). Уходящая в наряд запись уже вычтена из `shelf`. */
  const shelfStacks = $derived(stackWarehouse(shownShelf, undefined, stackOrder(itemName)));

  function itemName(itemId: string): string {
    return WEAPONS.has(itemId) ? tr(weapon(itemId).key) : tr(equipment(itemId).key);
  }

  /**
   * Числа, по которым выбирают: урон, дальности, тепло, масса, ячейки.
   *
   * Берутся из тех же таблиц, что читает бой (`data/weapons.json`,
   * `data/equipment.json`), а не переписываются сюда. Без них мехлаб — выбор
   * вслепую: игрок видит два названия и ничего, что их различает.
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
    if (e.category === 'ammo' && e.shots !== undefined) {
      return t('market.ammoFacts', { shots: e.shots, mass: e.mass, slots: e.slots });
    }
    return t('market.equipmentFacts', { mass: e.mass, slots: e.slots });
  }

  /**
   * Сколько залпов получит каждый ствол этой сборки из данного боезапаса.
   *
   * Формула та же, что отдаёт бою `construction.ts` (ёмкость установки): пачки
   * этого типа × залпы в пачке, поровну на одинаковые стволы. Без неё игрок
   * узнавал итог только в бою — две РДД-20 на одной пачке делят шесть залпов.
   */
  function ammoInBattle(ammoId: string): string {
    const items = target?.items ?? [];
    const users = [...new Set(items.filter((it) => AMMO_FOR_WEAPON[it.id] === ammoId).map((it) => it.id))];
    if (users.length === 0) return t('market.ammoNoWeapon');
    const boxes = Math.max(1, items.filter((it) => it.id === ammoId).length);
    return users
      .map((id) => {
        const w = weapon(id);
        const same = Math.max(1, items.filter((it) => it.id === id).length);
        return t('market.ammoPerWeapon', {
          weapon: tr(w.key),
          salvos: Math.floor(((w.ammo ?? 0) * boxes) / same),
        });
      })
      .join('\n');
  }

  /** Подсказка к позиции: описание и, у боезапаса, во что он превращается в бою. */
  function itemTitle(itemId: string): string | undefined {
    const parts = [equipmentHint(itemId)];
    if (!WEAPONS.has(itemId) && equipment(itemId).category === 'ammo') parts.push(ammoInBattle(itemId));
    const text = parts.filter((p) => p !== '').join('\n');
    return text === '' ? undefined : text;
  }

  function edit(next: MechAssembly): void {
    if (mech === null) return;
    draft = next;
    draftFor = mech.id;
  }

  function reset(): void {
    draft = null;
    draftFor = null;
  }

  /**
   * Поставить установку в зону.
   *
   * Своя пачка боезапаса добавляется вместе с орудием: без неё сборка не
   * пройдёт валидатор («для оружия не установлен боекомплект»), и игрок получил
   * бы отказ за то, чего не выбирал. Боезапас — расходник, склада он не
   * касается, и его цена уже входит в наряд цеха.
   */
  function add(itemId: string, zone: ZoneId): void {
    if (target === null) return;
    const items: MountedItem[] = [...target.items, { id: itemId, kind: itemKindOf(itemId), zone }];
    const ammoId = AMMO_FOR_WEAPON[itemId];
    if (ammoId !== undefined && !items.some((it) => it.id === ammoId)) {
      items.push({ id: ammoId, kind: 'ammo', zone: 'torso' });
    }
    edit({ ...target, items });
  }

  /** Снять позицию чертежа. Осиротевшая пачка боезапаса уходит вместе с последним орудием. */
  function remove(at: number): void {
    if (target === null) return;
    const removed = target.items[at];
    if (removed === undefined) return;
    let items = target.items.filter((_, i) => i !== at);
    const ammoId = AMMO_FOR_WEAPON[removed.id];
    if (ammoId !== undefined && !items.some((it) => WEAPONS.has(it.id) && AMMO_FOR_WEAPON[it.id] === ammoId)) {
      // Пачка из зоны, откуда снимать нельзя, остаётся: иначе снятие целого
      // ствола из руки отклонялось бы из-за пачки в разрушенном торсе. Лишняя
      // пачка валидатору не мешает — он требует боезапас у оружия, а не наоборот.
      const orphan = items.findIndex((it) => it.id === ammoId && blockOf(it.zone) === null);
      if (orphan >= 0) items = items.filter((_, i) => i !== orphan);
    }
    edit({ ...target, items });
  }

  /**
   * Сколько ячеек занимает позиция. Оружие и оборудование лежат в разных
   * каталогах, и спрашивать надо оба — ровно как это делает валидатор.
   */
  function slotsOf(itemId: string): number {
    return WEAPONS.get(itemId)?.slots ?? EQUIPMENT.get(itemId)?.slots ?? 0;
  }

  /**
   * ПЕРЕНЕСТИ УСТАНОВКУ В ДРУГУЮ ЗОНУ (шаг 40).
   *
   * **Боль, ради которой шаг делается.** Чтобы перенести лазер из левой руки в
   * правую, игрок был обязан: найти его под заголовком «Левая рука», нажать
   * «Снять» (деталь улетала на склад), перейти в левую колонку склада,
   * переключить выпадающий список из шести зон на «Правая рука», найти деталь в
   * списке и нажать «Установить». Шесть действий на одно намерение — и всё
   * потому, что монтаж был привязан к ГЛОБАЛЬНОМУ выбору зоны в селекторе, а
   * прямой связи между установленной деталью и свободными слотами куклы не было
   * вовсе.
   *
   * Теперь это один жест: у каждой позиции список зон, куда она поместится.
   * План части 3b называл этот пункт первым по отдаче — «закрывает 80 % боли
   * пятью процентами работы».
   */
  function moveTo(at: number, to: ZoneId): void {
    if (target === null) return;
    const items = target.items.map((it, i) => (i === at ? { ...it, zone: to } : it));
    edit({ ...target, items });
  }

  /** Сколько ячеек зоны ещё свободно — из той же сметы, что показана игроку. */
  function freeSlots(z: ZoneId): number {
    if (report === null) return 0;
    return (report.slotsAvailable[z] ?? 0) - (report.slotsUsed[z] ?? 0);
  }

  /**
   * Влезет ли установка в зону.
   *
   * **Годность спрашивается у ЯДРА, а не проверяется своими `if`.**
   * `mountIssue` — та же функция, которой правила зон спрашивают валидатор и
   * процедурный генератор (`core/rules/construction.ts`, шаг 31). Поэтому
   * интерфейс физически не может предложить сборку, которую отклонит валидатор:
   * второго свода правил здесь нет. Своей осталась ровно одна проверка — хватит
   * ли ячеек, и она считается из той же сметы, что показана игроку.
   */
  function fitsZone(itemId: string, z: ZoneId): boolean {
    if (report === null) return false;
    if (mountIssue(itemId, z) !== null) return false;
    return freeSlots(z) >= slotsOf(itemId);
  }

  /**
   * Почему в эту зону можно или нельзя — словами игрока, а не текстом
   * валидатора: `mountIssue` пишет по-английски именами зон ядра, и в подсказке
   * такое читалось бы отладочным выводом.
   */
  function zoneHint(itemId: string, z: ZoneId, from: ZoneId | null): string {
    const zone = t(`zone.${z}`);
    if (z === from) return t('mechlab.zoneHere', { zone });
    if (mountIssue(itemId, z) !== null) return t('mechlab.zoneDenied', { zone });
    const free = freeSlots(z);
    const need = slotsOf(itemId);
    if (free < need) return t('mechlab.zoneNoRoom', { zone, free, need });
    return t('mechlab.zoneFree', { zone, free });
  }

  /**
   * ВОССТАНОВИТЬ ЗАВОДСКОЙ ПАСПОРТ: вернуть чертёж к тому, чем машина сошла с
   * конвейера.
   *
   * Дешёвая и частая операция: игрок пробует вариант, он не нравится, и вернуть
   * всё как было можно было только вручную, позицию за позицией. Паспорт лежит
   * в самой записи машины (`record.assembly` до правок) — выдумывать его не надо.
   */
  function resetToStock(): void {
    if (mech === null) return;
    edit({ ...mech.assembly });
  }

  /**
   * ЧЕРНОВИК ПОД РОЛЬ (шаг 40): разложить навеску так, как её разложил бы
   * процедурный генератор под заданную тактику.
   *
   * **Это ЧЕРНОВИК, а не готовая сборка, и обещать большего нельзя.** Генератор
   * собирает из полного каталога, а не из того, что лежит на складе роты, —
   * значит предложить он может и то, чего у игрока нет. Врать про это не нужно:
   * приговор всё равно выносит `refitMech` через `canExecute`, и недостающее
   * железо он назовёт сам, теми же словами, что и всегда. Ценность кнопки в
   * том, что раскладывать полтора десятка позиций по зонам руками не надо —
   * достаточно поправить черновик.
   *
   * Сид взят от машины, а не случайный: одна и та же кнопка на одной и той же
   * машине обязана давать один и тот же черновик, иначе игрок будет жать её,
   * пока не выпадет удачный, — и это уже не инструмент, а лотерея.
   */
  function draftForRole(role: AssemblyRole): void {
    if (mech === null || target === null) return;
    let seed = 0;
    for (const ch of mech.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    edit(generateAssembly({ chassisCode: target.chassisCode, role }, new Rng(seed)));
  }

  /** Очков брони в одной тонне техбазы машины: шаг кнопок — четверть тонны. */
  const armorPerTon = $derived(
    target === null ? 0 : armorPointsPerTon(getChassisCatalogEntry(target.chassisCode).techBase),
  );
  /**
   * Сколько тонн брони влезает шагом 0.25 т, НЕ перелетая потолок корпуса.
   *
   * Округление ВНИЗ до шага — как у генератора сборок (`generateAssembly`).
   * Раньше здесь было округление к ближайшему: потолок 70 очков у Сферы — это
   * 4.375 т, и «+» доводил броню до 4.5 т, то есть до 72 очков — выше потолка и в
   * перевес (плейтест 2026-09-15).
   */
  const armorMaxTons = $derived(
    report === null || armorPerTon === 0 ? 0 : Math.floor((report.maxArmor / armorPerTon) * 4) / 4,
  );
  const overweight = $derived(report !== null && report.totalMass > report.maxMass);
  /** Почему «+» у брони погашен: следующий шаг перелетит потолок или даст перевес. `null` — можно. */
  const armorPlusWhy = $derived(
    report === null || target === null
      ? null
      : target.armorTons + 0.25 > armorMaxTons
        ? t('mechlab.armorCapped', { step: armorPerTon / 4, left: Math.max(0, report.maxArmor - report.totalArmor) })
        : report.totalMass + 0.25 > report.maxMass
          ? t('mechlab.armorNoMass')
          : null,
  );

  function armorBy(delta: number): void {
    if (target === null || report === null) return;
    const next = Math.min(armorMaxTons, Math.max(0, target.armorTons + delta));
    edit({ ...target, armorTons: Math.round(next * 4) / 4 });
  }

  /**
   * ДОКУПИТЬ НЕДОСТАЮЩЕЕ, НЕ УХОДЯ С ЭКРАНА (шаг 40, часть В).
   *
   * **Боль.** Ставя орудие, мехлаб добавляет к нему пачку боезапаса — иначе
   * сборка не пройдёт валидатор. Пачки на складе, как правило, нет, и игрок
   * получал отказ «На складе нет: БК РБД-4» за то, чего сам не выбирал. Дальше
   * его ждал худший обмен в игре: уйти на рынок, купить ящик снарядов за
   * копейки — и вернуться к пустому экрану, потому что черновик живёт только
   * пока на него смотрят.
   *
   * **Почему только снабжение.** Докупается ровно то, что лежит на складе
   * снабжения любой обжитой системы и не кончается (`stock.ts`, `supply`):
   * боезапас и охладители. Ствол одной кнопкой не покупается намеренно — это
   * покупка на десятки тысяч, и делать её мимоходом игрок не должен.
   */
  const missing = $derived.by(() => {
    const lots = campaign.stock;
    return (plan?.missing ?? []).map((m) => ({
      ...m,
      lot: lots.find((l) => l.itemId === m.id && l.supply === true) ?? null,
    }));
  });

  const shortfall = $derived(missing.filter((m) => m.lot !== null));

  /**
   * Чего здесь не купить — и это НЕ молчание, а отдельная строка.
   *
   * Снабжение возят не везде: `supplyItems` не даёт периферии ничего
   * (`market/stock.ts`), а в перелёте лавки нет вовсе. В такой системе кнопка
   * докупки появиться не может, и без объяснения это читалось бы поломкой
   * кнопки, а не свойством мира.
   *
   * Строка ТОЛЬКО про снабжение. Недостающий ствол сюда не попадает: он и не
   * должен покупаться одной кнопкой, и объяснять его отсутствие складом
   * снабжения было бы просто неправдой — про него уже сказано в списке
   * замечаний («купить на рынке или снять с другой машины»).
   */
  const unbuyable = $derived(missing.filter((m) => m.lot === null && isSupplyItem(m.id)));
  const unbuyableText = $derived(
    unbuyable.map((m) => `${itemName(m.id)} × ${m.count}`).join(', '),
  );

  const shortfallCost = $derived(shortfall.reduce((sum, m) => sum + (m.lot?.price ?? 0) * m.count, 0));
  const shortfallText = $derived(
    shortfall.map((m) => `${itemName(m.id)} × ${m.count}`).join(', '),
  );
  /** Почему докупить нельзя — ответом ядра на первую же покупку (касса, лавка, система). */
  const buyWhy = $derived.by(() => {
    const first = shortfall[0]?.lot;
    return first === undefined || first === null
      ? t('mechlab.pickMech')
      : campaign.why({ kind: 'buyPart', lotId: first.id });
  });

  /**
   * Покупка идёт ШТУЧНО и командами, а не одной «выдай мне всё»: позиция
   * снабжения не кончается, поэтому один и тот же лот берётся столько раз,
   * сколько пачек не хватает. Отказ на любой из покупок останавливает всё —
   * дальше всё равно не хватит кассы.
   */
  function buyShortfall(): void {
    for (const m of shortfall) {
      const lot = m.lot;
      if (lot === null) continue;
      for (let n = 0; n < m.count; n++) {
        if (!campaign.run({ kind: 'buyPart', lotId: lot.id })) return;
      }
    }
  }

  /**
   * Почему кнопку нельзя нажать — словами ЯДРА, а не своей проверкой.
   * `canExecute` прогоняет ту же команду на копии состояния, поэтому ответ не
   * может разойтись с настоящим исполнением (`commands/canExecute.ts`).
   */
  const applyWhy = $derived(
    mech === null || target === null
      ? t('mechlab.pickMech')
      : campaign.why({ kind: 'refitMech', recordId: mech.id, assembly: target }),
  );

  function apply(): void {
    if (mech === null || target === null) return;
    if (campaign.run({ kind: 'refitMech', recordId: mech.id, assembly: target })) reset();
  }
</script>

<div class="mechlab">
  <aside class="panel panel-scroll left">
    <div class="panel-header">
      <span>{t('hangar.fleet')}</span>
      <span class="badge badge-cyan">{campaign.aboardCount} / {campaign.mechCapacity}</span>
    </div>
    <FleetPlacePicker {places} {place} />

    <!--
      ПОЛОСА НАД ВЫБОРОМ — силуэт выбранной машины крупно (шаг 48). Просьба
      пользователя: над списком должно быть видно, как робот примерно выглядит,
      а не только его индекс.

      Показывает КЛАСС ШАССИ, а не сборку: при переоборудовании картинка не
      меняется, потому что шасси то же. Кукла зон и вооружение — ниже и рисуются
      кодом (решение 2026-09-01).
    -->
    {#if mech !== null}
      <div class="silhouette-band">
        <MechSilhouette
          chassisCode={mech.assembly.chassisCode}
          name={mech.name}
          paint={paintOfRecord(mech)}
          width={112}
          zoomable
        >
          <!-- Перекраска живёт в окне крупного показа: выбрал машину, открыл портрет, там же и
               перекрасил (решение пользователя 2026-09-13). -->
          {#snippet actions({ onPreview })}
            {#if mech !== null}
              <RepaintPanel {mech} {onPreview} />
            {/if}
          {/snippet}
        </MechSilhouette>
        <span class="band-caption dim tiny">
          <span class="cyan bold">{mech.name}</span>
          <span>{mech.assembly.chassisCode}</span>
          <!-- Каждое поле своей строкой: в колонке шириной ~85 px «Средний · 40 т»
               разрывалось так, что «т» уезжала на следующую строку. -->
          <span>{t(`weightClass.${recordChassisDef(mech).weightClass}`)}</span>
          <span class="gold band-tons">{t('hangar.tons', { tons: recordChassisDef(mech).tons })}</span>
        </span>
      </div>
    {/if}

    <div class="scroll-area list">
      {#if campaign.mechs.length === 0}
        <p class="empty dim">{t('mechlab.noMechs')}</p>
      {/if}
      {#each shownGroups as group (group.number)}
        {#if place === null}<LanceHead {group} />{/if}
        {#each group.mechs as m (m.id)}
          {@const status = mechStatusOf(campaign.state, m)}
          {@const pilot = campaign.pilotOf(m)}
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
            onclick={() => {
              campaign.selectedMechId = m.id;
              reset();
            }}
            title="{m.name} · {t(`hangar.status.${status}`)}"
          >
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

  </aside>

  <main class="panel panel-scroll center">
    {#if mech === null || target === null}
      <div class="panel-body dim">{t('mechlab.pickMech')}</div>
    {:else}
      <div class="panel-header">
        <span class="title">
          <span class="glow-cyan">{mech.name}</span>
          <span class="badge badge-dim">{mech.assembly.chassisCode}</span>
        </span>
        <button class="btn btn-sm" onclick={reset}>{t('mechlab.reset')}</button>
      </div>

      {#if !refittable}
        <p class="warn pad">{wreck ? t('mechlab.wreck') : t('mechlab.notRefittable')}</p>
      {/if}

      <!--
        ВЕРНУТЬ ЗАВОДСКОЙ ПАСПОРТ (шаг 40). Игрок пробует вариант, он не
        нравится — и до этого шага откатить его можно было только вручную,
        позицию за позицией. Паспорт лежит в самой записи машины, выдумывать
        его не надо.
      -->
      <div class="scroll-area zones">
        <!--
          Черновик под роль: раскладывать полтора десятка позиций по зонам руками
          не надо. Приговор всё равно выносит `refitMech` — если чего-то нет на
          складе, он назовёт это сам.

          Сетка, а не два ряда: подписи в своей колонке, кнопки — в своей, и
          перенесённые кнопки встают под кнопками, а не под подписью. Лежит
          внутри прокрутки: уезжает вместе с зонами, а не висит над ними.
          Названия ролей короткие (`roleShort`), чтобы шесть кнопок шли одной строкой.
        -->
        <div class="drafts">
          <span class="draft-label dim tiny">{t('mechlab.stockLabel')}</span>
          <div class="draft-cell">
            <button class="btn btn-sm" title={t('mechlab.resetStockHint')} onclick={resetToStock}>
              {t('mechlab.resetStock')}
            </button>
            <span class="dim tiny">{t('mechlab.resetStockHint')}</span>
          </div>

          <span class="draft-label dim tiny">{t('mechlab.draftRole')}</span>
          <div class="draft-cell">
            {#each ASSEMBLY_ROLES as role (role)}
              <button class="btn btn-sm" title={`${t(`role.${role}`)}. ${t('mechlab.draftRoleHint')}`} onclick={() => draftForRole(role)}>
                {t(`roleShort.${role}`)}
              </button>
            {/each}
          </div>
        </div>

        {#each ZONE_IDS as z (z)}
          <section class="zone-block">
            <div class="sec-title">
              <span>
                {t(`zone.${z}`)}
                {#if blockOf(z as ZoneId) !== null}
                  <span class="warn tiny" title={t(`mechlab.block.${blockOf(z as ZoneId)}`)}>
                    — {t(`mechlab.blockShort.${blockOf(z as ZoneId)}`)}
                  </span>
                {/if}
              </span>
              <span class="dim tiny">
                {t('mechlab.budgetSlots', {
                  used: report?.slotsUsed[z as ZoneId] ?? 0,
                  max: report?.slotsAvailable[z as ZoneId] ?? 0,
                })}
              </span>
            </div>
            {#each byZone.get(z as ZoneId) ?? [] as item (item)}
              {@const at = target.items.indexOf(item)}
              {@const block = blockOf(item.zone)}
              <div class="item-row">
                <ItemIcon itemId={item.id} />
                <span class="item-body" title={itemTitle(item.id)}>
                  <span class="item-name">{itemName(item.id)}</span>
                  {#if item.kind !== 'ammo'}
                    <span class="dim tiny">{itemFacts(item.id)}</span>
                  {/if}
                </span>
                <!--
                  ПЕРЕНОС ОДНИМ НАЖАТИЕМ (шаг 40, часть В). Строка клавиш зон
                  вместо выпадающего списка: годные зоны видны БЕЗ раскрытия, а
                  нажатие сразу переносит. Годность считает не разметка: правила
                  зон спрашиваются у ядра (`mountIssue`), ячейки — из той же
                  сметы, что показана рядом. Невозможного здесь предложить нельзя.
                -->
                <span class="dim tiny" title={t('mechlab.moveHint')}>{t('mechlab.moveTo')}</span>
                <ZonePicker
                  current={item.zone}
                  can={(z) => refittable && z !== item.zone && fitsZone(item.id, z)}
                  hint={(z) => (refittable ? zoneHint(item.id, z, item.zone) : t('mechlab.noMoveDamaged'))}
                  pick={(z) => moveTo(at, z)}
                />
                <button
                  class="btn btn-sm"
                  disabled={block !== null}
                  title={block === null ? undefined : t(`mechlab.block.${block}`)}
                  onclick={() => remove(at)}
                >
                  {t('mechlab.remove')}
                </button>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    {/if}
  </main>

  <!--
    СКЛАД ПЕРЕЕХАЛ К НАРЯДУ (шаг 40, часть В). Полка и наряд цеха — две половины
    одного действия: со склада берут, в наряд это попадает строкой и ценой.
    Держать их у разных краёв экрана значило заставлять взгляд ходить через всю
    ширину на каждую установку.
  -->
  <aside class="right">
    <section class="panel panel-scroll shelf-panel">
      <div class="panel-header">
        <span>{t('mechlab.warehouse')}</span>
        <span class="dim tiny">{t('mechlab.installTo')}</span>
      </div>
      <div class="scroll-area list">
        {#if shelf.length === 0}
          <p class="empty dim tiny">{t('mechlab.warehouseEmpty')}</p>
        {:else}
          <div class="family-tabs">
            {#each familiesHere as f (f)}
              <button class="chip" class:active={family === f} onclick={() => (family = f)}>
                {t(`market.family.${f}`)}
              </button>
            {/each}
          </div>
        {/if}
        {#each shelfStacks as stack (stack.key)}
          {@const entry = stack.head}
          <div class="shelf-row">
            <ItemIcon itemId={entry.itemId} />
            <span class="shelf-body" title={itemTitle(entry.itemId)}>
              <span class="shelf-name">
                {#if stack.count > 1}<span class="stack-count">{t('common.stack', { count: stack.count })}</span>{/if}
                {itemName(entry.itemId)}
              </span>
              <span class="dim tiny">{itemFacts(entry.itemId)}</span>
            </span>
            <!--
              ПОСТАНОВКА ОДНИМ НАЖАТИЕМ. Раньше зона выбиралась ГЛОБАЛЬНЫМ
              селектором внизу полки, и «Поставить» у каждой строки означало
              «поставить туда, что выбрано где-то ещё». Теперь зона — часть
              самого нажатия, и видно, куда эта установка вообще влезает.
            -->
            <span class="pick-row">
              <ZonePicker
                can={(z) => mech !== null && fitsZone(entry.itemId, z)}
                hint={(z) => zoneHint(entry.itemId, z, null)}
                pick={(z) => add(entry.itemId, z)}
              />
            </span>
          </div>
        {/each}
      </div>
    </section>

    <section class="panel panel-scroll plan-panel">
    <div class="panel-header">
      <span>{t('mechlab.plan')}</span>
      <!-- Одна справка на весь наряд: коротко про массу, броню и работу, подробнее
           про тепло (решение пользователя 2026-09-15). -->
      <WikiHelp doc="glossary.md" section="наряд цеха" align="right" />
    </div>
    {#if mech !== null && plan !== null && report !== null && target !== null}
      <div class="scroll-area side">
        <div class="budget">
          <div class="line">
            <!-- Одной обёрткой, как строка тепла: `.line` раскладывает детей по краям
                 (кнопки брони прижаты вправо), и три отдельных куска разъезжались.
                 Перевес — красным только текущая масса. -->
            <span>
              <span class="dim">{t('mechlab.budgetMassLabel')}</span>
              <span
                class:danger={overweight}
                class:dim={!overweight}
                title={overweight
                  ? t('mechlab.massOver', { over: (report.totalMass - report.maxMass).toFixed(2) })
                  : undefined}>{report.totalMass.toFixed(2)}</span>
              <span class="dim">{t('mechlab.budgetMassOf', { max: report.maxMass })}</span>
            </span>
          </div>
          <div class="line">
            <span title={heatTitle}>
              <span class="dim">{t('mechlab.heatLabel')}</span>
              <span class={heatTone}>{t('mechlab.heatAlpha', { alpha: report.heatAlpha })}</span>
              <span class="dim">
                {t('mechlab.heatParts', {
                  reactor: report.heatReactor,
                  sinks: report.heatDissipation - report.heatReactor,
                  reserve: report.heatReserve,
                })}
              </span>
            </span>
          </div>
          <!-- Порог отключения — предел: отвод + запас корпуса (`core/rules/heat.ts`).
               Залп выше предела глушит реактор в этом же ходу, залп в предел — нет. -->
          {#if report.heatAlpha > report.heatLimit}
            <div class="line warn tiny">{t('mechlab.heatHot')}</div>
          {/if}
          <div class="line armor">
            <span class="dim">
              {t('mechlab.armor')}:
              {t('mechlab.armorTons', {
                tons: target.armorTons,
                points: report.totalArmor,
                max: report.maxArmor,
              })}
            </span>
            <span class="armor-buttons">
              <button
                class="btn btn-sm"
                disabled={target.armorTons <= 0}
                onclick={() => armorBy(-0.25)}>−</button>
              <button
                class="btn btn-sm"
                disabled={armorPlusWhy !== null}
                title={armorPlusWhy ?? undefined}
                onclick={() => armorBy(0.25)}>+</button>
            </span>
          </div>
        </div>

        <!--
          Машина на стапеле: наряд уже оплачен, и показывать цену заново значило
          бы звать заплатить второй раз. Вместо наряда — срок и отмена, та же, что
          в ангаре.
        -->
        {#if showingPending && pending !== null}
          {@const cancel = { kind: 'cancelJob', jobId: pending.jobId } as const}
          <div class="in-work">
            <div class="line gold strong">{t('mechlab.inWorkTitle')}</div>
            <div class="line dim tiny">
              {t('mechlab.inWorkHint', { days: daysText(Math.max(0, pending.day - campaign.day)) })}
            </div>
            <button
              class="btn btn-sm wide"
              title={t('hangar.job.cancelHint')}
              disabled={!campaign.can(cancel)}
              onclick={() => campaign.run(cancel)}
            >
              {t('hangar.job.cancel')}
            </button>
          </div>
        {:else}
        <div class="plan">
          {#if plan.removed.length > 0}
            <div class="line">{t('mechlab.planRemoved', { count: plan.removed.length })}</div>
          {/if}
          {#if plan.installed.length > 0}
            <div class="line">{t('mechlab.planInstalled', { count: plan.installed.length })}</div>
          {/if}
          {#if plan.armorAdded > 0}
            <div class="line">{t('mechlab.planArmor', { points: plan.armorAdded })}</div>
          {/if}
          {#if plan.removed.length === 0 && plan.installed.length === 0 && plan.armorAdded === 0}
            <div class="line dim">{t('mechlab.planNothing')}</div>
          {/if}
          <div class="line gold strong">
            {t('mechlab.planCost', { sum: cbills(plan.cost), days: daysText(plan.days) })}
          </div>
        </div>

        {#if plan.issues.length > 0 || plan.blockers.length > 0}
          <div class="issues">
            <div class="sec-title">{t('mechlab.issues')}</div>
            {#each plan.blockers as blocker, i (i)}
              <div class="line warn tiny">{blockerText(blocker)}</div>
            {/each}
            {#if plan.blockers.length > 0}
              <div class="line warn tiny">{t(wreck ? 'mechlab.blocker.wreckAdvice' : 'mechlab.blocker.damagedAdvice')}</div>
            {/if}
            {#each plan.issues as issue, i (i)}
              <div class="line warn tiny">{issueText(issue)}</div>
            {/each}
          </div>
        {/if}

        <!--
          Недостающий боезапас докупается отсюда одной кнопкой: за ним не стоит
          решения игрока, он стоит копейки, а поход на рынок стоил бы черновика.
        -->
        {#if shortfall.length > 0}
          <button
            class="btn btn-gold wide"
            disabled={buyWhy !== null}
            title={buyWhy ?? t('mechlab.buyMissingHint')}
            onclick={buyShortfall}
          >
            {t('mechlab.buyMissing', { what: shortfallText, sum: cbills(shortfallCost) })}
          </button>
        {/if}
        {#if unbuyable.length > 0}
          <p class="line warn tiny">{t('mechlab.buyMissingNone', { what: unbuyableText })}</p>
        {/if}

        <button
          class="btn btn-primary wide"
          disabled={applyWhy !== null}
          title={applyWhy ?? ''}
          onclick={apply}
        >
          {t('mechlab.apply')}
        </button>
        {/if}
      </div>
    {:else}
      <div class="panel-body dim">{t('mechlab.pickMech')}</div>
    {/if}
    </section>
  </aside>
</div>

<style>
  /* Вкладки родов: та же полоса, что на витрине рынка (шаг 40). */
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
  .mechlab {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr) 320px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }

  .left,
  .center,
  .right {
    min-height: 0;
    overflow: hidden;
  }

  /*
   * Правая колонка держит две панели: сверху склад, снизу наряд цеха. Наряду
   * отдано больше места — он растёт замечаниями валидатора, а полка листается.
   */
  .right {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1.25fr);
    gap: 10px;
  }

  .shelf-panel,
  .plan-panel {
    min-height: 0;
    overflow: hidden;
  }

  .list,
  .side,
  .zones {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
  }

  .mech-card {
    display: flex;
    /* Миниатюра слева, текст справа: так силуэт не отнимает вертикали, а
       список из IS-N75-R3F2 и CL-H45-R2F3 становится сканируемым. */
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-align: left;
    width: 100%;
  }
  /* Перетаскивание списка парка: сама карточка тускнеет, цель наведения светится рамкой. */
  .mech-card.dragging {
    opacity: 0.4;
  }
  .mech-card.drag-over {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.08);
  }

  .silhouette-band {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel-sub);
  }

  .band-caption {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    line-height: 1.3;
  }

  .band-tons {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
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

  .small,
  .tiny {
    font-size: 11px;
  }

  /*
   * Колонки, а не «как встанет»: строки зон читаются столбиком, и клавиши зон
   * обязаны стоять друг под другом — иначе взгляд ищет ЛР заново в каждой
   * строке. Ширина отдана названию, остальное прибито к правому краю.
   */
  .item-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 8px;
  }

  /*
   * Строка склада: значок и название сверху, клавиши зон второй строкой. В
   * колонке шириной с наряд шесть клавиш рядом с названием не встают, а
   * переносить их «как выйдет» нельзя — строка выбора обязана читаться цельной.
   */
  .shelf-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 4px 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--color-border);
  }

  .pick-row {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
  }

  .shelf-body,
  .item-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .stack-count {
    color: var(--color-accent);
    font-weight: 600;
    margin-right: 4px;
  }

  .shelf-name,
  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .in-work {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: rgba(227, 179, 65, 0.08);
    border: 1px solid var(--color-gold);
    border-radius: 2px;
  }
  .drafts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 6px;
    align-items: start;
    padding-bottom: 4px;
  }
  .draft-label {
    /* Выравнивание по высоте кнопки: подпись стоит против первого ряда кнопок. */
    padding-top: 5px;
    text-align: right;
  }
  .draft-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  .zone-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sec-title {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .budget,
  .plan,
  .issues {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .armor-buttons {
    display: flex;
    gap: 4px;
  }

  .wide {
    width: 100%;
    margin-top: 8px;
  }

  .pad {
    padding: 8px;
  }

  .empty {
    padding: 6px 0;
  }
</style>
