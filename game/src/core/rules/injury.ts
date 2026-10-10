import { PILOTS } from '../data/tables.js';
import type { Pilot } from '../model/Pilot.js';
import type { Rng } from '../rng/index.js';
import { pilotInjuryMultiplier } from './skills.js';

/**
 * Ранения пилота (wiki/design/combat/rules.md, wiki/design/pilots/skills.md).
 *
 * Замысел: попадание в кокпит опасно по-настоящему, обычное — почти нет. Иначе
 * пилоты выбывают каждый бой и привязанности к персонажу не возникает, а без неё
 * пропадает половина смысла кампании.
 *
 * ВАЖНО про числа. Вероятности причин `headArmor`/`headStructure` подобраны под
 * подтверждённую долю попаданий в кокпит ≈ 1/18 (`combat.json` →
 * `hitLocation.headConfirm`). Плоская таблица d6 сама по себе даёт голове 1/6 —
 * вшестеро чаще канона. Если подтверждающий бросок отключить (`confirmOn: 6`) или
 * перейти на каноническую таблицу 2d6 (1/36), эти числа обязаны быть пересчитаны:
 * они не абсолютны, а привязаны к частоте попаданий в зону.
 */

export type InjuryCause = keyof typeof PILOTS.injury.causes;

export interface InjuryOdds {
  readonly cause: InjuryCause;
  /** Вероятность до поправки на Выносливость. */
  readonly base: number;
  readonly endurance: number;
  readonly multiplier: number;
  /** Итоговая вероятность, 0..1. */
  readonly chance: number;
}

export function injuryOdds(pilot: Pilot, cause: InjuryCause): InjuryOdds {
  const base = PILOTS.injury.causes[cause];
  const multiplier = pilotInjuryMultiplier(pilot);
  const endurance = pilot.skills['endurance'] ?? 1;
  return {
    cause,
    base,
    endurance,
    multiplier,
    chance: Math.max(0, Math.min(1, base * multiplier)),
  };
}

/** Порог, после которого пилот выбывает из боя. */
export const OUT_AT = PILOTS.injury.outAt;

/**
 * Добавить ранения. Достигнув порога, пилот выбывает из боя — робот замирает.
 *
 * Выбывание и потеря разведены сознательно: выбывший возвращается в строй после
 * лечения, потерянный — нет. Решение о судьбе выбывшего принимается ПОСЛЕ боя
 * (кто удержал поле, была ли эвакуация), а не броском в его середине. Так игрок
 * не теряет персонажа из-за одного невезучего кубика, но и не чувствует, что
 * ранения ничего не значат.
 */
export function addInjuries(pilot: Pilot, count: number): Pilot {
  if (count <= 0 || pilot.status === 'lost') return pilot;
  const injuries = pilot.injuries + count;
  const status = injuries >= OUT_AT ? 'out' : pilot.status;
  return { ...pilot, injuries, status };
}

/** Пилот катапультировался: спасён, выбыл из текущего боя, вернётся после боя. */
export function markEjected(pilot: Pilot): Pilot {
  if (pilot.status === 'lost') return pilot;
  return { ...pilot, status: 'ejected' };
}

/** Пилот погиб / не успел катапультироваться: потерян навсегда. */
export function markLost(pilot: Pilot): Pilot {
  return { ...pilot, status: 'lost' };
}

export interface InjuryResult {
  readonly injured: boolean;
  readonly odds: InjuryOdds;
  readonly roll: number;
  /** Пилот после броска: состояние обновлено, исходный объект не тронут. */
  readonly pilot: Pilot;
}

/**
 * Бросок на ранение. Идёт потоком `skill` вместе с проверками исполнения:
 * оба относятся к человеку в кокпите, а не к железу.
 */
export function rollInjury(rng: Rng, pilot: Pilot, cause: InjuryCause): InjuryResult {
  const odds = injuryOdds(pilot, cause);
  if (pilot.status === 'lost') {
    return { injured: false, odds, roll: 1, pilot };
  }
  const roll = rng.next();
  const injured = roll < odds.chance;
  return { injured, odds, roll, pilot: injured ? addInjuries(pilot, 1) : pilot };
}

/**
 * Причина ранения от попадания в кокпит: пробита ли броня.
 *
 * Разница десятикратная не случайно. Пока броня держит — это удар по корпусу,
 * пилота трясёт. Когда пробита — осколки внутри кабины.
 */
export function headHitCause(armorHeld: boolean): InjuryCause {
  return armorHeld ? 'headArmor' : 'headStructure';
}
