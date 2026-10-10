import { compare, distance, hex, type Hex } from './Hex.js';
import { round } from './HexMetrics.js';

/**
 * Линия гексов от a до b включительно. Основа трассировки видимости.
 *
 * Смещение epsilon уводит линию с точных границ гексов, чтобы округление не
 * балансировало на грани.
 */
const EPS = 1e-6;

function trace(a: Hex, b: Hex, n: number): Hex[] {
  const result: Hex[] = new Array<Hex>(n + 1);
  const aq = a.q + EPS;
  const ar = a.r + EPS;
  const bq = b.q + EPS;
  const br = b.r + EPS;

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    result[i] = round(aq + (bq - aq) * t, ar + (br - ar) * t);
  }
  return result;
}

/**
 * Линия строится в каноническом порядке и при необходимости разворачивается.
 *
 * Без этого line(a, b) и line(b, a) на линиях, идущих вдоль границы гексов,
 * дают РАЗНЫЕ наборы промежуточных клеток — просто потому, что обход идёт с
 * другого конца. Отсюда несимметричная видимость: A видит B, B не видит A.
 * Одного лишь epsilon для симметрии недостаточно, он смещает обе линии
 * одинаково, а расходятся они на направлении обхода.
 *
 * Правило настолки «на точной границе выбирает стреляющий» относится к другому
 * уровню: там из двух клеток вдоль ребра берётся более выгодная. Это решается
 * в los(), а геометрия линии обязана быть симметричной сама по себе.
 */
export function line(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n === 0) return [hex(a.q, a.r)];
  if (compare(a, b) > 0) return trace(b, a, n).reverse();
  return trace(a, b, n);
}

/**
 * Линия без концов — только промежуточные гексы. Именно они считаются при
 * трассировке видимости: лес под ногами стрелка обзор не перекрывает.
 */
export function between(a: Hex, b: Hex): Hex[] {
  const l = line(a, b);
  return l.slice(1, -1);
}
