import { Direction, distance, hexToOffset, key as hexKey, offsetToHex, type Hex } from '../hex/index.js';
import { terrainInfo } from '../data/tables.js';
import type { Rng } from '../rng/index.js';
import { findSpawn } from './generate.js';
import { cellCover } from './los.js';
import type { GeneratedMap } from './generate.js';
import type { HexMap } from './HexMap.js';

/**
 * Расстановка машин по стартовым зонам генератора карты (шаг 12).
 *
 * Вынесено из `sim/scenario.ts::makeBattle`, чтобы мост кампании
 * (`core/campaign/bridge/toBattle.ts`) переиспользовал ровно ту же расстановку, а не
 * копировал её: `core/campaign/` может импортировать боевое ядро, но не `sim/`, где эта
 * логика раньше жила единственной копией. Живёт в `core/map/`, рядом с `findSpawn`, а не в
 * `core/model/`, чтобы не заводить зависимость на тип `Side` — сторона здесь простая строка,
 * сравниваемая с элементами `sideOrder`, и лишняя зависимость `core/map → core/model` не нужна.
 *
 * Тело — точная копия прежних замыканий `place`/`startFacing`: поведение и хэш `makeBattle`
 * не должны сдвинуться (это первый пункт брифинга шага 12).
 */

export interface PlacementSpec {
  readonly id: string;
  readonly side: string;
  readonly col: number;
  readonly row: number;
}

export interface UnitPlacement {
  readonly hex: Hex;
  readonly facing: Direction;
}

/**
 * `sideOrder` определяет, какая из двух стартовых зон генератора (`generated.starts[0]`,
 * `generated.starts[1]`) принадлежит какой стороне — тот же смысл, что у `zoneOrder` в
 * `sim/scenario.ts`, включая обмен углами (`swapZones`).
 */
export function placeUnits(
  map: HexMap,
  generated: GeneratedMap,
  specs: readonly PlacementSpec[],
  sideOrder: readonly [string, string],
): ReadonlyMap<string, UnitPlacement> {
  const taken = new Set<number>();
  const nextInZone = new Map<string, number>();
  const out = new Map<string, UnitPlacement>();

  for (const spec of specs) {
    const zone = generated.starts[sideOrder.indexOf(spec.side)];
    let wanted = offsetToHex(spec.col, spec.row);
    if (zone !== undefined && zone.hexes.length > 0) {
      const i = nextInZone.get(spec.side) ?? 0;
      nextInZone.set(spec.side, i + 1);
      wanted = zone.hexes[Math.min(i, zone.hexes.length - 1)]!;
    }
    const spot = findSpawn(map, wanted, taken);
    taken.add(hexKey(spot));
    const facing = zone?.facing ?? (spec.side === 'player' ? Direction.NE : Direction.SW);
    out.set(spec.id, { hex: spot, facing });
  }

  return out;
}

/** Полоса между серединой карты и стартом стороны (шаг 73a, `combat.json → ambush`). */
export interface BandSpec {
  /** Доля пути от середины к центру стартовой зоны: 0 — середина, 1 — старт. */
  readonly from: number;
  readonly to: number;
  /** Наименьшее расстояние между поставленными в полосу, в гексах. */
  readonly spacing: number;
}

/**
 * Места для засады: полоса ближе к центру карты, но не в самом центре, на
 * половине своей стороны (шаг 73a). Общая для засадных машин и огневых точек.
 *
 * Клетка годится, если она проходима и суха, не занята, не лежит ни в одной
 * стартовой зоне, ближе к своему старту, чем к чужому, и её доля пути
 * `d(середина) / (d(середина) + d(свой старт))` попадает в полосу. Из годных
 * берутся самые укрытые (лес, развалины — `cellCover`): засада в чистом поле —
 * не засада. Среди равных по укрытию решает жребий `rng`.
 *
 * Не хватило мест — возвращается меньше, чем просили; вызывающий ставит
 * остальных обычной расстановкой. Чистая функция от карты, зон и `rng`.
 */
export function placeInBand(
  map: HexMap,
  generated: GeneratedMap,
  sideIndex: 0 | 1,
  count: number,
  band: BandSpec,
  taken: ReadonlySet<number>,
  rng: Rng,
): Hex[] {
  const own = generated.starts[sideIndex];
  const other = generated.starts[sideIndex === 0 ? 1 : 0];
  if (count <= 0 || own === undefined || other === undefined) return [];
  const centre = offsetToHex(Math.floor(map.w / 2), Math.floor(map.h / 2));
  const ownAt = centroid(own.hexes);
  const otherAt = centroid(other.hexes);
  const startCells = new Set<number>();
  for (const zone of generated.starts) for (const h of zone.hexes) startCells.add(hexKey(h));

  const byCover = new Map<number, Hex[]>();
  for (const h of map.cells()) {
    const k = hexKey(h);
    if (taken.has(k) || startCells.has(k)) continue;
    if (!terrainInfo(map.getTerrain(h)).walkable || map.getDepth(h) > 0) continue;
    const toOwn = distance(h, ownAt);
    if (toOwn >= distance(h, otherAt)) continue;
    const toCentre = distance(h, centre);
    const share = toCentre + toOwn === 0 ? 0 : toCentre / (toCentre + toOwn);
    if (share < band.from || share > band.to) continue;
    const cover = cellCover(map, h);
    const list = byCover.get(cover) ?? [];
    list.push(h);
    byCover.set(cover, list);
  }

  const out: Hex[] = [];
  // Укрытие по убыванию; внутри ступени — перемешивание Фишера — Йетса. Клетки
  // собраны обходом `map.cells()` в порядке хранения, так что порядок явный.
  for (const cover of [...byCover.keys()].sort((a, b) => b - a)) {
    const pool = byCover.get(cover) as Hex[];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as Hex, pool[i] as Hex];
    }
    for (const h of pool) {
      if (out.length >= count) return out;
      if (out.some((o) => distance(o, h) < band.spacing)) continue;
      out.push(h);
    }
  }
  return out;
}

function centroid(hexes: readonly Hex[]): Hex {
  const q = hexes.reduce((a, h) => a + h.q, 0) / hexes.length;
  const r = hexes.reduce((a, h) => a + h.r, 0) / hexes.length;
  return { q: Math.round(q), r: Math.round(r) };
}

/** Диагональ засады (шаг 73a, `combat.json → ambush.diagonal`). */
export interface DiagonalSpec {
  /** Сколько гексов в сторону от диагонали ещё считается ею. */
  readonly width: number;
  /** Где вероятнее всего: доля пути от центра к углу. */
  readonly peak: number;
  /** Наименьшее расстояние между поставленными, в гексах. */
  readonly spacing: number;
}

/**
 * Места засадных машин: диагональ из левого верхнего угла в правый нижний
 * (решение пользователя 2026-09-24). Стороны стартуют в двух других углах и идут
 * к центру, через эти места не ходит никто — засада выходит «из-за спины».
 *
 * Вес клетки — треугольник по доле пути от центра к углу `d` (0 — центр,
 * 1 — угол): ноль в центре и в самом углу, наибольший на `peak`. У центра засада
 * ожидаема — там сойдутся все, у угла бесполезна — туда не дойдёт никто.
 * Клетка годится, если она проходима и суха, не занята и не лежит в стартовой
 * зоне. Жребий взвешенный, без возврата, с разносом `spacing`; не хватило мест —
 * возвращается меньше. Чистая функция от карты, зон и `rng`.
 */
export function placeOnDiagonal(
  map: HexMap,
  generated: GeneratedMap,
  count: number,
  spec: DiagonalSpec,
  taken: ReadonlySet<number>,
  rng: Rng,
): Hex[] {
  if (count <= 0) return [];
  const startCells = new Set<number>();
  for (const zone of generated.starts) for (const h of zone.hexes) startCells.add(hexKey(h));
  const span = Math.max(1, Math.max(map.w, map.h) - 1);

  const pool: { hex: Hex; weight: number }[] = [];
  for (const h of map.cells()) {
    const k = hexKey(h);
    if (taken.has(k) || startCells.has(k)) continue;
    if (!terrainInfo(map.getTerrain(h)).walkable || map.getDepth(h) > 0) continue;
    const { col, row } = hexToOffset(h);
    const x = col / Math.max(1, map.w - 1);
    const y = row / Math.max(1, map.h - 1);
    // Отступ от диагонали y = x — в гексах, по перпендикуляру.
    if ((Math.abs(x - y) * span) / Math.SQRT2 > spec.width) continue;
    const d = Math.abs((x + y) / 2 - 0.5) * 2;
    const weight = d <= spec.peak ? d / spec.peak : (1 - d) / (1 - spec.peak);
    if (weight <= 0) continue;
    pool.push({ hex: h, weight });
  }

  const out: Hex[] = [];
  while (out.length < count) {
    const open = pool.filter((c) => !out.some((o) => distance(o, c.hex) < spec.spacing));
    const total = open.reduce((sum, c) => sum + c.weight, 0);
    if (total <= 0) break;
    let roll = rng.next() * total;
    let pick = open[open.length - 1] as { hex: Hex };
    for (const c of open) {
      roll -= c.weight;
      if (roll < 0) {
        pick = c;
        break;
      }
    }
    out.push(pick.hex);
  }
  return out;
}
