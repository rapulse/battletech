import { CHASSIS_CATALOG_LIST } from '../../data/index.js';
import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import { Rng } from '../../rng/index.js';
import { ASSEMBLY_ROLES, generateAssembly, type MechAssembly } from '../../rules/construction.js';
import { makeRecord, type MechRecord } from '../mech/MechRecord.js';
import { stripOutfit, type OutfitSpec } from '../mech/outfit.js';
import { mechValue } from './pricing.js';
import { MARKET } from './schema.js';
import type { RealmMarket } from '../war/buildings.js';
import { WAR } from '../war/schema.js';
import { decadeOf, marketProfile, marketSeed, type MarketProfile } from './stock.js';

/**
 * Машины на прилавке (шаг 19a).
 *
 * **Зачем это вообще.** Пробел назван ещё шагом 15 и подтверждён замером шага
 * 16: деньгам роты некуда деться, кроме класса исполнения узлов, — отсюда
 * `supply_share` в половину дохода и мастерский класс у трети кампаний за
 * первый год (`часть2-pipeline.md` §6). Покупка целой машины — второй сток
 * денег и единственный способ нарастить парк иначе, чем трофеями.
 *
 * **Устроено как остальной рынок и по тем же правилам.** Ассортимент не
 * хранится: он выводится из `(сид мира, система, декада)` чистой функцией
 * (`stock.ts`, решение 4 §2 пайплайна), в сохранении лежит только факт покупки.
 * Класс системы решает, сколько машин стоит на прилавке и какого они класса
 * исполнения; завод боевых машин добавляет к обоим.
 *
 * **Свой бросок, а не дописка в цикл узлов.** Лоты машин выводятся отдельным
 * ГПСЧ с солью `mechs`. Порядок бросков в `marketStock` зафиксирован шагом 15
 * прямым запретом («любой новый бросок дописывается В КОНЕЦ тела цикла»), и
 * вклинивание в него сделало бы другим весь прилавок всех лавок на всех старых
 * сохранениях при неизменных данных.
 *
 * **Машина подержанная.** На прилавке стоит чужой корпус с чужой навеской:
 * броня неполная, части навески может не быть вовсе (`mech/outfit.ts`). Это та
 * же ось комплектности, что у отрядов противника, и лечится она мехлабом —
 * тем самым, который приходит этим же шагом.
 */

export interface MechLot {
  readonly id: string;
  /** Готовая запись: цена, оценка и показ считаются по ней же, что и по машине роты. */
  readonly record: MechRecord;
  /** Оценочная стоимость до наценки рынка — то, за сколько её выкупят обратно. */
  readonly value: number;
  readonly price: number;
}

/** Сколько машин держит прилавок этой системы. Ноль на периферии — там их не бывает. */
export function mechLotCount(profile: MarketProfile): number {
  return (
    MARKET.mechs.lotsByClass[profile.marketClass] +
    (profile.mechFactory ? MARKET.mechs.factoryBonus : 0) +
    (profile.blackMarket ? MARKET.mechs.blackMarketBonus : 0)
  );
}

const MARKET_OUTFIT: OutfitSpec = {
  armorShare: MARKET.mechs.outfit.armorShare,
  missingItems: MARKET.mechs.outfit.missingItems,
};

function weightedQuality(rng: Rng, weights: Record<QualityClass, number>): QualityClass | null {
  let total = 0;
  for (const cls of QUALITY_CLASS_IDS) total += weights[cls];
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const cls of QUALITY_CLASS_IDS) {
    roll -= weights[cls];
    if (roll <= 0) return cls;
  }
  return QUALITY_CLASS_IDS[QUALITY_CLASS_IDS.length - 1] as QualityClass;
}

/**
 * Ассортимент машин на указанный день.
 *
 * Порядок бросков зафиксирован тем же правилом, что и у узлов: новый бросок
 * дописывается В КОНЕЦ тела цикла, иначе один и тот же мир начнёт торговать
 * другими машинами при неизменных данных.
 *
 * Класс исполнения берётся из весов системы, а не назначается генератору
 * наугад: `generateAssembly` предохраняется от случайного класса намеренно
 * (`rules/construction.ts`), и решает его тот, кто знает цену, — здесь это
 * рынок.
 */
export function mechStock(
  worldSeed: number,
  systemId: string,
  day: number,
  standing = 0,
  development = 0,
  realm: RealmMarket | undefined = undefined,
): readonly MechLot[] {
  const profile = marketProfile(worldSeed, systemId, standing, development, realm);
  const count = mechLotCount(profile);
  if (count === 0) return [];

  const decade = decadeOf(day);
  const rng = new Rng(marketSeed(worldSeed, profile.systemId, decade, 'mechs'));
  const weights = qualityWeightsOf(profile);

  const lots: MechLot[] = [];
  for (let n = 0; n < count; n++) {
    const clan = rng.next() < profile.clanChance;
    const techBase = clan ? 'clan' : 'is';
    const pool = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === techBase);
    const entry = rng.pick(pool.length === 0 ? CHASSIS_CATALOG_LIST : pool);
    const role = rng.pick(ASSEMBLY_ROLES);
    const cls = weightedQuality(rng, weights);
    if (cls === null) continue;

    const full: MechAssembly = generateAssembly(
      { chassisCode: entry.code, role, quality: { reactor: cls, frame: cls } },
      rng,
    );
    // Имя берётся у сборки, а не у шасси: `generateAssembly` уже подставляет
    // каноничное имя корпуса там, где оно есть в каталоге, и роль там, где его
    // нет. Голый код шасси на прилавке читался бы как складской артикул.
    const record = makeRecord({
      id: `lot-${decade}-${n}`,
      name: full.name ?? entry.code,
      assembly: stripOutfit(full, MARKET_OUTFIT, rng),
    });

    const value = mechValue(record);
    lots.push({
      id: `M${decade}-${n}`,
      record,
      value,
      price: Math.round(
        value * profile.priceFactor * MARKET.mechs.markup * (profile.realmFactory ? WAR.buildings.factoryMechPrice : 1),
      ),
    });
  }
  return lots;
}

/** Веса классов исполнения этой лавки — те же, по которым собирается прилавок узлов. */
function qualityWeightsOf(profile: MarketProfile): Record<QualityClass, number> {
  const base = MARKET.classes[profile.marketClass].quality;
  const out = { ...base } as Record<QualityClass, number>;
  for (const cls of QUALITY_CLASS_IDS) {
    if (profile.mechFactory) out[cls] += MARKET.flags.mechFactory.quality[cls];
    if (profile.blackMarket) out[cls] += MARKET.flags.blackMarket.quality[cls];
  }
  return out;
}

/** Машины за вычетом уже купленных. `bought` действителен только для своей декады. */
export function availableMechs(
  worldSeed: number,
  systemId: string,
  day: number,
  bought: readonly string[] = [],
  standing = 0,
  development = 0,
  realm: RealmMarket | undefined = undefined,
): readonly MechLot[] {
  const taken = new Set(bought);
  return mechStock(worldSeed, systemId, day, standing, development, realm).filter((lot) => !taken.has(lot.id));
}
