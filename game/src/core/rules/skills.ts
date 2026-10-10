import { PILOTS } from '../data/tables.js';
import {
  clampSkill,
  MAX_SKILL,
  MIN_SKILL,
  skillLevel,
  type Pilot,
  type SkillId,
  type SkillMap,
} from '../model/Pilot.js';
import type { Rng } from '../rng/index.js';
import { HOUSE_IDS, isClan, makePersona } from './names.js';

/**
 * Числовые таблицы навыков (wiki/design/pilots/skills.md).
 *
 * Каждый навык делает ровно одну работу. Соблазн считать срыв от профильного
 * навыка (промах по Стрельбе — от Стрельбы) отвергнут сознательно: навык влиял бы
 * на исход дважды, разрыв между новобранцем и ветераном раздулся бы до неиграбельного,
 * а балансировать стало бы нечем. Разбор — в вики.
 */

function at(table: readonly number[], level: number): number {
  const v = table[clampSkill(level) - 1];
  if (v === undefined) throw new RangeError(`Уровень вне таблицы: ${level}`);
  return v;
}

/** Стрельба → база целевого числа 2d6. */
export function gunneryBase(level: number): number {
  return at(PILOTS.tables.gunneryBase, level);
}

/** Пилотирование → целевое число броска на удержание равновесия. */
export function pilotingTarget(level: number): number {
  return at(PILOTS.tables.pilotingTarget, level);
}

/** Хладнокровие → базовая вероятность срыва исполнения. */
export function composureBotch(level: number): number {
  return at(PILOTS.tables.composureBotch, level);
}

/** Тактика → модификатор к броску инициативы. */
export function initiativeMod(level: number): number {
  return at(PILOTS.tables.tacticsInitiative, level);
}

/**
 * Тактика → шум в оценке хода бота (design/ai.md).
 * Сложность противника задаётся навыком его пилотов, а не бонусами к броскам.
 */
export function botNoise(level: number): number {
  return at(PILOTS.tables.tacticsNoise, level);
}

/** Выносливость → множитель к вероятности ранения. */
export function injuryMultiplier(level: number): number {
  return at(PILOTS.tables.enduranceInjuryMul, level);
}

/** Те же таблицы, но от пилота: уровень берётся с учётом травм. */
export const pilotGunneryBase = (p: Pilot): number => gunneryBase(skillLevel(p, 'gunnery'));
export const pilotPilotingTarget = (p: Pilot): number => pilotingTarget(skillLevel(p, 'piloting'));
export const pilotComposureBotch = (p: Pilot): number => composureBotch(skillLevel(p, 'composure'));
export const pilotInitiativeMod = (p: Pilot): number => initiativeMod(skillLevel(p, 'tactics'));
export const pilotBotNoise = (p: Pilot): number => botNoise(skillLevel(p, 'tactics'));
export const pilotInjuryMultiplier = (p: Pilot): number =>
  injuryMultiplier(skillLevel(p, 'endurance'));

/** Стоимость следующего уровня: квадратичная — ранний рост быстрый, поздний дорогой. */
export function levelCost(fromLevel: number): number {
  const n = clampSkill(fromLevel);
  return PILOTS.progression.levelCostBase * n * n;
}

// --- создание пилота ---------------------------------------------------------

export interface PilotOptions {
  readonly id: string;
  readonly name?: string;
  readonly callsign?: string;
  /** Ключ происхождения из data/pilots.json. По умолчанию — случайное, согласованное с принадлежностью. */
  readonly origin?: string;
  /**
   * Дом или клан пилота: id из реестра фракций. По умолчанию — случайный
   * Великий Дом. Отсюда берутся имя, лицо и подпись в казармах.
   */
  readonly affiliation?: string;
  /** Средний уровень навыков. Из него растут стартовые значения. */
  readonly tier?: number;
  /** Потолок уровня навыка: полоса найма (сферный наёмник не бывает выше семи). */
  readonly maxLevel?: number;
  /** Пол уровня навыка: полоса найма (клановый воин не бывает ниже восьми). */
  readonly minLevel?: number;
  /**
   * Потолок таланта: докуда пилот способен вырасти. По умолчанию — общие
   * границы `progression.talentCapMin/Max`; полоса найма задаёт свои.
   */
  readonly capMin?: number;
  readonly capMax?: number;
  /** Заданные вручную навыки перекрывают сгенерированные — нужно тестам и сценариям. */
  readonly skills?: SkillMap;
}

/**
 * Сборка пилота из сида. Происхождение сдвигает и уровни, и потолки: без потолков
 * все пилоты через N боёв становятся одинаковыми, а найм теряет смысл.
 */
export function makePilot(rng: Rng, opts: PilotOptions): Pilot {
  // ПРИНАДЛЕЖНОСТЬ ПЕРВОЙ: от неё зависят и происхождение, и лицо, и имя.
  // Клановое происхождение не встречается у наёмника из Дома и наоборот —
  // отбор идёт по `side`, а не по совпадению букв в id.
  const affiliation = opts.affiliation ?? rng.pick(HOUSE_IDS);
  const side = isClan(affiliation) ? 'clan' : 'sphere';
  const origins = PILOTS.origins.filter((o) => o.side === side);
  const origin =
    opts.origin !== undefined
      ? (PILOTS.origins.find((o) => o.id === opts.origin) ?? rng.pick(origins))
      : rng.pick(origins);

  const tier = opts.tier ?? 4;
  const floor = Math.max(MIN_SKILL, opts.minLevel ?? MIN_SKILL);
  const ceiling = Math.min(MAX_SKILL, opts.maxLevel ?? MAX_SKILL);
  const capFloor = Math.max(MIN_SKILL, opts.capMin ?? PILOTS.progression.talentCapMin);
  const capCeiling = Math.min(MAX_SKILL, Math.max(capFloor, opts.capMax ?? PILOTS.progression.talentCapMax));
  const strong = new Set(origin.strong);
  const weak = new Set(origin.weak);

  const skills: Record<SkillId, number> = {};
  const caps: Record<SkillId, number> = {};
  const xp: Record<SkillId, number> = {};

  for (const s of PILOTS.skills) {
    const bias = strong.has(s.id) ? 1 : weak.has(s.id) ? -1 : 0;
    // Полоса найма режет ПОСЛЕ разброса, а не вместо него: разброс — это
    // характер пилота («стреляет как бог, но паникует»), и терять его ради
    // границы полосы незачем.
    const level = Math.max(floor, Math.min(ceiling, clampSkill(tier + bias + rng.int(-1, 1))));

    const capBias = strong.has(s.id) ? 1 : weak.has(s.id) ? -1 : 0;
    // Потолок никогда не ниже текущего уровня: пилот, пришедший с десяткой,
    // просто вырос до своего предела, а не «сломан».
    const cap = Math.max(
      level,
      Math.min(capCeiling, Math.max(capFloor, rng.int(capFloor, capCeiling) + capBias)),
    );

    skills[s.id] = level;
    caps[s.id] = cap;
    xp[s.id] = 0;
  }

  // Имя и лицо — последними: любой новый бросок дописывается в КОНЕЦ, иначе
  // один и тот же сид даёт другую роту при неизменных данных.
  const persona = makePersona(rng, affiliation);

  return {
    id: opts.id,
    name: opts.name ?? persona.name,
    callsign: opts.callsign ?? persona.callsign,
    origin: origin.id,
    affiliation,
    gender: persona.gender,
    face: persona.face,
    skills: opts.skills !== undefined ? { ...skills, ...opts.skills } : skills,
    caps,
    xp,
    injuries: 0,
    status: 'active',
    firstBattle: true,
  };
}

/**
 * Начисление опыта за событие. Сверх потолка опыт копится, но уровень не растёт.
 *
 * Навыков у события может быть несколько (`pilots.json → progression.xp`):
 * «контракт выполнен» платит каждому задействованному навыку, попадание — одной
 * Стрельбе. Событие, которого в таблице нет, не начисляет ничего и не бросает:
 * таблица — данные, и лишнее имя в вызове не должно останавливать разбор боя.
 */
export function awardXp(pilot: Pilot, event: string): Pilot {
  const row = PILOTS.progression.xp[event];
  if (row === undefined) return pilot;
  const xp = { ...pilot.xp };
  for (const skill of row.skills) xp[skill] = (xp[skill] ?? 0) + row.amount;
  return settleTraining({ ...pilot, xp });
}

/**
 * Автоматическое обучение (решение пользователя, 2026-09-14): опыт переходит в
 * уровни сам, как только его хватает, — до потолка таланта. Кнопка «Учить»
 * ничего не решала: опыт навыка тратится только на этот навык, и отложить его
 * было не на что, так что игрок лишь заходил в казармы нажать её.
 *
 * Прогон по ВСЕМ навыкам, а не только по навыкам события: сохранения, в которых
 * опыта уже хватало, догоняют свои уровни при первом же начислении.
 */
export function settleTraining(pilot: Pilot): Pilot {
  let p = pilot;
  for (const s of PILOTS.skills) {
    for (;;) {
      const next = trainSkill(p, s.id);
      if (next === p) break;
      p = next;
    }
  }
  return p;
}

/**
 * Превращение опыта в уровни. Делается между заданиями, а не в бою: рост посреди
 * боя ломал бы воспроизводимость реплея и читался бы как случайность.
 */
export function trainSkill(pilot: Pilot, id: SkillId): Pilot {
  const level = pilot.skills[id];
  if (level === undefined) return pilot;
  const cap = pilot.caps[id] ?? MAX_SKILL;
  if (level >= cap || level >= MAX_SKILL) return pilot;

  const cost = levelCost(level);
  const have = pilot.xp[id] ?? 0;
  if (have < cost) return pilot;

  return {
    ...pilot,
    skills: { ...pilot.skills, [id]: Math.max(MIN_SKILL, level + 1) },
    xp: { ...pilot.xp, [id]: have - cost },
  };
}
