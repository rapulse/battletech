import { COMBAT } from '../data/tables.js';
import { unitDissipation, type MechUnit } from '../model/MechUnit.js';
import { WEIGHT_CLASS_NAME, type WeightClass, type WeightClassName } from '../model/WeightClass.js';

/**
 * Пороги тепла — от ПРЕДЕЛА самой машины, а не общие на всех.
 *
 * До 2026-09-14 пороги были одни на всю игру (отключение с 28, боезапас с 38,
 * пилот с 50), и цех с полем говорили о разном: мехлаб показывал «залп 30,
 * отвод 30», а шкала на карте — «из 28», и машина, которую игрок честно свёл в
 * ноль, глохла от первого же полного залпа. Бортик в 28 у лёгкого и у
 * штурмового одинаковый — это не логика машины, а константа.
 *
 * Предел = отвод за ход + запас корпуса по весовому классу (решения
 * пользователя 2026-09-14 и 2026-09-15). Отвод — сколько машина снимает за ход,
 * запас — сколько её корпус держит сверх этого разово. Полный залп в предел
 * реактор держит, единица сверх — отключение; но в конце хода снимается только
 * отвод, и запас возвращается лишь через ход передышки. Так машина может
 * ударить на весь предел, но не каждый ход.
 *
 * Остальные пороги отмеряются от того же предела: доля (`share`) плюс прибавка
 * (`plus`), `data/combat.json` → `heat`. Отвод берётся ТЕКУЩИЙ
 * (`unitDissipation`): выбитый радиатор опускает предел, и это видно на карте.
 *
 * Сравнение везде «не меньше метки». Метка может выйти дробной (половина
 * предела 25 — это 12.5), и тогда первое целое тепло, которое её достигает, —
 * 13. Показ округляет вверх (`heatMarkShown`), правила сравнивают как есть.
 */
export interface HeatMark {
  readonly share: number;
  readonly plus: number;
}

export function heatMark(limit: number, mark: HeatMark): number {
  return limit * mark.share + mark.plus;
}

/** Первое целое тепло, на котором метка срабатывает. */
export function heatMarkShown(limit: number, mark: HeatMark): number {
  return Math.ceil(heatMark(limit, mark));
}

export type HullClassId = WeightClassName;

/** Запас тепла корпуса по весовому классу — `combat.json → heat.hullReserve`. */
export function hullReserveOf(weightClass: WeightClass | HullClassId): number {
  const id = typeof weightClass === 'number' ? WEIGHT_CLASS_NAME[weightClass] : weightClass;
  return COMBAT.heat.hullReserve[id];
}

export interface HeatLimits {
  /** Отвод за ход — столько тепла снимается в фазе тепла. */
  readonly dissipation: number;
  /** Запас корпуса по весовому классу. */
  readonly reserve: number;
  /** Предел: отвод + запас. Край шкалы в интерфейсе. */
  readonly limit: number;
  /** С этого тепла в фазе тепла реактор отключается. */
  readonly shutdownAt: number;
  /** С этого тепла бросок на детонацию боезапаса. */
  readonly ammoRiskAt: number;
  /** С этого тепла бросок на ранение пилота. */
  readonly pilotRiskAt: number;
  /** Выше тепло не копится. */
  readonly max: number;
}

export function heatLimitsFor(dissipation: number, reserve: number): HeatLimits {
  const h = COMBAT.heat;
  const limit = dissipation + reserve;
  return {
    dissipation,
    reserve,
    limit,
    shutdownAt: heatMark(limit, h.shutdown),
    ammoRiskAt: heatMark(limit, h.ammoRisk),
    pilotRiskAt: heatMark(limit, h.pilotRisk),
    max: heatMark(limit, h.max),
  };
}

export function heatLimits(unit: MechUnit): HeatLimits {
  return heatLimitsFor(unitDissipation(unit), hullReserveOf(unit.weightClass));
}

/** Тепло на пороге отключения или выше — «перегрев» для всех правил, что его читают. */
export function isOverheated(unit: MechUnit, heat: number = unit.heat): boolean {
  return heat >= heatLimits(unit).shutdownAt;
}

/**
 * Уйдёт ли машина в отключение в ближайшей фазе тепла при таком тепле.
 *
 * Не то же, что `isOverheated`: только что перезапущенный реактор в этом ходу
 * не отключается (защита от петли, `commands/execute.ts`), обесточенный —
 * перезапускается. Интерфейс предупреждает именно по этой функции: «шкала не
 * мигает — машина не отключится» обязано быть правдой без исключений.
 */
export function wouldShutDown(unit: MechUnit, heat: number = unit.heat): boolean {
  if (unit.shutdown || unit.shutdownLastTurn) return false;
  return isOverheated(unit, heat);
}

/** Модификатор к попаданию: старшая достигнутая ступень `heat.toHitSteps`. */
export function heatToHitMod(heat: number, limit: number): number {
  let mod = 0;
  for (const step of COMBAT.heat.toHitSteps) {
    if (heat >= heatMark(limit, step)) mod = Math.max(mod, step.mod);
  }
  return mod;
}

/** Штраф MP: старшая достигнутая ступень `heat.mpPenaltySteps`, а не сумма (rules.md). */
export function heatMpPenalty(heat: number, limit: number): number {
  let penalty = 0;
  for (const step of COMBAT.heat.mpPenaltySteps) {
    if (heat >= heatMark(limit, step)) penalty = Math.max(penalty, step.mp);
  }
  return penalty;
}
