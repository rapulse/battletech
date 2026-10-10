import { COMBAT, PILOTS } from '../data/tables.js';
import { HitZone } from '../model/HitZone.js';
import { zoneState, type MechUnit } from '../model/MechUnit.js';
import { skillLevel, type Pilot } from '../model/Pilot.js';
import type { Rng } from '../rng/index.js';
import { isOverheated } from './heat.js';
import { composureBotch, pilotPilotingTarget } from './skills.js';

/**
 * Проверка исполнения — второй этап разрешения любого действия
 * (wiki/design/pilots/skills.md).
 *
 * ```
 * НАМЕРЕНИЕ                  ИСПОЛНЕНИЕ                  ИТОГ
 * что пилот хотел    →   получилось ли у него    →   что произошло
 * ```
 *
 * Одна функция на все действия: выстрел, перемещение, прыжок, рукопашная. Новое
 * действие подключается к ней, а не заводит свою механику.
 *
 * Три ограничения, без которых это раздражает вместо того, чтобы создавать характер:
 *   1. срыв только ухудшает уже удавшееся — провальный бросок он не трогает;
 *   2. срыв всегда объяснён: `factors` уходит в боевой журнал;
 *   3. выбор игрока не подменяется молча — маршрут остаётся заданным маршрутом.
 */

/** Слагаемое вероятности срыва. Ключ — для локализации, число — для журнала. */
export interface BotchFactor {
  readonly key: string;
  readonly amount: number;
}

export interface BotchOdds {
  /** Итоговая вероятность срыва, 0..1. */
  readonly chance: number;
  /** База от Хладнокровия. */
  readonly base: number;
  readonly composure: number;
  readonly factors: readonly BotchFactor[];
  /** Сумма упёрлась в потолок: дальше обстановка уже не ухудшает. */
  readonly capped: boolean;
}

/**
 * Обстановка вокруг действия. Намеренно plain-объект, а не `MechUnit`: та же
 * проверка обслуживает драку в баре и Круг Равных, где робота нет вовсе.
 */
export interface ExecutionSituation {
  /**
   * Машина на пороге отключения или выше (`rules/heat.ts::isOverheated`).
   * Флаг, а не число тепла: порог у каждой машины свой — от её отвода, — а
   * обстановка намеренно не знает о машине.
   */
  readonly overheated?: boolean;
  readonly damageTakenThisTurn?: number;
  readonly structureBreached?: boolean;
  readonly fellThisTurn?: boolean;
}

export function botchOdds(pilot: Pilot, sit: ExecutionSituation = {}): BotchOdds {
  const composure = skillLevel(pilot, 'composure');
  const base = composureBotch(composure);
  const s = PILOTS.execution.situational;
  const factors: BotchFactor[] = [];

  // «Перегрев» решает правило тепла (`rules/heat.ts::isOverheated`), а не число
  // здесь: иначе проверка исполнения и правила тепла разъедутся при первой же
  // правке баланса. Порог у каждой машины свой — от её отвода.
  if (sit.overheated === true) {
    factors.push({ key: 'botch.heat', amount: s.heatHigh });
  }
  if ((sit.damageTakenThisTurn ?? 0) >= COMBAT.damage.massiveDamagePerTurn) {
    factors.push({ key: 'botch.heavyDamage', amount: s.heavyDamageThisTurn });
  }
  if (sit.structureBreached === true) {
    factors.push({ key: 'botch.structure', amount: s.structureBreached });
  }
  if (sit.fellThisTurn === true) {
    factors.push({ key: 'botch.fell', amount: s.fellThisTurn });
  }
  if (pilot.injuries > 0) {
    factors.push({ key: 'botch.injuries', amount: s.perInjury * pilot.injuries });
  }
  if (pilot.firstBattle) {
    factors.push({ key: 'botch.firstBattle', amount: s.firstBattle });
  }

  const raw = base + factors.reduce((acc, f) => acc + f.amount, 0);
  const capped = raw > PILOTS.execution.maxBotch;

  return {
    chance: capped ? PILOTS.execution.maxBotch : raw,
    base,
    composure,
    factors,
    capped,
  };
}

export interface ExecutionResult {
  readonly botched: boolean;
  readonly odds: BotchOdds;
  /** Выпавшее значение 0..1 — попадает в реплей и делает разбор возможным. */
  readonly roll: number;
}

/**
 * Бросок на срыв. Поток `skill` отдельный: добавление новой проверки не сдвигает
 * последовательность боевых бросков и не обесценивает сохранённые бои.
 */
export function rollExecution(
  rng: Rng,
  pilot: Pilot,
  sit: ExecutionSituation = {},
): ExecutionResult {
  const odds = botchOdds(pilot, sit);
  const roll = rng.next();
  return { botched: roll < odds.chance, odds, roll };
}

/**
 * Собранность — обратная сторона высокого Хладнокровия: промах ровно на единицу
 * может стать попаданием.
 *
 * Без неё прокачка Хладнокровия ощущается как «всё реже получаю по рукам», а не
 * как «становлюсь мастером». Редкий невозможный выстрел ветерана — то, ради чего
 * его растили.
 */
export function poiseChance(pilot: Pilot): number {
  const level = skillLevel(pilot, 'composure');
  const min = PILOTS.execution.poise.minLevel;
  if (level < min) return 0;
  return (level - (min - 1)) * PILOTS.execution.poise.chancePerLevelAbove;
}

export interface PoiseResult {
  readonly saved: boolean;
  readonly chance: number;
  readonly roll: number;
}

export function rollPoise(rng: Rng, pilot: Pilot): PoiseResult {
  const chance = poiseChance(pilot);
  if (chance <= 0) return { saved: false, chance: 0, roll: 1 };
  const roll = rng.next();
  return { saved: roll < chance, chance, roll };
}

/**
 * Повреждена ли машина так, что равновесие перестало быть само собой (шаг 30).
 *
 * Гироскоп, приводы ног и потерянная нога — три причины, по которым бросок
 * назначается ЛЮБОМУ пилоту, каким бы опытным он ни был. Иммунитет по навыку
 * (`routineImmunitySkill`) действует только на исправную машину: мастерство
 * пилота отвечает за штатное перемещение, а не за перебитый привод.
 */
export function isPilotingImpaired(unit: MechUnit): boolean {
  return (
    unit.gyroHits > 0 ||
    unit.legActuatorHits[0] + unit.legActuatorHits[1] > 0 ||
    zoneState(unit, HitZone.LeftLeg).destroyed ||
    zoneState(unit, HitZone.RightLeg).destroyed
  );
}

/**
 * Нужен ли броску на равновесие вообще случаться при ШТАТНОМ перемещении
 * (вход в воду, спуск с уступа, бег по пересечённой) — шаг 30.
 *
 * До этого шага бросок назначался всем и на каждый гекс, из-за чего вода и
 * перепады высот выпали из тактики: по ним не ходили. Опытный пилот больше не
 * спотыкается о ручей — это его работа; новобранец спотыкается, и в этом
 * разница между ними. Повреждённая машина бросает независимо от навыка
 * (`isPilotingImpaired`).
 */
export function needsRoutinePilotingCheck(unit: MechUnit): boolean {
  if (isPilotingImpaired(unit)) return true;
  return skillLevel(unit.pilot, 'piloting') < COMBAT.piloting.routineImmunitySkill;
}

/**
 * Целевое число броска на равновесие: база от навыка плюс обстановка.
 *
 * Повреждённая нога и перегрев добавляются здесь, а не в таблице навыка: навык
 * описывает пилота, а это состояние машины.
 *
 * Жила приватной функцией в `commands/execute.ts`, пока бросок на равновесие
 * делался ровно в одном месте — при движении. Шаг 18 добавил второе:
 * быстрому расчёту (`campaign/bridge/fastResolve.ts`) равновесие тоже нужно, а
 * движения у него нет. Вторая копия этой лесенки разошлась бы с первой на
 * первом же новом крите.
 */
export function unitPilotingTarget(unit: MechUnit): number {
  let target = pilotPilotingTarget(unit.pilot);
  if (zoneState(unit, HitZone.LeftLeg).destroyed || zoneState(unit, HitZone.RightLeg).destroyed) {
    target += 1;
  }
  if (isOverheated(unit)) target += 1;
  if (unit.gyroHits > 0) target += unit.gyroHits * COMBAT.critical.gyro.pilotingPenaltyPerHit;
  target +=
    (unit.legActuatorHits[0] + unit.legActuatorHits[1]) *
    COMBAT.critical.actuators.pilotingPenaltyPerHit;
  return Math.min(12, target);
}
