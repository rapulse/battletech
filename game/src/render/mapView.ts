import type { Point } from '../core/hex/index.js';
import { Direction, neighbor, offsetToHex } from '../core/hex/index.js';
import {
  EDGE_BRIDGE,
  EDGE_CLIFF,
  terrainInfo,
  TerrainType,
  type HexMap,
  type MapDescriptor,
} from '../core/map/index.js';
import { Rng } from '../core/rng/index.js';
import {
  chaikin,
  clusterOutline,
  coordLabel,
  hexCorners,
  hexToPixel,
  neighbours,
  type Offset,
} from './hexView.js';

/**
 * Вид карты: то, что нужно РИСОВАНИЮ, выведенное из того, что знают ПРАВИЛА.
 *
 * Ядро хранит карту тремя ортогональными слоями — рельеф, уровень, признаки
 * рёбер — потому что так её удобно считать. Рисовать её так неудобно: чтобы
 * лес выглядел массивом, а не шестью раскрашенными гексами, нужен его контур;
 * чтобы река текла, нужна её линия; чтобы горы имели объём, нужны камни.
 *
 * Всё это ВЫВОДИТСЯ из карты и нигде не хранится: вид — функция от карты и
 * сида, второго источника истины не появляется. Пересобирается один раз на
 * карту, а не на кадр.
 */

export type TerrainName =
  | 'plain'
  | 'road'
  | 'rough'
  | 'lightWoods'
  | 'heavyWoods'
  | 'rubble'
  | 'swamp'
  | 'water'
  | 'building';

const TERRAIN_NAMES: readonly TerrainName[] = [
  'plain',
  'road',
  'rough',
  'lightWoods',
  'heavyWoods',
  'rubble',
  'swamp',
  'water',
  'building',
];

export interface HexView {
  readonly col: number;
  readonly row: number;
  /** Метка 0101 — та же, что показывает панель наведения. */
  readonly coord: string;
  readonly elevation: number;
  readonly terrain: TerrainName;
  readonly isWater: boolean;
  /** Вода этой клетки — русло реки, а не стоячий пруд/озеро (только показу). */
  readonly isRiver: boolean;
  /** Клетка — часть компактного пятна развалин, а не диффузной скалы (только показу). */
  readonly isRuins: boolean;
  readonly isRoad: boolean;
  /** Глубина погружения: 0 суша, 1 по колено, 2 по пояс. */
  readonly depth: number;
  /** Модификатор к попаданию по цели в этой клетке. Легенда штрафов берёт его отсюда. */
  readonly cover: number;
  /** Цена входа шагом по ровному месту. Точная цена перехода зависит от ребра. */
  readonly mpCost: number;
  readonly walkable: boolean;
}

export interface ClusterView {
  readonly cells: readonly Offset[];
  /** Сглаженные замкнутые контуры массива. */
  readonly loops: readonly (readonly Point[])[];
  readonly heavy: boolean;
}

export interface LakeView extends ClusterView {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface EdgeMark {
  readonly a: Point;
  readonly b: Point;
  /** Середина ребра: туда ставится значок моста. */
  readonly mid: Point;
}

export interface TreeView {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly kind: 'pine' | 'deciduous';
  readonly shade: number;
  readonly col: number;
  readonly row: number;
  readonly heavy?: boolean;
}

export interface RockView {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly kind: 'hill' | 'mountain' | 'peak';
  readonly elevation: number;
  readonly facet: number;
  readonly col: number;
  readonly row: number;
}

/** Обломок компактного пятна развалин (не диффузной скалы пустыни/вулкана/луны). */
export interface RuinView {
  readonly x: number;
  readonly y: number;
  readonly kind: 'wall' | 'rubble' | 'pillar';
  readonly angle: number;
  readonly size: number;
  /** Затравка для мелких деталей (трещины, число обломков) — своя на фрагмент. */
  readonly seed: number;
  readonly col: number;
  readonly row: number;
}

export interface MapView {
  readonly cols: number;
  readonly rows: number;
  readonly biome: string;
  readonly seed: number;
  readonly frozen: boolean;
  readonly hexes: ReadonlyMap<string, HexView>;
  readonly forestClusters: readonly ClusterView[];
  readonly mountainClusters: readonly ClusterView[];
  readonly lakeClusters: readonly LakeView[];
  /** Компактное пятно развалин (шаг 9c) — контур под обломки, отдельно от гор. */
  readonly ruinClusters: readonly ClusterView[];
  /** Линии рек по серединам рёбер, каждая — отдельный поток. */
  readonly riverLines: readonly (readonly Point[])[];
  readonly roadCells: readonly Offset[];
  readonly bridges: readonly EdgeMark[];
  readonly cliffs: readonly EdgeMark[];
  readonly trees: readonly TreeView[];
  readonly rocks: readonly RockView[];
  readonly ruinProps: readonly RuinView[];
}

export function key(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * Собирает вид карты. Детерминирован от сида: одна и та же карта на одном и том
 * же сиде всегда получает те же деревья на тех же местах — иначе перерисовка
 * после смены вкладки переставляла бы весь декор.
 */
export function buildMapView(map: HexMap, descriptor: MapDescriptor, frozen = false): MapView {
  const hexes = new Map<string, HexView>();

  for (let row = 0; row < map.h; row++) {
    for (let col = 0; col < map.w; col++) {
      const cell = offsetToHex(col, row);
      const terrain = map.getTerrain(cell);
      const info = terrainInfo(terrain);
      hexes.set(key(col, row), {
        col,
        row,
        coord: coordLabel(col, row),
        elevation: map.getElevation(cell),
        terrain: TERRAIN_NAMES[terrain] ?? 'plain',
        isWater: terrain === TerrainType.Water,
        isRiver: map.getRiver(cell),
        isRuins: map.getRuins(cell),
        isRoad: terrain === TerrainType.Road,
        depth: map.getDepth(cell),
        cover: info.toHitMod,
        mpCost: info.enterCost,
        walkable: info.walkable,
      });
    }
  }

  const lightClusters = clusters(map, hexes, (h) => h.terrain === 'lightWoods').map((cells) => ({
    cells,
    loops: cells.length > 0 ? outline(cells, 2) : [],
    heavy: false,
  }));
  const heavyClusters = clusters(map, hexes, (h) => h.terrain === 'heavyWoods').map((cells) => ({
    cells,
    loops: cells.length > 0 ? outline(cells, 2) : [],
    heavy: true,
  }));
  const forestClusters = [...lightClusters, ...heavyClusters];

  const mountainClusters = clusters(
    map,
    hexes,
    (h) => !h.isWater && !h.isRuins && (h.elevation >= 2 || h.terrain === 'rough' || h.terrain === 'rubble'),
  ).map((cells) => ({ cells, loops: outline(cells, 1), heavy: false }));

  // Развалины — своя, отдельная от гор геометрия: компактное пятно под обломки
  // стен, а не тёмный скальный массив (иначе руины неотличимы от скалы).
  const ruinClusters = clusters(map, hexes, (h) => h.isRuins).map((cells) => ({
    cells,
    loops: cells.length > 0 ? outline(cells, 1) : [],
    heavy: false,
  }));

  // Река — тоже isWater, но не пруд: она рисуется линией течения (riverLines),
  // а не блином лужи, поэтому в кластеры озёр не идёт.
  const lakeClusters = clusters(map, hexes, (h) => h.isWater && !h.isRiver)
    .filter((cells) => cells.length >= 2)
    .map((cells) => {
      let sx = 0;
      let sy = 0;
      for (const c of cells) {
        const p = hexToPixel(c.col, c.row);
        sx += p.x;
        sy += p.y;
      }
      return {
        cells,
        loops: outline(cells, 2),
        heavy: false,
        cx: sx / cells.length,
        cy: sy / cells.length,
        radius: Math.sqrt(cells.length) * (hexCorners(0, 0)[0]!.x || 32) * 0.9 + 24,
      };
    });

  const roadCells: Offset[] = [];
  for (const h of hexes.values()) if (h.isRoad) roadCells.push({ col: h.col, row: h.row });

  return {
    cols: map.w,
    rows: map.h,
    biome: descriptor.biome,
    seed: descriptor.seed,
    frozen,
    hexes,
    forestClusters,
    mountainClusters,
    lakeClusters,
    ruinClusters,
    riverLines: riverLines(map),
    roadCells,
    bridges: edgeMarks(map, EDGE_BRIDGE),
    cliffs: edgeMarks(map, EDGE_CLIFF),
    ...scatter(map, hexes, descriptor),
  };
}

// --- Массивы -----------------------------------------------------------------

function clusters(
  map: HexMap,
  hexes: ReadonlyMap<string, HexView>,
  match: (h: HexView) => boolean,
): Offset[][] {
  const seen = new Set<string>();
  const out: Offset[][] = [];

  // Обход строго по сетке: порядок массивов обязан быть одинаковым от запуска
  // к запуску, иначе декор и подписи прыгают между перерисовками.
  for (let row = 0; row < map.h; row++) {
    for (let col = 0; col < map.w; col++) {
      const k = key(col, row);
      if (seen.has(k)) continue;
      const start = hexes.get(k);
      if (start === undefined || !match(start)) continue;

      const group: Offset[] = [];
      const queue: Offset[] = [{ col, row }];
      seen.add(k);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        group.push(cur);
        for (const nb of neighbours(cur.col, cur.row)) {
          const nk = key(nb.col, nb.row);
          if (seen.has(nk)) continue;
          const h = hexes.get(nk);
          if (h === undefined || !match(h)) continue;
          seen.add(nk);
          queue.push(nb);
        }
      }
      out.push(group);
    }
  }
  return out;
}

function outline(cells: readonly Offset[], smoothing: number): Point[][] {
  return clusterOutline(cells).map((loop) => chaikin(loop, smoothing));
}

// --- Рёбра -------------------------------------------------------------------

/**
 * Реки — цепочки КЛЕТОК (`map.getRiver`, шаг 9c), а не рёбер между ними: река —
 * полноценная `TerrainType.Water`, и рисуется линией течения по центрам своих
 * же клеток, а не по границам чужих. Ветвление (слияние притоков) — обычный
 * узел с более чем двумя речными соседями; обходится тем же алгоритмом, что и
 * простую цепочку, по одной непройденной связи графа за раз.
 */
function riverLines(map: HexMap): Point[][] {
  const riverCells: Offset[] = [];
  for (let row = 0; row < map.h; row++) {
    for (let col = 0; col < map.w; col++) {
      if (map.getRiver(offsetToHex(col, row))) riverCells.push({ col, row });
    }
  }
  if (riverCells.length === 0) return [];

  const pairKey = (a: Offset, b: Offset): string =>
    a.col < b.col || (a.col === b.col && a.row <= b.row)
      ? `${a.col},${a.row}-${b.col},${b.row}`
      : `${b.col},${b.row}-${a.col},${a.row}`;

  const adjacent = new Map<string, Offset[]>();
  for (const cell of riverCells) {
    const k = key(cell.col, cell.row);
    const nbs = neighbours(cell.col, cell.row).filter(
      (nb) => nb.col >= 0 && nb.col < map.w && nb.row >= 0 && nb.row < map.h && map.getRiver(offsetToHex(nb.col, nb.row)),
    );
    if (nbs.length > 0) adjacent.set(k, nbs);
  }

  const visitedPairs = new Set<string>();
  const remaining = (cell: Offset): Offset[] =>
    (adjacent.get(key(cell.col, cell.row)) ?? []).filter((nb) => !visitedPairs.has(pairKey(cell, nb)));

  const traceChain = (start: Offset): Point[] => {
    const pts: Point[] = [hexToPixel(start.col, start.row)];
    let current = start;
    for (;;) {
      const next = remaining(current)[0];
      if (next === undefined) break;
      visitedPairs.add(pairKey(current, next));
      current = next;
      pts.push(hexToPixel(current.col, current.row));
    }
    return pts;
  };

  const lines: Point[][] = [];
  const trace = (start: Offset): void => {
    const pts = traceChain(start);
    if (pts.length >= 2) lines.push(chaikinOpen(chaikinOpen(pts)));
  };

  // Сначала от концов (исток/устье — клетка с одним речным соседом)...
  for (const cell of riverCells) {
    if ((adjacent.get(key(cell.col, cell.row)) ?? []).length === 1) trace(cell);
  }
  // ...затем добираем то, что осталось (кольца, развилки без чистого конца).
  for (const cell of riverCells) {
    if (remaining(cell).length > 0) trace(cell);
  }

  return lines;
}

/** Сглаживание НЕзамкнутой ломаной: концы остаются на месте. */
function chaikinOpen(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]!];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    out.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
    out.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Все рёбра карты с заданным признаком, как отрезки в мировых координатах. */
function edgeMarks(map: HexMap, flag: number): EdgeMark[] {
  const out: EdgeMark[] = [];
  // Порядок: по сетке и по трём каноническим направлениям — каждое ребро
  // ровно один раз.
  for (let row = 0; row < map.h; row++) {
    for (let col = 0; col < map.w; col++) {
      const cell = offsetToHex(col, row);
      const pts = hexCorners(col, row);
      const nb = neighbours(col, row);
      for (let i = 0; i < 6; i++) {
        // Берём только рёбра «вправо и вниз», чтобы не удвоить каждое.
        if (nb[i]!.row < row || (nb[i]!.row === row && nb[i]!.col < col)) continue;
        const target = offsetToHex(nb[i]!.col, nb[i]!.row);
        if (!map.contains(target)) continue;
        const dir = directionTo(cell, target);
        if (dir === null) continue;
        if ((map.getEdge(cell, dir) & flag) === 0) continue;
        const a = pts[i]!;
        const b = pts[(i + 1) % 6]!;
        out.push({ a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
      }
    }
  }
  return out;
}

function directionTo(from: ReturnType<typeof offsetToHex>, to: ReturnType<typeof offsetToHex>) {
  for (let d = 0; d < 6; d++) {
    const probe = neighbor(from, d as Direction);
    if (probe.q === to.q && probe.r === to.r) return d as Direction;
  }
  return null;
}

// --- Декор -------------------------------------------------------------------

/**
 * Деревья и камни. Кладутся детерминированно от сида карты: одна и та же клетка
 * на одном и том же сиде всегда получает тот же куст на том же месте.
 *
 * ГПСЧ — проектный, а не `Math.random`: линтер запрещает его во всём `game/src`,
 * и правильно делает — иначе декор менялся бы на каждой перерисовке.
 */
function scatter(
  map: HexMap,
  hexes: ReadonlyMap<string, HexView>,
  descriptor: MapDescriptor,
): { trees: TreeView[]; rocks: RockView[]; ruinProps: RuinView[] } {
  const rng = new Rng(descriptor.seed ^ 0x5decade);
  const trees: TreeView[] = [];
  const rocks: RockView[] = [];
  const ruinProps: RuinView[] = [];
  const halfWidth = 32;

  const barren = descriptor.biome === 'volcanic' || descriptor.biome === 'lunar';

  for (let row = 0; row < map.h; row++) {
    for (let col = 0; col < map.w; col++) {
      const h = hexes.get(key(col, row));
      if (h === undefined) continue;
      const c = hexToPixel(col, row);

      const heavy = h.terrain === 'heavyWoods';
      if (!barren && (heavy || h.terrain === 'lightWoods')) {
        let count = heavy ? 4 + rng.int(0, 1) : 2 + rng.int(0, 1);
        if (descriptor.biome === 'jungle') count += 2;
        if (descriptor.biome === 'desert') count = 1 + rng.int(0, 1);

        for (let i = 0; i < count; i++) {
          const angle = rng.next() * Math.PI * 2;
          const dist = rng.next() * halfWidth * 0.55;
          trees.push({
            x: c.x + Math.cos(angle) * dist,
            y: c.y + Math.sin(angle) * dist,
            radius: descriptor.biome === 'desert' ? 4 + rng.next() * 2 : 6 + rng.next() * 4,
            kind:
              descriptor.biome === 'jungle'
                ? 'deciduous'
                : descriptor.biome === 'tundra'
                  ? 'pine'
                  : rng.next() > 0.45
                    ? 'pine'
                    : 'deciduous',
            shade: rng.next(),
            col,
            row,
            heavy,
          });
        }
      }

      if (h.isWater || h.isRoad) continue;

      if (h.isRuins) {
        // Компактное пятно развалин: обломки стен вместо горных камней —
        // иначе клетка `rubble` неотличима от диффузной скалы пустыни/вулкана.
        const wallCount = 1 + rng.int(0, 1);
        for (let i = 0; i < wallCount; i++) {
          const angle = rng.next() * Math.PI * 2;
          const dist = rng.next() * halfWidth * 0.5;
          ruinProps.push({
            x: c.x + Math.cos(angle) * dist,
            y: c.y + Math.sin(angle) * dist,
            kind: rng.next() > 0.25 ? 'wall' : 'pillar',
            angle: rng.next() * Math.PI,
            size: 14 + rng.next() * 8,
            seed: rng.next(),
            col,
            row,
          });
        }
        const rubbleCount = 2 + rng.int(0, 2);
        for (let i = 0; i < rubbleCount; i++) {
          const angle = rng.next() * Math.PI * 2;
          const dist = rng.next() * halfWidth * 0.65;
          ruinProps.push({
            x: c.x + Math.cos(angle) * dist,
            y: c.y + Math.sin(angle) * dist,
            kind: 'rubble',
            angle: rng.next() * Math.PI,
            size: 5 + rng.next() * 5,
            seed: rng.next(),
            col,
            row,
          });
        }
        continue;
      }

      if (h.elevation === 1 && h.terrain === 'plain') {
        if (rng.next() > 0.4) {
          rocks.push({
            x: c.x + (rng.next() - 0.5) * halfWidth * 0.8,
            y: c.y + (rng.next() - 0.5) * halfWidth * 0.8,
            size: 8 + rng.next() * 4,
            kind: 'hill',
            elevation: 1,
            facet: rng.next() * Math.PI,
            col,
            row,
          });
        }
      } else if (h.elevation >= 2 || h.terrain === 'rough' || h.terrain === 'rubble') {
        let count = h.elevation >= 3 ? 3 : 2;
        if (barren) count += 1;
        for (let i = 0; i < count; i++) {
          rocks.push({
            x: c.x + (rng.next() - 0.5) * halfWidth * 1.3,
            y: c.y + (rng.next() - 0.5) * halfWidth * 1.3,
            size: (h.elevation >= 3 ? 12 : 9) + rng.next() * 4,
            // Снежная шапка — только с четвёртого уровня: ниже она была бы
            // украшением, а не признаком высоты.
            kind: h.elevation >= 4 ? 'peak' : 'mountain',
            elevation: h.elevation,
            facet: rng.next() * Math.PI,
            col,
            row,
          });
        }
      }
    }
  }

  return { trees, rocks, ruinProps };
}
