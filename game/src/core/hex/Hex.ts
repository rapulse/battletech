/**
 * Аксиальные координаты гекса.
 *
 * Ориентация — ОСТРОКРЫШАЯ (pointy-top): у гекса вершины сверху и снизу, плоские
 * грани слева и справа. Гексы стоят горизонтальными рядами со смещением через ряд.
 * Так нарисован тактический макет проекта; нумерация снаружи по-прежнему 0101 —
 * колонка и ряд по два разряда.
 *
 *           _____             q — аксиальная координата, растёт вправо
 *     NW   /     \   NE       r — номер ряда, растёт вниз
 *         /       \           третья кубическая координата s = -q-r не хранится
 *      W  \       /  E
 *          \_____/
 *        SW         SE
 *
 * Шесть направлений и их аксиальные векторы совпадают с плоскокрышей раскладкой
 * до порядка: тот же цикл, другие имена. Поэтому перевод ориентации не сдвинул
 * ни движения, ни видимости — сменилась только проекция в пиксели и нумерация
 * (`HexMetrics.ts`).
 */
export interface Hex {
  readonly q: number;
  readonly r: number;
}

export function hex(q: number, r: number): Hex {
  return { q, r };
}

/**
 * Направления по часовой стрелке. Индекс = фасинг робота.
 *
 * У острокрышего гекса нет соседа строго на севере: шесть румбов — NW, NE, E,
 * SE, SW, W. Индексы намеренно оставлены за теми же аксиальными векторами, что
 * были у плоскокрышей раскладки, поэтому `opposite`, `rotate` и `turnCost`
 * работают ровно как работали.
 */
export const enum Direction {
  NW = 0,
  NE = 1,
  E = 2,
  SE = 3,
  SW = 4,
  W = 5,
}

export const DIRECTIONS: readonly Hex[] = [
  { q: 0, r: -1 }, // NW — вверх-влево
  { q: 1, r: -1 }, // NE — вверх-вправо
  { q: 1, r: 0 }, // E  — вправо
  { q: 0, r: 1 }, // SE — вниз-вправо
  { q: -1, r: 1 }, // SW — вниз-влево
  { q: -1, r: 0 }, // W  — влево
];

/** Имена румбов по индексу: для журнала и подписей. */
export const DIRECTION_KEYS: readonly string[] = [
  'dir.nw',
  'dir.ne',
  'dir.e',
  'dir.se',
  'dir.sw',
  'dir.w',
];

export const DIRECTION_COUNT = 6;

export function equals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function add(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function subtract(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function scale(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k };
}

/** Соседняя клетка в заданном направлении. */
export function neighbor(h: Hex, dir: Direction): Hex {
  const d = DIRECTIONS[dir];
  if (d === undefined) throw new RangeError(`Некорректное направление: ${dir}`);
  return { q: h.q + d.q, r: h.r + d.r };
}

/** Все шесть соседей, в порядке Direction. */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** Расстояние в гексах (кубическая метрика). */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Направление противоположное данному. Нужно для рёбер: ребро между A и B
 * читается со стороны A как dir, а со стороны B как opposite(dir).
 */
export function opposite(dir: Direction): Direction {
  return ((dir + 3) % 6) as Direction;
}

/**
 * Поворот фасинга на steps шагов по часовой стрелке (отрицательные — против).
 * Нормализует любой вход в диапазон 0..5.
 */
export function rotate(dir: Direction, steps: number): Direction {
  return (((dir + steps) % 6) + 6) % 6 as Direction;
}

/** Кратчайшее число шагов поворота между двумя фасингами: 0..3. */
export function turnCost(from: Direction, to: Direction): number {
  const diff = (((to - from) % 6) + 6) % 6;
  return Math.min(diff, 6 - diff);
}

/** Ключ для Map/Set. Числовой, чтобы обход был предсказуемым и быстрым. */
export function key(h: Hex): number {
  // Смещение на 512 даёт запас координат ±512 при однозначном ключе.
  return (h.q + 512) * 4096 + (h.r + 512);
}

export function fromKey(k: number): Hex {
  return { q: Math.floor(k / 4096) - 512, r: (k % 4096) - 512 };
}

/**
 * Порядок сортировки гексов. Детерминизм требует явного порядка обхода:
 * полагаться на порядок вставки в Map или Set нельзя (game_core.md §4.7).
 */
export function compare(a: Hex, b: Hex): number {
  return a.q - b.q || a.r - b.r;
}
