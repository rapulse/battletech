import { isPlayerActor } from '../war/actors.js';
import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { findRoute } from '../galaxy/navigation.js';
import type { MechRecord } from '../mech/MechRecord.js';
import type { Company } from './types.js';

/**
 * ГАРНИЗОН МИРА ИЗ МАШИН РОТЫ (шаг 86b; проект державы §4 C, идея пользователя — `ideas.md` §1, вариант А).
 *
 * Машина роты, выгруженная на мир державы, остаётся записью ангара (`company.mechs`) со своим пилотом:
 * жалованье, износ, ремонт очередью стапеля, лазарет и разбор боя идут тем же путём, что у машины на
 * корабле. Отличие одно — где она стоит. Здесь лежит только это: `recordId → пост`. Машина без поста — на
 * корабле.
 *
 * Гарнизон — парк мира, а не корабля (решение пользователя 2026-10-01): место в ангаре он не занимает, и
 * вместимость считает только машины на корабле (`shipboardMechs`). В контракт, приказ армии и бой
 * восстания на других мирах гарнизон не идёт; чтобы взять машину в дело — забрать её, стоя в системе.
 */

/** Где стоит машина вне корабля. До дня `arrives` она в пути (отход, п. 8 решений) и не дерётся. */
export interface GarrisonPost {
  readonly systemId: string;
  readonly arrives: number;
  /**
   * Машина на складе мира (шаг 87): выгружена без пилота, не дерётся, автонайм её не трогает. Без метки —
   * гарнизон. Получив пилота, машина склада становится гарнизоном.
   */
  readonly depot?: true;
}

/**
 * Политика гарнизона мира (решение пользователя 2026-10-01, п. 8): «драться» — по умолчанию; «отходить» —
 * если нападающий вдвое сильнее всей обороны мира, уйти без боя на свой мир в прыжке.
 */
export type GarrisonPolicy = 'fight' | 'withdraw';

export interface GarrisonState {
  /** `recordId → пост`. Есть только у машин вне корабля. */
  readonly posts: Readonly<Record<string, GarrisonPost>>;
  /** Миры с политикой «отходить», по возрастанию id. Остальные — «драться». */
  readonly withdraw: readonly string[];
}

export const NO_GARRISON: GarrisonState = Object.freeze({ posts: Object.freeze({}), withdraw: Object.freeze([]) });

/** Во сколько раз нападающий должен быть сильнее всей обороны мира, чтобы политика «отходить» увела гарнизон. */
export const WITHDRAW_RATIO = 2;

export function isStationed(g: GarrisonState, recordId: string): boolean {
  return g.posts[recordId] !== undefined;
}

/** Машины на корабле — те, что считает вместимость ангара и видят контракт, приказ и бот. */
export function shipboardMechs(company: Company, g: GarrisonState): readonly MechRecord[] {
  return company.mechs.filter((m) => g.posts[m.id] === undefined);
}

/** Машины на мире (прибывшие к дню `day`), в порядке ангара. */
export function garrisonAt(company: Company, g: GarrisonState, systemId: string, day: number): readonly MechRecord[] {
  return company.mechs.filter((m) => {
    const post = g.posts[m.id];
    return post !== undefined && post.systemId === systemId && post.arrives <= day;
  });
}

/** Миры, где стоит или куда идёт хоть одна машина роты, по возрастанию id. */
export function garrisonWorlds(g: GarrisonState): readonly string[] {
  return [...new Set(Object.values(g.posts).map((p) => p.systemId))].sort();
}

export function policyOf(g: GarrisonState, systemId: string): GarrisonPolicy {
  return g.withdraw.includes(systemId) ? 'withdraw' : 'fight';
}

export function withPolicy(g: GarrisonState, systemId: string, policy: GarrisonPolicy): GarrisonState {
  const rest = g.withdraw.filter((id) => id !== systemId);
  return { ...g, withdraw: policy === 'withdraw' ? [...rest, systemId].sort() : rest };
}

export function withPosts(g: GarrisonState, recordIds: readonly string[], post: GarrisonPost | null): GarrisonState {
  const posts: Record<string, GarrisonPost> = { ...g.posts };
  for (const id of recordIds) {
    if (post === null) delete posts[id];
    else posts[id] = post;
  }
  return { ...g, posts };
}

/** Перенести посты на другой мир (отход, эвакуация): метка склада остаётся при машине. */
export function relocatePosts(
  g: GarrisonState,
  recordIds: readonly string[],
  to: { readonly systemId: string; readonly arrives: number },
): GarrisonState {
  const posts: Record<string, GarrisonPost> = { ...g.posts };
  for (const id of recordIds) {
    posts[id] = g.posts[id]?.depot === true ? { ...to, depot: true } : { ...to };
  }
  return { ...g, posts };
}

/** Машин гарнизона (без склада) на мире — и прибывших, и в пути: так считается предел мира (шаг 87). */
export function garrisonCount(g: GarrisonState, systemId: string): number {
  return Object.values(g.posts).filter((p) => p.systemId === systemId && p.depot !== true).length;
}

/** Машин на складе мира (шаг 87). */
export function depotCount(g: GarrisonState, systemId: string): number {
  return Object.values(g.posts).filter((p) => p.systemId === systemId && p.depot === true).length;
}

export function isInDepot(g: GarrisonState, recordId: string): boolean {
  return g.posts[recordId]?.depot === true;
}

/** Посты машин, которых в роте больше нет (потеряны в бою гарнизона), — снять. */
export function prunePosts(g: GarrisonState, company: Company): GarrisonState {
  const ids = new Set(company.mechs.map((m) => m.id));
  const gone = Object.keys(g.posts).filter((id) => !ids.has(id));
  return gone.length === 0 ? g : withPosts(g, gone, null);
}

/**
 * Куда отходит гарнизон мира `system` (решение пользователя 2026-10-01, п. 8): ближайший мир державы в одном
 * прыжке, при равенстве — меньший id; путь — срок прыжка, как у перелёта роты. `null` — своего мира в
 * прыжке нет, уйти некуда.
 */
export function retreatTarget(
  deltas: GalaxyDeltas,
  system: number,
  day: number,
): { readonly systemId: string; readonly arrives: number } | null {
  let best: number | null = null;
  for (const n of GALAXY.neighbors(system)) {
    if (!isPlayerActor(ownerOf(deltas, n))) continue;
    if (
      best === null ||
      GALAXY.distance(system, n) < GALAXY.distance(system, best) ||
      (GALAXY.distance(system, n) === GALAXY.distance(system, best) && GALAXY.id(n) < GALAXY.id(best))
    ) {
      best = n;
    }
  }
  if (best === null) return null;
  const route = findRoute(system, best);
  if (route === null) return null;
  return { systemId: GALAXY.id(best), arrives: day + route.days };
}

/**
 * Сид боя гарнизона с восстанием (шаг 86b): от мира и дня, как сид боя участка (`war/battle.ts`), — бой
 * свойство мира на этот такт, а не потока состояния; ни одного броска ГПСЧ кампании он не сдвигает.
 */
export function garrisonRevoltSeed(worldSeed: number, systemId: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x1f83d9ab;
  const text = `${systemId}|${day}|garrison-revolt`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
