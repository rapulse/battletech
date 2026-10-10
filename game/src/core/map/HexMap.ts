import { hexToOffset, offsetToHex, type Direction, type Hex } from '../hex/index.js';
import { canonicalEdge, EDGE_NONE } from './edges.js';
import { terrainInfo } from '../data/tables.js';
import { TerrainType } from './TerrainType.js';

/** Границы уровня по правилам. Формат данных шире — расширение будет правкой правил. */
export const MIN_ELEVATION = -5;
export const MAX_ELEVATION = 5;

/** Динамический слой поверх рельефа. Появляется и исчезает по ходу боя. */
export const OVERLAY_NONE = 0;
export const OVERLAY_SMOKE = 1 << 0;
export const OVERLAY_FIRE = 1 << 1;
export const OVERLAY_ICE = 1 << 2;

/**
 * Карта боя. Структура массивов, а не массив объектов (game_core.md §4.1):
 * снапшот состояния — копия типизированного массива, хэш для golden-теста
 * считается прямо по байтам, на картах 40×40 ничего не меняется.
 *
 * Хранение прямоугольное, в offset-координатах odd-q — так же, как нумеруются
 * планшеты настольной BattleTech.
 */
export class HexMap {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  readonly elevation: Int8Array;
  /** Высота объекта поверх клетки. По умолчанию берётся из рельефа, но перекрываема. */
  readonly objHeight: Uint8Array;
  /** Рёбра: три слота на клетку (N, NE, SE); остальные читаются у соседа. */
  readonly edges: Uint8Array;
  readonly overlay: Uint8Array;
  /**
   * Клетка — часть русла реки. Река — обычная `TerrainType.Water` (все её правила
   * читаются оттуда: тепло, глубина, стоимость хода, укрытие); этот бит не несёт
   * ни одного правила сам по себе и нужен только показу — отличить нитку реки от
   * пруда/озера, чтобы нарисовать течение, а не лужу (шаг 9c: было признаком
   * РЕБРА, из-за чего река выглядела водой, а вела себя как суша).
   */
  readonly river: Uint8Array;
  /**
   * Клетка — часть компактного пятна развалин (шаг 9c, вторая ревизия): та же
   * `TerrainType.Rubble`, что и диффузная скальная россыпь пустыни/вулкана/луны,
   * но помечена отдельно, чтобы показ рисовал обломки стен, а не скалу. Ни одно
   * правило этот бит не читает — Rubble остаётся источником истины для правил.
   */
  readonly ruins: Uint8Array;

  constructor(w: number, h: number) {
    if (w <= 0 || h <= 0) throw new RangeError(`Некорректный размер карты: ${w}×${h}`);
    this.w = w;
    this.h = h;
    const n = w * h;
    this.terrain = new Uint8Array(n);
    this.elevation = new Int8Array(n);
    this.objHeight = new Uint8Array(n);
    this.edges = new Uint8Array(n * 3);
    this.overlay = new Uint8Array(n);
    this.river = new Uint8Array(n);
    this.ruins = new Uint8Array(n);
  }

  contains(hex: Hex): boolean {
    const { col, row } = hexToOffset(hex);
    return col >= 0 && col < this.w && row >= 0 && row < this.h;
  }

  /** Линейный индекс клетки. Бросает исключение вне карты — молчаливый выход за край опаснее. */
  index(hex: Hex): number {
    const { col, row } = hexToOffset(hex);
    if (col < 0 || col >= this.w || row < 0 || row >= this.h) {
      throw new RangeError(`Клетка вне карты: q=${hex.q}, r=${hex.r}`);
    }
    return row * this.w + col;
  }

  hexAt(index: number): Hex {
    if (index < 0 || index >= this.w * this.h) throw new RangeError(`Индекс вне карты: ${index}`);
    return offsetToHex(index % this.w, Math.floor(index / this.w));
  }

  /** Все клетки карты в детерминированном порядке — по индексу хранения. */
  *cells(): Generator<Hex> {
    for (let i = 0; i < this.w * this.h; i++) yield this.hexAt(i);
  }

  getTerrain(hex: Hex): TerrainType {
    return this.terrain[this.index(hex)] as TerrainType;
  }

  setTerrain(hex: Hex, t: TerrainType): void {
    const i = this.index(hex);
    this.terrain[i] = t;
    this.objHeight[i] = terrainInfo(t).objHeight;
  }

  getElevation(hex: Hex): number {
    return this.elevation[this.index(hex)]!;
  }

  setElevation(hex: Hex, level: number): void {
    if (!Number.isInteger(level) || level < MIN_ELEVATION || level > MAX_ELEVATION) {
      throw new RangeError(`Уровень вне диапазона ${MIN_ELEVATION}…${MAX_ELEVATION}: ${level}`);
    }
    this.elevation[this.index(hex)] = level;
  }

  /** Высота объекта поверх клетки: лес 2, здание 1…4. Только для линии видимости. */
  getObjHeight(hex: Hex): number {
    return this.objHeight[this.index(hex)]!;
  }

  setObjHeight(hex: Hex, height: number): void {
    if (!Number.isInteger(height) || height < 0 || height > 255) {
      throw new RangeError(`Некорректная высота объекта: ${height}`);
    }
    this.objHeight[this.index(hex)] = height;
  }

  /**
   * Глубина погружения в клетке: 0 — суша или мель по щиколотку,
   * 1 — по колено, 2 — по пояс, 3+ — с головой (шагом непроходимо).
   */
  getDepth(hex: Hex): number {
    if (this.getTerrain(hex) !== TerrainType.Water) return 0;
    return Math.max(0, -this.getElevation(hex));
  }

  getOverlay(hex: Hex): number {
    return this.overlay[this.index(hex)]!;
  }

  setOverlay(hex: Hex, flags: number): void {
    this.overlay[this.index(hex)] = flags & 0xff;
  }

  /** Признаки ребра между клеткой и её соседом в заданном направлении. */
  getEdge(hex: Hex, dir: Direction): number {
    const c = canonicalEdge(hex, dir);
    if (!this.contains(c.hex)) return EDGE_NONE;
    return this.edges[this.index(c.hex) * 3 + c.slot]!;
  }

  /**
   * Записывает признаки ребра. Ребро общее, поэтому запись через любую из двух
   * клеток попадает в одну и ту же ячейку — рассинхронизация невозможна.
   */
  setEdge(hex: Hex, dir: Direction, flags: number): void {
    const c = canonicalEdge(hex, dir);
    if (!this.contains(c.hex)) {
      throw new RangeError(`Ребро вне карты: q=${hex.q}, r=${hex.r}, dir=${dir}`);
    }
    this.edges[this.index(c.hex) * 3 + c.slot] = flags & 0xff;
  }

  addEdge(hex: Hex, dir: Direction, flags: number): void {
    this.setEdge(hex, dir, this.getEdge(hex, dir) | flags);
  }

  /** Клетка входит в русло реки — только показу, ни одно правило это не читает. */
  getRiver(hex: Hex): boolean {
    return this.river[this.index(hex)] !== 0;
  }

  setRiver(hex: Hex, isRiver: boolean): void {
    this.river[this.index(hex)] = isRiver ? 1 : 0;
  }

  /** Клетка входит в пятно развалин — только показу, ни одно правило это не читает. */
  getRuins(hex: Hex): boolean {
    return this.ruins[this.index(hex)] !== 0;
  }

  setRuins(hex: Hex, isRuins: boolean): void {
    this.ruins[this.index(hex)] = isRuins ? 1 : 0;
  }

  /** Полная копия. Нужна для снапшотов и для перебора вариантов в ИИ. */
  clone(): HexMap {
    const m = new HexMap(this.w, this.h);
    m.terrain.set(this.terrain);
    m.elevation.set(this.elevation);
    m.objHeight.set(this.objHeight);
    m.edges.set(this.edges);
    m.overlay.set(this.overlay);
    m.river.set(this.river);
    m.ruins.set(this.ruins);
    return m;
  }
}
