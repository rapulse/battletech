import { COMBAT, HEAD_GLANCE_ZONE, weapon, ZONE_TABLES } from '../data/tables.js';
import { line as hexLine } from '../hex/index.js';
import type { HexMap } from '../map/HexMap.js';
import { los, type LosResult } from '../map/los.js';
import { MoveMode } from '../map/movement.js';
import { ContactLevel } from '../model/Contact.js';
import { HitZone, isArm } from '../model/HitZone.js';
import { WEIGHT_CLASS_NAME } from '../model/WeightClass.js';
import {
  eyeLevelOffset,
  spendAmmo,
  structureBreached,
  zoneState,
  type MechUnit,
} from '../model/MechUnit.js';
import type { Rng, RngSet } from '../rng/index.js';
import { applyDamage, type DamageOutcome } from './damage.js';
import { heatLimits, heatToHitMod, isOverheated } from './heat.js';
import { rollCriticalHit, type CriticalResult } from './critical.js';
import {
  rollCockpitBreach,
  rollEjection,
  type CockpitBreachResult,
  type EjectionResult,
} from './ejection.js';
import {
  rollExecution,
  rollPoise,
  unitPilotingTarget,
  type ExecutionResult,
  type PoiseResult,
} from './execution.js';
import { headHitCause, rollInjury, type InjuryCause, type InjuryResult } from './injury.js';
import { pilotGunneryBase } from './skills.js';

/**
 * Разрешение выстрела в три этапа (wiki/design/combat/rules.md).
 *
 * ```
 * 1. ПОПАДАНИЕ     2d6 >= целевое число   ->  попал / промах
 * 2. ЗОНА          1d6 по таблице зон      ->  куда пришёлся урон
 * 3. ИСПОЛНЕНИЕ    бросок на срыв          ->  срыв превращает попадание в промах
 * ```
 *
 * Порядок именно такой, а не «срыв вместо зоны»: журнал обязан показать, что
 * пилот попал и куда, и только потом — что он это испортил. Иначе срыв читается
 * как жульничество игры.
 */

/**
 * Вероятность выбросить на 2d6 не меньше целевого числа.
 *
 * Нужна и интерфейсу (показать игроку шанс), и боту (сравнить варианты хода).
 * Считается по точному распределению, а не приближением: колокол 2d6 — то, на чём
 * держится вся плавность модификаторов, и округлять его нельзя.
 */
const D2D6_AT_LEAST: readonly number[] = [
  // Индекс — целевое число. Два первых значения — заглушки: цель ниже 2 недостижима.
  //  2    3    4    5    6    7    8    9   10  11  12
  36, 36, 36, 35, 33, 30, 26, 21, 15, 10, 6, 3, 1,
].map((n) => n / 36);

export function hitProbability(target: number): number {
  if (target <= 2) return 1;
  if (target > 12) return 0;
  return D2D6_AT_LEAST[target] ?? 0;
}

export type RangeBand = 'short' | 'medium' | 'long' | 'out';

export interface ToHitFactor {
  readonly key: string;
  readonly amount: number;
}

export interface ToHitBreakdown {
  /** База от навыка Стрельба. */
  readonly base: number;
  readonly factors: readonly ToHitFactor[];
  /**
   * Сумма базы и всех слагаемых ДО обрезки потолком (`COMBAT.toHit.maxTarget`).
   *
   * Хранится отдельно, потому что обрезка молчалива и именно этим сбивала с
   * толку: игрок и замер видели «нужно 12» и не видели, что на деле сложилось
   * 15. Разница между `raw` и `target` — единственное, по чему видно, что
   * модификаторы упёрлись в потолок, а не подошли к нему.
   */
  readonly raw: number;
  /**
   * Сколько срезал потолок ОБСТАНОВКИ (`maxSituational`) — правило шага 30.
   *
   * Это нормальное применение правила, а не патология: обстановка сделала
   * выстрел настолько трудным, насколько правило вообще позволяет.
   */
  readonly situationalCut: number;
  /**
   * Сколько срезал потолок ЦЕЛЕВОГО ЧИСЛА (`maxTarget`) — край шкалы 2d6.
   *
   * Вот это уже патология: выстрел вышел за пределы того, что кубик умеет
   * выразить, и разница пропала. Мерится отдельно от `situationalCut` именно
   * потому, что смысл у них противоположный, а до шага 30 они были одним
   * молчаливым числом.
   */
  readonly overflow: number;
  /** Итоговое целевое число 2d6. */
  readonly target: number;
  readonly band: RangeBand;
  readonly distance: number;
  readonly los: LosResult;
  /** Стрелять нельзя вовсе: нет линии, вне дальности, оружие недоступно. */
  readonly impossible: boolean;
  /** Косвенный огонь: ракеты навесом по наводке союзника, своей линии нет. */
  readonly indirect: boolean;
}

function band(distance: number, w: { short: number; medium: number; long: number }): RangeBand {
  if (distance <= w.short) return 'short';
  if (distance <= w.medium) return 'medium';
  if (distance <= w.long) return 'long';
  return 'out';
}

function attackerMoveFactor(unit: MechUnit): number {
  const m = COMBAT.toHit.attackerMove;
  if (unit.moveMode === MoveMode.Jump) return m.jump;
  if (unit.hexesMoved === 0) return m.still;
  return unit.moveMode === MoveMode.Run ? m.run : m.walk;
}

function targetMoveFactor(hexesMoved: number): number {
  for (const row of COMBAT.toHit.targetMove) {
    if (hexesMoved <= row.upTo) return row.mod;
  }
  return 0;
}

/** Есть ли у стороны стрелка сейчас (не по устаревшему контакту) живой союзник с открытой линией на цель. */
function sideHasLiveSpotter(
  map: HexMap,
  attacker: MechUnit,
  target: MechUnit,
  allUnits: readonly MechUnit[],
): boolean {
  for (const u of allUnits) {
    if (u.id === attacker.id || u.side !== attacker.side || u.destroyed || u.withdrawn) continue;
    const sight = los(map, u.hex, target.hex, {
      fromEye: eyeLevelOffset(u),
      toEye: eyeLevelOffset(target),
    });
    if (!sight.blocked) return true;
  }
  return false;
}

/**
 * Целевое число выстрела со всеми слагаемыми.
 *
 * Возвращает разбор, а не одно число: интерфейс показывает игроку, из чего сложился
 * шанс, ИИ сравнивает варианты, а журнал объясняет исход. Считать это в трёх местах
 * значило бы завести три расходящиеся копии.
 */
export function toHitBreakdown(
  map: HexMap,
  attacker: MechUnit,
  target: MechUnit,
  weaponId: string,
  /** Зона, из которой стреляют. Нужна для штрафа за перебитый привод руки. */
  fromZone?: HitZone,
  /**
   * Что сторона стрелка знает о цели (шаг 7). По умолчанию — «опознана»:
   * так ведут себя вызовы, которым обнаружение не важно (тесты, разбор урона).
   * Правила боя обязаны передавать настоящий уровень.
   */
  contact: ContactLevel = ContactLevel.Identified,
  allUnits?: readonly MechUnit[],
): ToHitBreakdown {
  const w = weapon(weaponId);
  const sight = los(map, attacker.hex, target.hex, {
    fromEye: eyeLevelOffset(attacker),
    toEye: eyeLevelOffset(target),
  });

  const base = pilotGunneryBase(attacker.pilot);
  const factors: ToHitFactor[] = [];
  const b = band(sight.range, w);

  // КОСВЕННЫЙ ОГОНЬ (2026-09-14, решение пользователя; наводчик вернулся решением
  // пользователя 2026-09-19). Ракеты — и РДД, и РБД — бьют навесом: своя линия
  // перекрыта, но сторона знает цель не хуже силуэта. Ровно то, что нарисовано
  // на карте: серый или цветной — можно, «?» — нельзя. РБД включены: иначе
  // ближние ракеты от пушки ничем не отличались бы. Ракета идёт над
  // препятствиями, поэтому укрытие по пути и роботы на линии ниже не считаются.
  //
  // `indirectRequiresSpotter` (`combat.json` → toHit) переключает второе условие:
  // выключен — держится контакт стороны, «наводчика прямо сейчас» нет (было
  // 2026-09-14..09-19, контакт внутри хода не убывает); включён — из условия
  // «можно» дополнительно нужен ЖИВОЙ союзник с открытой линией на цель ИМЕННО
  // СЕЙЧАС (было исходно, до 2026-09-14). Один флаг данных — оба поведения без
  // правки кода, для сравнения боёв `pnpm sim`.
  const requireSpotter = COMBAT.toHit.indirectRequiresSpotter;
  const indirect =
    sight.blocked &&
    w.category === 'missile' &&
    contact >= ContactLevel.Silhouette &&
    (!requireSpotter || (allUnits !== undefined && sideHasLiveSpotter(map, attacker, target, allUnits)));

  if (b === 'medium') factors.push({ key: 'toHit.rangeMedium', amount: COMBAT.toHit.rangeMedium });
  if (b === 'long') factors.push({ key: 'toHit.rangeLong', amount: COMBAT.toHit.rangeLong });

  if (sight.range < w.minRange) {
    factors.push({
      key: 'toHit.minRange',
      amount: (w.minRange - sight.range) * COMBAT.toHit.minRangePenaltyPerHex,
    });
  }

  const move = attackerMoveFactor(attacker);
  if (move !== 0) factors.push({ key: 'toHit.attackerMove', amount: move });

  const targetMove = targetMoveFactor(target.hexesMoved);
  if (targetMove !== 0) factors.push({ key: 'toHit.targetMove', amount: targetMove });

  if (!indirect && sight.coverMod !== 0) factors.push({ key: 'toHit.cover', amount: sight.coverMod });
  // Клетка, в которой стоит цель: лес, развалины, дым. Отдельной строкой от
  // укрытия по пути — «сидит в лесу» и «стреляю сквозь лес» это разные вещи, и
  // игрок обязан видеть, какая из них подняла целевое число (шаг 7).
  if (sight.targetCover !== 0) {
    factors.push({ key: 'toHit.targetCover', amount: sight.targetCover });
  }
  // Неподвижная установка (шаги 73c, 73d) — не робот: ног, которые прячет
  // гребень, у неё нет, и частичного укрытия она не получает, даже стоя на +1.
  const fixed = target.frame === 'emplacement';
  if (sight.partialCover && !fixed) {
    factors.push({ key: 'toHit.partialCover', amount: COMBAT.toHit.targetPartialCover });
  }

  // Роботы на линии огня (Total Warfare p. 101: intervening 'Mechs add +1 to-hit per standing Mech)
  let interveningMechs = 0;
  if (allUnits && sight.range >= 2 && !indirect) {
    const range = sight.range;
    const eyeFrom = map.getElevation(attacker.hex) + eyeLevelOffset(attacker);
    const eyeTo = map.getElevation(target.hex) + eyeLevelOffset(target);
    const lineHexes = hexLine(attacker.hex, target.hex);
    for (let i = 1; i < lineHexes.length - 1; i++) {
      const h = lineHexes[i]!;
      const unitHere = allUnits.find(
        (u) =>
          !u.destroyed &&
          u.id !== attacker.id &&
          u.id !== target.id &&
          u.hex.q === h.q &&
          u.hex.r === h.r,
      );
      if (unitHere !== undefined) {
        const t = i / range;
        const lineHeight = eyeFrom + (eyeTo - eyeFrom) * t;
        const mechTop = map.getElevation(h) + (unitHere.prone ? 1 : 2);
        if (mechTop >= lineHeight) {
          interveningMechs++;
        }
      }
    }
  }
  if (interveningMechs > 0) {
    factors.push({ key: 'toHit.interveningMech', amount: interveningMechs });
  }
  if (target.prone) factors.push({ key: 'toHit.targetProne', amount: COMBAT.toHit.targetProne });
  if (attacker.prone) factors.push({ key: 'toHit.attackerProne', amount: COMBAT.toHit.attackerProne });

  // Стрельба по неопознанному. Стрелять можно по любому контакту — это дорогое,
  // но законное решение; нельзя стрелять только в пустоту. По засветке огонь
  // идёт вслепую, по силуэту виден хотя бы класс машины, отсюда и разные числа
  // (`combat.json` → detection). Решение пользователя, 2026-08-26.
  // Установку распознавать незачем (решение пользователя 2026-09-24): она не
  // ходит и не меняет вид; раз контакт есть — огонь как по опознанной.
  if (fixed) {
    // без поправки за засветку и силуэт
  } else if (contact === ContactLevel.Blip) {
    factors.push({ key: 'toHit.blip', amount: COMBAT.detection.toHitBlip });
  } else if (contact === ContactLevel.Silhouette) {
    factors.push({ key: 'toHit.silhouette', amount: COMBAT.detection.toHitSilhouette });
  }

  // Собственная точность оружия. Импульсный лазер бьёт короткими импульсами и
  // держит цель лучше обычного — за это он платит вдвое меньшей дальностью и
  // вдвое большей массой. Число лежит в `weapons.json` и до шага 8 не читалось
  // ни одной строкой правил: импульсник был просто дорогим лазером.
  if (w.toHitMod !== 0) factors.push({ key: 'toHit.weapon', amount: w.toHitMod });

  const heat = heatToHitMod(attacker.heat, heatLimits(attacker).limit);
  if (heat !== 0) factors.push({ key: 'toHit.heat', amount: heat });

  if (attacker.sensorHits > 0) {
    factors.push({
      key: 'toHit.sensorHits',
      amount: attacker.sensorHits * COMBAT.critical.sensors.toHitPenaltyPerHit,
    });
  }

  // Перебитый привод руки роняет наводку той руки, в которой стоит орудие, и
  // только её: рука с целым плечом продолжает целиться как прежде.
  if (fromZone !== undefined && isArm(fromZone)) {
    const armHits = attacker.armActuatorHits[fromZone === HitZone.LeftArm ? 0 : 1] ?? 0;
    if (armHits > 0) {
      factors.push({
        key: 'toHit.armActuator',
        amount: armHits * COMBAT.critical.actuators.toHitPenaltyPerHit,
      });
    }
  }

  // Обстановка ограничена сверху ДО потолка целевого числа (шаг 30).
  //
  // Порядок важен. Потолок целевого числа (`maxTarget`) — это край шкалы 2d6, и
  // упираться в него выстрел не должен вовсе. Потолок обстановки
  // (`maxSituational`) — правило: сколько бы поводов ни сошлось разом, они
  // делают выстрел трудным, но не бессмысленным. Без него шесть независимых
  // источников штрафа выносили сумму за 12 в каждом восьмом выстреле.
  //
  // Отрицательные слагаемые под потолок не идут: лежачая цель и импульсное
  // оружие выстрел улучшают, и ограничивать их этим правилом не за что.
  const factorSum = factors.reduce((acc, f) => acc + f.amount, 0);
  const situational = Math.min(COMBAT.toHit.maxSituational, factorSum);
  // Штраф косвенного огня — СВЕРХ потолка обстановки: выстрел из-за холма почти
  // всегда уже упирается в потолок, и под ним +1 молча исчезал бы.
  const indirectPenalty = indirect ? COMBAT.toHit.indirectFire : 0;
  if (indirect) factors.push({ key: 'toHit.indirect', amount: indirectPenalty });
  const raw = base + factorSum + indirectPenalty;
  const beforeCeiling = base + situational + indirectPenalty;
  const clamped = Math.max(
    COMBAT.toHit.minTarget,
    Math.min(COMBAT.toHit.maxTarget, beforeCeiling),
  );

  return {
    base,
    factors,
    raw,
    situationalCut: factorSum - situational,
    overflow: Math.max(0, beforeCeiling - clamped),
    target: clamped,
    band: b,
    distance: sight.range,
    los: sight,
    // Стрелять нельзя в трёх случаях: вне дальности, линия перекрыта и —
    // со шага 7 — цель для стороны не существует вовсе. Засветка целью уже
    // является: по ней стреляют вслепую, со штрафом. Перекрытая линия не
    // запрещает косвенный огонь ракетами (см. `indirect` выше).
    impossible: b === 'out' || (sight.blocked && !indirect) || contact === ContactLevel.None,
    indirect,
  };
}

/** Обстановка выстрела, от которой зависит таблица зон. */
export interface ZoneShot {
  /** Разница уровней: стрелок выше цели — больше нуля. */
  readonly levelAdvantage?: number;
  /** Ноги цели закрыты выступом в уровень: доступен только верх. */
  readonly partialCover?: boolean;
  /** Дальность в клетках. */
  readonly distance?: number;
  /** Оружие бьёт навесом (ракеты): угол ему безразличен. */
  readonly arcing?: boolean;
}

/** Ракета приходит сверху при любой разнице высот — угол для неё не считается. */
export function arcingWeapon(category: string): boolean {
  return (COMBAT.hitLocation.angle.arcingCategories as readonly string[]).includes(category);
}

/**
 * Выбор таблицы зон по углу выстрела и укрытию.
 *
 * Таблицы Above и Below ничего не перевешивают: они вычёркивают то, чего с этой
 * точки не видно, — ноги за гребнем сверху, руки снизу, — а по оставшимся
 * четырём зонам бросок такой же ровный, как вровень (`rollZone`).
 *
 * Знака разницы высот для этого мало. Ступень высоты на двадцати клетках — пара
 * градусов, то есть обычный настильный выстрел, а на холмистой карте кто-нибудь
 * выше или ниже почти всегда: ровная таблица выродилась в редкий случай, хотя
 * угла, ради которого всё затевалось, не было. Поэтому высота меняет таблицу
 * только вблизи — до `angle.maxRange` клеток.
 *
 * Два исключения, оба про физику, а не про угол:
 * - ракеты (`arcing`) идут навесом — им ровная таблица на любой высоте;
 * - частичное укрытие (`partialCover`) перебивает всё, включая ракеты: ноги за
 *   выступом не видны ни с какой дистанции и ни для какого оружия
 *   (Punch table, Total Warfare p. 106).
 */
export function zoneTableName(shot: ZoneShot = {}): 'Above' | 'Below' | 'Main' {
  if (shot.partialCover === true) return 'Above';
  if (shot.arcing === true) return 'Main';
  if ((shot.distance ?? 0) > COMBAT.hitLocation.angle.maxRange) return 'Main';
  const advantage = shot.levelAdvantage ?? 0;
  if (advantage > 0) return 'Above';
  if (advantage < 0) return 'Below';
  return 'Main';
}

export function zoneTableFor(shot: ZoneShot = {}): readonly HitZone[] {
  const name = zoneTableName(shot);
  if (name === 'Above') return ZONE_TABLES.above;
  if (name === 'Below') return ZONE_TABLES.below;
  return ZONE_TABLES.level;
}

export interface ZoneRoll {
  readonly zone: HitZone;
  readonly roll: number;
  /** Выпала голова: бросок подтверждения и его исход. */
  readonly confirmRoll: number | null;
  readonly glanced: boolean;
}

/**
 * Бросок зоны с подтверждением кокпита.
 *
 * Бросок ровный по длине таблицы: вровень это d6 по шести зонам, Above и Below —
 * d4 по четырём оставшимся. Доли между оставшимися зонами одинаковые в любой
 * таблице — вычёркивание невидимого не должно превращаться в перевес (решение
 * пользователя 2026-09-17).
 *
 * Плоская таблица даёт голове 1/6 попаданий против 1/36 в каноне. Без
 * подтверждения кокпит отказывал бы раньше торса в любом бою — не баланс, а
 * лотерея. Второй бросок опускает долю до ~1/18, сохраняя таблицу дословно;
 * `confirmOn: 6` в данных возвращает чистую плоскую таблицу.
 */
export function rollZone(rng: Rng, shot: ZoneShot = {}): ZoneRoll {
  const table = zoneTableFor(shot);
  const roll = rng.int(1, table.length);
  const zone = table[roll - 1];
  if (zone === undefined) throw new RangeError(`Бросок вне таблицы зон: ${roll}`);

  if (zone !== HitZone.Head) return { zone, roll, confirmRoll: null, glanced: false };

  const confirmRoll = rng.d6();
  if (confirmRoll <= COMBAT.hitLocation.headConfirm.confirmOn) {
    return { zone, roll, confirmRoll, glanced: false };
  }
  return { zone: HEAD_GLANCE_ZONE, roll, confirmRoll, glanced: true };
}

export interface ShotDamage {
  readonly zoneRoll: ZoneRoll;
  readonly outcome: DamageOutcome;
  readonly critical?: CriticalResult | null;
}

export interface InjuryEvent {
  readonly cause: InjuryCause;
  readonly result: InjuryResult;
}

export interface AttackResolution {
  readonly attacker: MechUnit;
  readonly target: MechUnit;
  readonly weapon: string;
  readonly breakdown: ToHitBreakdown;
  /** Бросок 2d6 на попадание. 0 — выстрела не было (нельзя стрелять). */
  readonly roll: number;
  /** Этап 1: намерение удалось. */
  readonly intentHit: boolean;
  /** Собранность спасла промах ровно на единицу. */
  readonly poise: PoiseResult | null;
  /** Этап 3: проверка исполнения. null — не проводилась (промах). */
  readonly execution: ExecutionResult | null;
  /** Итог после всех трёх этапов. */
  readonly hit: boolean;
  readonly shots: readonly ShotDamage[];
  readonly criticalHits: readonly CriticalResult[];
  readonly injuries: readonly InjuryEvent[];
  readonly targetDestroyed: boolean;
  readonly pilotLost: boolean;
  readonly ejection: EjectionResult | null;
  /** Бросок на равновесие после 20+ урона за ход (шаг 30). `null` — порог не перейдён. */
  readonly hitFalls: SalvoResult['hitFalls'];
  /**
   * Бросок на пробитие кокпита: броня головы пробита, 1d6 решает, ушёл снаряд
   * в приборы или в остекление (шаг 6). `null` — броня головы устояла или
   * голову в этом залпе не задело.
   */
  readonly cockpitBreach: CockpitBreachResult | null;
  /** Название таблицы зон: Above, Below или Main */
  readonly zoneTable: 'Above' | 'Below' | 'Main';
  /** Стрелять было нельзя: нет линии, вне дальности, оружие недоступно. */
  readonly impossible: boolean;
  /**
   * Судьба каждой ракеты пачки по отдельности (шаг 66b) — только у оружия с
   * `cluster: true`. У остальных стволов `null`: там намерение и исполнение
   * по-прежнему решают ВСЮ атаку одним броском (Ultra-автопушка бьёт дважды
   * одним решением, а не двумя независимыми). Верхнеуровневые `roll`/
   * `intentHit`/`poise`/`execution` для кластерного оружия не значат ничего
   * содержательного (первая ракета пачки) — читать нужно отсюда.
   */
  readonly clusterShots: readonly ClusterShotDetail[] | null;
}

/** Разрешение попадания одной ракеты пачки — см. `AttackResolution.clusterShots`. */
export interface ClusterShotDetail {
  /** Бросок 2d6 на попадание этой ракеты. */
  readonly roll: number;
  /** Этап 1 для этой ракеты: намерение удалось (после Собранности, если спасала). */
  readonly intentHit: boolean;
  readonly poise: PoiseResult | null;
  /** null — намерение не удалось, до проверки исполнения дело не дошло. */
  readonly execution: ExecutionResult | null;
  /** Долетела ли ракета: намерение удалось И исполнение не сорвалось. */
  readonly landed: boolean;
}

export interface AttackInput {
  readonly map: HexMap;
  readonly attacker: MechUnit;
  readonly target: MechUnit;
  /** Индекс установки в `attacker.mounts`. */
  readonly mountIndex: number;
  /** Что сторона стрелка знает о цели. По умолчанию — «опознана» (шаг 7). */
  readonly contact?: ContactLevel;
  /** Все юниты на карте для учёта промежуточных роботов на линии огня. */
  readonly units?: readonly MechUnit[];
}

/**
 * Полное разрешение выстрела. Чистая функция: состояние не меняется, возвращаются
 * новые версии обоих роботов. Это то, что делает возможными автобой и реплей.
 */
export function resolveAttack(rng: RngSet, input: AttackInput): AttackResolution {
  const { map, target } = input;
  let attacker = input.attacker;

  const mount = attacker.mounts[input.mountIndex];
  if (mount === undefined) throw new RangeError(`Нет установки ${input.mountIndex} у ${attacker.id}`);
  const w = weapon(mount.weapon);

  const contact = input.contact ?? ContactLevel.Identified;
  const breakdown = toHitBreakdown(map, attacker, target, mount.weapon, mount.zone, contact, input.units);
  const unusable =
    mount.destroyed ||
    zoneState(attacker, mount.zone).destroyed ||
    (mount.ammo !== null && mount.ammo <= 0);

  const shot: ZoneShot = {
    levelAdvantage: breakdown.los.levelAdvantage,
    partialCover: breakdown.los.partialCover,
    distance: breakdown.distance,
    arcing: arcingWeapon(w.category),
  };
  const zoneTable = zoneTableName(shot);

  const empty = (impossible: boolean): AttackResolution => ({
    attacker, target, weapon: mount.weapon, breakdown, roll: 0,
    intentHit: false, poise: null, execution: null, hit: false,
    shots: [], criticalHits: [], injuries: [], targetDestroyed: target.destroyed, pilotLost: false,
    ejection: null,
    hitFalls: [],
    cockpitBreach: null,
    zoneTable,
    impossible,
    clusterShots: null,
  });

  if (unusable || breakdown.impossible) return empty(true);

  // Тепло и боезапас тратятся за сам выстрел, независимо от исхода.
  attacker = spendAmmo(
    {
      ...attacker,
      heat: attacker.heat + w.heat,
      hasFired: true,
      // Считаются ХОДЫ со стрельбой, а не выстрелы: залп из трёх стволов — это
      // один раз открытый огонь, а не три. Засчитывается сразу, до броска —
      // цель выдаёт вспышка, а не попадание (шаг 7).
      shotsSeen: attacker.hasFired ? attacker.shotsSeen : attacker.shotsSeen + 1,
      // Отметка на самой установке: залп — это каждый ствол по разу, а тепло от
      // предыдущего выстрела уже висит на роботе, когда целится следующий.
      mounts: attacker.mounts.map((m, i) =>
        i === input.mountIndex ? { ...m, firedThisTurn: true } : m,
      ),
    },
    input.mountIndex,
  );

  // РАКЕТЫ (шаг 66b, cluster: true): каждая ракета пачки бросает намерение,
  // Собранность (при промахе на единицу) и исполнение НЕЗАВИСИМО — судьба
  // одной ракеты не зависит от соседних. Раньше (canon-divergences.md §7,
  // до шага 66b) один бросок на всю пачку решал всё разом: либо долетают все
  // `w.shots`, либо ни одна. Не-кластерное оружие (энергетика, баллистика,
  // Ultra-автопушки с `shots: 2`) этой веткой не идёт вовсе — там залп
  // по-прежнему решает один бросок, а `w.shots` зон кидается разом, как было.
  if (w.cluster) {
    const toHitRng = rng.stream('toHit');
    const skillRng = rng.stream('skill');
    const hitRng = rng.stream('hitLocation');

    const clusterShots: ClusterShotDetail[] = [];
    const zoneRolls: ZoneRoll[] = [];

    for (let i = 0; i < w.shots; i++) {
      const roll = toHitRng.d2d6();
      let intentHit = roll >= breakdown.target;

      let poise: PoiseResult | null = null;
      if (!intentHit && roll === breakdown.target - 1) {
        poise = rollPoise(skillRng, attacker.pilot);
        if (poise.saved) intentHit = true;
      }

      let execution: ExecutionResult | null = null;
      let landed = false;
      if (intentHit) {
        execution = rollExecution(skillRng, attacker.pilot, {
          overheated: isOverheated(attacker),
          damageTakenThisTurn: attacker.damageThisTurn,
          structureBreached: structureBreached(attacker),
          fellThisTurn: attacker.fellThisTurn,
        });
        if (!execution.botched) {
          landed = true;
          zoneRolls.push(rollZone(hitRng, shot));
        }
      }

      clusterShots.push({ roll, intentHit, poise, execution, landed });
    }

    const firstRoll = clusterShots[0]?.roll ?? 0;
    const anyIntentHit = clusterShots.some((s) => s.intentHit);

    if (zoneRolls.length === 0) {
      return {
        attacker, target, weapon: mount.weapon, breakdown, roll: firstRoll,
        intentHit: anyIntentHit, poise: null, execution: null, hit: false,
        shots: [], criticalHits: [], injuries: [], targetDestroyed: target.destroyed, pilotLost: false,
        ejection: null,
        hitFalls: [],
        cockpitBreach: null,
        zoneTable,
        impossible: false,
        clusterShots,
      };
    }

    // Урон, криты и последствия для пилота (падение, кокпит, уход) — ОДНИМ
    // проходом `resolveSalvo` по накопленным зонам долетевших ракет, тем же
    // приёмом, что и раньше: массив зон переменной длины вместо всегда
    // `w.shots` (попали все) или всегда пустого (не попал никто).
    const salvo = resolveSalvo(rng, target, mount.weapon, zoneRolls);

    return {
      attacker,
      target: salvo.target,
      weapon: mount.weapon,
      breakdown,
      roll: firstRoll,
      intentHit: true,
      poise: null,
      execution: null,
      hit: true,
      shots: salvo.shots,
      criticalHits: salvo.criticalHits,
      injuries: salvo.injuries,
      targetDestroyed: salvo.target.destroyed,
      pilotLost: salvo.pilotLost,
      ejection: salvo.ejection,
      hitFalls: salvo.hitFalls,
      cockpitBreach: salvo.cockpitBreach,
      zoneTable,
      impossible: false,
      clusterShots,
    };
  }

  // --- Этап 1: намерение -----------------------------------------------------
  const roll = rng.stream('toHit').d2d6();
  let intentHit = roll >= breakdown.target;

  let poise: PoiseResult | null = null;
  if (!intentHit && roll === breakdown.target - 1) {
    poise = rollPoise(rng.stream('skill'), attacker.pilot);
    if (poise.saved) intentHit = true;
  }

  if (!intentHit) return { ...empty(false), attacker, roll, poise };

  // --- Этап 2: зона ----------------------------------------------------------
  const zoneRolls: ZoneRoll[] = [];
  for (let i = 0; i < w.shots; i++) {
    zoneRolls.push(rollZone(rng.stream('hitLocation'), shot));
  }

  // --- Этап 3: исполнение ----------------------------------------------------
  const execution = rollExecution(rng.stream('skill'), attacker.pilot, {
    overheated: isOverheated(attacker),
    damageTakenThisTurn: attacker.damageThisTurn,
    structureBreached: structureBreached(attacker),
    fellThisTurn: attacker.fellThisTurn,
  });

  if (execution.botched) {
    return {
      attacker, target, weapon: mount.weapon, breakdown, roll,
      intentHit: true, poise, execution, hit: false,
      shots: [], criticalHits: [], injuries: [], targetDestroyed: target.destroyed, pilotLost: false,
      ejection: null,
      hitFalls: [],
      cockpitBreach: null,
      zoneTable,
      impossible: false,
      clusterShots: null,
    };
  }

  const salvo = resolveSalvo(rng, target, mount.weapon, zoneRolls);

  return {
    attacker,
    target: salvo.target,
    weapon: mount.weapon,
    breakdown,
    roll,
    intentHit: true,
    poise,
    execution,
    hit: true,
    shots: salvo.shots,
    criticalHits: salvo.criticalHits,
    injuries: salvo.injuries,
    targetDestroyed: salvo.target.destroyed,
    pilotLost: salvo.pilotLost,
    ejection: salvo.ejection,
    hitFalls: salvo.hitFalls,
    cockpitBreach: salvo.cockpitBreach,
    zoneTable,
    impossible: false,
    clusterShots: null,
  };
}

/**
 * Что залп сделал с целью: урон, криты, судьба пилота.
 *
 * Выделено из `resolveAttack` шагом 18 и НЕ переписано ни на строку — порядок
 * бросков тот же, поэтому закреплённый golden-хэш боя не двигается. Разделение
 * проходит ровно по границе карты: всё до этой функции (дальность, укрытие,
 * линия видимости, движение) требует карты, всё внутри — не требует ничего,
 * кроме двух машин и брошенных зон.
 *
 * Это и есть шов, которым пользуется быстрый расчёт
 * (`campaign/bridge/fastResolve.ts`): у него карты нет, но правила урона,
 * критов, детонаций, пробития кокпита и катапультирования обязаны быть теми же.
 * Вторая копия этой цепочки разошлась бы с первой молча — как раз потому, что
 * обе давали бы правдоподобные числа.
 */
export interface SalvoResult {
  /** Цель после залпа. */
  readonly target: MechUnit;
  readonly shots: readonly ShotDamage[];
  readonly criticalHits: readonly CriticalResult[];
  readonly injuries: readonly InjuryEvent[];
  readonly pilotLost: boolean;
  readonly ejection: EjectionResult | null;
  readonly cockpitBreach: CockpitBreachResult | null;
  /**
   * Броски на равновесие от попадания, в порядке, в каком случились (шаг 30,
   * переработано 2026-09-15): крит гироскопа, крит привода ноги, урон за ход
   * через порог весового класса. Бросаются по очереди до первого падения.
   *
   * Классическое правило Total Warfare. Введено вместе с отменой спама
   * проверок на рельефе: если убрать броски за воду и уступы и не дать взамен
   * ничего, падение исчезнет из боя вовсе, а вместе с ним — смысл навыка
   * Пилотирование. Машину валит пойманный залп, а не лужа под ногами.
   */
  readonly hitFalls: readonly HitFall[];
}

export type HitFallReason = 'piloting.massiveDamage' | 'piloting.gyroHit' | 'piloting.legActuator';

export interface HitFall {
  readonly reason: HitFallReason;
  readonly target: number;
  readonly roll: number;
  readonly passed: boolean;
}

/**
 * Бросок, который назначает сам крит (`combat.json → piloting.onHit`).
 *
 * Число — обычное число машины ДО этого крита плюс модификатор события: иначе
 * постоянная надбавка, которую крит оставляет на будущие броски, легла бы в
 * этот же бросок второй раз.
 */
export function hitFallFromCrit(
  before: MechUnit,
  crit: CriticalResult,
): { reason: HitFallReason; target: number } | null {
  const onHit = COMBAT.piloting.onHit;
  if (crit.effect === 'gyroHit') {
    return { reason: 'piloting.gyroHit', target: unitPilotingTarget(before) + onHit.gyroHit };
  }
  if (crit.effect === 'actuatorHit' && crit.slotKind === 'leg_actuator') {
    return { reason: 'piloting.legActuator', target: unitPilotingTarget(before) + onHit.legActuatorHit };
  }
  return null;
}

/**
 * Залп по огневой точке (шаг 73c) — все исключения турели из правил меха здесь.
 *
 * Зон у неё нет: каждое попадание приходит в корпус, сколько бы ни выпало на
 * таблице. Ни критов, ни падений, ни ранений, ни катапульты: у неё нет ни
 * ячеек под криты, ни ног, ни пилота в кабине. Корпус пробит — точка выбита.
 * Броски ГПСЧ здесь не тратятся, и чужие потоки от турели не сдвигаются.
 */
function emplacementSalvo(target: MechUnit, weaponId: string, zoneRolls: readonly ZoneRoll[]): SalvoResult {
  const w = weapon(weaponId);
  let victim = target;
  const shots: ShotDamage[] = [];
  for (const zr of zoneRolls) {
    if (victim.destroyed) break;
    const outcome = applyDamage(victim, HitZone.Torso, w.damage);
    victim = outcome.unit;
    shots.push({ zoneRoll: zr, outcome, critical: null });
  }
  return {
    target: victim,
    shots,
    criticalHits: [],
    injuries: [],
    pilotLost: false,
    ejection: null,
    cockpitBreach: null,
    hitFalls: [],
  };
}

export function resolveSalvo(
  rng: RngSet,
  target: MechUnit,
  weaponId: string,
  zoneRolls: readonly ZoneRoll[],
): SalvoResult {
  if (target.frame === 'emplacement') return emplacementSalvo(target, weaponId, zoneRolls);
  const w = weapon(weaponId);

  // --- Урон и критические попадания ------------------------------------------
  let victim = target;
  const shots: ShotDamage[] = [];
  const criticalHits: CriticalResult[] = [];
  const critInjuries: InjuryEvent[] = [];
  const damageBefore = victim.damageThisTurn;
  const pendingFalls: { reason: HitFallReason; target: number }[] = [];
  const hitFalls: HitFall[] = [];
  let headArmorHeld: boolean | null = null;
  let headDestroyed = false;
  const skill = rng.stream('skill');
  const critsRng = rng.stream('crits');
  let ejection: EjectionResult | null = null;

  for (const zr of zoneRolls) {
    if (victim.destroyed) break;
    const outcome = applyDamage(victim, zr.zone, w.damage);
    victim = outcome.unit;

    let critResult: CriticalResult | null = null;
    // Крит бросается только когда броня пробита (урон дошёл до структуры)
    if (!outcome.armorHeld && !outcome.zoneDestroyed && !victim.destroyed) {
      const critCheck = rollCriticalHit(
        critsRng,
        skill,
        victim,
        outcome.zone,
        weaponId,
        outcome.armorHeld,
      );
      if (critCheck.success && critCheck.result) {
        critResult = critCheck.result;
        const fromCrit = hitFallFromCrit(victim, critResult);
        if (fromCrit !== null) pendingFalls.push(fromCrit);
        victim = critResult.unit;
        criticalHits.push(critResult);
        // Ранение от детонации должно попасть в общий список: иначе бросок
        // случился, пилот его получил, а журнал и замер о нём не знают.
        if (critResult.injury) {
          critInjuries.push({ cause: 'ammoExplosion', result: critResult.injury });
        }
        if (critResult.ejection) {
          ejection = critResult.ejection;
        }
      }
    }

    shots.push({ zoneRoll: zr, outcome, critical: critResult });

    if (outcome.zone === HitZone.Head) {
      headArmorHeld = headArmorHeld === false ? false : outcome.armorHeld;
      if (outcome.zoneDestroyed) headDestroyed = true;
    }
  }

  // --- Пилот -----------------------------------------------------------------
  const injuries: InjuryEvent[] = [...critInjuries];
  let pilotLost = false;

  // Пробитие кокпита разыгрывается ДО всего остального: снаряд, прошедший
  // сквозь остекление, решает судьбу человека раньше, чем катапульта успевает
  // начать работать (`rollCockpitBreach`, шаг 6). Если уход уже разыгран внутри
  // крита — бросок не делается: судьба пилота решена, и второй раз её не решают.
  let cockpitBreach: CockpitBreachResult | null = null;
  if (headArmorHeld === false && ejection === null && victim.pilot.status === 'active') {
    cockpitBreach = rollCockpitBreach(skill, victim.pilot);
    victim = { ...victim, pilot: cockpitBreach.pilot };
  }

  if (cockpitBreach?.lost === true) {
    // Выстрел пришёлся в стекло. Ни броска на уход, ни ранения при приземлении:
    // уходить некому.
    pilotLost = true;
  } else if (ejection !== null) {
    // Уход уже разыгран внутри крита (разбитый кокпит, третий крит реактора,
    // детонация). Состояние `victim` его уже содержит и с тех пор могло уйти
    // дальше — присваивать сюда `ejection.unit` значит откатить весь залп.
    pilotLost = !ejection.success;
  } else if (headDestroyed) {
    // Кокпит разрушен вместе с катапультой — единственный повод, где бросок
    // может закончиться потерей пилота.
    // Броня головы к этому моменту заведомо пробита, бросок на остекление уже
    // сделан и прошёл мимо — катапульта пробует сработать в разбитой голове.
    ejection = rollEjection(skill, victim, 'head');
    victim = ejection.unit;
    pilotLost = !ejection.success;
  } else {
    if (headArmorHeld !== null) {
      const cause = headHitCause(headArmorHeld);
      const result = rollInjury(skill, victim.pilot, cause);
      victim = { ...victim, pilot: result.pilot };
      injuries.push({ cause, result });
    }

    // «Тяжёлый удар» — один порог для машины и для пилота: урон за ход через
    // порог своего весового класса (2026-09-24, решение пользователя). До того
    // ранение шло с общих 20, и это треть живучести лёгкой машины, но двадцатая
    // доля штурмовой: пилоты крупных машин ранились вдвое чаще лёгких
    // (замер 300 боёв: 6.5 / 10.1 / 15.2 / 12.9 на 100 машин), хотя 20 урона
    // в броню тяжёлой машины — не удар, который трясёт кабину.
    const massiveAt = COMBAT.piloting.fallDamageByClass[WEIGHT_CLASS_NAME[victim.weightClass]];
    const crossedMassive = damageBefore < massiveAt && victim.damageThisTurn >= massiveAt;
    if (crossedMassive) {
      const result = rollInjury(skill, victim.pilot, 'massiveDamage');
      victim = { ...victim, pilot: result.pilot };
      injuries.push({ cause: 'massiveDamage', result });
    }

    // Порог падения от урона — свой у весового класса (2026-09-15): общие 20
    // были третью живучести лёгкой машины и десятой частью штурмовой.
    if (COMBAT.piloting.massiveDamageCheck && crossedMassive) {
      pendingFalls.push({
        reason: 'piloting.massiveDamage',
        target: unitPilotingTarget(victim) + COMBAT.piloting.onHit.massiveDamage,
      });
    }

    // Броски по очереди до первого падения. ТОЛЬКО стоящей машине: лежачую
    // валить некуда, а разрушенную — незачем. Число выше 12 — падение без шанса,
    // как в каноне: 2d6 его не достаёт.
    for (const check of pendingFalls) {
      if (victim.prone || victim.destroyed) break;
      const roll = skill.d2d6();
      const passed = roll >= check.target;
      hitFalls.push({ reason: check.reason, target: check.target, roll, passed });
      if (!passed) {
        victim = { ...victim, prone: true, fellThisTurn: true, mpLeft: 0 };
        const fallResult = rollInjury(skill, victim.pilot, 'fall');
        victim = { ...victim, pilot: fallResult.pilot };
        injuries.push({ cause: 'fall', result: fallResult });
      }
    }

    if (shots.some((s) => s.outcome.fell)) {
      const result = rollInjury(skill, victim.pilot, 'fall');
      victim = { ...victim, pilot: result.pilot };
      injuries.push({ cause: 'fall', result });
    }

    if (victim.destroyed && !target.destroyed) {
      // Робот разрушен — катапульта срабатывает сама. Пилот уходит всегда;
      // цена поражения — машина и жёсткое приземление, а не человек.
      ejection = rollEjection(skill, victim, 'torso');
      victim = ejection.unit;
      pilotLost = !ejection.success;
    }
  }

  // Пилот без сознания или ушёл — робот замирает; для боя это одно и то же.
  if (victim.pilot.status !== 'active') victim = { ...victim, destroyed: true };

  return {
    target: victim,
    shots,
    criticalHits,
    injuries,
    pilotLost,
    ejection,
    cockpitBreach,
    hitFalls,
  };
}
