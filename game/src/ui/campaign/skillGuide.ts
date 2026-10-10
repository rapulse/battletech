import { COMBAT, PILOTS } from '../../core/data/tables.js';
import { clampSkill, MAX_SKILL } from '../../core/model/Pilot.js';
import {
  composureBotch,
  gunneryBase,
  initiativeMod,
  injuryMultiplier,
  pilotingTarget,
} from '../../core/rules/skills.js';
import { t } from '../i18n/index.js';

/**
 * Подсказка казарм: что навык даёт СЕЙЧАС и на каком уровне станет лучше.
 *
 * Своих чисел здесь нет — только вопросы к таблицам ядра (`rules/skills.ts`,
 * `data/pilots.json`, `data/combat.json`). Иначе подсказка разошлась бы с
 * правилами при первой же калибровке.
 *
 * Зачем «следующий полезный уровень», а не просто «следующий»: таблицы
 * ступенчатые. Стрельба 5, 6 и 7 дают одну и ту же базу, и игрок, который
 * этого не знает, ждёт от уровня того, чего уровень не даёт.
 */

export interface SkillGuide {
  /** Что навык даёт на текущем уровне (с учётом травм). */
  readonly now: string;
  /** Ближайший уровень, который что-то меняет, или почему такого нет. */
  readonly next: string;
  /** Навык растёт, но ни одно правило его пока не читает. */
  readonly idle: boolean;
}

interface Row {
  /** Число, по которому видно, изменилось ли что-то между уровнями. */
  value(level: number): number;
  text(level: number): string;
}

const pct = (x: number): number => Math.round(x * 100);
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const decimal = (n: number): string => n.toFixed(2).replace('.', ',');

const poise = PILOTS.execution.poise;
const poiseAt = (level: number): number =>
  level >= poise.minLevel ? (level - poise.minLevel + 1) * poise.chancePerLevelAbove : 0;
const immunity = COMBAT.piloting.routineImmunitySkill;

const ROWS: Readonly<Record<string, Row>> = {
  gunnery: {
    value: gunneryBase,
    text: (l) => t('barracks.guide.gunnery', { base: gunneryBase(l) }),
  },
  piloting: {
    // Уровень иммунитета к штатным проверкам — тоже польза, хотя цель та же.
    value: (l) => pilotingTarget(l) * 2 + (l >= immunity ? 0 : 1),
    text: (l) =>
      l >= immunity
        ? t('barracks.guide.pilotingFree', { target: pilotingTarget(l) })
        : t('barracks.guide.pilotingChecks', { target: pilotingTarget(l), level: immunity }),
  },
  tactics: {
    value: (l) => -initiativeMod(l),
    text: (l) => t('barracks.guide.tactics', { mod: signed(initiativeMod(l)) }),
  },
  composure: {
    value: (l) => composureBotch(l) - poiseAt(l),
    text: (l) =>
      poiseAt(l) > 0
        ? t('barracks.guide.composurePoise', { botch: pct(composureBotch(l)), poise: pct(poiseAt(l)) })
        : t('barracks.guide.composure', { botch: pct(composureBotch(l)) }),
  },
  endurance: {
    value: injuryMultiplier,
    text: (l) => t('barracks.guide.endurance', { mul: decimal(injuryMultiplier(l)) }),
  },
};

/**
 * @param level уровень с учётом травм (`skillLevel`)
 * @param base  уровень без травм — его и поднимает кнопка «Учить»
 * @param cap   потолок таланта пилота
 */
export function skillGuide(id: string, level: number, base: number, cap: number): SkillGuide {
  const row = ROWS[id];
  if (row === undefined) return { now: t('barracks.guide.idle'), next: '', idle: true };

  // Травма снимает ступени с уровня, но не с обучения: учим базу, действует база минус травмы.
  const penalty = base - level;
  const effective = (b: number): number => clampSkill(b - penalty);

  const now = t('barracks.guide.now', { effect: row.text(level) });
  const current = row.value(level);
  for (let b = base + 1; b <= MAX_SKILL; b++) {
    if (row.value(effective(b)) === current) continue;
    const next =
      b <= cap
        ? t('barracks.guide.next', { level: b, effect: row.text(effective(b)) })
        : t('barracks.guide.beyondCap', { level: b, cap });
    return { now, next, idle: false };
  }
  return { now, next: t('barracks.guide.top'), idle: false };
}
