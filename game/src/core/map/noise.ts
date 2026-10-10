import type { Rng } from '../rng/index.js';

/**
 * Когерентный шум для генерации карт (шаг 9a, часть A).
 *
 * Свой, а не библиотечный, по трём причинам, и все три несговорчивы:
 *   1. Источник случайности обязан быть нашим `Rng` — `Math.random` в `game/src/`
 *      запрещён линтером, а библиотека затянет его внутрь себя.
 *   2. Шум входит в детерминизм: минорное обновление библиотеки, сменившее
 *      алгоритм, молча перепишет все сохранённые карты. Наш алгоритм закреплён
 *      тестом на воспроизводимость наравне с остальным ядром.
 *   3. Нужен ровно один вид шума и ~80 строк. Зависимость дороже кода.
 *
 * Value-noise, а не симплекс: у симплекса лучше изотропия, но нам нужны крупные
 * читаемые формы, а не идеальная статистика, и разница на глаз не видна.
 */
export class ValueNoise {
  /** Таблица перестановок: 256 значений, продублированы для обхода без модуля. */
  private readonly perm: Uint8Array;
  /** Значение в узле решётки по индексу перестановки, в диапазоне −1…1. */
  private readonly lattice: Float64Array;

  constructor(rng: Rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Фишер — Йетс на нашем ГПСЧ: перестановка целиком определяется сидом.
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }

    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;

    this.lattice = new Float64Array(256);
    for (let i = 0; i < 256; i++) this.lattice[i] = rng.next() * 2 - 1;
  }

  /** Значение в узле целочисленной решётки. */
  private at(ix: number, iy: number): number {
    const h = this.perm[(this.perm[ix & 255]! + (iy & 255)) & 511]!;
    return this.lattice[h]!;
  }

  /**
   * Одна октава шума в точке. Возвращает −1…1.
   *
   * Интерполяция — сглаживающий полином 6t⁵−15t⁴+10t³: у него нулевые первая и
   * вторая производные в узлах, поэтому решётка не проступает сеткой на склонах.
   */
  value2D(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);

    const v00 = this.at(x0, y0);
    const v10 = this.at(x0 + 1, y0);
    const v01 = this.at(x0, y0 + 1);
    const v11 = this.at(x0 + 1, y0 + 1);

    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * ty;
  }

  /**
   * Многооктавный шум (fBm). Возвращает 0…1.
   *
   * Нормируется на сумму амплитуд, а не на теоретический максимум: иначе при
   * четырёх октавах результат жмётся к середине и карта выходит без контраста.
   */
  fractal2D(x: number, y: number, octaves = 3, persistence = 0.5, lacunarity = 2): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let total = 0;

    for (let o = 0; o < octaves; o++) {
      sum += this.value2D(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return (sum / total + 1) / 2;
  }

  /**
   * Гребневой шум: |шум|, перевёрнутый. Даёт хребты с резкими вершинами вместо
   * округлых холмов — то, чем вулканическая пустошь отличается от лугов.
   */
  ridged2D(x: number, y: number, octaves = 3, persistence = 0.5, lacunarity = 2): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let total = 0;

    for (let o = 0; o < octaves; o++) {
      sum += (1 - Math.abs(this.value2D(x * frequency, y * frequency))) * amplitude;
      total += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return sum / total;
  }
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
