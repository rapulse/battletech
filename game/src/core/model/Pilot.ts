import { PILOTS } from '../data/tables.js';

/**
 * Пилот. Игровая модель — wiki/design/pilots/skills.md.
 *
 * Навыки лежат словарём, а не полями структуры. Это прямое следствие правила
 * «навыки — список в JSON»: добавить навык означает добавить запись в данные, а не
 * править модель персонажа и все её обработчики.
 */

export type SkillId = string;

/** Уровни навыков, ключ — id из data/pilots.json. */
export type SkillMap = Readonly<Record<SkillId, number>>;

/**
 * Состояние пилота:
 * `active` — в строю;
 * `out` — выбыл по ранению (вернётся после лечения);
 * `ejected` — катапультировался и эвакуирован (вернётся после боя);
 * `lost` — погиб / не успел катапультироваться (потерян навсегда).
 */
export type PilotStatus = 'active' | 'out' | 'ejected' | 'lost';

export interface Pilot {
  readonly id: string;
  /** Имя и позывной — только описание, механики не касаются. */
  readonly name: string;
  readonly callsign: string;
  readonly origin: string;
  /**
   * Дом или клан: id из реестра фракций (`data/galaxy/factions.json`).
   *
   * Ссылка, а не строка с названием: тем же id подписывается герб в казармах и
   * берётся пул имён. Механики боя не касается — как имя и позывной.
   */
  readonly affiliation: string;
  readonly gender: 'male' | 'female';
  /**
   * Номер лица в атласе своей принадлежности (`data/pilots.json → faces`).
   *
   * Лежит В ЗАПИСИ, а не выводится из хэша id, потому что лицо и пол связаны:
   * имя подбиралось под пол, а пол — под нарисованное лицо. Хэш id развалил бы
   * эту связку при первой же смене атласа.
   */
  readonly face: number;
  readonly skills: SkillMap;
  /** Потолок таланта по каждому навыку: 4..10, свой у каждого персонажа. */
  readonly caps: SkillMap;
  /** Накопленный опыт по навыкам. */
  readonly xp: SkillMap;
  readonly injuries: number;
  readonly status: PilotStatus;
  /** Первый бой персонажа: отдельная надбавка к срыву. */
  readonly firstBattle: boolean;
}

export const MIN_SKILL = PILOTS.progression.minLevel;
export const MAX_SKILL = PILOTS.progression.maxLevel;

/**
 * Навыки, которые проседают от травм. Список явный, а не «все кокпитные»:
 * Техника от ушибов не страдает, а Тактика — это опыт, а не моторика.
 */
export const INJURY_AFFECTED: readonly SkillId[] = ['gunnery', 'piloting'];

export function clampSkill(level: number): number {
  return Math.max(MIN_SKILL, Math.min(MAX_SKILL, Math.round(level)));
}

/** Базовый уровень навыка без учёта травм. */
export function baseSkill(pilot: Pilot, id: SkillId): number {
  const v = pilot.skills[id];
  if (v === undefined) throw new RangeError(`У пилота ${pilot.id} нет навыка «${id}»`);
  return v;
}

/**
 * Уровень навыка с учётом травм: −1 за каждые две травмы, но не ниже минимума.
 * Именно этим значением пользуются все правила — обращаться к `skills` напрямую
 * в правилах нельзя, иначе травмы будут работать в одних местах и не работать в других.
 */
export function skillLevel(pilot: Pilot, id: SkillId): number {
  const base = baseSkill(pilot, id);
  if (!INJURY_AFFECTED.includes(id)) return clampSkill(base);
  const penalty = Math.floor(pilot.injuries / PILOTS.injury.skillPenaltyPerInjuries);
  return clampSkill(base - penalty);
}

export function talentCap(pilot: Pilot, id: SkillId): number {
  return pilot.caps[id] ?? MAX_SKILL;
}

/** Ступень мастерства — ярлык для интерфейса, чтобы игрок не считал в уме. */
export function masteryTier(level: number): string {
  if (level <= 2) return 'tier.recruit';
  if (level <= 4) return 'tier.trained';
  if (level <= 6) return 'tier.veteran';
  if (level <= 8) return 'tier.elite';
  return 'tier.legend';
}

export function isFit(pilot: Pilot): boolean {
  return pilot.status === 'active';
}

/** Полный набор навыков одним уровнем — основа для сборки пилота. */
export function uniformSkills(level: number): Record<SkillId, number> {
  const out: Record<SkillId, number> = {};
  for (const s of PILOTS.skills) out[s.id] = clampSkill(level);
  return out;
}
