import { skillLevel, type Pilot } from '../../model/Pilot.js';
import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { isPlayerActor } from '../war/actors.js';
import { domainWorlds } from '../war/domain.js';
import { WAR, type GovernorPriority } from '../war/schema.js';
import { NO_BONUSES, type GovernorBonus, type RealmBonuses } from './bonus.js';
import { titleBonusOf } from './titles.js';

/**
 * СЕКТОРЫ И ГУБЕРНАТОРЫ ДЕРЖАВЫ РОТЫ (шаг 88; проект державы §6).
 *
 * Держава в десятки миров поштучно не управляется. Сектор — свои миры в пределах `realm.sectorJumps` прыжков от
 * центра, который выбрал игрок; губернатор — пилот роты, снятый с машины. Губернатор отдаёт те же команды, что
 * игрок (`realm/policy.ts`), а его навыки дают сектору малый бонус — единственное новое правило шага.
 *
 * Сектор — не поле мира, а вывод из центра и карты: мир, взятый у соседа рядом с центром, сам входит в сектор, а
 * потерянный — сам выходит. Плечо снабжения по-прежнему от столицы (шаг 72a): центр сектора экономики не трогает.
 */

const R = WAR.realm;

/** Стойка фронта против врага. «Держать» — отсутствие записи: политика молчит. */
export const FRONT_STANCES = ['advance', 'hold', 'yield'] as const;
export type FrontStance = (typeof FRONT_STANCES)[number];

export interface Sector {
  /** Центр — свой мир; он же id сектора. */
  readonly center: string;
  /** Пилот-губернатор; `null` — пост пуст (губернатора уволили), сектор ничего не делает. */
  readonly governor: string | null;
  readonly priority: GovernorPriority;
}

export interface RealmState {
  /** В порядке назначения: при равном расстоянии мир принадлежит сектору, назначенному раньше. */
  readonly sectors: readonly Sector[];
  /** Миры, закреплённые игроком за собой: губернатор по ним команд не отдаёт. По возрастанию id. */
  readonly pinned: readonly string[];
  /** Резерв кассы: губернатор не опускает кассу ниже. Один из `realm.reserveSteps`. */
  readonly reserve: number;
  /** Стойки фронтов: враг → `advance` | `yield`. Без записи — «держать». */
  readonly stances: Readonly<Record<string, Exclude<FrontStance, 'hold'>>>;
  /**
   * Ручная принадлежность мира сектору (шаг 93): мир → центр. Действует, пока сектор жив и центр не дальше
   * `realm.sectorJumps` прыжков; иначе мир идёт по геометрии. Нет записи — геометрия, как до шага 93.
   */
  readonly assigned?: Readonly<Record<string, string>>;
  /**
   * Цель стойки «наступать», выбранная игроком (шаг 93): враг → участок. Нет записи — цель выбирает
   * `policy.ts::stanceTarget`, как до шага 93.
   */
  readonly targets?: Readonly<Record<string, string>>;
}

export const NO_REALM: RealmState = Object.freeze({
  sectors: Object.freeze([]) as readonly Sector[],
  pinned: Object.freeze([]) as readonly string[],
  reserve: R.reserveDefault,
  stances: Object.freeze({}),
});

/** Отличается ли состояние от начального — для хэша: держава без секторов и стоек хэширует как прежде. */
export function realmIsDefault(r: RealmState): boolean {
  return (
    r.sectors.length === 0 &&
    r.pinned.length === 0 &&
    r.reserve === R.reserveDefault &&
    Object.keys(r.stances).length === 0 &&
    Object.keys(r.assigned ?? {}).length === 0 &&
    Object.keys(r.targets ?? {}).length === 0
  );
}

export function stanceOf(r: RealmState, factionId: string): FrontStance {
  return r.stances[factionId] ?? 'hold';
}

export function sectorAt(r: RealmState, center: string): Sector | undefined {
  return r.sectors.find((s) => s.center === center);
}

/** Сектор, где губернатором этот пилот. */
export function governorSector(r: RealmState, pilotId: string): Sector | undefined {
  return r.sectors.find((s) => s.governor === pilotId);
}

export function isGovernor(r: RealmState, pilotId: string): boolean {
  return governorSector(r, pilotId) !== undefined;
}

/** Предел секторов: `floor(миров державы ÷ realm.worldsPerSector)` плюс прибавка титула (шаг 89). */
export function sectorLimit(deltas: GalaxyDeltas): number {
  const worlds = domainWorlds(deltas).length;
  return Math.floor(worlds / R.worldsPerSector) + titleBonusOf(worlds).sectors;
}

/** Прыжков от `from` до каждой системы в пределах `realm.sectorJumps` — обход в ширину по соседству. */
function jumpsFrom(from: number): ReadonlyMap<number, number> {
  const seen = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= R.sectorJumps; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.set(j, d);
        next.push(j);
      }
    }
    frontier = next;
  }
  return seen;
}

/** Сколько прыжков от центра до мира, если не дальше `realm.sectorJumps`; `undefined` — дальше. */
export function sectorJumps(center: string, world: string): number | undefined {
  return jumpsFrom(GALAXY.require(center)).get(GALAXY.require(world));
}

/** Действует ли сектор: его центр — мир роты. Сектор с потерянным центром такт распускает. */
export function sectorLive(deltas: GalaxyDeltas, s: Sector): boolean {
  const i = GALAXY.index(s.center);
  return i >= 0 && isPlayerActor(ownerOf(deltas, i));
}

/**
 * Какому сектору принадлежит каждый мир роты: ближайшему центру в пределах радиуса, при равенстве — сектору,
 * назначенному раньше. Ручная принадлежность (`assigned`, шаг 93) перекрывает геометрию, пока её сектор жив и мир
 * в его радиусе. Мир вне всех секторов в карте не значится.
 */
export function sectorMap(deltas: GalaxyDeltas, r: RealmState): ReadonlyMap<string, string> {
  const owned = new Set(domainWorlds(deltas));
  const best = new Map<number, { center: string; jumps: number }>();
  for (const s of r.sectors) {
    if (!sectorLive(deltas, s)) continue;
    for (const [i, jumps] of jumpsFrom(GALAXY.require(s.center))) {
      if (!owned.has(i)) continue;
      const cur = best.get(i);
      // Строго меньше: при равенстве остаётся сектор, назначенный раньше (обход идёт в порядке назначения).
      if (cur === undefined || jumps < cur.jumps) best.set(i, { center: s.center, jumps });
    }
  }
  const out = new Map<string, string>();
  for (const i of [...best.keys()].sort((a, b) => a - b)) out.set(GALAXY.id(i), (best.get(i) as { center: string }).center);
  for (const [world, center] of Object.entries(r.assigned ?? {})) {
    const sector = sectorAt(r, center);
    if (sector === undefined || !sectorLive(deltas, sector) || !out.has(world)) continue;
    if (sectorJumps(center, world) !== undefined) out.set(world, center);
  }
  return out;
}

/** Миры сектора по возрастанию индекса каталога. */
export function sectorWorlds(deltas: GalaxyDeltas, r: RealmState, center: string): readonly string[] {
  const out: string[] = [];
  for (const [id, c] of sectorMap(deltas, r)) if (c === center) out.push(id);
  return out;
}

/** Бонус губернатора по его навыкам: линеен от (уровень − `skillFloor`), не меньше нуля. */
export function governorBonus(pilot: Pilot): GovernorBonus {
  const G = R.governor;
  const above = (skill: string): number => Math.max(0, skillLevel(pilot, skill) - G.skillFloor);
  return {
    loyalty: above('presence') * G.loyaltyPerLevel,
    points: above('tech') * G.pointsPerLevel,
    defence: 1 + above('tactics') * G.defencePerLevel,
  };
}

/**
 * Бонусы губернаторов всем мирам их секторов — одна функция на такт и экран. Закреплённый мир бонус получает:
 * закрепление снимает команды губернатора, а не его самого.
 */
export function realmBonuses(deltas: GalaxyDeltas, r: RealmState, pilots: readonly Pilot[]): RealmBonuses {
  const mine = domainWorlds(deltas);
  // Титул державы (шаг 89) — прибавка всем её мирам поверх губернатора; без титульной прибавки и секторов — пусто.
  const title = titleBonusOf(mine.length);
  const titled = title.loyalty > 0 || title.points > 0;
  if (r.sectors.length === 0 && !titled) return NO_BONUSES;
  const byCenter = new Map<string, GovernorBonus>();
  for (const s of r.sectors) {
    const pilot = s.governor === null ? undefined : pilots.find((p) => p.id === s.governor);
    if (pilot !== undefined) byCenter.set(s.center, governorBonus(pilot));
  }
  const out = new Map<string, GovernorBonus>();
  if (r.sectors.length > 0) {
    for (const [id, center] of sectorMap(deltas, r)) {
      const b = byCenter.get(center);
      if (b !== undefined) out.set(id, b);
    }
  }
  if (!titled) return out;
  for (const i of mine) {
    const id = GALAXY.id(i);
    const b = out.get(id);
    out.set(id, {
      loyalty: (b?.loyalty ?? 0) + title.loyalty,
      points: (b?.points ?? 0) + title.points,
      defence: b?.defence ?? 1,
    });
  }
  return out;
}
