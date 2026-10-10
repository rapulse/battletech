import { describe, expect, it } from 'vitest';
import { hex } from '../src/core/hex/index.js';
import {
  computeLos,
  EYE_PRONE,
  HexMap,
  invalidateLos,
  los,
  losCacheSize,
  TerrainType,
} from '../src/core/map/index.js';
import { Rng } from '../src/core/rng/index.js';

function flatMap(w = 15, h = 15): HexMap {
  return new HexMap(w, h);
}

describe('линия видимости', () => {
  it('на пустой равнине не перекрыта', () => {
    const m = flatMap();
    const r = computeLos(m, hex(0, 0), hex(0, 6));
    expect(r.blocked).toBe(false);
    expect(r.range).toBe(6);
    expect(r.coverMod).toBe(0);
  });

  it('расстояние 0 — цель сама на себе', () => {
    const m = flatMap();
    const r = computeLos(m, hex(3, 3), hex(3, 3));
    expect(r.range).toBe(0);
    expect(r.blocked).toBe(false);
  });

  it('соседние клетки: промежуточных гексов нет, помех нет', () => {
    const m = flatMap();
    m.setTerrain(hex(1, 1), TerrainType.HeavyWoods);
    const r = computeLos(m, hex(1, 0), hex(1, 1));
    expect(r.blocked).toBe(false);
    expect(r.coverMod).toBe(0);
  });

  it('редкий лес на пути даёт укрытие, но не перекрывает', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 3), TerrainType.LightWoods);
    const r = computeLos(m, hex(0, 0), hex(0, 6));
    expect(r.blocked).toBe(false);
    expect(r.lightWoods).toBe(1);
    expect(r.coverMod).toBe(1);
  });

  it('три редких леса перекрывают линию', () => {
    const m = flatMap();
    for (const y of [2, 3, 4]) m.setTerrain(hex(0, y), TerrainType.LightWoods);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(true);
  });

  it('один густой лес не перекрывает, два — перекрывают', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 3), TerrainType.HeavyWoods);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(false);
    m.setTerrain(hex(0, 4), TerrainType.HeavyWoods);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(true);
  });

  it('здание перекрывает линию жёстко, независимо от числа', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 3), TerrainType.Building);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(true);
  });

  it('холм между стрелком и целью перекрывает линию', () => {
    const m = flatMap();
    m.setElevation(hex(0, 3), 3);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(true);
  });

  it('с высоты видно поверх леса — то самое преимущество возвышенности', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 1), TerrainType.HeavyWoods);
    m.setTerrain(hex(0, 2), TerrainType.HeavyWoods);
    // Вровень: два густых леса перекрывают.
    expect(computeLos(m, hex(0, 0), hex(0, 4)).blocked).toBe(true);
    // Стрелок на +4, цель на 0: линия идёт выше крон.
    m.setElevation(hex(0, 0), 4);
    const high = computeLos(m, hex(0, 0), hex(0, 4));
    expect(high.blocked).toBe(false);
    expect(high.levelAdvantage).toBe(4);
  });

  it('упавший робот смотрит с уровня клетки, а не на уровень выше', () => {
    // Стрелок на +2 бьёт вниз на 0; гребень +2 стоит сразу перед ним.
    // Стоя он смотрит поверх гребня, лёжа — упирается в него.
    const m = flatMap();
    m.setElevation(hex(0, 0), 2);
    m.setElevation(hex(0, 1), 2);
    const standing = computeLos(m, hex(0, 0), hex(0, 4));
    const prone = computeLos(m, hex(0, 0), hex(0, 4), { fromEye: EYE_PRONE });
    expect(standing.blocked).toBe(false);
    expect(prone.blocked).toBe(true);
  });

  it('препятствие ровно на высоте линии перекрывает её', () => {
    // Формула terrain.md: препятствие >= высотыЛинии блокирует. Холм в один
    // уровень между двумя роботами на нуле — ровно этот случай.
    const m = flatMap();
    m.setElevation(hex(0, 3), 1);
    expect(computeLos(m, hex(0, 0), hex(0, 6)).blocked).toBe(true);
  });

  it('преимущество по высоте считается со знаком', () => {
    const m = flatMap();
    m.setElevation(hex(0, 0), 2);
    m.setElevation(hex(0, 4), -1);
    expect(computeLos(m, hex(0, 0), hex(0, 4)).levelAdvantage).toBe(3);
    expect(computeLos(m, hex(0, 4), hex(0, 0)).levelAdvantage).toBe(-3);
  });

  it('лес на равнине даёт укрытие, но не даёт частичного укрытия (partialCover = false)', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 1), TerrainType.LightWoods);
    const r = computeLos(m, hex(0, 0), hex(0, 2));
    expect(r.blocked).toBe(false);
    expect(r.coverMod).toBe(1);
    expect(r.partialCover).toBe(false);
  });

  it('гребень высотой +1 перед целью на 0 даёт частичное укрытие (partialCover = true)', () => {
    const m = flatMap();
    m.setElevation(hex(0, 0), 1); // Стрелок на +1
    m.setElevation(hex(0, 1), 1); // Гребень +1
    m.setElevation(hex(0, 2), 0); // Цель на 0 (ноги прикрыты гребнем)
    const r = computeLos(m, hex(0, 0), hex(0, 2));
    expect(r.blocked).toBe(false);
    expect(r.partialCover).toBe(true);
  });

  it('вода глубины 1 даёт частичное укрытие цели (ноги в воде)', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 2), TerrainType.Water);
    m.setElevation(hex(0, 2), -1); // Глубина 1
    const r = computeLos(m, hex(0, 0), hex(0, 2));
    expect(r.blocked).toBe(false);
    expect(r.partialCover).toBe(true);
  });

  it('развалины перед целью на равнине дают частичное укрытие (твёрдый рельеф, не лес)', () => {
    // Развалины численно похожи на редкий лес (objHeight>0, toHitMod>0) и
    // так же считаются лесоподобным препятствием для перекрытия линии — но
    // partialCover у них включён данными (`terrain.json`), в отличие от леса.
    const m = flatMap();
    m.setTerrain(hex(0, 1), TerrainType.Rubble);
    const r = computeLos(m, hex(0, 0), hex(0, 2));
    expect(r.blocked).toBe(false);
    expect(r.partialCover).toBe(true);
  });
});

describe('симметричность видимости', () => {
  it('los(a,b).blocked === los(b,a).blocked на случайных картах', () => {
    const rng = new Rng(20260824);
    for (let attempt = 0; attempt < 200; attempt++) {
      const m = flatMap(12, 12);
      for (let i = 0; i < 40; i++) {
        const h = hex(rng.int(0, 11), rng.int(-5, 11));
        if (!m.contains(h)) continue;
        m.setTerrain(h, rng.int(0, 8) as TerrainType);
        m.setElevation(h, rng.int(-2, 3));
      }
      const cells = [...m.cells()];
      for (let k = 0; k < 12; k++) {
        const a = rng.pick(cells);
        const b = rng.pick(cells);
        const ab = computeLos(m, a, b);
        const ba = computeLos(m, b, a);
        if (ab.blocked !== ba.blocked) {
          throw new Error(
            `Несимметрия: (${a.q},${a.r})->(${b.q},${b.r}) blocked=${ab.blocked}, обратно ${ba.blocked}`,
          );
        }
        expect(ab.range).toBe(ba.range);
        // Сложение, а не отрицание: -(0) даёт -0, и toBe спотыкается на Object.is.
        expect(ab.levelAdvantage + ba.levelAdvantage).toBe(0);
      }
    }
  });

  it('промежуточные леса считаются одинаково в обе стороны', () => {
    const rng = new Rng(7777);
    const m = flatMap(12, 12);
    for (let i = 0; i < 50; i++) {
      const h = hex(rng.int(0, 11), rng.int(-5, 11));
      if (m.contains(h)) m.setTerrain(h, rng.pick([TerrainType.LightWoods, TerrainType.HeavyWoods, TerrainType.Plain]));
    }
    const cells = [...m.cells()];
    for (let k = 0; k < 300; k++) {
      const a = rng.pick(cells);
      const b = rng.pick(cells);
      const ab = computeLos(m, a, b);
      const ba = computeLos(m, b, a);
      expect(ab.coverMod).toBe(ba.coverMod);
      expect(ab.lightWoods).toBe(ba.lightWoods);
      expect(ab.heavyWoods).toBe(ba.heavyWoods);
    }
  });
});

describe('кэш видимости', () => {
  it('повторный вызов отдаёт тот же объект и не растит кэш', () => {
    const m = flatMap();
    invalidateLos(m);
    const first = los(m, hex(0, 0), hex(0, 5));
    expect(losCacheSize(m)).toBe(1);
    const second = los(m, hex(0, 0), hex(0, 5));
    expect(second).toBe(first);
    expect(losCacheSize(m)).toBe(1);
  });

  it('кэш различает уровень глаз', () => {
    const m = flatMap();
    invalidateLos(m);
    los(m, hex(0, 0), hex(0, 5));
    los(m, hex(0, 0), hex(0, 5), { fromEye: EYE_PRONE });
    expect(losCacheSize(m)).toBe(2);
  });

  it('сброс очищает кэш', () => {
    const m = flatMap();
    los(m, hex(0, 0), hex(0, 5));
    invalidateLos(m);
    expect(losCacheSize(m)).toBe(0);
  });

  it('кэшированный результат совпадает с прямым расчётом', () => {
    const m = flatMap();
    m.setTerrain(hex(0, 3), TerrainType.HeavyWoods);
    invalidateLos(m);
    expect(los(m, hex(0, 0), hex(0, 6))).toEqual(computeLos(m, hex(0, 0), hex(0, 6)));
  });
});
