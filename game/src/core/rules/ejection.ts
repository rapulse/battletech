import { PILOTS } from '../data/tables.js';
import type { MechUnit } from '../model/MechUnit.js';
import type { Pilot } from '../model/Pilot.js';
import { skillLevel } from '../model/Pilot.js';
import type { Rng } from '../rng/index.js';
import { isOverheated } from './heat.js';
import { markEjected, markLost, rollInjury, type InjuryCause, type InjuryResult } from './injury.js';

/**
 * Катапультирование (wiki/design/combat/rules.md, раздел «Пилот в бою»).
 *
 * Главный принцип, ради которого механика и заведена: катапультировавшийся пилот
 * ВСЕГДА возвращается в отряд. Поражение стоит машины (деньги) и времени на
 * лечение, но не персонажа. Поэтому риск потерять человека живёт ровно в трёх
 * местах, и все они редки:
 *
 *   - пробит кокпит — 1d6 решает, ушёл снаряд в приборы или в остекление
 *     (`rollCockpitBreach`, шаг 6). Единственный повод, где человека теряют
 *     БЕЗ броска на уход: катапульта даже не начала работать;
 *   - разрушен кокпит — катапульта в голове, её и разбило. Единственный повод,
 *     где сам бросок на уход может закончиться `lost`;
 *   - разрушен торс — заряд срабатывает сам, пилот уходит всегда, но жёстко.
 *
 * Отсюда `situational`: обстановка мешает ЧЕЛОВЕКУ решиться (добровольный уход,
 * разбитый кокпит), но не мешает автоматике (торс). Если бы модификаторы кусали
 * и торс, они кусали бы именно тогда, когда мех повален и раскалён, — то есть
 * почти всегда, и потери пилотов взлетели бы. Замерено: при базе торса 85 % с
 * модификаторами выходило 0.63 потери за бой против 0.024 на шаге 2.
 */

export type EjectionTrigger = keyof typeof PILOTS.ejection.triggers;

export interface CockpitBreachResult {
  /** Бросок 1d6. */
  readonly roll: number;
  /** Значение, с которого выстрел считается прошедшим сквозь остекление. */
  readonly lostFrom: number;
  readonly lost: boolean;
  readonly pilot: Pilot;
}

/**
 * Пробитие кокпита (`pilots.json` → cockpitBreach).
 *
 * Броня головы пробита — снаряд уже внутри кабины, и остаётся один вопрос: в
 * приборы или в остекление. 1d6, при `lostFrom` и выше — в стекло, и пилот не
 * успевает даже потянуться к катапульте. Это единственный повод потерять
 * человека БЕЗ броска на уход: во всех остальных случаях катапульта хотя бы
 * пробует сработать.
 *
 * Бросок один на залп, а не на ствол — ровно как ранение от пробитой головы
 * (`headStructure`): два счёта одного события разошлись бы между собой.
 */
export function rollCockpitBreach(rng: Rng, pilot: Pilot): CockpitBreachResult {
  const cfg = PILOTS.cockpitBreach;
  const roll = 1 + Math.floor(rng.next() * cfg.die);
  const lost = roll >= cfg.lostFrom;
  return { roll, lostFrom: cfg.lostFrom, lost, pilot: lost ? markLost(pilot) : pilot };
}

export interface EjectionFactor {
  readonly key: string;
  readonly mod: number;
}

export interface EjectionOdds {
  readonly trigger: EjectionTrigger;
  readonly base: number;
  /** Пусты для поводов, где обстановка не при чём (сработала автоматика). */
  readonly factors: readonly EjectionFactor[];
  /** Итоговый шанс уйти живым, 0..1. */
  readonly chance: number;
}

export interface EjectionResult {
  readonly odds: EjectionOdds;
  readonly roll: number;
  readonly success: boolean;
  /** Бросок на ранение при приземлении. `null`, если уходить было некому. */
  readonly injury: InjuryResult | null;
  readonly pilot: Pilot;
  readonly unit: MechUnit;
}

/** Причина ранения при приземлении для данного повода. */
export function ejectionInjuryCause(trigger: EjectionTrigger): InjuryCause {
  return PILOTS.ejection.triggers[trigger].injury;
}

export function ejectionOdds(unit: MechUnit, trigger: EjectionTrigger): EjectionOdds {
  const cfg = PILOTS.ejection;
  const spec = cfg.triggers[trigger];
  const factors: EjectionFactor[] = [];

  if (!spec.situational) {
    return { trigger, base: spec.base, factors, chance: spec.base };
  }

  let sumMods = 0;
  const add = (key: string, mod: number): void => {
    factors.push({ key, mod });
    sumMods += mod;
  };

  if (unit.prone) add('ejection.prone', cfg.situational.prone);
  if (unit.submerged > 0) add('ejection.submerged', cfg.situational.submerged);
  if (isOverheated(unit)) add('ejection.heatHigh', cfg.situational.heatHigh);
  if (unit.pilot.injuries > 0) {
    add('ejection.injuries', unit.pilot.injuries * cfg.situational.perInjury);
  }

  const piloting = skillLevel(unit.pilot, 'piloting');
  if (piloting !== 5) {
    add('ejection.piloting', (piloting - 5) * cfg.situational.pilotingBonusPerLevel);
  }

  const chance = Math.max(spec.minChance, Math.min(cfg.maxChance, spec.base + sumMods));
  return { trigger, base: spec.base, factors, chance };
}

/**
 * Бросок на катапультирование. Поток `skill`: и уход, и приземление — про
 * человека в кокпите, а не про железо.
 *
 * Порядок внутри важен. Сначала решается, ушёл ли пилот; только ушедший
 * бросает на ранение; статус `ejected` ставится последним, чтобы шесть ранений
 * не превратили спасённого обратно в `out` — из боя он выбыл в любом случае, но
 * отряд обязан видеть, что человека подобрали.
 */
export function rollEjection(
  rng: Rng,
  unit: MechUnit,
  trigger: EjectionTrigger,
): EjectionResult {
  const odds = ejectionOdds(unit, trigger);

  // Гарантированный уход не тратит бросок: лишнее обращение к ГПСЧ сдвинуло бы
  // поток и обесценило сохранённые бои.
  const guaranteed = odds.chance >= 1;
  const roll = guaranteed ? 0 : rng.next();
  const success = guaranteed || roll < odds.chance;

  let injury: InjuryResult | null = null;
  let pilot: Pilot;

  if (success) {
    injury = rollInjury(rng, unit.pilot, ejectionInjuryCause(trigger));
    pilot = markEjected(injury.pilot);
  } else {
    pilot = markLost(unit.pilot);
  }

  return { odds, roll, success, injury, pilot, unit: { ...unit, pilot, destroyed: true } };
}
