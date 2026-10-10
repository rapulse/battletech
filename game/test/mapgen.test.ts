import { describe, expect, it } from 'vitest';
import {
  assertGeneratorVersion,
  describeMap,
  EDGE_BRIDGE,
  EDGE_CLIFF,
  GENERATOR_VERSION,
  generateMap,
  MAP_SIZES,
  moveCost,
  MoveMode,
  terrainInfo,
  TerrainType,
  type HexMap,
} from '../src/core/map/index.js';
import { BIOME_LIST } from '../src/core/data/tables.js';
import {
  Direction,
  key as hexKey,
  neighbor,
  offsetToHex,
  type Hex,
} from '../src/core/hex/index.js';
import { Rng } from '../src/core/rng/index.js';
import { ValueNoise } from '../src/core/map/noise.js';

const BIOMES = BIOME_LIST.map((b) => b.id);

function make(seed: number, size = MAP_SIZES.lance, biome = 'temperate') {
  return generateMap(describeMap({ seed, width: size, height: size, biome }));
}

function walkable(map: HexMap, h: Hex): boolean {
  if (!map.contains(h)) return false;
  if (!terrainInfo(map.getTerrain(h)).walkable) return false;
  return map.getDepth(h) <= 2;
}

describe('шум', () => {
  it('воспроизводим: один сид — те же значения', () => {
    const a = new ValueNoise(new Rng(7));
    const b = new ValueNoise(new Rng(7));
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a.fractal2D(x, y)).toBe(b.fractal2D(x, y));
    }
  });

  it('разные сиды дают разные поля', () => {
    const a = new ValueNoise(new Rng(7));
    const b = new ValueNoise(new Rng(8));
    let diffs = 0;
    for (let i = 0; i < 50; i++) {
      if (a.fractal2D(i * 0.37, i * 0.11) !== b.fractal2D(i * 0.37, i * 0.11)) diffs++;
    }
    expect(diffs).toBeGreaterThan(40);
  });

  it('остаётся в 0…1 на любой октаве', () => {
    const n = new ValueNoise(new Rng(3));
    for (let i = 0; i < 200; i++) {
      const v = n.fractal2D(i * 0.9, i * 1.7, 4, 0.5, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('детерминизм генератора', () => {
  it('один описатель — побайтово те же буферы', () => {
    for (const biome of BIOMES) {
      const a = make(4242, MAP_SIZES.lance, biome).map;
      const b = make(4242, MAP_SIZES.lance, biome).map;
      expect([...a.terrain]).toEqual([...b.terrain]);
      expect([...a.elevation]).toEqual([...b.elevation]);
      expect([...a.edges]).toEqual([...b.edges]);
    }
  });

  it('разные сиды — разные карты', () => {
    const a = make(1).map;
    const b = make(2).map;
    expect([...a.terrain]).not.toEqual([...b.terrain]);
  });

  it('версия генератора сверяется, а не игнорируется', () => {
    const d = describeMap({ seed: 1 });
    expect(() => assertGeneratorVersion(d)).not.toThrow();
    expect(() => assertGeneratorVersion({ ...d, generatorVersion: GENERATOR_VERSION + 1 })).toThrow(
      /версии/,
    );
  });
});

describe('гарантии карты', () => {
  it('связность: из стартовой зоны шагом достижима вся проходимая карта', () => {
    for (const biome of BIOMES) {
      for (let seed = 500; seed < 520; seed++) {
        const g = make(seed, MAP_SIZES.lance, biome);
        expect(g.metrics.unreachable, `${biome}, сид ${seed}`).toBe(0);
      }
    }
  }, 15000);

  it('стартовые зоны есть у обеих сторон и не пересекаются', () => {
    for (let seed = 700; seed < 720; seed++) {
      const g = make(seed);
      expect(g.starts).toHaveLength(2);
      for (const zone of g.starts) expect(zone.hexes.length).toBeGreaterThan(0);
      const first = new Set(g.starts[0]!.hexes.map(hexKey));
      for (const h of g.starts[1]!.hexes) expect(first.has(hexKey(h))).toBe(false);
    }
  });

  it('между стартовыми зонами есть путь ШАГОМ, а не только прыжком', () => {
    for (let seed = 800; seed < 815; seed++) {
      const g = make(seed);
      expect(g.metrics.startPathCost, `сид ${seed}`).not.toBeNull();
    }
  });

  it('перепад ≥2 всегда закрыт обрывом', () => {
    for (let seed = 900; seed < 915; seed++) {
      const { map } = make(seed);
      for (const cell of map.cells()) {
        for (let d = 0; d < 3; d++) {
          const dir = d as Direction;
          const to = neighbor(cell, dir);
          if (!map.contains(to)) continue;
          const delta = Math.abs(map.getElevation(to) - map.getElevation(cell));
          if (delta < 2) continue;
          expect((map.getEdge(cell, dir) & EDGE_CLIFF) !== 0, `сид ${seed}`).toBe(true);
        }
      }
    }
  });

  it('клетки реки — полноценная вода, а не декорация ребра (шаг 9c)', () => {
    // Река раньше была признаком РЕБРА, из-за чего выглядела водой, но не
    // подчинялась ни одному правилу воды. Теперь это обычная `Water`.
    let riverCells = 0;
    for (let seed = 1000; seed < 1030; seed++) {
      const { map } = make(seed);
      for (const cell of map.cells()) {
        if (!map.getRiver(cell)) continue;
        riverCells++;
        expect(map.getTerrain(cell), `сид ${seed}`).toBe(TerrainType.Water);
      }
    }
    // Замер, который всегда ноль, — найденная ошибка: проверка обязана
    // что-то проверять.
    expect(riverCells).toBeGreaterThan(0);
  });

  it('вода не глубже пояса: непроходимого шагом озера генератор не строит', () => {
    for (let seed = 1100; seed < 1120; seed++) {
      const { map } = make(seed);
      for (const cell of map.cells()) {
        if (map.getTerrain(cell) !== TerrainType.Water) continue;
        expect(map.getDepth(cell)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('мост стоит только там, где есть река', () => {
    for (let seed = 1200; seed < 1215; seed++) {
      const { map } = make(seed);
      for (const cell of map.cells()) {
        for (let d = 0; d < 3; d++) {
          const dir = d as Direction;
          const edge = map.getEdge(cell, dir);
          if ((edge & EDGE_BRIDGE) === 0) continue;
          const to = neighbor(cell, dir);
          const onRiver = map.getRiver(cell) || (map.contains(to) && map.getRiver(to));
          expect(onRiver, `сид ${seed}`).toBe(true);
        }
      }
    }
  });

  it('развалины: редкое компактное пятно, не на воде и не в стартовой зоне', () => {
    let mapsWithRuins = 0;
    const biomesWithRuins = ['temperate', 'desert', 'tundra', 'jungle'];
    for (const biomeId of biomesWithRuins) {
      for (let seed = 1300; seed < 1330; seed++) {
        const { map, starts } = make(seed, MAP_SIZES.lance, biomeId);
        const startSet = new Set<number>();
        for (const zone of starts) for (const h of zone.hexes) startSet.add(hexKey(h));

        const ruinCells: Hex[] = [];
        for (const cell of map.cells()) {
          if (!map.getRuins(cell)) continue;
          ruinCells.push(cell);
          // Метка не должна разойтись с рельефом (шаг 9c: дорога, проложенная
          // поверх пятна, обязана снимать метку, иначе показ рисует развалины
          // на клетке, которая давно стала дорогой).
          expect(map.getTerrain(cell), `${biomeId}, сид ${seed}`).toBe(TerrainType.Rubble);
          expect(startSet.has(hexKey(cell)), `${biomeId}, сид ${seed}`).toBe(false);
        }
        if (ruinCells.length > 0) mapsWithRuins++;
        // Компактно: 2-6 клеток (1-2 пятна по ~3), не расползшееся по всей карте.
        expect(ruinCells.length, `${biomeId}, сид ${seed}`).toBeLessThanOrEqual(8);
      }
    }
    // Не на каждой карте: замер, который всегда 100% или 0%, — найденная ошибка.
    expect(mapsWithRuins).toBeGreaterThan(0);
    expect(mapsWithRuins).toBeLessThan(biomesWithRuins.length * 30);
  });

  it('развалины не заводятся там, где не просили (вулкан, луна)', () => {
    for (const biomeId of ['volcanic', 'lunar']) {
      for (let seed = 1300; seed < 1310; seed++) {
        const { map } = make(seed, MAP_SIZES.lance, biomeId);
        let ruinCells = 0;
        for (const cell of map.cells()) if (map.getRuins(cell)) ruinCells++;
        expect(ruinCells, `${biomeId}, сид ${seed}`).toBe(0);
      }
    }
  });

  it('ручка интерфейса «Развалины» выключает их совсем, как у реки/озёр/дорог', () => {
    for (let seed = 1300; seed < 1330; seed++) {
      const { map } = generateMap(
        describeMap({ seed, width: MAP_SIZES.lance, height: MAP_SIZES.lance, biome: 'temperate', ruins: false }),
      );
      let ruinCells = 0;
      for (const cell of map.cells()) if (map.getRuins(cell)) ruinCells++;
      expect(ruinCells, `сид ${seed}`).toBe(0);
    }
  });
});

describe('тактическая шкала', () => {
  /**
   * Главное требование части E: то, что робот видит на дистанции выстрела, не
   * зависит от размера карты. Проверяется по МЕДИАНЕ размера массива, а не по
   * среднему: среднее на большой карте тянут вверх редкие сросшиеся массивы
   * (перколяция), и оно растёт даже при неизменном генераторе.
   */
  it('медианный размер массива не зависит от размера карты', () => {
    const median = (size: number): number => {
      let sum = 0;
      for (let seed = 0; seed < 12; seed++) {
        sum += generateMap(describeMap({ seed: 3000 + seed, width: size, height: size })).metrics
          .medianPatchSize;
      }
      return sum / 12;
    };

    const small = median(MAP_SIZES.duel);
    const large = median(MAP_SIZES.operational);
    expect(Math.abs(large - small) / small).toBeLessThan(0.25);
  });

  it('доля укрытия не зависит от размера карты', () => {
    const share = (size: number): number => {
      let sum = 0;
      for (let seed = 0; seed < 10; seed++) {
        sum += generateMap(describeMap({ seed: 4000 + seed, width: size, height: size })).metrics
          .coverShare;
      }
      return sum / 10;
    };
    expect(Math.abs(share(MAP_SIZES.operational) - share(MAP_SIZES.duel))).toBeLessThan(0.06);
  });

  it('умеренный биом даёт укрытие в оговорённой полосе 25…45 %', () => {
    let sum = 0;
    for (let seed = 0; seed < 20; seed++) sum += make(5000 + seed).metrics.coverShare;
    const share = sum / 20;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.45);
  });
});

describe('биомы различимы', () => {
  /**
   * Критерий тот же, которым шаг 8 проверял личности бота: если два биома дают
   * одинаковые числа, их два только в файле данных.
   */
  it('джунгли укрывают заметно больше тундры и пустыни', () => {
    const cover = (biome: string): number => {
      let sum = 0;
      for (let seed = 0; seed < 12; seed++) sum += make(6000 + seed, MAP_SIZES.lance, biome).metrics.coverShare;
      return sum / 12;
    };
    const jungle = cover('jungle');
    expect(jungle).toBeGreaterThan(cover('tundra') + 0.2);
    expect(jungle).toBeGreaterThan(cover('desert') + 0.2);
  });

  it('в джунглях видно заметно ближе, чем в лунной пустыне', () => {
    const sight = (biome: string): number => {
      let sum = 0;
      for (let seed = 0; seed < 12; seed++) sum += make(6100 + seed, MAP_SIZES.lance, biome).metrics.longSightShare;
      return sum / 12;
    };
    expect(sight('jungle')).toBeLessThan(sight('lunar') - 0.2);
  });

  it('в лунном биоме нет ни воды, ни растительности', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { map } = make(6200 + seed, MAP_SIZES.lance, 'lunar');
      for (const cell of map.cells()) {
        const t = map.getTerrain(cell);
        expect(t).not.toBe(TerrainType.Water);
        expect(t).not.toBe(TerrainType.LightWoods);
        expect(t).not.toBe(TerrainType.HeavyWoods);
      }
    }
  });
});

describe('карта играбельна теми же правилами, что и бой', () => {
  it('из каждой стартовой клетки есть законный ход шагом', () => {
    for (let seed = 7000; seed < 7015; seed++) {
      const g = make(seed);
      for (const zone of g.starts) {
        const start = zone.hexes[0]!;
        expect(walkable(g.map, start)).toBe(true);
        let moves = 0;
        for (let d = 0; d < 6; d++) {
          const dir = d as Direction;
          const to = neighbor(start, dir);
          if (!g.map.contains(to)) continue;
          if (moveCost(g.map, start, to, dir, MoveMode.Walk).ok) moves++;
        }
        expect(moves, `сид ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('клетка 0101 существует и совпадает с угловой', () => {
    const { map } = make(11);
    expect(map.contains(offsetToHex(0, 0))).toBe(true);
    expect(map.contains(offsetToHex(map.w - 1, map.h - 1))).toBe(true);
  });
});
