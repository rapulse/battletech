import { describe, expect, it } from 'vitest';
import { Direction, hex, neighbor, offsetToHex, opposite } from '../src/core/hex/index.js';
import {
  EDGE_CLIFF,
  EDGE_WALL,
  HexMap,
  MAX_ELEVATION,
  MIN_ELEVATION,
  OVERLAY_SMOKE,
  TerrainType,
  terrainInfo,
} from '../src/core/map/index.js';

function grid(w = 8, h = 8): HexMap {
  return new HexMap(w, h);
}

describe('хранение карты', () => {
  it('новая карта — равнина на нулевом уровне', () => {
    const m = grid();
    for (const c of m.cells()) {
      expect(m.getTerrain(c)).toBe(TerrainType.Plain);
      expect(m.getElevation(c)).toBe(0);
      expect(m.getDepth(c)).toBe(0);
    }
  });

  it('индексы клеток уникальны и покрывают всю карту', () => {
    const m = grid(15, 15);
    const seen = new Set<number>();
    for (const c of m.cells()) seen.add(m.index(c));
    expect(seen.size).toBe(15 * 15);
  });

  it('hexAt обратен index', () => {
    const m = grid(15, 15);
    for (let i = 0; i < m.w * m.h; i++) expect(m.index(m.hexAt(i))).toBe(i);
  });

  it('contains отсекает клетки за краем', () => {
    const m = grid(5, 5);
    expect(m.contains(offsetToHex(0, 0))).toBe(true);
    expect(m.contains(offsetToHex(4, 4))).toBe(true);
    expect(m.contains(offsetToHex(5, 0))).toBe(false);
    expect(m.contains(offsetToHex(0, -1))).toBe(false);
  });

  it('обращение за край бросает исключение, а не возвращает мусор', () => {
    const m = grid(4, 4);
    expect(() => m.getTerrain(offsetToHex(9, 9))).toThrow(RangeError);
  });

  it('порядок обхода клеток детерминирован', () => {
    const m = grid(6, 7);
    const a = [...m.cells()].map((c) => `${c.q},${c.r}`);
    const b = [...m.cells()].map((c) => `${c.q},${c.r}`);
    expect(a).toEqual(b);
    expect(a.length).toBe(42);
  });
});

describe('рельеф и высота', () => {
  it('смена рельефа подтягивает высоту объекта', () => {
    const m = grid();
    const c = offsetToHex(2, 2);
    m.setTerrain(c, TerrainType.HeavyWoods);
    expect(m.getObjHeight(c)).toBe(terrainInfo(TerrainType.HeavyWoods).objHeight);
    expect(m.getObjHeight(c)).toBe(2);

    m.setTerrain(c, TerrainType.Plain);
    expect(m.getObjHeight(c)).toBe(0);
  });

  it('высоту объекта можно перекрыть — здания бывают разной этажности', () => {
    const m = grid();
    const c = offsetToHex(1, 1);
    m.setTerrain(c, TerrainType.Building);
    m.setObjHeight(c, 4);
    expect(m.getObjHeight(c)).toBe(4);
  });

  it('уровень принимается только в диапазоне −5…+5', () => {
    const m = grid();
    const c = offsetToHex(3, 3);
    for (let lv = MIN_ELEVATION; lv <= MAX_ELEVATION; lv++) {
      m.setElevation(c, lv);
      expect(m.getElevation(c)).toBe(lv);
    }
    expect(() => m.setElevation(c, MAX_ELEVATION + 1)).toThrow(RangeError);
    expect(() => m.setElevation(c, MIN_ELEVATION - 1)).toThrow(RangeError);
    expect(() => m.setElevation(c, 1.5)).toThrow(RangeError);
  });

  it('глубина — это отрицательный уровень, но только у воды', () => {
    const m = grid();
    const water = offsetToHex(2, 2);
    const pit = offsetToHex(3, 3);

    m.setTerrain(water, TerrainType.Water);
    m.setElevation(water, -2);
    expect(m.getDepth(water)).toBe(2);

    // Сухая яма той же глубины водой не является.
    m.setElevation(pit, -2);
    expect(m.getDepth(pit)).toBe(0);
  });
});

describe('рёбра хранятся один раз на две клетки', () => {
  it('запись с одной стороны читается с другой', () => {
    const m = grid();
    const a = offsetToHex(3, 3);
    for (let d = 0; d < 6; d++) {
      const dir = d as Direction;
      const b = neighbor(a, dir);
      if (!m.contains(b)) continue;

      m.setEdge(a, dir, EDGE_WALL);
      expect(m.getEdge(a, dir)).toBe(EDGE_WALL);
      expect(m.getEdge(b, opposite(dir))).toBe(EDGE_WALL);

      m.setEdge(a, dir, 0);
    }
  });

  it('запись со второй стороны видна с первой — рассинхронизация невозможна', () => {
    const m = grid();
    const a = offsetToHex(4, 4);
    const b = neighbor(a, Direction.E);
    m.setEdge(b, Direction.W, EDGE_CLIFF);
    expect(m.getEdge(a, Direction.E)).toBe(EDGE_CLIFF);
  });

  it('признаки складываются битовой маской', () => {
    const m = grid();
    const a = offsetToHex(2, 2);
    m.addEdge(a, Direction.NW, EDGE_WALL);
    m.addEdge(a, Direction.NW, EDGE_CLIFF);
    expect(m.getEdge(a, Direction.NW) & EDGE_WALL).toBeTruthy();
    expect(m.getEdge(a, Direction.NW) & EDGE_CLIFF).toBeTruthy();
  });

  it('ребро наружу карты читается как пустое, а не падает', () => {
    const m = grid(3, 3);
    const corner = offsetToHex(0, 0);
    expect(m.getEdge(corner, Direction.NW)).toBe(0);
  });

  it('число слотов рёбер — три на клетку', () => {
    const m = grid(10, 10);
    expect(m.edges.length).toBe(10 * 10 * 3);
  });
});

describe('копия карты', () => {
  it('независима от оригинала', () => {
    const m = grid();
    const c = offsetToHex(2, 2);
    m.setTerrain(c, TerrainType.HeavyWoods);
    m.setElevation(c, 3);
    m.addEdge(c, Direction.NW, EDGE_WALL);
    m.setOverlay(c, OVERLAY_SMOKE);
    m.setRiver(c, true);

    const copy = m.clone();
    expect(copy.getTerrain(c)).toBe(TerrainType.HeavyWoods);
    expect(copy.getElevation(c)).toBe(3);
    expect(copy.getEdge(c, Direction.NW)).toBe(EDGE_WALL);
    expect(copy.getOverlay(c)).toBe(OVERLAY_SMOKE);
    expect(copy.getRiver(c)).toBe(true);

    copy.setElevation(c, -1);
    expect(m.getElevation(c)).toBe(3);
    copy.setRiver(c, false);
    expect(m.getRiver(c)).toBe(true);
  });

  it('снапшот сравним побайтово — основа хэша состояния', () => {
    const m = grid();
    m.setTerrain(hex(1, 1), TerrainType.Water);
    const a = m.clone();
    expect(Array.from(a.terrain)).toEqual(Array.from(m.terrain));
    expect(Array.from(a.elevation)).toEqual(Array.from(m.elevation));
  });
});
