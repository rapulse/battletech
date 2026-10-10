import { describe, expect, it } from 'vitest';
import { HitZone, makeUnit, type MechSlot, type MechUnit } from '../src/core/model/index.js';
import {
  criticalChanceFor,
  resolveCriticalSlot,
  rollCriticalHit,
  triggerAmmoExplosion,
} from '../src/core/rules/critical.js';
import { Rng } from '../src/core/rng/index.js';
import { makePilot } from '../src/core/rules/index.js';
import { hasCase } from '../src/core/model/MechUnit.js';
import { chassis, registerDynamicChassis } from '../src/core/data/index.js';

/** Поставить систему защиты в свободную ячейку зоны. */
function withCaseSlot(unit: MechUnit, zone: HitZone, id: 'is_case' | 'case2'): MechUnit {
  const zoneSlots = unit.slots[zone]!.slice();
  const free = zoneSlots.findIndex((s) => s.kind === 'empty');
  expect(free).toBeGreaterThanOrEqual(0);
  zoneSlots[free] = { kind: 'equipment', id, destroyed: false };
  const slots = unit.slots.slice();
  slots[zone] = zoneSlots;
  return { ...unit, slots };
}

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
    hex: { q: 0, r: 0 },
    facing: 0,
  });
}

describe('Механика критических попаданий (Часть B)', () => {
  describe('Шансы по категориям оружия', () => {
    it('баллистика и ракеты имеют шанс крита 30 %, энергия — 15 %', () => {
      expect(criticalChanceFor('ballistic')).toBe(0.3);
      expect(criticalChanceFor('missile')).toBe(0.3);
      expect(criticalChanceFor('energy')).toBe(0.15);
    });

    it('крит не бросается, если броня выдержала', () => {
      const unit = testUnit();
      const rng = new Rng(1);
      const skillRng = new Rng(2);
      const check = rollCriticalHit(rng, skillRng, unit, HitZone.Torso, 'is_ac10', true);
      expect(check.rolled).toBe(false);
      expect(check.result).toBeNull();
    });
  });

  describe('Попадание по компонентам', () => {
    it('уничтожение оружия выводит установку из строя, но сохраняет зону', () => {
      const unit = testUnit('IS-H75-R3F3'); // PPC в правой руке
      const skillRng = new Rng(100);

      // Ищем ячейку с оружием в правой руке
      const rightArmSlots = unit.slots[HitZone.RightArm]!;
      const weaponSlotIdx = rightArmSlots.findIndex((s: MechSlot) => s.kind === 'weapon');
      expect(weaponSlotIdx).toBeGreaterThanOrEqual(0);

      // Принудительно резолвим крит в эту ячейку
      const forcedRng = {
        next: () => (weaponSlotIdx + 0.01) / rightArmSlots.length,
        stream: () => forcedRng,
      } as unknown as Rng;

      const res = resolveCriticalSlot(forcedRng, skillRng, unit, HitZone.RightArm);
      expect(res.effect).toBe('weaponDestroyed');
      expect(res.weaponLost).toBe('is_ppc');
      expect(res.unit.mounts.find((m) => m.weapon === 'is_ppc')?.destroyed).toBe(true);
      expect(res.unit.zones[HitZone.RightArm]?.destroyed).toBe(false);
    });

    it('попадания по реактору: 1-й/2-й дают нагрев, 3-й уничтожает машину с катапультированием', () => {
      let unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(777);

      const torsoSlots = unit.slots[HitZone.Torso]!;
      const reactorIndices = torsoSlots
        .map((s: MechSlot, idx: number) => (s.kind === 'reactor' ? idx : -1))
        .filter((i: number) => i >= 0);
      expect(reactorIndices.length).toBe(3);

      // 1-й крит реактора
      const rng1 = { next: () => (reactorIndices[0]! + 0.01) / torsoSlots.length } as unknown as Rng;
      const res1 = resolveCriticalSlot(rng1, skillRng, unit, HitZone.Torso);
      expect(res1.effect).toBe('reactorHit');
      expect(res1.unit.reactorHits).toBe(1);
      expect(res1.unit.destroyed).toBe(false);

      // 2-й крит реактора
      unit = res1.unit;
      const rng2 = { next: () => (reactorIndices[1]! + 0.01) / torsoSlots.length } as unknown as Rng;
      const res2 = resolveCriticalSlot(rng2, skillRng, unit, HitZone.Torso);
      expect(res2.effect).toBe('reactorHit');
      expect(res2.unit.reactorHits).toBe(2);
      expect(res2.unit.destroyed).toBe(false);

      // 3-й крит реактора
      unit = res2.unit;
      const rng3 = { next: () => (reactorIndices[2]! + 0.01) / torsoSlots.length } as unknown as Rng;
      const res3 = resolveCriticalSlot(rng3, skillRng, unit, HitZone.Torso);
      expect(res3.effect).toBe('reactorDestroyed');
      expect(res3.unit.reactorHits).toBe(3);
      expect(res3.unit.destroyed).toBe(true);
      expect(res3.ejection).toBeDefined();
      expect(res3.ejection?.odds.trigger).toBe('torso');
    });

    it('попадания по гироскопу: 1-й даёт штраф, 2-й выводит машину из боя навсегда (шаг 6, часть E)', () => {
      let unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(777);
      const torsoSlots = unit.slots[HitZone.Torso]!;
      const gyroIndices = torsoSlots
        .map((s: MechSlot, idx: number) => (s.kind === 'gyro' ? idx : -1))
        .filter((i: number) => i >= 0);

      // 1-й крит гироскопа
      const rng1 = { next: () => (gyroIndices[0]! + 0.01) / torsoSlots.length } as unknown as Rng;
      const res1 = resolveCriticalSlot(rng1, skillRng, unit, HitZone.Torso);
      expect(res1.effect).toBe('gyroHit');
      expect(res1.unit.gyroHits).toBe(1);
      expect(res1.unit.destroyed).toBe(false);

      // 2-й крит гироскопа — тот же исход, что и оторванная нога: машина
      // уничтожена/выведена из боя, не просто «лежит, но ещё воюет».
      unit = res1.unit;
      const rng2 = { next: () => (gyroIndices[1]! + 0.01) / torsoSlots.length } as unknown as Rng;
      const res2 = resolveCriticalSlot(rng2, skillRng, unit, HitZone.Torso);
      expect(res2.effect).toBe('gyroDestroyed');
      expect(res2.unit.gyroHits).toBe(2);
      expect(res2.unit.prone).toBe(true);
      expect(res2.unit.destroyed).toBe(true);
    });

    it('крит кокпита в голове вызывает катапультирование по поводу head', () => {
      const unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(777);
      const headSlots = unit.slots[HitZone.Head]!;
      const cockpitIdx = headSlots.findIndex((s: MechSlot) => s.kind === 'cockpit');

      const rng = { next: () => (cockpitIdx + 0.01) / headSlots.length } as unknown as Rng;
      const res = resolveCriticalSlot(rng, skillRng, unit, HitZone.Head);
      expect(res.effect).toBe('cockpitDestroyed');
      expect(res.unit.destroyed).toBe(true);
      expect(res.ejection).toBeDefined();
      expect(res.ejection?.odds.trigger).toBe('head');
    });
  });

  describe('Детонация боезапаса и система CASE', () => {
    it('детонация БК без CASE отрывает руку и переносит избыточный урон в торс', () => {
      const unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(123);

      const ammoSlot: MechSlot = {
        kind: 'ammo',
        id: 'ammo_srm2',
        explosionDamage: 100,
        destroyed: false,
      };

      const res = triggerAmmoExplosion(skillRng, unit, HitZone.RightArm, 0, ammoSlot);
      expect(res.effect).toBe('ammoExplosion');
      expect(res.unit.zones[HitZone.RightArm]?.destroyed).toBe(true);
      // Торс получает избыточный урон и также разрушается (без CASE)
      expect(res.unit.zones[HitZone.Torso]?.destroyed).toBe(true);
      expect(res.unit.destroyed).toBe(true);
    });

    it('при уничтожении меха от взрыва пилот катапультируется без двойного штрафа', () => {
      const unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(123);

      // Взрыв пулемётной пачки в торсе (400 урона) гарантированно уничтожает мех
      const mgAmmoSlot: MechSlot = {
        kind: 'ammo',
        id: 'ammo_mg',
        explosionDamage: 400,
        destroyed: false,
      };

      const res = triggerAmmoExplosion(skillRng, unit, HitZone.Torso, 0, mgAmmoSlot);
      expect(res.unit.destroyed).toBe(true);
      expect(res.ejection).toBeDefined();
      expect(res.ejection?.odds.trigger).toBe('torso');
      // Ранение по причине ammoExplosion не должно выставляться, так как мех погиб и сработало катапультирование
      expect(res.injury).toBeUndefined();
    });

    it('CASE не пускает избыток детонации в торс: зону уносит, машина цела', () => {
      // Без CASE тот же взрыв уносит и руку, и торс — проверено тестом выше.
      const base = testUnit('IS-H35-R3F1');
      registerDynamicChassis({ ...chassis('IS-H35-R3F1'), id: 'TEST-IS-CASE' });
      const withCase = withCaseSlot(testUnit('IS-H35-R3F1'), HitZone.RightArm, 'is_case');

      const ammo: MechSlot = {
        kind: 'ammo',
        id: 'ammo_srm2',
        explosionDamage: 100,
        destroyed: false,
      };

      const res = triggerAmmoExplosion(new Rng(123), withCase, HitZone.RightArm, 0, ammo);
      expect(res.unit.zones[HitZone.RightArm]?.destroyed).toBe(true);
      expect(res.unit.zones[HitZone.Torso]?.destroyed).toBe(false);
      expect(res.unit.destroyed).toBe(false);
      expect(base.zones[HitZone.Torso]?.destroyed).toBe(false);
    });

    it('кланский CASE встроен: отдельной ячейки не нужно', () => {
      const clanDef = { ...chassis('IS-H35-R3F1'), id: 'TEST-CLAN', techBase: 'clan' as const };
      registerDynamicChassis(clanDef);
      const unit = testUnit('TEST-CLAN');
      expect(hasCase(unit, HitZone.RightArm)).toBe(true);

      const ammo: MechSlot = {
        kind: 'ammo',
        id: 'ammo_srm2',
        explosionDamage: 100,
        destroyed: false,
      };
      const res = triggerAmmoExplosion(new Rng(123), unit, HitZone.RightArm, 0, ammo);
      expect(res.unit.zones[HitZone.Torso]?.destroyed).toBe(false);
    });

    it('CASE II гасит взрыв внутри зоны: зона уцелела, урон единица', () => {
      const unit = withCaseSlot(testUnit('IS-H35-R3F1'), HitZone.RightArm, 'case2');
      const ammo: MechSlot = {
        kind: 'ammo',
        id: 'ammo_srm2',
        explosionDamage: 100,
        destroyed: false,
      };
      const res = triggerAmmoExplosion(new Rng(123), unit, HitZone.RightArm, 0, ammo);
      expect(res.damageDealt).toBe(1);
      expect(res.contained).toBe(true);
      expect(res.unit.zones[HitZone.RightArm]?.destroyed).toBe(false);
      expect(res.unit.destroyed).toBe(false);
    });

    it('снаряды Гаусса (0 урона) не детонируют', () => {
      const unit = testUnit('IS-H35-R3F1');
      const skillRng = new Rng(123);

      const gaussAmmoSlot: MechSlot = {
        kind: 'ammo',
        id: 'ammo_gauss',
        explosionDamage: 0,
        destroyed: false,
      };

      const res = triggerAmmoExplosion(skillRng, unit, HitZone.RightArm, 0, gaussAmmoSlot);
      expect(res.damageDealt).toBe(0);
      expect(res.unit.destroyed).toBe(false);
      expect(res.unit.zones[HitZone.RightArm]?.destroyed).toBe(false);
    });
  });
});
