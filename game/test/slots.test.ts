import { describe, expect, it } from 'vitest';
import { hex, Direction } from '../src/core/hex/index.js';
import {
  HitZone,
  INTEGRAL_HEAT_SINKS,
  makeUnit,
  unitDissipation,
  zoneFromId,
  type MechUnit,
} from '../src/core/model/index.js';
import { assemblyToChassisDef, generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { CHASSIS_CATALOG_LIST, CONSTRUCTION, registerDynamicChassis } from '../src/core/data/index.js';

function pilot(id: string) {
  const p = makePilot(new Rng(42), { id, tier: 5 });
  return { ...p, firstBattle: false };
}

function testUnit(chassis = 'IS-H55-R3F2'): MechUnit {
  return makeUnit({
    id: 'test-mech',
    side: 'player',
    chassis,
    pilot: pilot('test-pilot'),
    hex: hex(0, 0),
    facing: Direction.NW,
  });
}

describe('Раскладка слотов оборудования в боевой модели (Часть A)', () => {
  it('вместимость каждой зоны совпадает с baseSlots из construction.json', () => {
    const unit = testUnit('IS-H55-R3F2');
    const { baseSlots } = CONSTRUCTION.zones;

    expect(unit.slots[HitZone.Head]?.length).toBe(baseSlots.head);
    expect(unit.slots[HitZone.Torso]?.length).toBe(baseSlots.torso);
    expect(unit.slots[HitZone.LeftArm]?.length).toBe(baseSlots.leftArm);
    expect(unit.slots[HitZone.RightArm]?.length).toBe(baseSlots.rightArm);
    expect(unit.slots[HitZone.LeftLeg]?.length).toBe(baseSlots.leftLeg);
    expect(unit.slots[HitZone.RightLeg]?.length).toBe(baseSlots.rightLeg);
  });

  it('несъёмное оборудование размещено в соответствующих зонах', () => {
    const unit = testUnit('IS-H35-R3F1');

    // Голова: кокпит (1) + сенсоры (2)
    const headSlots = unit.slots[HitZone.Head]!;
    expect(headSlots[0]?.kind).toBe('cockpit');
    expect(headSlots[1]?.kind).toBe('sensor');
    expect(headSlots[2]?.kind).toBe('sensor');

    // Торс: реактор (3) + гироскоп (2) + системы жизнеобеспечения (1)
    const torsoSlots = unit.slots[HitZone.Torso]!;
    expect(torsoSlots[0]?.kind).toBe('reactor');
    expect(torsoSlots[1]?.kind).toBe('reactor');
    expect(torsoSlots[2]?.kind).toBe('reactor');
    expect(torsoSlots[3]?.kind).toBe('gyro');
    expect(torsoSlots[4]?.kind).toBe('gyro');
    expect(torsoSlots[5]?.kind).toBe('fixed');

    // Руки: плечевой и локтевой приводы (2)
    const leftArmSlots = unit.slots[HitZone.LeftArm]!;
    expect(leftArmSlots[0]?.kind).toBe('arm_actuator');
    expect(leftArmSlots[1]?.kind).toBe('arm_actuator');

    // Ноги: 4 привода (hip, upper leg, lower leg, foot)
    const leftLegSlots = unit.slots[HitZone.LeftLeg]!;
    expect(leftLegSlots[0]?.kind).toBe('leg_actuator');
    expect(leftLegSlots[1]?.kind).toBe('leg_actuator');
    expect(leftLegSlots[2]?.kind).toBe('leg_actuator');
    expect(leftLegSlots[3]?.kind).toBe('leg_actuator');
  });

  it('установки MountState связаны со своими ячейками слотов', () => {
    // IS-H75-R3F3 несёт IS-PPC на правой руке (3 слота)
    const unitH75 = testUnit('IS-H75-R3F3');
    const ppcMount = unitH75.mounts.find((m) => m.weapon === 'is_ppc')!;
    expect(ppcMount).toBeDefined();
    expect(ppcMount.slotIndices.length).toBe(3);

    const rightArmSlotsH75 = unitH75.slots[HitZone.RightArm]!;
    for (const idx of ppcMount.slotIndices) {
      expect(rightArmSlotsH75[idx]?.kind).toBe('weapon');
      expect(rightArmSlotsH75[idx]?.id).toBe('is_ppc');
    }

    // IS-H55-R3F2 несёт IS-AC10 на правой руке (7 слотов: 6 в руке + 1 переполнение в торсе)
    const unitH55 = testUnit('IS-H55-R3F2');
    const ac10Mount = unitH55.mounts.find((m) => m.weapon === 'is_ac10')!;
    expect(ac10Mount).toBeDefined();
    expect(ac10Mount.slotIndices.length).toBe(6);

    const rightArmSlotsH55 = unitH55.slots[HitZone.RightArm]!;
    for (const idx of ac10Mount.slotIndices) {
      expect(rightArmSlotsH55[idx]?.kind).toBe('weapon');
      expect(rightArmSlotsH55[idx]?.id).toBe('is_ac10');
    }
  });

  it('пачки боекомплекта размещены со своим explosionDamage', () => {
    const unit = testUnit('IS-H35-R3F1');
    // IS-H35-R3F1 несёт SRM-2 с 50 выстрелами (ammo_srm2, explosionDamage: 100)
    const torsoSlots = unit.slots[HitZone.Torso]!;
    const ammoSlot = torsoSlots.find((s) => s.kind === 'ammo')!;
    expect(ammoSlot).toBeDefined();
    expect(ammoSlot.id).toBe('ammo_srm2');
    expect(ammoSlot.explosionDamage).toBe(100);
  });

  it('пустые ячейки дополняют зону до baseSlots', () => {
    const unit = testUnit('IS-H35-R3F1');
    const headSlots = unit.slots[HitZone.Head]!;
    // В голове 3 fixed + 0 mounted -> 3 empty
    const emptyHead = headSlots.filter((s) => s.kind === 'empty');
    expect(emptyHead.length).toBe(3);
    expect(headSlots.length).toBe(6);
  });
});

describe('Охладители и боезапас в раскладке (шаг 4, правки оркестратора)', () => {
  it('навесные охладители занимают ячейки, встроенные в реактор — нет', () => {
    // H55 несёт 12 радиаторов: 10 сидят в реакторе, 2 висят на корпусе.
    const unit = testUnit('IS-H55-R3F2');
    const sinks = unit.slots.flat().filter((s) => s.kind === 'heatsink');
    expect(sinks.length).toBe(12 - INTEGRAL_HEAT_SINKS);
  });

  it('целая машина отводит ровно свои очки — то же число, что показывает цех', () => {
    // Шаг 46: отвод — это очки, а не число железок, делённое пополам. У
    // каталожного шасси `heatSinks` и есть очки за ход, поэтому проверка стала
    // тождеством: сколько записано, столько и отводит.
    expect(unitDissipation(testUnit('IS-H35-R3F1'))).toBe(10);
    expect(unitDissipation(testUnit('IS-H75-R3F3'))).toBe(15);
  });

  it('выбитые охладители снижают рассеивание, но не до нуля', () => {
    const unit = testUnit('IS-H75-R3F3');
    const before = unitDissipation(unit);
    const broken: MechUnit = {
      ...unit,
      slots: unit.slots.map((zoneSlots) =>
        zoneSlots.map((s) => (s.kind === 'heatsink' ? { ...s, destroyed: true } : s)),
      ),
    };
    const after = unitDissipation(broken);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it('пачка боезапаса лежит там, где её поставила сборка, а не рядом с орудием', () => {
    // Собранное генератором шасси само решает, в какой зоне держать бомбу:
    // именно этот выбор и защищает CASE. Выводить зону из орудия здесь нельзя.
    const def = assemblyToChassisDef(
      generateAssembly({ chassisCode: CHASSIS_CATALOG_LIST[0]!.code, tonnage: 55 }, new Rng(7)),
    );
    const ammoItems = (def.equipment ?? []).filter((e) => e.id.startsWith('ammo_'));
    if (ammoItems.length === 0) return; // сборка без боезапаса — проверять нечего

    registerDynamicChassis({ ...def, id: 'TEST-AMMO-ZONE' });
    const unit = testUnit('TEST-AMMO-ZONE');

    for (const item of ammoItems) {
      const z = zoneFromId(item.zone);
      expect(unit.slots[z]?.some((s) => s.kind === 'ammo' && s.id === item.id)).toBe(true);
    }
  });
});
