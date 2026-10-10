import { GALAXY, GALAXY_RULES } from './catalog.js';

/**
 * Навигация: соседи, маршрут, время и цена перелёта (шаг 14, planets.md §5).
 *
 * Два решения, которые дорого менять потом.
 *
 * **1. Смежность не хранится.** Прыжок привода Керни-Фушиды — ровно 30
 * световых лет, соседи ищутся по равномерной сетке (`SpatialGrid`), маршрут —
 * A* поверх неё. Матрица 2000×2000 — четыре миллиона ячеек ради того, что
 * считается по координатам за микросекунды (ловушка 1 брифинга).
 *
 * **2. Стоимость маршрута считается в СУТКАХ, а не в световых годах.** Цена
 * дороги — это зарядка паруса у тусклой звезды и транзит от орбиты до точки
 * прыжка, а не расстояние: два маршрута одной длины различаются на неделю,
 * если один идёт через красные карлики. Деньги выводятся из суток и числа
 * прыжков, поэтому короткий по времени маршрут всегда и дешевле.
 */

const J = GALAXY_RULES.jump;

/** Транзит десантного корабля от орбиты до точки прыжка, суток в одну сторону. */
export const TRANSIT_DAYS = Math.round(J.transitDays);

/** Зарядка паруса у звезды этой системы, целых суток. */
export function rechargeDays(system: number): number {
  return Math.round(J.rechargeHoursByStar[GALAXY.starOf(system)] / 24);
}

const MIN_RECHARGE = Math.min(...Object.values(J.rechargeHoursByStar).map((h) => Math.round(h / 24)));

export interface TravelLeg {
  /** Куда приводит эта нога маршрута. */
  readonly to: number;
  /** Сколько суток она занимает: транзит на выходе, зарядка паруса, транзит на входе. */
  readonly days: number;
}

export interface Route {
  /** Системы по порядку, начиная с исходной. */
  readonly path: readonly number[];
  readonly jumps: number;
  readonly days: number;
  readonly cost: number;
  readonly legs: readonly TravelLeg[];
}

/** Минимальная двоичная куча. Очередь A* без неё вырождается в линейный поиск по фронту. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= (this.keys[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const lastItem = this.items.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.items.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a] as number;
    this.items[a] = this.items[b] as number;
    this.items[b] = ti;
    const tk = this.keys[a] as number;
    this.keys[a] = this.keys[b] as number;
    this.keys[b] = tk;
  }
}

/**
 * Маршрут от системы к системе. `null`, если пути нет.
 *
 * Первый прыжок зарядки не требует: корабль стоит на заряженном парусе. Каждый
 * следующий ждёт зарядки у той звезды, от которой уходит, — отсюда и берётся
 * разница между «три прыжка через жёлтые звёзды» и «три прыжка через красные
 * карлики».
 */
export function findRoute(from: number, to: number): Route | null {
  if (from === to) {
    return { path: [from], jumps: 0, days: 0, cost: 0, legs: [] };
  }

  const n = GALAXY.count;
  const best = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  const heuristic = (i: number): number => {
    const jumps = Math.ceil(GALAXY.distance(i, to) / GALAXY.jumpRangeLy);
    return Math.max(0, jumps - 1) * MIN_RECHARGE;
  };

  best[from] = 0;
  heap.push(from, heuristic(from));

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === 1) continue;
    closed[cur] = 1;
    if (cur === to) break;

    // Ребро стоит зарядки паруса у ТЕКУЩЕЙ звезды, кроме самого первого
    // прыжка: из точки отправления корабль уходит уже заряженным.
    const step = cur === from ? 0 : rechargeDays(cur);
    const g = (best[cur] as number) + step;

    for (const next of GALAXY.neighbors(cur)) {
      if (closed[next] === 1) continue;
      if (g < (best[next] as number)) {
        best[next] = g;
        cameFrom[next] = cur;
        heap.push(next, g + heuristic(next));
      }
    }
  }

  if (!Number.isFinite(best[to] as number)) return null;

  const path: number[] = [];
  for (let i = to; i !== -1; i = cameFrom[i] as number) path.push(i);
  path.reverse();

  return routeOf(path);
}

/** Сборка маршрута из готового пути: раскладка по ногам, сутки, цена. */
function routeOf(path: readonly number[]): Route {
  const jumps = path.length - 1;
  const legs: TravelLeg[] = [];
  for (let i = 0; i < jumps; i++) {
    const outbound = i === 0 ? TRANSIT_DAYS : rechargeDays(path[i] as number);
    const inbound = i === jumps - 1 ? TRANSIT_DAYS : 0;
    legs.push({ to: path[i + 1] as number, days: outbound + inbound });
  }
  const days = legs.reduce((s, l) => s + l.days, 0);
  return {
    path,
    jumps,
    days,
    cost: Math.round(jumps * J.costPerJump + days * J.costPerTransitDay),
    legs,
  };
}

/** Есть ли между системами один прыжок. */
export function isAdjacent(from: number, to: number): boolean {
  return from !== to && GALAXY.distance(from, to) <= GALAXY.jumpRangeLy;
}

/**
 * Число прыжков между системами по кратчайшему пути (без учёта суток).
 * Нужен замеру связности; маршрут игрока строит `findRoute`.
 */
export function jumpDistance(from: number, to: number): number {
  if (from === to) return 0;
  const seen = new Uint8Array(GALAXY.count);
  let frontier = [from];
  seen[from] = 1;
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      for (const j of GALAXY.neighbors(cur)) {
        if (seen[j] === 1) continue;
        if (j === to) return depth;
        seen[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  return -1;
}
