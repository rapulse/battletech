import {
  distance as coreDistance,
  line as coreLine,
  corners as coreCorners,
  DEFAULT_LAYOUT,
  hexToPixel as coreHexToPixel,
  hexToOffset,
  offsetToHex,
  pixelToHex as corePixelToHex,
  type HexLayout,
  type Point,
} from '../core/hex/index.js';

/**
 * Геометрия для слоя показа, в координатах сетки (колонка, ряд).
 *
 * Отдельный модуль, а не прямое использование `core/hex`, по одной причине:
 * рисование ходит по прямоугольной сетке (перебрать все клетки, взять соседа
 * слева), а правила — по аксиальным. Перевод туда-обратно в каждой строчке
 * отрисовки читался бы хуже, чем один адаптер.
 *
 * ВСЯ геометрия здесь делегирует ядру. Своей формулы перевода в пиксели тут
 * нет и быть не должно: две независимые формулы разойдутся на первом же
 * изменении раскладки, и клик перестанет попадать туда, куда нарисовано.
 */

export const LAYOUT: HexLayout = DEFAULT_LAYOUT;

/** Расстояние между центрами соседей в ряду. */
export const HEX_WIDTH = LAYOUT.width;
/** От вершины до вершины по вертикали. */
export const HEX_HEIGHT = LAYOUT.height;
/** Шаг между рядами. */
export const ROW_STEP = 0.75 * LAYOUT.height;

export interface Offset {
  readonly col: number;
  readonly row: number;
}

export function hexToPixel(col: number, row: number): Point {
  return coreHexToPixel(LAYOUT, offsetToHex(col, row));
}

export function pixelToHex(x: number, y: number): Offset {
  return hexToOffset(corePixelToHex(LAYOUT, { x, y }));
}

/**
 * Шесть вершин, ПО ЧАСОВОЙ ОТ ПРАВОЙ ВЕРХНЕЙ, чтобы ребро к соседу `i` из
 * `neighbours()` лежало между вершинами `i` и `i+1`. Порядок отличается от
 * ядерного началом отсчёта: там он согласован с перечнем `Direction`, здесь —
 * с обходом соседей по сетке, и оба обязаны оставаться самосогласованными.
 */
export function hexCorners(col: number, row: number): Point[] {
  // Ядерный порядок: [левая верхняя, верхняя, правая верхняя, правая нижняя,
  // нижняя, левая нижняя]. Нужный здесь начинается с правой верхней — это
  // сдвиг на два.
  const pts = coreCorners(LAYOUT, offsetToHex(col, row));
  return [pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[0]!, pts[1]!];
}

/**
 * Шесть соседей по сетке, по часовой от восточного: E, SE, SW, W, NW, NE.
 * Ребро номер `i` лежит между вершинами `i` и `i+1` из `hexCorners`.
 */
export function neighbours(col: number, row: number): Offset[] {
  const odd = (row & 1) === 1;
  return odd
    ? [
        { col: col + 1, row },
        { col: col + 1, row: row + 1 },
        { col, row: row + 1 },
        { col: col - 1, row },
        { col, row: row - 1 },
        { col: col + 1, row: row - 1 },
      ]
    : [
        { col: col + 1, row },
        { col, row: row + 1 },
        { col: col - 1, row: row + 1 },
        { col: col - 1, row },
        { col: col - 1, row: row - 1 },
        { col, row: row - 1 },
      ];
}

/** Метка гекса на сетке: 0101, как на планшетах. */
export function coordLabel(col: number, row: number): string {
  const pad = (n: number): string => String(n + 1).padStart(2, '0');
  return `${pad(col)}${pad(row)}`;
}

// --- Контуры массивов --------------------------------------------------------

/**
 * Внешние контуры связной группы клеток, одной или несколькими замкнутыми
 * петлями.
 *
 * Это то, что превращает лес из шести раскрашенных гексов в один массив с
 * органическим краем: собираются рёбра, у которых снаружи нет своего, и
 * сшиваются в петли по совпадению концов.
 */
export function clusterOutline(cells: readonly Offset[]): Point[][] {
  const inside = new Set(cells.map((c) => `${c.col},${c.row}`));
  const edges: { a: Point; b: Point }[] = [];

  for (const cell of cells) {
    const pts = hexCorners(cell.col, cell.row);
    const nb = neighbours(cell.col, cell.row);
    for (let i = 0; i < 6; i++) {
      if (inside.has(`${nb[i]!.col},${nb[i]!.row}`)) continue;
      edges.push({ a: pts[i]!, b: pts[(i + 1) % 6]! });
    }
  }
  if (edges.length === 0) return [];

  const loops: Point[][] = [];
  const used = new Set<number>();

  for (let start = 0; start < edges.length; start++) {
    if (used.has(start)) continue;
    const loop: Point[] = [edges[start]!.a];
    let current = start;
    used.add(start);

    for (let guard = 0; guard < edges.length + 2; guard++) {
      const end = edges[current]!.b;
      loop.push(end);

      let next = -1;
      let bestDist = 1.5;
      for (let j = 0; j < edges.length; j++) {
        if (used.has(j)) continue;
        const d = Math.hypot(edges[j]!.a.x - end.x, edges[j]!.a.y - end.y);
        if (d < bestDist) {
          bestDist = d;
          next = j;
        }
      }
      if (next < 0) break;
      used.add(next);
      current = next;
      if (loop.length > 3 && Math.hypot(end.x - loop[0]!.x, end.y - loop[0]!.y) < 1.5) break;
    }

    if (loop.length > 3) {
      const last = loop[loop.length - 1]!;
      if (Math.hypot(last.x - loop[0]!.x, last.y - loop[0]!.y) < 1.5) loop.pop();
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

/**
 * Сглаживание Чайкина: срезает каждый угол на четверти сторон.
 * Две итерации превращают ломаный контур гексов в мягкий край массива.
 */
export function chaikin(points: readonly Point[], iterations = 2): Point[] {
  if (points.length < 3) return [...points];
  let current: Point[] = [...points];

  for (let it = 0; it < iterations; it++) {
    const out: Point[] = [];
    for (let i = 0; i < current.length; i++) {
      const p0 = current[i]!;
      const p1 = current[(i + 1) % current.length]!;
      out.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      out.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    current = out;
  }
  return current;
}

// --- Помощники отрисовки -----------------------------------------------------

/** «Радиус» гекса: от центра до вершины. Им меряются размеры фишек и значков. */
export const HEX_SIZE = HEX_HEIGHT / 2;

/**
 * Вершины гекса вокруг ПРОИЗВОЛЬНОГО центра, с необязательным уменьшением.
 * Нужна подсветкам: обводка достижимой клетки рисуется чуть внутри её границы,
 * иначе соседние обводки сливаются в сплошную сетку.
 */
export function cornersAt(cx: number, cy: number, size = HEX_SIZE): Point[] {
  const k = size / HEX_SIZE;
  const hw = (HEX_WIDTH / 2) * k;
  const hh = (HEX_HEIGHT / 2) * k;
  const qh = (HEX_HEIGHT / 4) * k;
  // Порядок тот же, что у `hexCorners`: по часовой от правой верхней.
  return [
    { x: cx + hw, y: cy - qh },
    { x: cx + hw, y: cy + qh },
    { x: cx, y: cy + hh },
    { x: cx - hw, y: cy + qh },
    { x: cx - hw, y: cy - qh },
    { x: cx, y: cy - hh },
  ];
}

/** Расстояние в гексах между клетками сетки. Считает ядро. */
export function hexDistance(c1: number, r1: number, c2: number, r2: number): number {
  return coreDistance(offsetToHex(c1, r1), offsetToHex(c2, r2));
}

/**
 * Линия гексов от клетки до клетки. Та же трассировка, что у правил
 * (`core/hex/HexLine`), — иначе подсветка линии огня показывала бы один набор
 * клеток, а видимость считалась бы по другому.
 */
export function hexLine(c1: number, r1: number, c2: number, r2: number): Offset[] {
  return coreLine(offsetToHex(c1, r1), offsetToHex(c2, r2)).map(hexToOffset);
}
