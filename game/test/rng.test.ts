import { describe, expect, it } from 'vitest';
import { Rng, RngSet, STREAMS } from '../src/core/rng/index.js';

describe('детерминизм', () => {
  it('один сид даёт одну и ту же последовательность', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('разные сиды расходятся', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('состояние сохраняется и восстанавливается', () => {
    const r = new Rng(999);
    for (let i = 0; i < 50; i++) r.next();
    const snapshot = r.getState();
    const expected = Array.from({ length: 20 }, () => r.next());

    r.setState(snapshot);
    expect(Array.from({ length: 20 }, () => r.next())).toEqual(expected);
  });

  it('состояние — беззнаковое 32-битное', () => {
    const r = new Rng(-1);
    expect(r.getState()).toBe(0xffffffff);
    for (let i = 0; i < 100; i++) {
      r.next();
      expect(r.getState()).toBeGreaterThanOrEqual(0);
      expect(r.getState()).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('диапазоны', () => {
  it('next всегда в [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 100_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('d6 покрывает ровно 1..6', () => {
    const r = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) seen.add(r.d6());
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('int соблюдает границы включительно', () => {
    const r = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = r.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('пустой диапазон отвергается', () => {
    expect(() => new Rng(1).int(5, 4)).toThrow(RangeError);
  });
});

describe('d2d6 — колокол, а не равномерное распределение', () => {
  const N = 600_000;
  const counts = new Array<number>(13).fill(0);
  const r = new Rng(2026);
  for (let i = 0; i < N; i++) counts[r.d2d6()]!++;

  it('значения только 2..12', () => {
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBe(0);
    for (let v = 2; v <= 12; v++) expect(counts[v]).toBeGreaterThan(0);
  });

  it('пик приходится ровно на 7', () => {
    const max = Math.max(...counts);
    expect(counts[7]).toBe(max);
  });

  it('частоты совпадают с 36-долями в пределах 1.5 %', () => {
    const expected = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((w) => (w / 36) * N);
    for (let v = 2; v <= 12; v++) {
      expect(Math.abs(counts[v]! - expected[v]!) / expected[v]!).toBeLessThan(0.015);
    }
  });

  it('монотонно растёт до 7 и симметрично спадает', () => {
    for (let v = 3; v <= 7; v++) expect(counts[v]!).toBeGreaterThan(counts[v - 1]!);
    for (let v = 8; v <= 12; v++) expect(counts[v]!).toBeLessThan(counts[v - 1]!);
    // Симметрия: 2↔12, 3↔11, ...
    for (let v = 2; v <= 6; v++) {
      const diff = Math.abs(counts[v]! - counts[14 - v]!);
      expect(diff / counts[v]!).toBeLessThan(0.05);
    }
  });
});

describe('вспомогательное', () => {
  it('pick не выходит за пределы массива', () => {
    const r = new Rng(3);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 1000; i++) expect(items).toContain(r.pick(items));
  });

  it('pick из пустого массива отвергается', () => {
    expect(() => new Rng(1).pick([])).toThrow(RangeError);
  });

  it('shuffle сохраняет состав и детерминирован', () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = new Rng(77).shuffle([...base]);
    const b = new Rng(77).shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
  });
});

describe('именованные потоки', () => {
  it('одинаковый мастер-сид даёт одинаковые потоки', () => {
    const a = new RngSet(2026);
    const b = new RngSet(2026);
    for (const s of STREAMS) {
      expect(a.stream(s).d2d6()).toBe(b.stream(s).d2d6());
    }
  });

  it('потоки независимы: расход одного не двигает другой', () => {
    const set = new RngSet(555);
    const reference = new RngSet(555).stream('toHit').d2d6();

    for (let i = 0; i < 1000; i++) set.stream('initiative').d6();
    expect(set.stream('toHit').d2d6()).toBe(reference);
  });

  it('разные потоки одного сида не совпадают', () => {
    const set = new RngSet(1);
    const a = Array.from({ length: 30 }, () => set.stream('toHit').d6());
    const set2 = new RngSet(1);
    const b = Array.from({ length: 30 }, () => set2.stream('crits').d6());
    expect(a).not.toEqual(b);
  });

  it('снапшот и восстановление всех потоков', () => {
    const set = new RngSet(31337);
    for (const s of STREAMS) for (let i = 0; i < 13; i++) set.stream(s).next();

    const snapshot = set.getState();
    const expected = STREAMS.map((s) => set.stream(s).d2d6());

    set.setState(snapshot);
    expect(STREAMS.map((s) => set.stream(s).d2d6())).toEqual(expected);
  });

  it('снапшот содержит ровно все потоки', () => {
    const state = new RngSet(1).getState();
    expect(Object.keys(state).sort()).toEqual([...STREAMS].sort());
  });

  it('неизвестный поток отвергается', () => {
    // @ts-expect-error — проверяем защиту в рантайме, не только типом
    expect(() => new RngSet(1).stream('нет-такого')).toThrow(RangeError);
  });
});
