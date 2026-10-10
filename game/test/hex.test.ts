import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  Direction,
  compare,
  distance,
  equals,
  fromKey,
  hex,
  key,
  neighbor,
  neighbors,
  opposite,
  rotate,
  turnCost,
} from '../src/core/hex/index.js';

const GRID = (() => {
  const out = [];
  for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) out.push(hex(q, r));
  return out;
})();

describe('соседи и направления', () => {
  it('шесть направлений, все различны', () => {
    expect(DIRECTIONS).toHaveLength(6);
    expect(new Set(DIRECTIONS.map(key)).size).toBe(6);
  });

  it('каждый сосед находится на расстоянии 1', () => {
    for (const h of GRID) {
      for (const n of neighbors(h)) expect(distance(h, n)).toBe(1);
    }
  });

  it('сосед в противоположном направлении возвращает обратно', () => {
    for (const h of GRID) {
      for (let d = 0; d < 6; d++) {
        const dir = d as Direction;
        expect(equals(neighbor(neighbor(h, dir), opposite(dir)), h)).toBe(true);
      }
    }
  });

  it('ровно шесть клеток на расстоянии 1 от любой', () => {
    const origin = hex(0, 0);
    expect(GRID.filter((h) => distance(origin, h) === 1)).toHaveLength(6);
  });
});

describe('расстояние', () => {
  it('до самой себя ноль', () => {
    for (const h of GRID) expect(distance(h, h)).toBe(0);
  });

  it('симметрично', () => {
    for (const a of GRID) for (const b of GRID) expect(distance(a, b)).toBe(distance(b, a));
  });

  it('соблюдает неравенство треугольника', () => {
    const sample = GRID.filter((_, i) => i % 7 === 0);
    for (const a of sample)
      for (const b of sample)
        for (const c of sample)
          expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
  });

  it('всегда целое и неотрицательное', () => {
    for (const a of GRID)
      for (const b of GRID) {
        const d = distance(a, b);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }
  });
});

describe('фасинги', () => {
  it('поворот на 6 шагов возвращает исходный', () => {
    for (let d = 0; d < 6; d++) expect(rotate(d as Direction, 6)).toBe(d);
  });

  it('нормализует отрицательные шаги', () => {
    expect(rotate(Direction.NW, -1)).toBe(Direction.W);
    expect(rotate(Direction.NW, -7)).toBe(Direction.W);
  });

  it('цена поворота не больше 3 и симметрична', () => {
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++) {
        const c = turnCost(a as Direction, b as Direction);
        expect(c).toBeLessThanOrEqual(3);
        expect(c).toBe(turnCost(b as Direction, a as Direction));
      }
  });

  it('противоположное направление стоит 3 поворота', () => {
    for (let d = 0; d < 6; d++) expect(turnCost(d as Direction, opposite(d as Direction))).toBe(3);
  });
});

describe('ключи и порядок', () => {
  it('ключ обратим', () => {
    for (const h of GRID) expect(fromKey(key(h))).toEqual(h);
  });

  it('ключи уникальны', () => {
    expect(new Set(GRID.map(key)).size).toBe(GRID.length);
  });

  it('сортировка детерминирована и полна', () => {
    const a = [...GRID].sort(compare);
    const b = [...GRID].reverse().sort(compare);
    expect(a).toEqual(b);
  });
});
