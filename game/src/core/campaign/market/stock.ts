import { EQUIPMENT_LIST, WEAPON_LIST } from '../../data/index.js';
import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import { Rng } from '../../rng/index.js';
import { GALAXY, FACTIONS } from '../galaxy/catalog.js';
import { systemProfile } from '../galaxy/profile.js';
import { MARKET_CLASSES, type MarketClass } from '../galaxy/schema.js';
import type { WearNode } from '../mech/index.js';
import { itemCost, itemKindOf, type WarehouseItemKind } from './pricing.js';
import { marketFactor } from '../reputation/access.js';
import { MARKET } from './schema.js';
import type { RealmMarket } from '../war/buildings.js';

/**
 * Ассортимент лавки (шаг 15).
 *
 * **Не хранится.** Выводится из `(worldSeed, systemId, декада)` чистой функцией,
 * ровно как профиль системы выводится из `(worldSeed, systemId)`
 * (`galaxy/profile.ts`, решение 4 §2 пайплайна). В сохранении лежит только факт
 * покупки — иначе размер снимка рос бы с числом посещённых систем (ловушка 1
 * брифинга).
 *
 * **Декада считается от дня кампании, а не от числа заходов на экран**
 * (ловушка 2): иначе «перезаход» становится способом переиграть неудачный
 * ассортимент. Броски идут из СВОЕГО ГПСЧ, выведенного из сида мира, а НЕ из
 * потока `camp.market` состояния: поток продвигался бы от каждого взгляда на
 * прилавок, и одна и та же лавка выглядела бы по-разному в зависимости от того,
 * сколько раз игрок на неё посмотрел.
 */

/** Номер декады по дню кампании. Первая декада — 0. */
export function decadeOf(day: number): number {
  return Math.floor(day / MARKET.decadeDays);
}

/** Первый день декады: срок, до которого ассортимент не меняется. */
export function decadeStart(decade: number): number {
  return decade * MARKET.decadeDays;
}

/**
 * Сид лавки: имя системы, декада и сид мира.
 *
 * Экспортирован шагом 19a: прилавок машин (`market/mechs.ts`) выводится СВОИМ
 * броском с солью `mechs`, а не дописывается в цикл узлов — порядок бросков там
 * зафиксирован, и вклинивание в него сделало бы другим весь ассортимент всех
 * лавок на старых сохранениях.
 *
 * Замешивается id системы, а не её индекс в каталоге, — по той же причине, что
 * и в `galaxy/profile.ts`: индекс сдвинется при первом пополнении каталога, а
 * id переживает перегенерацию.
 */
export function marketSeed(worldSeed: number, systemId: string, decade: number, salt: string): number {
  let h = (worldSeed >>> 0) ^ 0x27d4eb2f;
  const text = `${systemId}|${decade}|${salt}`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// --- пулы, из которых лавка собирает позиции ----------------------------------

/** Установки на продажу. Боезапас исключён: он расходник ремонта, а не складская запись (ловушка 5). */
function itemPool(techBase: 'is' | 'clan'): readonly string[] {
  const weapons = WEAPON_LIST.filter((w) => w.techBase === techBase).map((w) => w.id);
  const equipment = EQUIPMENT_LIST.filter(
    (e) => e.category !== 'ammo' && (e.techBase === techBase || (techBase === 'is' && e.techBase === 'both')),
  ).map((e) => e.id);
  return [...weapons, ...equipment];
}

const IS_ITEMS = itemPool('is');
const CLAN_ITEMS = itemPool('clan');

// --- профиль рынка системы ----------------------------------------------------

/**
 * Что система представляет собой как рынок.
 *
 * Не зависит от декады и от разведки: класс рынка виден всегда (решение
 * пользователя 2026-09-01, `wiki/decisions.md`). Ровно поэтому маршрут «за
 * армейским реактором в столицу» можно проложить, ни разу не заплатив за
 * `Survey`, — и перелёт остаётся решением, а не лотереей.
 */
export interface MarketProfile {
  readonly systemId: string;
  readonly marketClass: MarketClass;
  /** Множитель цены покупки: наценка за глушь (`planets.md` §4). */
  readonly priceFactor: number;
  /** Множитель цены выкупа: на захолустье просто нет денег. */
  readonly sellFactor: number;
  /** Классы исполнения, которые тут бывают в продаже вообще. Пустых не бывает: восстановленный есть везде. */
  readonly classes: readonly QualityClass[];
  /** Сколько позиций держит лавка за декаду. */
  readonly lots: number;
  /** Срок доставки заказа. 0 — заказать отсюда нельзя (периферия). */
  readonly orderDays: number;
  readonly orderFactor: number;
  /** Вероятность, что позиция окажется клановой. */
  readonly clanChance: number;
  readonly mechFactory: boolean;
  readonly blackMarket: boolean;
  /** Завод машин роты на мире (шаг 87): машины лавки по цене × `buildings.factoryMechPrice`. */
  readonly realmFactory: boolean;
}

function qualityWeights(marketClass: MarketClass, factory: boolean, black: boolean): Record<QualityClass, number> {
  const base = MARKET.classes[marketClass].quality;
  const out = { ...base } as Record<QualityClass, number>;
  for (const cls of QUALITY_CLASS_IDS) {
    if (factory) out[cls] += MARKET.flags.mechFactory.quality[cls];
    if (black) out[cls] += MARKET.flags.blackMarket.quality[cls];
  }
  return out;
}

/**
 * Профиль лавки.
 *
 * `standing` (шаг 20) — отношение владельца системы к отряду. Складывается
 * прямо в `priceFactor`, а не отдельным множителем у каждой цены, и это
 * решение: так репутация разом действует на узлы, установки, машины целиком и
 * заказ с доставкой, и ни одна будущая цена не сможет забыть её учесть.
 * Умолчание — ноль, то есть множитель ровно единица: рынок без репутации
 * остаётся ровно тем, каким его выставил шаг 15.
 *
 * `development` (шаг 23) — насколько мир отстроен сверх канона или сведён ниже
 * него (`galaxy/delta.ts`). Отдельным числом, а не картой дельт: рынок читают
 * места, у которых дельт под рукой нет (замер каталога, тесты), а класс рынка
 * — единственное, что развитие здесь меняет. Ноль даёт ровно тот рынок, каким
 * его выставил шаг 15.
 */
export function marketProfile(
  worldSeed: number,
  systemId: string,
  standing = 0,
  development = 0,
  realm: RealmMarket | undefined = undefined,
): MarketProfile {
  const i = GALAXY.require(systemId);
  const natural = systemProfile(worldSeed, i, development, { developMax: realm?.developMax ?? 0, portSteps: 0 }).marketClass;
  // Космопорт роты (шаг 87) — ступенью выше по лестнице классов, только в лавке: профиль мира читают пиратский
  // риск и основание соперников, и постройка роты их не трогает.
  const marketClass = realm?.classUp === true ? MARKET_CLASSES[Math.max(0, MARKET_CLASSES.indexOf(natural) - 1)]! : natural;
  const row = MARKET.classes[marketClass];
  // Завод роты (шаг 87) — тем же признаком, что завод по канону: лоты и классы исполнения лавки.
  const factory = GALAXY.hasFlag(i, 'mechFactory') || realm?.factory === true;
  const black = GALAXY.hasFlag(i, 'blackMarket');

  const weights = qualityWeights(marketClass, factory, black);
  const clanOwned = FACTIONS.get(GALAXY.ownerId(i))?.kind === 'clan';

  return {
    systemId: GALAXY.id(i),
    marketClass,
    priceFactor:
      row.priceFactor *
      (factory ? MARKET.flags.mechFactory.priceFactor : 1) *
      (black ? MARKET.flags.blackMarket.priceFactor : 1) *
      marketFactor(standing),
    sellFactor: row.sellFactor,
    classes: QUALITY_CLASS_IDS.filter((cls) => weights[cls] > 0),
    lots:
      row.lots + (factory ? MARKET.flags.mechFactory.lots : 0) + (black ? MARKET.flags.blackMarket.lots : 0),
    orderDays: row.orderDays,
    orderFactor: row.orderFactor,
    clanChance: Math.min(
      1,
      MARKET.clan.chanceByClass[marketClass] +
        (clanOwned ? MARKET.clan.clanOwnerBonus : 0) +
        (black ? MARKET.clan.blackMarketBonus : 0),
    ),
    mechFactory: factory,
    blackMarket: black,
    realmFactory: realm?.factory === true,
  };
}

/** Продаётся ли тут этот класс исполнения вообще. Ровно это запирает лестницу классов на периферии. */
export function sellsClass(profile: MarketProfile, cls: QualityClass): boolean {
  return profile.classes.includes(cls);
}

// --- ассортимент --------------------------------------------------------------

/**
 * Позиция на прилавке: только установки (орудия, теплоотводы, ускорители,
 * оборудование). Реакторы и каркасы на прилавок не выставляются — их заказывают
 * из ангара по спецификации машины (`orderPart`), а лежащие на складе продаются
 * скупщику.
 */
export interface StockLot {
  readonly id: string;
  readonly itemId: string;
  readonly kind: WarehouseItemKind;
  readonly price: number;
  /**
   * Позиция постоянного снабжения (шаг 32): охладители и боезапас.
   *
   * Отличается от обычного лота двумя свойствами: не занимает случайную
   * позицию декады и НЕ КОНЧАЕТСЯ — купить можно сколько угодно раз. Это и
   * есть разница между «нашёл на прилавке» и «взял со склада снабжения»,
   * которой в игре не было: теплообменник и ящик снарядов лежат в любой
   * мастерской, а игра выдавала их как редкую находку.
   */
  readonly supply?: boolean;
}

/**
 * Ассортимент лавки на указанный день.
 *
 * Порядок бросков зафиксирован: любой новый бросок дописывается В КОНЕЦ тела
 * цикла, иначе весь ассортимент всех лавок на старых сохранениях станет другим
 * при неизменных данных. То же правило, что у `systemProfile`.
 *
 * Узлов на прилавке нет (решение пользователя 2026-09-20): их доля в позициях
 * была 35 %, и почти всё выставленное либо «Восстановленное», либо не по
 * тоннажу ни одной машине роты. Освободившиеся позиции заняли установки, число
 * позиций лавки прежнее (`market.json → classes[*].lots`). Ассортимент
 * выводится, а не хранится, поэтому старые сохранения читаются: в них лежит
 * только список купленных id за декаду, и у уже начатой декады он может
 * указать на другую позицию — на одну декаду, без потери денег.
 */
export function marketStock(
  worldSeed: number,
  systemId: string,
  day: number,
  standing = 0,
  development = 0,
  realm: RealmMarket | undefined = undefined,
): readonly StockLot[] {
  const profile = marketProfile(worldSeed, systemId, standing, development, realm);
  const decade = decadeOf(day);
  const rng = new Rng(marketSeed(worldSeed, profile.systemId, decade, 'stock'));

  const lots: StockLot[] = [];
  for (let n = 0; n < profile.lots; n++) {
    const clan = rng.next() < profile.clanChance;
    const pool = clan ? CLAN_ITEMS : IS_ITEMS;
    const itemId = rng.pick(pool.length === 0 ? IS_ITEMS : pool);
    lots.push({
      id: `L${decade}-${n}`,
      itemId,
      kind: itemKindOf(itemId),
      price: Math.round(itemCost(itemId) * profile.priceFactor),
    });
  }

  // Постоянное снабжение дописывается ПОСЛЕ цикла и без единого броска: порядок
  // бросков в цикле зафиксирован (см. докстринг), и вклиниваться в него значило
  // бы перетасовать ассортимент всех лавок на всех старых сохранениях.
  for (const itemId of supplyItems(profile)) {
    lots.push({
      id: `SUP-${itemId}`,
      itemId,
      kind: itemKindOf(itemId),
      price: Math.round(itemCost(itemId) * profile.priceFactor),
      supply: true,
    });
  }

  return lots;
}

/**
 * Что лежит на складе снабжения этой системы.
 *
 * Периферия исключена намеренно: там нет ни мастерских, ни линий снабжения, и
 * бесконечный запас теплообменников на захолустье отменил бы весь смысл
 * маршрута «за снабжением в обжитые миры». Клановые позиции продаются только
 * там, где вообще бывает клановая техника.
 */
function supplyItems(profile: MarketProfile): readonly string[] {
  if (profile.marketClass === 'periphery') return [];
  const categories = new Set(MARKET.stock.supplyCategories);
  return EQUIPMENT_LIST.filter((e) => {
    if (!categories.has(e.category)) return false;
    if (e.techBase === 'clan') return profile.clanChance > 0;
    return true;
  }).map((e) => e.id);
}

/**
 * Ассортимент за вычетом уже скупленного.
 *
 * `bought` действителен только для своей декады: список из прошлой декады не
 * вычёркивает ничего, потому что и лоты там были другие.
 */
export function availableStock(
  worldSeed: number,
  systemId: string,
  day: number,
  bought: readonly string[] = [],
  standing = 0,
  development = 0,
  realm: RealmMarket | undefined = undefined,
): readonly StockLot[] {
  const taken = new Set(bought);
  // Снабжение не кончается: купленная пачка снарядов не убирает пачки снарядов
  // со склада мастерской (шаг 32).
  return marketStock(worldSeed, systemId, day, standing, development, realm).filter(
    (lot) => lot.supply === true || !taken.has(lot.id),
  );
}

// --- цена выкупа --------------------------------------------------------------

/**
 * Что скупщик готов взять охотнее обычного. Выводится, а не бросается из
 * состояния. `mech` — машина целиком: у неё свой спрос, не сводимый к спросу на
 * реакторы.
 */
export type DemandKey = WearNode | WarehouseItemKind | 'mech';

/**
 * «Нужен ли этот тип на этом рынке» (брифинг шага 15, п. 5).
 *
 * Выводится из `(сид мира, система, декада, вид)` — той же чистой функцией, что
 * и весь остальной рынок. Меняется вместе с ассортиментом, раз в декаду: рынок
 * живёт, но не мерцает от каждого захода.
 */
export function demandFactor(
  worldSeed: number,
  systemId: string,
  day: number,
  key: DemandKey,
): number {
  const rng = new Rng(marketSeed(worldSeed, systemId, decadeOf(day), `demand:${key}`));
  const roll = rng.next();
  const d = MARKET.sell.demand;
  if (roll < d.lowShare) return d.low;
  if (roll >= 1 - d.highShare) return d.high;
  return 1;
}

/**
 * Сколько заплатит скупщик.
 *
 * Спред — ПРАВИЛО (ловушка 3): продажа заметно ниже покупки, иначе возка узлов
 * между системами становится бесконечным доходом. Поверх спреда — класс
 * системы (на захолустье просто нет денег) и спрос на этот вид.
 */
export function sellPrice(
  value: number,
  profile: MarketProfile,
  worldSeed: number,
  day: number,
  key: DemandKey,
): number {
  return Math.round(
    value * MARKET.sell.spread * profile.sellFactor * demandFactor(worldSeed, profile.systemId, day, key),
  );
}

/** Цена заказа с доставкой: дороже покупки на месте и приходит не сразу. */
export function orderPrice(value: number, profile: MarketProfile): number {
  return Math.round(value * profile.priceFactor * profile.orderFactor);
}
