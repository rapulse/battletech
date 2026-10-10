/**
 * Детерминированный ГПСЧ (game_core.md §4.6).
 *
 * Три обязательных свойства, из-за которых пишем свой, а не берём библиотеку:
 *   1. d2d6 — сумма ДВУХ независимых d6. Вся боевая математика BattleTech стоит
 *      на колоколе с пиком на 7; равномерное 2..12 сломало бы баланс незаметно.
 *   2. Состояние сериализуемо — иначе не работают сохранение в середине боя и
 *      реплей с середины.
 *   3. Потоки именованные — иначе новый бросок в правилах сдвигает всю
 *      последовательность и обесценивает сохранённые тестовые бои.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /**
   * mulberry32: период 2^32, десяток строк, поведение полностью проверяемо.
   * Состояние держится беззнаковым (`>>> 0`, не `| 0`): битовая картина та же,
   * но в снапшот и в JSON уходит 0..2^32-1, а не отрицательные числа.
   */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Целое в диапазоне [min, max] включительно. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`Пустой диапазон: [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  d6(): number {
    return 1 + Math.floor(this.next() * 6);
  }

  /** Два независимых d6. Никогда не заменять на int(2, 12). */
  d2d6(): number {
    return this.d6() + this.d6();
  }

  /** Случайный элемент. Порядок массива обязан быть детерминированным. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Выбор из пустого массива');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Перемешивание Фишера — Йетса на месте. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i] as T;
      items[i] = items[j] as T;
      items[j] = a;
    }
    return items;
  }

  getState(): number {
    return this.s;
  }

  setState(state: number): void {
    this.s = state >>> 0;
  }
}

/** Потоки бросков. Каждый живёт своей последовательностью. */
export const STREAMS = [
  'initiative',
  'toHit',
  'hitLocation',
  'crits',
  'piloting',
  /** Проверки исполнения (срыв) — wiki/design/pilots/skills.md. */
  'skill',
  'mapGen',
  'campaign',
] as const;

export type StreamName = (typeof STREAMS)[number];

export type RngState = Readonly<Record<StreamName, number>>;

/**
 * Хэш строки в 32 бита (cyrb32). Нужен, чтобы вывести сид потока из имени:
 * добавление нового потока не трогает состояние существующих.
 */
function hashName(name: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Набор именованных потоков с произвольным списком имён.
 *
 * Вынесен из `RngSet` в шаге 10 ради кампании, и по одной жёсткой причине:
 * снимок набора перечисляет ВСЕ его потоки, а `serializeBattleState`
 * (`core/model/hash.ts`) складывает их в хэш боя. Допиши кампанийный поток в
 * `STREAMS` — и закреплённый golden-хэш `test/replay.test.ts` разойдётся, хотя
 * в правилах боя не поменялось ни строки. Поэтому у кампании свой список имён
 * (`core/campaign/rng.ts`), а общая механика — здесь.
 *
 * Сид потока выводится из его имени (`hashName`), поэтому добавление имени в
 * ОДИН набор не сдвигает последовательности остальных потоков этого набора.
 */
export class NamedRngSet<N extends string> {
  readonly masterSeed: number;
  private readonly names: readonly N[];
  private readonly streams: Map<N, Rng>;

  constructor(masterSeed: number, names: readonly N[]) {
    this.masterSeed = masterSeed >>> 0;
    this.names = names;
    this.streams = new Map(names.map((n) => [n, new Rng(hashName(n, this.masterSeed))]));
  }

  stream(name: N): Rng {
    const r = this.streams.get(name);
    if (r === undefined) throw new RangeError(`Неизвестный поток: ${name}`);
    return r;
  }

  /** Снимок состояния всех потоков — часть снапшота. */
  getState(): Readonly<Record<N, number>> {
    const out = {} as Record<N, number>;
    for (const n of this.names) out[n] = this.stream(n).getState();
    return out;
  }

  setState(state: Readonly<Record<N, number>>): void {
    for (const n of this.names) this.stream(n).setState(state[n]);
  }
}

/** Набор потоков одного боя. Именно он входит в снапшот состояния боя. */
export class RngSet extends NamedRngSet<StreamName> {
  constructor(masterSeed: number) {
    super(masterSeed, STREAMS);
  }
}
