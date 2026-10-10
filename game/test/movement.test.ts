import { describe, expect, it } from 'vitest';
import { Direction, neighbor, offsetToHex, opposite, type Hex } from '../src/core/hex/index.js';
import {
  Blocked,
  EDGE_BRIDGE,
  EDGE_CLIFF,
  EDGE_WALL,
  HexMap,
  MoveMode,
  moveCost,
  TerrainType,
} from '../src/core/map/index.js';

const A = offsetToHex(3, 3);
const B = neighbor(A, Direction.E);
const DIR = Direction.E;

function fresh(): HexMap {
  return new HexMap(9, 9);
}

function cost(m: HexMap, mode = MoveMode.Walk, from: Hex = A, to: Hex = B, dir = DIR): number | null {
  const r = moveCost(m, from, to, dir, mode);
  return r.ok ? r.step.mp : null;
}

function reason(m: HexMap, mode = MoveMode.Walk): Blocked | null {
  const r = moveCost(m, A, B, DIR, mode);
  return r.ok ? null : r.reason;
}

describe('стоимость по рельефу', () => {
  it('равнина стоит 1, лес дороже, густой лес ещё дороже', () => {
    const m = fresh();
    expect(cost(m)).toBe(1);
    m.setTerrain(B, TerrainType.LightWoods);
    expect(cost(m)).toBe(2);
    m.setTerrain(B, TerrainType.HeavyWoods);
    expect(cost(m)).toBe(3);
  });

  it('здание непроходимо', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Building);
    expect(reason(m)).toBe(Blocked.Impassable);
  });

  it('за краем карты хода нет', () => {
    const m = fresh();
    const corner = offsetToHex(0, 0);
    const outside = neighbor(corner, Direction.NW);
    const r = moveCost(m, corner, outside, Direction.NW, MoveMode.Walk);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(Blocked.OffMap);
  });
});

describe('вода: глубина — это уровень', () => {
  it('по колено дороже на 1, по пояс на 2', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);

    // База 1 + глубина. Спуск в воду доплаты не требует — вниз ходить дёшево.
    m.setElevation(B, -1);
    expect(cost(m)).toBe(2);
    m.setElevation(B, -2);
    expect(cost(m)).toBe(3);
  });

  it('глубина по пояс требует броска пилотирования', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);
    m.setElevation(B, -2);
    const r = moveCost(m, A, B, DIR, MoveMode.Walk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.step.pilotingCheck).toBe(true);
      expect(r.step.submerged).toBe(2);
    }
  });

  it('с головой — шагом непроходимо', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);
    m.setElevation(B, -3);
    expect(reason(m)).toBe(Blocked.TooSteepDown);
  });

  it('переправа на бегу требует броска пилотирования, шагом — нет (любая вода, включая реку)', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);
    m.setElevation(B, -1); // по колено — глубина реки (шаг 9c: река это Water, не ребро)
    const walk = moveCost(m, A, B, DIR, MoveMode.Walk);
    const run = moveCost(m, A, B, DIR, MoveMode.Run);
    expect(walk.ok && walk.step.pilotingCheck).toBe(false);
    expect(run.ok && run.step.pilotingCheck).toBe(true);
  });

  it('прыжком глубокая вода тоже не место для приземления', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);
    m.setElevation(B, -3);
    expect(reason(m, MoveMode.Jump)).toBe(Blocked.DeepWater);
  });
});

describe('переходы по высоте', () => {
  it('подъём на 1 стоит дополнительный MP', () => {
    const m = fresh();
    m.setElevation(B, 1);
    expect(cost(m)).toBe(2);
  });

  it('подъём на 2 и выше шагом запрещён', () => {
    const m = fresh();
    m.setElevation(B, 2);
    expect(reason(m)).toBe(Blocked.TooSteepUp);
    m.setElevation(B, 5);
    expect(reason(m)).toBe(Blocked.TooSteepUp);
  });

  it('подъём на 1 с уровня 1 на уровень 2 разрешён — важен перепад, а не абсолют', () => {
    const m = fresh();
    m.setElevation(A, 1);
    m.setElevation(B, 2);
    expect(cost(m)).toBe(2);
  });

  it('спуск на 1 бесплатен сверх базовой стоимости', () => {
    const m = fresh();
    m.setElevation(A, 1);
    expect(cost(m)).toBe(1);
  });

  it('спуск ровно на 2 проходится, но с броском пилотирования', () => {
    const m = fresh();
    m.setElevation(A, 2);
    const r = moveCost(m, A, B, DIR, MoveMode.Walk);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.step.pilotingCheck).toBe(true);
  });

  it('спуск на 3 и глубже шагом запрещён', () => {
    const m = fresh();
    m.setElevation(A, 3);
    expect(reason(m)).toBe(Blocked.TooSteepDown);
  });

  it('прыжок берёт любой перепад, доплачивая за подъём', () => {
    const m = fresh();
    m.setElevation(B, 4);
    expect(cost(m, MoveMode.Jump)).toBe(1 + 4);
    m.setElevation(A, 5);
    m.setElevation(B, -5);
    expect(cost(m, MoveMode.Jump)).toBe(1); // спуск прыжком доплаты не требует
  });
});

describe('рёбра', () => {
  it('обрыв непроходим шагом в обе стороны, независимо от перепада', () => {
    const m = fresh();
    m.addEdge(A, DIR, EDGE_CLIFF);
    expect(reason(m)).toBe(Blocked.Cliff);
    const back = moveCost(m, B, A, opposite(DIR), MoveMode.Walk);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.reason).toBe(Blocked.Cliff);
  });

  it('обрыв перелетается прыжком', () => {
    const m = fresh();
    m.addEdge(A, DIR, EDGE_CLIFF);
    expect(cost(m, MoveMode.Jump)).toBe(1);
  });

  it('стена непроходима и прыжком тоже — но приземлиться за ней можно', () => {
    const m = fresh();
    m.addEdge(A, DIR, EDGE_WALL);
    expect(reason(m)).toBe(Blocked.Wall);
    // Прыжок игнорирует рёбра: перелёт через стену допустим.
    expect(cost(m, MoveMode.Jump)).toBe(1);
  });

  it('мост отменяет глубину воды и обрыв, кладя ровную дорогу', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Water);
    m.setElevation(B, -1); // по колено — как в русле реки
    m.addEdge(A, DIR, EDGE_CLIFF | EDGE_BRIDGE);
    expect(cost(m)).toBe(1);
  });
});

describe('бег по опасной местности', () => {
  it('пересечённая, развалины и болото требуют броска только на бегу', () => {
    for (const t of [TerrainType.Rough, TerrainType.Rubble, TerrainType.Swamp]) {
      const m = fresh();
      m.setTerrain(B, t);
      const walk = moveCost(m, A, B, DIR, MoveMode.Walk);
      const run = moveCost(m, A, B, DIR, MoveMode.Run);
      expect(walk.ok && walk.step.pilotingCheck).toBe(false);
      expect(run.ok && run.step.pilotingCheck).toBe(true);
    }
  });

  it('дорога безопасна на бегу', () => {
    const m = fresh();
    m.setTerrain(B, TerrainType.Road);
    const run = moveCost(m, A, B, DIR, MoveMode.Run);
    expect(run.ok && run.step.pilotingCheck).toBe(false);
  });
});

describe('симметрия и целостность', () => {
  it('на ровной равнине переход стоит одинаково в обе стороны', () => {
    const m = fresh();
    for (let d = 0; d < 6; d++) {
      const dir = d as Direction;
      const to = neighbor(A, dir);
      if (!m.contains(to)) continue;
      const there = moveCost(m, A, to, dir, MoveMode.Walk);
      const back = moveCost(m, to, A, opposite(dir), MoveMode.Walk);
      expect(there.ok && there.step.mp).toBe(back.ok && back.step.mp);
    }
  });

  it('стоимость всегда положительное целое', () => {
    const m = fresh();
    for (const t of [0, 1, 2, 3, 4, 5, 6, 7] as TerrainType[]) {
      m.setTerrain(B, t);
      for (const mode of [MoveMode.Walk, MoveMode.Run, MoveMode.Jump]) {
        const r = moveCost(m, A, B, DIR, mode);
        if (!r.ok) continue;
        expect(Number.isInteger(r.step.mp)).toBe(true);
        expect(r.step.mp).toBeGreaterThan(0);
      }
    }
  });
});
