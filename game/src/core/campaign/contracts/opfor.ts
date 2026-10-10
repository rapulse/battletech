import { CHASSIS_CATALOG_LIST, NAMES } from '../../data/tables.js';
import { QUALITY_CLASS_IDS, type MechQuality, type QualityClass } from '../../model/QualityClass.js';
import { Rng } from '../../rng/index.js';
import {
  ASSEMBLY_ROLES,
  ForceFamilies,
  generateAssembly,
  roleWeightsFor,
  type AssemblyRole,
} from '../../rules/construction.js';
import { makePilot } from '../../rules/skills.js';
import { makeRecord, recordChassisDef, type MechRecord } from '../mech/MechRecord.js';
import { stripOutfit } from '../mech/outfit.js';
import type { BattleParticipant } from '../bridge/toBattle.js';
import type { Contract } from './board.js';
import { actualForce, ambushCount } from './intel.js';
import { CONTRACTS, type OpforType } from './schema.js';
import { supplyOutfit } from './supply.js';

/**
 * Состав противника по контракту (шаг 16, брифинг п. 2).
 *
 * Две таблицы и ни одного нового боевого правила:
 *
 * 1. **Тип отряда → классы исполнения.** «Снаряжение отрядов» из
 *    `wiki/design/campaign/global-layer.md`: периферийная банда выходит на
 *    восстановленном хламе, гвардия — на армейском и мастерском. Отсюда и
 *    читаемая до боя сложность, и разная ценность трофеев: с гвардейской машины
 *    снимается реактор, который сам по себе стоит дороже иного робота.
 * 2. **Тип отряда → комплектность** (шаг 16a). Класс исполнения отвечает только
 *    за реактор и каркас, и до этого шага периферийная банда выходила с полным
 *    паспортным вооружением и полной бронёй — отличаясь от гвардии одним лишь
 *    качеством узлов. Теперь у ополчения не хватает и брони, и стволов
 *    (`mech/outfit.ts`), а у гвардии и кланов комплект полный: им есть чем
 *    снабжаться. Это то самое обещание из `global-layer.md` — «броня не везде
 *    целая», — которого класс исполнения в одиночку не выполнял.
 * 3. **Биом → предпочтения по вооружению** (шаг 71). Выражены ВЕСАМИ РОЛЕЙ
 *    (`construction.json` → `roles.weightByBiome`), а не второй таблицей
 *    оружия: роль уже решает, что генератор сборки поставит на машину. До
 *    шага 71 здесь были доктрины Домов (Курита — кулаком, Марик — ракетами);
 *    они не зависели от поля боя и сняты решением пользователя.
 *
 * Состав считается ЗДЕСЬ, а не при генерации биржи, и это ловушка 2 брифинга,
 * решённая честно: «у контракта должна быть оценка силы, сопоставимая с силой
 * отряда». Абсолютный состав, зафиксированный за декаду до вылета, ничего не
 * знал бы о том, чем рота располагает сегодня.
 */

function weightedQuality(rng: Rng, weights: Readonly<Record<QualityClass, number>>): QualityClass {
  let total = 0;
  for (const cls of QUALITY_CLASS_IDS) total += weights[cls];
  let roll = rng.next() * total;
  for (const cls of QUALITY_CLASS_IDS) {
    roll -= weights[cls];
    if (roll <= 0) return cls;
  }
  return QUALITY_CLASS_IDS[QUALITY_CLASS_IDS.length - 1] as QualityClass;
}

function weightedRole(rng: Rng, weights: Readonly<Record<AssemblyRole, number>>): AssemblyRole {
  let total = 0;
  for (const role of ASSEMBLY_ROLES) total += weights[role];
  if (total <= 0) return rng.pick(ASSEMBLY_ROLES);
  let roll = rng.next() * total;
  for (const role of ASSEMBLY_ROLES) {
    roll -= weights[role];
    if (roll <= 0) return role;
  }
  return ASSEMBLY_ROLES[ASSEMBLY_ROLES.length - 1] as AssemblyRole;
}

/**
 * Машины противника на этот вылет.
 *
 * `seed` — сид вылета (`sortie.battleSeed`): он лежит в состоянии кампании,
 * поэтому состав, собранный при выходе на контракт, тот же самый, что будет
 * собран при разборе того же боя, — и это не удача, а условие того, чтобы
 * `ResolveContract` вообще мог сойтись с боем.
 */
/**
 * Заказ на состав: сколько машин, чьих, какого типа части, под каким потолком
 * тоннажа и на каком биоме.
 *
 * Заведён шагом 22c, когда фронт перестал разыгрывать бои броском кубика.
 * Раньше состав собирался ровно в одном месте и ровно на один вылет звена;
 * теперь тем же кодом собирается и гарнизон мира, и наступающий батальон, и
 * полк наёмников. Разные размеры — это ЧИСЛО в заказе, а не второй сборщик:
 * заведись он, и снаряжение армии разошлось бы со снаряжением взвода молча.
 */
export interface ForceOrder {
  /** Сколько машин вывести. */
  readonly count: number;
  /** Чья часть: происхождение машин (цвета трофея). */
  readonly factionId: string;
  /**
   * Биом поля боя (шаг 71): множитель весов ролей его группы
   * (`construction.json → roles.weightByBiome`). Не задан — только вес класса.
   */
  readonly biome?: string;
  /** Тип части (`data/contracts.json` → `opfor.types`): класс исполнения и выучка. */
  readonly opforType: OpforType;
  readonly techBase: 'is' | 'clan';
  /** Снабжение, 0..~1.6 — комплектность брони и стволов (шаг 21a). */
  readonly supply: number;
  /** Потолок тоннажа корпуса. */
  readonly tonnageCap: number;
  /**
   * Нижняя граница тоннажа корпуса (шаг 44, план Б). Не задана — ноль, то есть
   * пул от самой лёгкой машины каталога, как было до шага.
   *
   * Нужна там, где вес состава сам по себе является обещанием: гвардия с
   * потолком 85 т, набранная от двадцати тонн, ничем не отличалась бы от
   * ополчения, кроме класса узлов.
   */
  readonly tonnageMin?: number;
  /** Префикс id машин: он размечает сторону в бою и обязан быть уникальным. */
  readonly idPrefix: string;
  /** Как звать пилотов в журнале. */
  readonly callsign?: string;
}

type CatalogEntry = (typeof CHASSIS_CATALOG_LIST)[number];

const POOLS = new Map<string, readonly CatalogEntry[]>();

/**
 * Шасси, из которых `buildForce` равновероятно выбирает корпус, по полосе
 * тоннажа и техбазе.
 *
 * Вынесено ради оценки до боя (`threat.ts::opforTonsAverage`): она обязана
 * считать средний вес по ЭТОМУ ЖЕ набору. Середина полосы на бумаге с ним
 * расходится: каталог начинается с 20 т и идёт шагом 5 т, поэтому «до 20 т»
 * оценивалось машинами по 15.5 т, а выходили двадцатитонные.
 */
export function forcePool(cap: number, floor: number, techBase: 'is' | 'clan'): readonly CatalogEntry[] {
  const key = `${cap}|${floor}|${techBase}`;
  const hit = POOLS.get(key);
  if (hit !== undefined) return hit;
  const inBand = (c: { tonnage: number }): boolean => c.tonnage <= cap && c.tonnage >= floor;
  const pool = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === techBase && inBand(c));
  // Клановых шасси лёгкого тоннажа в каталоге может не оказаться под потолком
  // звена — тогда противник выходит на сферных корпусах, а не срывает контракт
  // исключением. Клановость при этом не теряется: класс исполнения у такой
  // части всё равно армейский и выше. Второй запасной шаг — снять нижнюю
  // границу: полоса тоннажа это предпочтение, а не условие существования части.
  const byBand = pool.length > 0 ? pool : CHASSIS_CATALOG_LIST.filter(inBand);
  const out = byBand.length > 0 ? byBand : CHASSIS_CATALOG_LIST.filter((c) => c.tonnage <= cap);
  POOLS.set(key, out);
  return out;
}

/** Средний тоннаж корпуса, который выйдет из `forcePool`: выбор равновероятный. */
export function forceTonsAverage(cap: number, floor: number, techBase: 'is' | 'clan'): number {
  const pool = forcePool(cap, floor, techBase);
  return pool.reduce((sum, c) => sum + c.tonnage, 0) / pool.length;
}

/**
 * Состав по заказу — ЕДИНСТВЕННЫЙ сборщик боевых сил в кампании.
 *
 * Четыре машины гарнизонного контракта и сто восемь машин полка собираются
 * здесь одинаково: тип части даёт класс исполнения и выучку, класс машины и
 * биом — роли, снабжение — комплектность. Ни одной ветки «а если это армия».
 */
export function buildForce(order: ForceOrder, seed: number): BattleParticipant[] {
  const rng = new Rng(seed);
  const type = CONTRACTS.opfor.types[order.opforType];
  // Семейства вооружения по биому и специалисты звена (шаг 71b).
  const families = new ForceFamilies(order.count, order.techBase, order.biome);
  const chassisPool = forcePool(order.tonnageCap, order.tonnageMin ?? 0, order.techBase);

  const out: BattleParticipant[] = [];
  for (let n = 0; n < order.count; n++) {
    const entry = rng.pick(chassisPool);
    const quality: MechQuality = {
      reactor: weightedQuality(rng, type.quality),
      frame: weightedQuality(rng, type.quality),
    };
    // Роль — по весу класса (шаг 47; доктрины Домов сняты шагом 71). Точка
    // применения ОДНА: `roleWeightsFor` тут и `pickWeightedRole` внутри
    // генератора, когда роль не задана вовсе. С семейством роль решает только
    // прыжковые двигатели и приборы, оружие — семейство по биому (шаг 71b).
    const role = weightedRole(rng, roleWeightsFor(entry.tonnage));
    const family = families.next(entry.tonnage, rng);

    const full = generateAssembly(
      { chassisCode: entry.code, role, quality, ...(family !== undefined ? { family } : {}) },
      rng,
    );
    // Комплектность правится снабжением (шаг 21a): у бедной линии не хватает и
    // брони, и стволов, у богатой комплект полный. Класс исполнения при этом
    // остаётся от типа части — экономика двигает часть по лестнице типов
    // (`supply.ts::opforTypeOf`), а не подменяет её реактор задним числом.
    const assembly = stripOutfit(full, supplyOutfit(type.outfit, order.supply), rng);
    const id = `${order.idPrefix}-${n + 1}`;
    out.push({
      // Происхождение едет с записью дальше: трофей собирается из неё же
      // (`unitToRecord` переносит поля), и снятая с поля машина остаётся в цветах
      // того, у кого её взяли.
      record: makeRecord({ id, name: assembly.name, assembly, originFaction: order.factionId }),
      pilot: makePilot(rng, {
        id: `${id}-пилот`, // i18n-ignore: id записан в сохранения, игрок его не видит
        callsign: `${order.callsign ?? NAMES.defaults.opforCallsign}-${n + 1}`,
        tier: rng.int(type.pilotTierMin, type.pilotTierMax),
      }),
    });
  }
  return out;
}

/**
 * Состав противника по контракту.
 *
 * Звено сюда больше не входит (шаг 44, план Б): и число машин, и полоса их
 * тоннажа записаны в предложении, а состав лишь материализуется по ним. Проверка
 * на пустое звено остаётся — выводить на контракт нечего, и это ошибка вызова,
 * а не боевая ситуация.
 */
export function buildOpfor(
  contract: Contract,
  lance: readonly MechRecord[],
  seed: number,
): BattleParticipant[] {
  if (lance.length === 0) throw new RangeError('Состав противника нельзя собрать против пустого звена');

  // ФАКТ, А НЕ СВОДКА (шаг 57): на поле выходит то, что вышло, а не то, что
  // обещал наниматель. Разброс считается от сида ВЫЛЕТА, который лежит в
  // сохранении, — поэтому разбор боя, пересобирающий этот же брифинг, получает
  // тот же состав.
  const actual = actualForce(contract, seed);
  const floor = CONTRACTS.opfor.tons.floor;
  const force = buildForce(
    {
      count: actual.units,
      factionId: contract.target,
      biome: contract.biome,
      opforType: contract.opforType,
      techBase: contract.opforTechBase,
      supply: contract.supply,
      tonnageCap: actual.tonnageCap,
      tonnageMin: actual.tonnageCap * floor,
      idPrefix: `E-${seed}`,
    },
    seed,
  );
  // Засада (шаг 73a) — последние машины состава: те, кого сводка не насчитала.
  const ambush = ambushCount(contract, seed);
  if (ambush === 0) return force;
  return force.map((p, i) => (i >= force.length - ambush ? { ...p, ambush: true } : p));
}

/** Свой сид звена нанимателя: состав противника от него не сдвигается. */
const ALLIES_SEED = 0x2c1b_3c6d;

/**
 * Звено нанимателя по контракту (шаг 73b); пусто, если его нет.
 *
 * Сводка нанимателя о СВОИХ машинах точна: разброса разведки здесь нет, выходит
 * ровно объявленное число в той же полосе тоннажа, что и противник. Собирается
 * тем же `buildForce` на том же биоме — тип части, техбаза и снабжение нанимателя.
 */
export function buildAllies(contract: Contract, seed: number): BattleParticipant[] {
  const a = contract.allies;
  if (a === undefined) return [];
  const s = (seed ^ ALLIES_SEED) >>> 0;
  return buildForce(
    {
      count: a.units,
      factionId: contract.employer,
      biome: contract.biome,
      opforType: a.opforType,
      techBase: a.techBase,
      supply: a.supply,
      tonnageCap: contract.opforTons,
      tonnageMin: contract.opforTons * CONTRACTS.opfor.tons.floor,
      idPrefix: `A-${seed}`,
    },
    s,
  );
}

/** Суммарный тоннаж состава — грубая мера силы, которой хватает боту для решения «браться или нет». */
export function opforTonnage(participants: readonly BattleParticipant[]): number {
  return participants.reduce((sum, p) => sum + recordChassisDef(p.record).tons, 0);
}
