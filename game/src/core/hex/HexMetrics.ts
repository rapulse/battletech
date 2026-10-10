import { hex, type Hex } from './Hex.js';

/**
 * Перевод гекс ↔ пиксели для ОСТРОКРЫШИХ гексов (pointy-top).
 *
 * Размер задаётся шириной и высотой в пикселях, а не «радиусом»: два числа
 * читаются в отладке без тригонометрии, и раскладку можно слегка сплющить, не
 * трогая ни одной формулы.
 *
 *   width  — от грани до грани по ГОРИЗОНТАЛИ (расстояние между центрами соседей в ряду)
 *   height — от вершины до вершины по ВЕРТИКАЛИ
 *
 * Шаг между центрами рядов = 3/4 · height, соседние ряды смещены на width/2.
 * У правильного шестиугольника height = width · 2/√3.
 */
export interface HexLayout {
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
}

export function layout(width: number, height: number, originX = 0, originY = 0): HexLayout {
  return { width, height, originX, originY };
}

/**
 * Регламентный размер проекта: гекс 64×74 при масштабе 1×.
 * 64 · 2/√3 = 73.9 — округлено до целого, отклонение от правильного 0.1 %.
 */
export const DEFAULT_LAYOUT: HexLayout = layout(64, 74);

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Центр гекса в пикселях. */
export function hexToPixel(l: HexLayout, h: Hex): Point {
  return {
    x: l.originX + l.width * (h.q + h.r / 2),
    y: l.originY + 0.75 * l.height * h.r,
  };
}

/** Пиксель → гекс. Основа хит-теста: сцен-граф для этого не нужен (game_core.md §6). */
export function pixelToHex(l: HexLayout, p: Point): Hex {
  const r = (p.y - l.originY) / (0.75 * l.height);
  const q = (p.x - l.originX) / l.width - r / 2;
  return round(q, r);
}

/** Округление дробных аксиальных координат до ближайшего гекса. */
export function round(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);

  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);

  // Отбрасываем координату с наибольшей ошибкой, восстанавливая её из двух других.
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;

  // `| 0` убирает -0: Math.round(-0.3) даёт -0, а -0 !== 0 при Object.is,
  // из-за чего toEqual, ключи и сравнения координат ведут себя непредсказуемо.
  return hex(q | 0, r | 0);
}

/**
 * Шесть вершин гекса в пикселях, ПО ЧАСОВОЙ СТРЕЛКЕ ОТ ЛЕВОЙ ВЕРХНЕЙ.
 *
 * Порядок выбран так, чтобы ребро в направлении dir лежало между вершинами
 * `dir` и `dir + 1`: NW — между левой верхней и верхней, NE — между верхней и
 * правой верхней, и дальше по кругу. Отрисовке рёбер (река, обрыв, стена, мост)
 * тогда не нужна отдельная таблица соответствия, а сбить её правкой порядка
 * вершин нельзя — это проверяет тест.
 */
export function corners(l: HexLayout, h: Hex): Point[] {
  const c = hexToPixel(l, h);
  const hw = l.width / 2;
  const hh = l.height / 2;
  const qh = l.height / 4;
  return [
    { x: c.x - hw, y: c.y - qh }, // 0 левая верхняя
    { x: c.x, y: c.y - hh }, // 1 верхняя
    { x: c.x + hw, y: c.y - qh }, // 2 правая верхняя
    { x: c.x + hw, y: c.y + qh }, // 3 правая нижняя
    { x: c.x, y: c.y + hh }, // 4 нижняя
    { x: c.x - hw, y: c.y + qh }, // 5 левая нижняя
  ];
}

/**
 * Индексы вершин, между которыми лежит ребро в заданном направлении.
 * Совпадает с `[dir, (dir + 1) % 6]` — функция нужна затем, чтобы это свойство
 * было записано явно и проверялось тестом, а не подразумевалось.
 */
export function edgeCorners(dir: number): [number, number] {
  const i = ((dir % 6) + 6) % 6;
  return [i, (i + 1) % 6];
}

/**
 * Прямоугольная сетка ↔ аксиальные координаты (odd-r: нечётные РЯДЫ смещены вправо).
 * Снаружи гекс по-прежнему называется 0101 — колонка и ряд от единицы.
 */
export function offsetToHex(col: number, row: number): Hex {
  return hex(col - ((row - (row & 1)) >> 1), row);
}

export function hexToOffset(h: Hex): { col: number; row: number } {
  return { col: h.q + ((h.r - (h.r & 1)) >> 1), row: h.r };
}

/** Метка гекса в стиле планшетов BattleTech: колонка и ряд по два разряда, с единицы. */
export function hexLabel(h: Hex): string {
  const { col, row } = hexToOffset(h);
  const pad = (n: number): string => String(n + 1).padStart(2, '0');
  return `${pad(col)}${pad(row)}`;
}
