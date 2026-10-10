import { describe, expect, it } from 'vitest';
import { heatLimitsFor } from '../src/core/rules/heat.js';
import {
  CHASSIS_LIST,
  chassisFileSchema,
  COMBAT,
  PILOTS,
  pilotsFileSchema,
  TERRAIN,
  weaponsFileSchema,
  WEAPON_LIST,
  WEAPONS,
  ZONE_TABLES,
} from '../src/core/data/index.js';
import { TERRAIN_IDS } from '../src/core/map/index.js';
import { ZONE_COUNT } from '../src/core/model/index.js';

describe('загрузка игровых таблиц', () => {
  it('рельеф загружен в порядке перечисления', () => {
    expect(TERRAIN).toHaveLength(TERRAIN_IDS.length);
    TERRAIN.forEach((row, i) => {
      expect(row.id).toBe(i);
      expect(row.key).toBe(`terrain.${TERRAIN_IDS[i]}`);
    });
  });

  it('оружие и шасси загружены без повторов', () => {
    expect(WEAPONS.size).toBe(WEAPON_LIST.length);
    expect(new Set(CHASSIS_LIST.map((c) => c.id)).size).toBe(CHASSIS_LIST.length);
  });

  it('каждая установка шасси ссылается на существующее оружие', () => {
    for (const c of CHASSIS_LIST) {
      for (const m of c.mounts) expect(WEAPONS.has(m.weapon)).toBe(true);
    }
  });

  it('таблицы зон вычёркивают невидимое, но не перевешивают оставшееся', () => {
    // Ровная таблица — все шесть зон, Above и Below — четыре оставшиеся. Ни одна
    // зона не повторяется в своей таблице: повтор был бы удвоенной долей, а
    // доли менять нельзя (решение пользователя 2026-09-17).
    expect(ZONE_TABLES.level).toHaveLength(6);
    expect(ZONE_TABLES.above).toHaveLength(4);
    expect(ZONE_TABLES.below).toHaveLength(4);
    for (const table of [ZONE_TABLES.above, ZONE_TABLES.level, ZONE_TABLES.below]) {
      expect(new Set(table).size).toBe(table.length);
      for (const z of table) expect(z).toBeGreaterThanOrEqual(0);
    }
    expect(ZONE_COUNT).toBe(6);
  });

  it('таблицы навыков заданы на все десять уровней', () => {
    for (const [name, table] of Object.entries(PILOTS.tables)) {
      expect(table, name).toHaveLength(10);
    }
  });

  it('опыт и происхождения ссылаются только на существующие навыки', () => {
    const known = new Set(PILOTS.skills.map((s) => s.id));
    for (const row of Object.values(PILOTS.progression.xp)) {
      for (const skill of row.skills) expect(known.has(skill)).toBe(true);
    }
    for (const o of PILOTS.origins) {
      for (const s of [...o.strong, ...o.weak]) expect(known.has(s)).toBe(true);
    }
  });
});

describe('схемы отвергают битые данные', () => {
  it('оружие с убывающими дальностями не проходит', () => {
    const broken = { weapons: [{ ...WEAPON_LIST[0], short: 10, medium: 5, long: 3 }] };
    expect(() => weaponsFileSchema.parse(broken)).toThrow();
  });

  it('лишний ключ не проходит — опечатка не должна теряться молча', () => {
    const broken = { weapons: [{ ...WEAPON_LIST[0], damge: 5 }] };
    expect(() => weaponsFileSchema.parse(broken)).toThrow();
  });

  it('шасси без зоны не проходит', () => {
    const first = CHASSIS_LIST[0]!;
    const zones = { ...first.zones } as Record<string, unknown>;
    delete zones['head'];
    expect(() => chassisFileSchema.parse({ chassis: [{ ...first, zones }] })).toThrow();
  });

  it('таблица навыка не на десять уровней не проходит', () => {
    const broken = {
      ...PILOTS,
      tables: { ...PILOTS.tables, gunneryBase: [1, 2, 3] },
    };
    expect(() => pilotsFileSchema.parse(broken)).toThrow();
  });

  it('вероятность больше единицы не проходит', () => {
    const broken = {
      ...PILOTS,
      injury: { ...PILOTS.injury, causes: { ...PILOTS.injury.causes, fall: 1.5 } },
    };
    expect(() => pilotsFileSchema.parse(broken)).toThrow();
  });
});

describe('связность боевых констант', () => {
  it('пороги тепла упорядочены на любом отводе', () => {
    // Метки считаются от отвода машины, поэтому порядок проверяется на всём
    // разбросе парка: от голого реактора Сферы до кланового штурмовика.
    for (const dissipation of [1, 10, 20, 35, 60]) for (const reserve of [0, 5, 20]) {
      const l = heatLimitsFor(dissipation, reserve);
      expect(l.limit).toBe(dissipation + reserve);
      expect(l.shutdownAt).toBeGreaterThan(l.limit);
      expect(l.shutdownAt).toBeLessThan(l.ammoRiskAt);
      expect(l.ammoRiskAt).toBeLessThan(l.pilotRiskAt);
      expect(l.pilotRiskAt).toBeLessThanOrEqual(l.max);
    }
  });

  it('запас корпуса не убывает с весовым классом', () => {
    const r = COMBAT.heat.hullReserve;
    expect(r.light).toBeLessThanOrEqual(r.medium);
    expect(r.medium).toBeLessThanOrEqual(r.heavy);
    expect(r.heavy).toBeLessThanOrEqual(r.assault);
  });

  it('дальние дистанции штрафуют сильнее ближних', () => {
    expect(COMBAT.toHit.rangeShort).toBeLessThan(COMBAT.toHit.rangeMedium);
    expect(COMBAT.toHit.rangeMedium).toBeLessThan(COMBAT.toHit.rangeLong);
  });

  it('подтверждение кокпита включено и опускает его долю ниже 1/6', () => {
    // Если поставить confirmOn: 6, вероятности ранений в pilots.json обязаны быть
    // пересчитаны — они подобраны под долю ~1/18. Тест охраняет эту связь.
    expect(COMBAT.hitLocation.headConfirm.confirmOn).toBeLessThan(6);
    expect(COMBAT.hitLocation.headConfirm.confirmOn).toBeGreaterThan(0);
  });

  it('запас кокпита заметно тоньше торса, но не катастрофично (шаг 9e)', () => {
    for (const c of CHASSIS_LIST) {
      const head = c.zones.head.armor + c.zones.head.structure;
      const torso = c.zones.torso.armor + c.zones.torso.structure;
      // Было head > torso*0.6..1.2 (запас кокпита ≈ запасу торса) — при этом
      // голова разрушалась в 60-85 раз реже торса и ног (замер на 3000 боёв,
      // wiki/decisions.md 2026-08-28): редкость избыточная. Диапазон сознательно
      // сужен и опущен, но не убран: кокпит обязан оставаться толще рук
      // (см. «руки отказывают раньше торса» ниже и construction.test.ts).
      expect(head, c.id).toBeGreaterThan(torso * 0.45);
      expect(head, c.id).toBeLessThan(torso * 0.7);
    }
  });

  it('руки отказывают раньше торса — бой начинается с потери оружия', () => {
    for (const c of CHASSIS_LIST) {
      const arm = c.zones.leftArm.armor + c.zones.leftArm.structure;
      const torso = c.zones.torso.armor + c.zones.torso.structure;
      expect(arm, c.id).toBeLessThan(torso);
    }
  });
});
