import { EQUIPMENT, EQUIPMENT_LIST, REPAIR, WEAPONS } from '../../data/index.js';
import { HitZone, ZONE_COUNT, zoneFromId } from '../../model/HitZone.js';
import { buildUnitSlots } from '../../model/MechUnit.js';
import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import {
  recordChassisDef,
  recordQuality,
  recordNodeSpec,
  nodeCost,
  WEAR_NODES,
  type MechRecord,
  type NodeSpec,
  type WearNode,
} from '../mech/index.js';
import { WAREHOUSE_ITEM_KINDS, type WarehouseItemKind } from '../company/types.js';
import { MARKET } from './schema.js';
import { weightClassOf } from '../../rules/construction.js';

/**
 * Цены рынка (шаг 15).
 *
 * Три вещи, которых до этого шага не было вовсе: цена отдельной установки
 * (орудия, теплоотвода, ускорителя, оборудования), цена машины ЦЕЛИКОМ и
 * список того, что уцелело настолько, чтобы попасть на склад после разбора.
 * Узел оценивать было чем (`mech/repair.ts::nodeCost`), машину — нечем.
 *
 * Ни одного зашитого числа: всё из `data/market.json` и `data/repair.json`.
 */

/**
 * Нижняя ступень лестницы качества — то, чем сходит узел с разбитой машины.
 *
 * Берётся из порядка `QUALITY_CLASS_IDS`, а не пишется строкой: порядок этого
 * массива объявлен шкалой «хуже → лучше» и менять его нельзя, поэтому нулевой
 * элемент и есть дно по определению.
 */
const WRECKED_NODE_CLASS: QualityClass = QUALITY_CLASS_IDS[0];

/** Вид складской установки объявлен вместе со складом (`company/types.ts`); здесь только реэкспорт. */
export { WAREHOUSE_ITEM_KINDS, type WarehouseItemKind };

function round(n: number): number {
  return Math.round(n);
}

/**
 * Цена установки по типу и массе.
 *
 * Класс исполнения у отдельных орудий НЕ заводится (решение 8 §7 пайплайна):
 * множителей для него в `classification.md` §5 нет, а выдумать их значило бы
 * выдумать баланс. Поэтому у установки только два состояния — целая и
 * выбитая, — и цена от них не зависит: выбитая просто не попадает ни на склад,
 * ни в оценку машины.
 *
 * Клановое железо дороже в разы: спрос на него в Сфере есть, а снабжения нет
 * (`data/market.json` → `clan.priceFactor`).
 */
export function itemCost(itemId: string): number {
  const per = MARKET.item.perTon;
  const weapon = WEAPONS.get(itemId);
  if (weapon !== undefined) {
    const base = weapon.mass * per[weapon.category];
    return round(Math.max(MARKET.item.minimum, base * (weapon.techBase === 'clan' ? MARKET.clan.priceFactor : 1)));
  }

  const eq = EQUIPMENT.get(itemId);
  if (eq === undefined) throw new RangeError(`Нет такой установки в каталогах: ${itemId}`);
  const perTon = per[eq.category as keyof typeof per];
  if (perTon === undefined) throw new RangeError(`Для категории «${eq.category}» не задана цена в data/market.json`);
  const base = eq.mass * perTon;
  return round(Math.max(MARKET.item.minimum, base * (eq.techBase === 'clan' ? MARKET.clan.priceFactor : 1)));
}

/** Вид установки по её id — из каталогов, а не из сборки: складская запись живёт отдельно от машины. */
export function itemKindOf(itemId: string): WarehouseItemKind {
  if (WEAPONS.has(itemId)) return 'weapon';
  const eq = EQUIPMENT.get(itemId);
  if (eq === undefined) throw new RangeError(`Нет такой установки в каталогах: ${itemId}`);
  if (eq.category === 'heatsink') return 'heatsink';
  if (eq.category === 'jump_jet') return 'jump_jet';
  // Боезапас стал складской записью шагом 32: до него он был исключён из
  // торговли вовсе, и докупить пачку под расширенный боекомплект было негде.
  if (eq.category === 'ammo') return 'ammo';
  return 'equipment';
}

/**
 * РОД УСТАНОВКИ — деление ассортимента, по которому игрок ищет глазами (шаг 40).
 *
 * Не то же, что `WarehouseItemKind`: вид отвечает на вопрос «что это за
 * запись», род — «из какой оно оперы». Все орудия — один вид `weapon`, но
 * ищут их по роду: лазер, автопушка, ракеты. Поэтому родов пять, а не четыре,
 * и энергетическое с баллистическим разведены.
 *
 * Живёт рядом с ценами, а не на экране, потому что делений ассортимента в игре
 * должно быть ровно одно: и витрина рынка, и склад мехлаба фильтруют одним и
 * тем же родом, по которому нарисованы иконки (`ui/components/ItemIcon.svelte`).
 */
export const ITEM_FAMILIES = ['energy', 'ballistic', 'missile', 'gear', 'ammo'] as const;
export type ItemFamily = (typeof ITEM_FAMILIES)[number];

/**
 * ПОЗИЦИЯ ПОСТОЯННОГО СНАБЖЕНИЯ: боезапас и охладители (шаг 32).
 *
 * Такие установки не кончаются и лежат на складе снабжения любой обжитой
 * системы (`stock.ts::supplyItems`); всё остальное — разовые лоты декады.
 * Разница видна игроку: снабжение мехлаб докупает сам одной кнопкой, ствол
 * покупается на витрине руками. Список категорий берётся из `market.json`, а не
 * переписывается по месту, — иначе новая категория снабжения разойдётся с тем,
 * что показывает экран.
 */
export function isSupplyItem(itemId: string): boolean {
  const category = EQUIPMENT.get(itemId)?.category;
  return category !== undefined && (MARKET.stock.supplyCategories as readonly string[]).includes(category);
}

export function itemFamilyOf(itemId: string): ItemFamily {
  const w = WEAPONS.get(itemId);
  if (w !== undefined) return w.category === 'energy' ? 'energy' : w.category === 'ballistic' ? 'ballistic' : 'missile';
  return itemKindOf(itemId) === 'ammo' ? 'ammo' : 'gear';
}

/**
 * Насколько износ съедает цену узла.
 *
 * На пороге деградации (`repair.json` → `wear.threshold`) узел стоит
 * `1 − wearDiscount` от нового. Ниже не падает: изношенный реактор всё ещё
 * реактор, а не металлолом, — за металлолом отвечает класс исполнения.
 */
export function wearFactor(wear: number): number {
  const share = Math.min(1, Math.max(0, wear / REPAIR.wear.threshold));
  return 1 - share * MARKET.sell.wearDiscount;
}

export function nodeValue(spec: NodeSpec, cls: QualityClass, wear: number): number {
  return round(nodeCost(spec, cls) * wearFactor(wear));
}

/**
 * Установка на машине: где стоит, цела ли, сколько стоит.
 *
 * Оружие разобрано ТОЧНО — по `destroyedMounts`, как оно и лежит в записи.
 * Всё остальное разобрано по раскладке ячеек (`buildUnitSlots`), потому что
 * именно ячейки выбивает бой и именно их индексы лежат в `destroyedSlots`.
 * Одно допущение названо прямо: у теплоотвода в раскладке нет id — их
 * единственный источник `def.heatSinks` (число, а не список), — поэтому вид
 * теплоотвода берётся тот, что стоит в сборке, а при отсутствии такового —
 * серийный по техбазе. На цену это не влияет: все теплоотводы каталога весят
 * ровно тонну.
 */
export interface InstalledItem {
  readonly itemId: string;
  readonly kind: WarehouseItemKind;
  readonly zone: HitZone;
  readonly intact: boolean;
}

function defaultHeatSink(record: MechRecord): string {
  const own = record.assembly.items.find((it) => EQUIPMENT.get(it.id)?.category === 'heatsink');
  if (own !== undefined) return own.id;
  const techBase = recordChassisDef(record).techBase;
  const fallback = EQUIPMENT_LIST.find(
    (e) => e.category === 'heatsink' && (e.techBase === techBase || e.techBase === 'both'),
  );
  if (fallback === undefined) throw new Error('В data/equipment.json нет ни одного теплоотвода');
  return fallback.id;
}

export function installedItems(record: MechRecord): readonly InstalledItem[] {
  const def = recordChassisDef(record);
  const { slots } = buildUnitSlots(def);
  const zoneDead = (z: number): boolean => record.condition.zones[z]?.destroyed === true;
  const out: InstalledItem[] = [];

  def.mounts.forEach((mount, m) => {
    const z = zoneFromId(mount.zone);
    out.push({
      itemId: mount.weapon,
      kind: 'weapon',
      zone: z,
      intact: !zoneDead(z) && record.condition.destroyedMounts[m] !== true,
    });
  });

  const sinkId = defaultHeatSink(record);
  for (let z = 0; z < ZONE_COUNT; z++) {
    const dead = new Set(record.condition.destroyedSlots[z] ?? []);
    const zoneSlots = slots[z] ?? [];
    // Установка из нескольких ячеек лежит в раскладке подряд и с одним id:
    // группируем соседние ячейки, чтобы ECM на две ячейки не поехал на склад
    // двумя штуками. Выбитая хоть одной ячейкой — потеряна целиком.
    let i = 0;
    while (i < zoneSlots.length) {
      const slot = zoneSlots[i] as { kind: string; id?: string; destroyed: boolean };
      if (slot.kind !== 'heatsink' && slot.kind !== 'jump_jet' && slot.kind !== 'equipment') {
        i += 1;
        continue;
      }
      // Сколько ячеек занимает ОДНА установка — из каталога, а не «сколько
      // подряд одинаковых»: три прыжковых ускорителя в одной ноге лежат тремя
      // одинаковыми ячейками подряд, и по одинаковости их не различить.
      // Теплоотвод в раскладке всегда одна ячейка (`buildUnitSlots`, п. 4).
      const declared = slot.kind === 'heatsink' ? 1 : Math.max(1, EQUIPMENT.get(slot.id ?? '')?.slots ?? 1);
      let span = 1;
      while (
        span < declared &&
        i + span < zoneSlots.length &&
        (zoneSlots[i + span] as { kind: string; id?: string }).kind === slot.kind &&
        (zoneSlots[i + span] as { kind: string; id?: string }).id === slot.id
      ) {
        span += 1;
      }
      let intact = !zoneDead(z);
      for (let s = i; s < i + span; s++) if (dead.has(s)) intact = false;
      out.push({
        itemId: slot.id ?? sinkId,
        kind: slot.kind === 'heatsink' ? 'heatsink' : slot.kind === 'jump_jet' ? 'jump_jet' : 'equipment',
        zone: z,
        intact,
      });
      i += span;
    }
  }

  return out;
}

/**
 * Цена машины ЦЕЛИКОМ (брифинг шага 15, п. 6).
 *
 * Складывается из трёх слагаемых, и все три считаются по фактическому
 * состоянию записи, а не по паспорту: узлы по классу и износу, целые установки,
 * оставшаяся броня со структурой по ценам ремонта. Выбитое не стоит ничего —
 * ровно поэтому машину выгоднее продать на ходу, чем после боя, и ровно
 * поэтому разбор не может стать станком по печати денег (ловушка 4).
 *
 * Реактор в цену не входит, если разрушен торс: реактор стоит там.
 */
/**
 * Надбавка за класс веса платформы (шаг 34, questions.md п. 20).
 *
 * Оценка машины складывалась из узлов, установок и брони, и надбавки за саму
 * платформу в ней не было вовсе. Из-за этого готовый 85-тонный штурмовик стоял
 * на прилавке за 1 002 132 C-Bills — ровно столько же, во что игроку обходились
 * две-три итерации доводки лёгкого разведчика. Тяжёлая платформа дефицитна сама
 * по себе, и цена обязана это отражать: иначе чинить и настраивать своё нет
 * смысла, проще купить готовый штурмовик.
 *
 * Применяется ТОЛЬКО к цене машины целиком. Реактор на 85 тонн уже дороже
 * реактора на 25 по своей формуле, и вторая надбавка сверху была бы двойным
 * счётом.
 *
 * Ступень — весовой класс машины (шаг 49), а не свои границы по тоннажу.
 */
export function weightPriceFactor(tonnage: number): number {
  return MARKET.weightClass.priceFactor[weightClassOf(tonnage)];
}

export function mechValue(record: MechRecord): number {
  const q = recordQuality(record);
  let sum = 0;

  if (record.condition.zones[HitZone.Torso]?.destroyed !== true) {
    sum += nodeValue(recordNodeSpec(record, 'reactor'), q.reactor, record.wear.reactor);
  }
  sum += nodeValue(recordNodeSpec(record, 'frame'), q.frame, record.wear.frame);

  for (const item of installedItems(record)) {
    if (item.intact) sum += itemCost(item.itemId);
  }

  for (const zone of record.condition.zones) {
    if (zone.destroyed) continue;
    sum += zone.armor * REPAIR.cost.armorPoint + zone.structure * REPAIR.cost.structurePoint;
  }

  // Надбавка идёт ПОСЛЕДНЕЙ, поверх суммы: она о платформе целиком, а не о
  // каком-то из слагаемых. Действует в обе стороны — на покупку и на выкуп
  // трофеев, — иначе трофейный штурмовик стал бы станком по печати денег.
  return round(sum * weightPriceFactor(record.assembly.tonnage));
}

/** Узел, который разбор отдаёт на склад. */
export interface SalvagedNode {
  readonly spec: NodeSpec;
  readonly quality: QualityClass;
  readonly wear: number;
}

export interface Salvage {
  readonly nodes: readonly SalvagedNode[];
  readonly items: readonly { readonly itemId: string; readonly kind: WarehouseItemKind }[];
}

/**
 * Каким узел СХОДИТ с машины — при разборе, при замене на другой, при любом
 * снятии (шаг 45).
 *
 * Правило одно на все случаи, и в нём весь смысл разделения двух осей:
 *
 * > **Тир — это железо, оно переживает машину. Класс — это качество сборки,
 * > и его разбивает попадание.**
 *
 * До шага 45 реактор из разрушенного торса пропадал вовсе, и дорогой узел был
 * ставкой на один бой: игрок платил за R3 армейский миллион, а следующее
 * попадание в торс отменяло покупку целиком. Теперь машина заканчивается, а
 * архитектура — нет: реактор возвращается на склад с тем же тиром и тоннажем,
 * но в нижнем классе и с износом у порога. Класс поднимается стапелем
 * (`UpgradeClass`), тир заново не покупается.
 *
 * Каркас так не роняется: он и раньше переживал любую машину (её силовой набор
 * и есть каркас), а за полевые работы по нему уже наказывает своя лестница —
 * ступень класса и кустарная латка (`company/jobs.ts::attemptReplacePart`).
 */
export function salvagedNode(record: MechRecord, node: WearNode): SalvagedNode {
  const spec = recordNodeSpec(record, node);
  const wrecked =
    node === 'reactor' && record.condition.zones[HitZone.Torso]?.destroyed === true;
  return wrecked
    ? { spec, quality: WRECKED_NODE_CLASS, wear: MARKET.scrap.wreckedNodeWear }
    : { spec, quality: recordQuality(record)[node], wear: record.wear[node] };
}

/**
 * Что остаётся от машины после разбора (брифинг шага 15, п. 7).
 *
 * Отдаёт ВСЁ уцелевшее: реактор, каркас, целые орудия, теплоотводы, прыжковые
 * ускорители, оборудование. Теряется выбитое в бою и всё, что стояло в
 * разрушенной зоне, — считать заново нечего, состояние уже лежит в записи.
 *
 * Оба узла отдаются ВСЕГДА (шаг 45): реактор из разрушенного торса приходит
 * хламом, но приходит — правило одно с любым другим снятием, см. `salvagedNode`.
 *
 * Броня и боезапас не отдаются вовсе, и это правило, а не упущение (ловушка 5):
 * они расходник работы ремонта (`repairPlan`, работы `armor` и `ammo`), а не
 * складская запись. Иначе в игре заводится «продать три очка брони», и склад
 * распухает записями, которые никому не нужны.
 */
export function scrapSalvage(record: MechRecord): Salvage {
  const nodes: SalvagedNode[] = WEAR_NODES.map((node) => salvagedNode(record, node));

  const items = installedItems(record)
    .filter((it) => it.intact)
    .map((it) => ({ itemId: it.itemId, kind: it.kind }));

  return { nodes, items };
}

/** Работа разбора: деньги и срок, как у любой другой работы стапеля (правило шага 13). */
export function scrapPlan(record: MechRecord): { readonly cost: number; readonly days: number } {
  const tons = recordChassisDef(record).tons;
  return {
    cost: round(MARKET.scrap.baseCost + tons * MARKET.scrap.costPerTon),
    days: Math.round((MARKET.scrap.daysBase + tons * MARKET.scrap.daysPerTon) * 2) / 2,
  };
}

/** Установка узла со склада: платится только работа цеха — сам узел уже куплен. */
export function installPlan(
  spec: NodeSpec,
  cls: QualityClass,
): { readonly cost: number; readonly days: number } {
  return { cost: round(nodeCost(spec, cls) * MARKET.install.labourShare), days: MARKET.install.days };
}

export type { NodeSpec, WearNode };
