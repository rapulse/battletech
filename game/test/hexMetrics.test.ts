import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  Direction,
  corners,
  edgeCorners,
  distance,
  hex,
  hexLabel,
  hexToOffset,
  hexToPixel,
  layout,
  neighbor,
  neighbors,
  offsetToHex,
  pixelToHex,
} from '../src/core/hex/index.js';

const GRID = (() => {
  const out = [];
  for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) out.push(hex(q, r));
  return out;
})();

describe('гекс ↔ пиксели', () => {
  it('регламентный размер — 64×74, гекс почти правильный', () => {
    expect(DEFAULT_LAYOUT.width).toBe(64);
    expect(DEFAULT_LAYOUT.height).toBe(74);
    // У правильного острокрышего гекса высота = ширина · 2/√3. Отклонение
    // регламентного размера от правильного не должно быть заметно глазом.
    const ideal = (DEFAULT_LAYOUT.width * 2) / Math.sqrt(3);
    expect(Math.abs(DEFAULT_LAYOUT.height - ideal) / ideal).toBeLessThan(0.01);
  });

  it('обратимо: центр гекса всегда попадает в свой гекс', () => {
    for (const h of GRID) expect(pixelToHex(DEFAULT_LAYOUT, hexToPixel(DEFAULT_LAYOUT, h))).toEqual(h);
  });

  it('обратимо при любой точке внутри гекса, а не только в центре', () => {
    const l = DEFAULT_LAYOUT;
    // Смещения заведомо внутри гекса: четверть ширины и треть высоты.
    const offsets = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: -12, y: 0 },
      { x: 0, y: 18 },
      { x: 0, y: -18 },
    ];
    for (const h of GRID) {
      const c = hexToPixel(l, h);
      for (const o of offsets) {
        expect(pixelToHex(l, { x: c.x + o.x, y: c.y + o.y })).toEqual(h);
      }
    }
  });

  it('соседи по ряду отстоят ровно на ширину', () => {
    const l = DEFAULT_LAYOUT;
    const a = hexToPixel(l, hex(0, 0));
    const b = hexToPixel(l, hex(1, 0));
    expect(b.x - a.x).toBeCloseTo(l.width);
    expect(b.y - a.y).toBeCloseTo(0);
  });

  it('шаг между рядами — 3/4 высоты, со смещением на полширины', () => {
    const l = DEFAULT_LAYOUT;
    const a = hexToPixel(l, hex(0, 0));
    const b = hexToPixel(l, hex(0, 1));
    expect(b.x - a.x).toBeCloseTo(l.width / 2);
    expect(b.y - a.y).toBeCloseTo(0.75 * l.height);
  });

  it('ребро в направлении dir лежит между вершинами dir и dir+1', () => {
    const l = DEFAULT_LAYOUT;
    const h = hex(2, -3);
    const pts = corners(l, h);
    for (let d = 0; d < 6; d++) {
      const [i, j] = edgeCorners(d);
      const mid = { x: (pts[i]!.x + pts[j]!.x) / 2, y: (pts[i]!.y + pts[j]!.y) / 2 };
      // Середина ребра равноудалена от центров обеих клеток, которым оно принадлежит.
      const own = hexToPixel(l, h);
      const other = hexToPixel(l, neighbor(h, d as Direction));
      expect(Math.hypot(mid.x - own.x, mid.y - own.y)).toBeCloseTo(
        Math.hypot(mid.x - other.x, mid.y - other.y),
      );
    }
  });

  it('начало координат сдвигает всю сетку', () => {
    const shifted = layout(64, 74, 100, 200);
    const p = hexToPixel(shifted, hex(0, 0));
    expect(p).toEqual({ x: 100, y: 200 });
  });

  it('у гекса шесть вершин, симметричных относительно центра', () => {
    const c = hexToPixel(DEFAULT_LAYOUT, hex(2, -3));
    const pts = corners(DEFAULT_LAYOUT, hex(2, -3));
    expect(pts).toHaveLength(6);
    const sumX = pts.reduce((s, p) => s + p.x, 0) / 6;
    const sumY = pts.reduce((s, p) => s + p.y, 0) / 6;
    expect(sumX).toBeCloseTo(c.x);
    expect(sumY).toBeCloseTo(c.y);
  });
});

describe('прямоугольная сетка (odd-r: нечётные ряды смещены вправо)', () => {
  it('обратима', () => {
    for (let col = 0; col < 15; col++)
      for (let row = 0; row < 15; row++)
        expect(hexToOffset(offsetToHex(col, row))).toEqual({ col, row });
  });

  it('соседи по сетке остаются соседями в аксиальных координатах', () => {
    expect(distance(offsetToHex(3, 4), offsetToHex(4, 4))).toBe(1);
    expect(distance(offsetToHex(3, 4), offsetToHex(3, 5))).toBe(1);
  });

  it('прямоугольник 15×15 связен: у каждой клетки есть сосед внутри', () => {
    const inside = new Set<string>();
    for (let col = 0; col < 15; col++)
      for (let row = 0; row < 15; row++) {
        const h = offsetToHex(col, row);
        inside.add(`${h.q},${h.r}`);
      }
    for (const s of inside) {
      const [q, r] = s.split(',').map(Number) as [number, number];
      const has = neighbors(hex(q, r)).some((n) => inside.has(`${n.q},${n.r}`));
      expect(has).toBe(true);
    }
  });

  it('метка первой клетки — 0101', () => {
    expect(hexLabel(offsetToHex(0, 0))).toBe('0101');
    expect(hexLabel(offsetToHex(0, 1))).toBe('0102');
    expect(hexLabel(offsetToHex(14, 14))).toBe('1515');
  });
});
