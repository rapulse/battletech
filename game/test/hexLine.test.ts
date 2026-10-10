import { describe, expect, it } from 'vitest';
import { between, distance, equals, hex, line, neighbors } from '../src/core/hex/index.js';

const SAMPLE = (() => {
  const out = [];
  for (let q = -5; q <= 5; q++) for (let r = -5; r <= 5; r++) out.push(hex(q, r));
  return out;
})();

describe('линия гексов', () => {
  it('начинается и заканчивается на концах', () => {
    for (const a of SAMPLE)
      for (const b of SAMPLE) {
        const l = line(a, b);
        expect(equals(l[0]!, a)).toBe(true);
        expect(equals(l[l.length - 1]!, b)).toBe(true);
      }
  });

  it('длина равна расстоянию плюс один', () => {
    for (const a of SAMPLE)
      for (const b of SAMPLE) expect(line(a, b)).toHaveLength(distance(a, b) + 1);
  });

  it('соседние элементы линии — соседи на карте', () => {
    for (const a of SAMPLE)
      for (const b of SAMPLE) {
        const l = line(a, b);
        for (let i = 1; i < l.length; i++) expect(distance(l[i - 1]!, l[i]!)).toBe(1);
      }
  });

  it('линия в саму себя — один гекс', () => {
    const l = line(hex(2, 2), hex(2, 2));
    expect(l).toHaveLength(1);
    expect(l[0]).toEqual(hex(2, 2));
  });

  it('промежуточных гексов у соседей нет', () => {
    const a = hex(0, 0);
    for (const n of neighbors(a)) expect(between(a, n)).toHaveLength(0);
  });

  it('промежуточные — это линия без концов', () => {
    const a = hex(0, 0);
    const b = hex(4, -2);
    expect(between(a, b)).toEqual(line(a, b).slice(1, -1));
  });
});

describe('симметрия линии — основа симметричной видимости', () => {
  it('множество промежуточных гексов одинаково в обе стороны', () => {
    for (const a of SAMPLE)
      for (const b of SAMPLE) {
        const forward = between(a, b).map((h) => `${h.q},${h.r}`).sort();
        const backward = between(b, a).map((h) => `${h.q},${h.r}`).sort();
        expect(forward).toEqual(backward);
      }
  });
});
