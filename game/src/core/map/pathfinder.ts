import {
  DIRECTION_COUNT,
  key as hexKey,
  neighbor,
  turnCost,
  type Direction,
  type Hex,
} from '../hex/index.js';
import type { HexMap } from './HexMap.js';
import { moveCost, MoveMode, type MoveStep } from './movement.js';

/**
 * Состояние поиска — клетка И фасинг.
 *
 * Фасинг входит в состояние сознательно, хотя сейчас поворот бесплатен
 * (turnMpCost = 0). Если позже поворот начнёт стоить MP — как в настолке, — это
 * станет правкой параметра, а не переписыванием поиска, подсветки и ИИ.
 * Узлов всего 225×6, цена общности близка к нулю.
 */
export interface ReachableCell {
  readonly hex: Hex;
  readonly facing: Direction;
  /** Сколько MP потрачено, чтобы сюда попасть. */
  readonly cost: number;
  /** Откуда пришли; null у стартовой клетки. */
  readonly from: ReachableCell | null;
  /** Сколько бросков пилотирования требует маршрут целиком. */
  readonly riskCount: number;
  /** Требовался ли бросок пилотирования хоть на одном шаге маршрута. */
  readonly anyPilotingCheck: boolean;
  readonly submerged: 0 | 1 | 2;
}

/**
 * Сравнение двух способов попасть в одно и то же состояние.
 *
 * Ключ лексикографический: сначала стоимость, при равной — число бросков
 * пилотирования. При одинаковой цене маршрут без риска падения строго лучше,
 * и выбирать между ними произвольно нельзя: игрок ожидает, что подсвеченный
 * путь обходит реку, если это ничего не стоит, а ИИ иначе будет ронять роботов
 * на ровном месте.
 */
function isBetter(cost: number, risk: number, than: ReachableCell): boolean {
  if (cost !== than.cost) return cost < than.cost;
  return risk < than.riskCount;
}

export interface ReachOptions {
  readonly mode: MoveMode;
  readonly mpBudget: number;
  readonly startFacing: Direction;
  /** Цена поворота на один фасинг. По умолчанию 0 — поворот бесплатен. */
  readonly turnMpCost?: number;
  /** Клетки, занятые другими юнитами: пройти нельзя. */
  readonly blocked?: ReadonlySet<number>;
}

export interface ReachResult {
  readonly start: Hex;
  /** Лучшее состояние на каждую пару (клетка, фасинг). Ключ — stateKey. */
  readonly states: ReadonlyMap<number, ReachableCell>;
  /** Самый дешёвый способ оказаться в клетке, без учёта фасинга. Для подсветки. */
  readonly byHex: ReadonlyMap<number, ReachableCell>;
}

function stateKey(h: Hex, facing: Direction): number {
  return hexKey(h) * DIRECTION_COUNT + facing;
}

/**
 * Все клетки, достижимые в пределах бюджета MP.
 *
 * Дейкстра, а не A*: для подсветки достижимого и для перебора в ИИ нужно ВСЁ
 * множество достижимого, а не один маршрут (game_core.md §4.2).
 */
export function reachable(map: HexMap, start: Hex, opts: ReachOptions): ReachResult {
  const turnMpCost = opts.turnMpCost ?? 0;
  const blocked = opts.blocked ?? new Set<number>();

  const states = new Map<number, ReachableCell>();
  const startCell: ReachableCell = {
    hex: start,
    facing: opts.startFacing,
    cost: 0,
    from: null,
    riskCount: 0,
    anyPilotingCheck: false,
    submerged: map.contains(start) ? clamp(map.getDepth(start)) : 0,
  };
  states.set(stateKey(start, opts.startFacing), startCell);

  // Очередь по возрастанию стоимости. Бюджет MP невелик (максимум 10 по rules.md),
  // поэтому обычный массив с сортировкой дешевле и предсказуемее кучи.
  let frontier: ReachableCell[] = [startCell];

  while (frontier.length > 0) {
    // Явный порядок обхода: сначала стоимость, затем координаты и фасинг.
    // Полагаться на порядок вставки нельзя — детерминизм требует сортировки
    // (game_core.md §4.7).
    frontier.sort(
      (a, b) =>
        a.cost - b.cost ||
        a.riskCount - b.riskCount ||
        a.hex.q - b.hex.q ||
        a.hex.r - b.hex.r ||
        a.facing - b.facing,
    );
    const next: ReachableCell[] = [];

    for (const current of frontier) {
      // Устаревшая запись: до этого состояния уже нашли дорогу дешевле.
      const known = states.get(stateKey(current.hex, current.facing));
      if (known !== current) continue;

      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const dir = d as Direction;
        const to = neighbor(current.hex, dir);
        if (!map.contains(to)) continue;
        if (blocked.has(hexKey(to))) continue;

        const turn = turnMpCost === 0 ? 0 : turnCost(current.facing, dir) * turnMpCost;
        const result = moveCost(map, current.hex, to, dir, opts.mode);
        if (!result.ok) continue;

        const cost = current.cost + turn + result.step.mp;
        if (cost > opts.mpBudget) continue;

        const risk = current.riskCount + (result.step.pilotingCheck ? 1 : 0);
        const k = stateKey(to, dir);
        const existing = states.get(k);
        if (existing !== undefined && !isBetter(cost, risk, existing)) continue;

        // Придя в клетку, робот смотрит туда, куда шёл.
        const cell = makeCell(to, dir, cost, risk, current, result.step);
        states.set(k, cell);
        next.push(cell);
      }
    }
    frontier = next;
  }

  return { start, states, byHex: bestByHex(states) };
}

function makeCell(
  hex: Hex,
  facing: Direction,
  cost: number,
  riskCount: number,
  from: ReachableCell,
  step: MoveStep,
): ReachableCell {
  return {
    hex,
    facing,
    cost,
    from,
    riskCount,
    anyPilotingCheck: riskCount > 0,
    submerged: step.submerged,
  };
}

function bestByHex(states: ReadonlyMap<number, ReachableCell>): Map<number, ReachableCell> {
  const out = new Map<number, ReachableCell>();
  // Обход в детерминированном порядке: у равных по стоимости побеждает
  // меньший фасинг, а не тот, что случайно оказался раньше в Map.
  const sorted = [...states.values()].sort(
    (a, b) =>
      a.cost - b.cost ||
      a.riskCount - b.riskCount ||
      a.hex.q - b.hex.q ||
      a.hex.r - b.hex.r ||
      a.facing - b.facing,
  );
  for (const cell of sorted) {
    const k = hexKey(cell.hex);
    if (!out.has(k)) out.set(k, cell);
  }
  return out;
}

/** Маршрут до клетки, от старта включительно. Пустой массив — клетка недостижима. */
export function pathTo(result: ReachResult, target: Hex): ReachableCell[] {
  const cell = result.byHex.get(hexKey(target));
  if (cell === undefined) return [];
  const path: ReachableCell[] = [];
  for (let c: ReachableCell | null = cell; c !== null; c = c.from) path.push(c);
  return path.reverse();
}

/** Стоимость достижения клетки, либо null, если недостижима. */
export function costTo(result: ReachResult, target: Hex): number | null {
  return result.byHex.get(hexKey(target))?.cost ?? null;
}

function clamp(depth: number): 0 | 1 | 2 {
  if (depth <= 0) return 0;
  if (depth === 1) return 1;
  return 2;
}
