import { describe, expect, it } from 'vitest';
import {
  Direction,
  distance,
  key as hexKey,
  neighbor,
  offsetToHex,
  type Hex,
} from '../src/core/hex/index.js';
import {
  EDGE_CLIFF,
  HexMap,
  MoveMode,
  TerrainType,
  costTo,
  pathTo,
  reachable,
} from '../src/core/map/index.js';

const START = offsetToHex(7, 7);

function board(w = 15, h = 15): HexMap {
  return new HexMap(w, h);
}

function reach(m: HexMap, mp: number, mode = MoveMode.Walk, blocked?: ReadonlySet<number>) {
  return reachable(m, START, {
    mode,
    mpBudget: mp,
    startFacing: Direction.NW,
    ...(blocked === undefined ? {} : { blocked }),
  });
}

describe('достижимость на пустой равнине', () => {
  it('стартовая клетка достижима бесплатно', () => {
    const r = reach(board(), 5);
    expect(costTo(r, START)).toBe(0);
  });

  it('на равнине стоимость равна расстоянию в гексах', () => {
    const m = board();
    const r = reach(m, 6);
    for (const [, cell] of r.byHex) {
      expect(cell.cost).toBe(distance(START, cell.hex));
    }
  });

  it('бюджет соблюдается строго', () => {
    for (const mp of [1, 3, 5, 7]) {
      const r = reach(board(), mp);
      for (const [, cell] of r.byHex) expect(cell.cost).toBeLessThanOrEqual(mp);
    }
  });

  it('число достижимых клеток растёт по формуле шестиугольника', () => {
    const m = board(31, 31);
    const centre = offsetToHex(15, 15);
    for (const mp of [1, 2, 3, 4]) {
      const r = reachable(m, centre, { mode: MoveMode.Walk, mpBudget: mp, startFacing: Direction.NW });
      // 1 + 3·n·(n+1) — все клетки в радиусе n
      expect(r.byHex.size).toBe(1 + 3 * mp * (mp + 1));
    }
  });

  it('за край карты не выходит', () => {
    const m = board(5, 5);
    const corner = offsetToHex(0, 0);
    const r = reachable(m, corner, { mode: MoveMode.Walk, mpBudget: 20, startFacing: Direction.NW });
    for (const [, cell] of r.byHex) expect(m.contains(cell.hex)).toBe(true);
    expect(r.byHex.size).toBe(25);
  });
});

describe('рельеф влияет на достижимость', () => {
  it('густой лес съедает бюджет', () => {
    const m = board();
    for (const c of m.cells()) m.setTerrain(c, TerrainType.HeavyWoods);
    const r = reach(m, 6);
    // Каждый гекс по 3 MP: дальше двух шагов не уйти.
    for (const [, cell] of r.byHex) expect(distance(START, cell.hex)).toBeLessThanOrEqual(2);
  });

  it('стена зданий отсекает всё, что за ней', () => {
    const m = board();
    // Кольцо зданий вокруг старта
    for (let d = 0; d < 6; d++) m.setTerrain(neighbor(START, d as Direction), TerrainType.Building);
    const r = reach(m, 10);
    expect(r.byHex.size).toBe(1); // только стартовая клетка
  });

  it('обрыв обходится, а не игнорируется', () => {
    const m = board();
    const target = neighbor(START, Direction.E);
    m.addEdge(START, Direction.E, EDGE_CLIFF);
    const r = reach(m, 4);
    // Клетка достижима, но не напрямую: в обход дороже одного шага.
    expect(costTo(r, target)).toBeGreaterThan(1);
  });

  it('прыжок перелетает обрыв напрямую', () => {
    const m = board();
    const target = neighbor(START, Direction.E);
    m.addEdge(START, Direction.E, EDGE_CLIFF);
    const r = reach(m, 2, MoveMode.Jump);
    expect(costTo(r, target)).toBe(1);
  });

  it('высокий уступ шагом недостижим, прыжком достижим', () => {
    const m = board();
    const ledge = neighbor(START, Direction.NW);
    m.setElevation(ledge, 3);

    expect(costTo(reach(m, 8), ledge)).toBeNull();
    expect(costTo(reach(m, 8, MoveMode.Jump), ledge)).toBe(1 + 3);
  });

  it('лестница уровней проходится шагом по одному', () => {
    const m = board();
    let c: Hex = START;
    for (let lv = 1; lv <= 4; lv++) {
      c = neighbor(c, Direction.E);
      m.setElevation(c, lv);
    }
    const r = reach(m, 8);
    // Четыре шага по 1 MP плюс по 1 за каждый уровень подъёма.
    expect(costTo(r, c)).toBe(4 + 4);
  });
});

describe('занятые клетки', () => {
  it('через чужого робота не пройти', () => {
    const m = board();
    const occupied = neighbor(START, Direction.E);
    const r = reach(m, 4, MoveMode.Walk, new Set([hexKey(occupied)]));
    expect(costTo(r, occupied)).toBeNull();
  });

  it('но вокруг него — можно', () => {
    const m = board();
    const occupied = neighbor(START, Direction.E);
    const behind = neighbor(occupied, Direction.E);
    const r = reach(m, 4, MoveMode.Walk, new Set([hexKey(occupied)]));
    // Напрямую было бы 2 шага, но прямая дорога перекрыта: обход стоит 3.
    expect(costTo(r, behind)).toBe(3);
  });
});

describe('маршрут', () => {
  it('начинается на старте и заканчивается на цели', () => {
    const m = board();
    const target = offsetToHex(10, 9);
    const r = reach(m, 12);
    const path = pathTo(r, target);
    expect(path[0]!.hex).toEqual(START);
    expect(path[path.length - 1]!.hex).toEqual(target);
  });

  it('каждый шаг маршрута — переход в соседнюю клетку', () => {
    const m = board();
    m.setTerrain(offsetToHex(8, 7), TerrainType.HeavyWoods);
    const r = reach(m, 12);
    for (const [, cell] of r.byHex) {
      const path = pathTo(r, cell.hex);
      for (let i = 1; i < path.length; i++) {
        expect(distance(path[i - 1]!.hex, path[i]!.hex)).toBe(1);
      }
    }
  });

  it('стоимость маршрута монотонно растёт', () => {
    const m = board();
    for (const c of m.cells()) if ((c.q + c.r) % 3 === 0) m.setTerrain(c, TerrainType.Rough);
    const r = reach(m, 10);
    for (const [, cell] of r.byHex) {
      const path = pathTo(r, cell.hex);
      for (let i = 1; i < path.length; i++) {
        expect(path[i]!.cost).toBeGreaterThan(path[i - 1]!.cost);
      }
    }
  });

  it('до недостижимой клетки маршрут пуст', () => {
    const m = board();
    expect(pathTo(reach(m, 1), offsetToHex(0, 0))).toEqual([]);
  });

  it('риск копится по всему маршруту, а не только на последнем шаге', () => {
    const m = board();
    // Единственная дорога наружу идёт через две реки подряд.
    const step1 = neighbor(START, Direction.E);
    const step2 = neighbor(step1, Direction.E);
    for (let d = 0; d < 6; d++) {
      if (d === Direction.E) continue;
      m.setTerrain(neighbor(START, d as Direction), TerrainType.Building);
    }
    for (let d = 0; d < 6; d++) {
      if (d === Direction.E) continue;
      const c = neighbor(step1, d as Direction);
      if (m.contains(c) && c.q !== START.q) m.setTerrain(c, TerrainType.Building);
    }
    // Река — теперь клетка (Water по колено), а не ребро (шаг 9c).
    m.setTerrain(step1, TerrainType.Water);
    m.setElevation(step1, -1);
    m.setTerrain(step2, TerrainType.Water);
    m.setElevation(step2, -1);

    const r = reach(m, 8, MoveMode.Run);
    const cell = r.byHex.get(hexKey(step2))!;
    expect(cell.anyPilotingCheck).toBe(true);
    expect(cell.riskCount).toBe(2);
  });

  it('при равной стоимости выбирается маршрут без риска падения', () => {
    const m = board();
    const risky = neighbor(START, Direction.E);
    const beyond = neighbor(risky, Direction.E);
    // Река — клетка Water по колено (шаг 9c), не ребро.
    m.setTerrain(risky, TerrainType.Water);
    m.setElevation(risky, -1);

    // Прямая дорога через реку: 1+1 (глубина) +1 = 3. Обход: тоже 3, но без броска.
    const r = reach(m, 6, MoveMode.Run);
    const cell = r.byHex.get(hexKey(beyond))!;
    expect(cell.cost).toBe(3);
    expect(cell.riskCount).toBe(0);
  });
});

describe('детерминизм', () => {
  it('повторный прогон даёт тот же результат', () => {
    const m = board();
    for (const c of m.cells()) {
      if ((c.q * 7 + c.r * 3) % 5 === 0) m.setTerrain(c, TerrainType.LightWoods);
      if ((c.q * 3 + c.r * 5) % 7 === 0) m.setElevation(c, 1);
    }
    const snapshot = (): string =>
      [...reach(m, 8).byHex.values()]
        .map((c) => `${c.hex.q},${c.hex.r}:${c.cost}:${c.facing}`)
        .sort()
        .join('|');
    expect(snapshot()).toBe(snapshot());
  });

  it('выбор фасинга при равной стоимости стабилен', () => {
    const m = board();
    const a = reach(m, 5);
    const b = reach(m, 5);
    for (const [k, cell] of a.byHex) {
      expect(b.byHex.get(k)!.facing).toBe(cell.facing);
    }
  });

  it('поворот можно сделать платным без переделки поиска', () => {
    const m = board();
    const free = reachable(m, START, {
      mode: MoveMode.Walk,
      mpBudget: 4,
      startFacing: Direction.NW,
      turnMpCost: 0,
    });
    const costly = reachable(m, START, {
      mode: MoveMode.Walk,
      mpBudget: 4,
      startFacing: Direction.NW,
      turnMpCost: 1,
    });
    // Платный поворот сужает достижимую область, но не ломает поиск.
    expect(costly.byHex.size).toBeLessThan(free.byHex.size);
    expect(costly.byHex.size).toBeGreaterThan(1);
    // Идти прямо на север по-прежнему стоит ровно по 1 за гекс.
    let north: Hex = START;
    for (let i = 0; i < 4; i++) north = neighbor(north, Direction.NW);
    expect(costTo(costly, north)).toBe(4);
  });
});
