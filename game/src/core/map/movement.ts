import type { Direction, Hex } from '../hex/index.js';
import { EDGE_BRIDGE, EDGE_CLIFF, EDGE_GATE, EDGE_WALL } from './edges.js';
import type { HexMap } from './HexMap.js';
import { terrainInfo } from '../data/tables.js';
import { TerrainType } from './TerrainType.js';

export enum MoveMode {
  Walk = 0,
  Run = 1,
  Jump = 2,
}

/** Максимальный подъём шагом за один гекс. Выше — только прыжком. */
export const MAX_CLIMB = 1;
/** Спуск глубже этого шагом запрещён. Ровно на эту величину — с броском пилотирования. */
export const MAX_DESCENT = 2;
/** Глубже этого воду шагом не перейти: робот скрывается с головой. */
export const MAX_WADE_DEPTH = 2;

/** Почему переход невозможен. Одно место на все причины отказа. */
export enum Blocked {
  OffMap = 'offMap',
  Cliff = 'cliff',
  Wall = 'wall',
  TooSteepUp = 'tooSteepUp',
  TooSteepDown = 'tooSteepDown',
  DeepWater = 'deepWater',
  Impassable = 'impassable',
}

export interface MoveStep {
  /** Цена шага в очках движения. */
  readonly mp: number;
  /** Нужен бросок пилотирования: спуск на два уровня, бег по пересечённой, переправа. */
  readonly pilotingCheck: boolean;
  /**
   * Ключ причины броска. Нужен журналу: «не удержался» без причины читается как
   * произвол игры, а с причиной — как следствие выбранного маршрута.
   */
  readonly pilotingReason: string | null;
  /** Глубина погружения после шага: 0 суша, 1 по колено, 2 по пояс. */
  readonly submerged: 0 | 1 | 2;
}

export type MoveResult = { readonly ok: true; readonly step: MoveStep } | { readonly ok: false; readonly reason: Blocked };

/**
 * Цена перехода из клетки в соседнюю.
 *
 * Принимает ОБЕ клетки и направление, а не только цель: перепад высот и признаки
 * ребра (река, обрыв, мост) — свойства перехода, а не целевого гекса. Сигнатура
 * вида cost(cell) высоты бы не приняла (wiki/decisions.md, 2026-08-24).
 *
 * Три причины отказа — рельеф, уровень, ребро — проверяются здесь и только здесь,
 * поэтому на вопрос «почему сюда нельзя» всегда один ответ.
 */
export function moveCost(map: HexMap, from: Hex, to: Hex, dir: Direction, mode: MoveMode): MoveResult {
  if (!map.contains(to)) return { ok: false, reason: Blocked.OffMap };

  const terrain = map.getTerrain(to);
  const info = terrainInfo(terrain);
  const depth = map.getDepth(to);
  const delta = map.getElevation(to) - map.getElevation(from);
  const edge = map.getEdge(from, dir);
  const bridged = (edge & EDGE_BRIDGE) !== 0;

  // --- Прыжок: перелетает рельеф и рёбра, важна только точка приземления ---
  if (mode === MoveMode.Jump) {
    if (!info.walkable) return { ok: false, reason: Blocked.Impassable };
    if (depth > MAX_WADE_DEPTH) return { ok: false, reason: Blocked.DeepWater };
    return {
      ok: true,
      step: {
        mp: 1 + Math.max(0, delta),
        pilotingCheck: false,
        pilotingReason: null,
        submerged: clampDepth(depth),
      },
    };
  }

  // --- Шагом: сначала ребро ---
  if (!bridged && (edge & EDGE_CLIFF) !== 0) return { ok: false, reason: Blocked.Cliff };
  if ((edge & (EDGE_WALL | EDGE_GATE)) !== 0) return { ok: false, reason: Blocked.Wall };

  // --- Затем перепад уровней ---
  if (delta > MAX_CLIMB) return { ok: false, reason: Blocked.TooSteepUp };
  if (-delta > MAX_DESCENT) return { ok: false, reason: Blocked.TooSteepDown };

  // --- Затем рельеф ---
  if (!info.walkable) return { ok: false, reason: Blocked.Impassable };
  if (depth > MAX_WADE_DEPTH) return { ok: false, reason: Blocked.DeepWater };

  let mp: number;
  let pilotingCheck = false;
  let pilotingReason: string | null = null;

  if (bridged) {
    // Мост кладёт ровную дорогу поверх всего, что под ним.
    mp = 1;
  } else {
    mp = terrain === TerrainType.Water ? info.enterCost + depth : info.enterCost;
  }

  mp += Math.max(0, delta);

  // Спуск ровно на предел проходится, но с риском падения.
  if (-delta === MAX_DESCENT) {
    pilotingCheck = true;
    pilotingReason = 'piloting.descent';
  }
  // Пересечённая местность, развалины и болото на бегу — и переправа: вода
  // (включая реку, которая теперь просто Water с меткой `river` для показа)
  // тоже требует броска пилотирования на бегу (Total Warfare: PSR при входе
  // в воду бегом), только с более точной причиной в журнале.
  if (mode === MoveMode.Run && info.pilotingOnRun) {
    pilotingCheck = true;
    pilotingReason = terrain === TerrainType.Water ? 'piloting.water' : 'piloting.rough';
  }
  // Вход в воду по пояс.
  if (depth >= MAX_WADE_DEPTH) {
    pilotingCheck = true;
    pilotingReason = 'piloting.deepWater';
  }

  return { ok: true, step: { mp, pilotingCheck, pilotingReason, submerged: clampDepth(depth) } };
}

function clampDepth(depth: number): 0 | 1 | 2 {
  if (depth <= 0) return 0;
  if (depth === 1) return 1;
  return 2;
}
