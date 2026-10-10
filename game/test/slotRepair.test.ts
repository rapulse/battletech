import { describe, expect, it } from 'vitest';
import { HitZone, buildUnitSlots, makeUnit, type MechUnit } from '../src/core/model/index.js';
import { resolveCriticalSlot } from '../src/core/rules/critical.js';
import { Rng } from '../src/core/rng/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { REPAIR } from '../src/core/data/index.js';
import { brokenSlots, makeRecord, recordChassisDef, type MechRecord } from '../src/core/campaign/mech/MechRecord.js';
import { repairPlan } from '../src/core/campaign/mech/repair.js';
import { isRefittable, stripBlockAt } from '../src/core/campaign/company/refit.js';

/**
 * Крит в пустую ячейку и цена ремонта ячейки (плейтест 2026-09-15).
 *
 * Крит выбирал любую ячейку зоны и помечал её выбитой ДО того, как смотрел, что
 * в ней стоит. Метка пустой ячейки уезжала в запись машины: ремонт брал за неё
 * 25 000, а мехлаб запрещал из-за неё снимать целое железо из той же зоны.
 */

/** Rng, который отдаёт заранее заданное число: крит попадает в нужную ячейку. */
function fixedRng(value: number): Rng {
  return { next: () => value } as unknown as Rng;
}

function unitOf(chassis: string): MechUnit {
  const p = makePilot(new Rng(42), { id: 'p', tier: 5 });
  return makeUnit({ id: 'u', side: 'player', chassis, pilot: { ...p, firstBattle: false }, hex: { q: 0, r: 0 }, facing: 0 });
}

function recordWithMarks(zone: number, marks: readonly number[]): MechRecord {
  const record = makeRecord({ id: 'M-1', assembly: generateAssembly({ chassisCode: 'IS-H55-R3F2' }, new Rng(7)) });
  return {
    ...record,
    condition: {
      ...record.condition,
      destroyedSlots: record.condition.destroyedSlots.map((s, i) => (i === zone ? [...marks] : s)),
    },
  };
}

function layoutOf(record: MechRecord, zone: number) {
  return buildUnitSlots(recordChassisDef(record)).slots[zone] ?? [];
}

describe('крит в пустую ячейку', () => {
  it('ничего не помечает выбитым — проходит насквозь', () => {
    const unit = unitOf('IS-H55-R3F2');
    const zoneSlots = unit.slots[HitZone.Torso]!;
    const empty = zoneSlots.findIndex((s) => s.kind === 'empty');
    expect(empty).toBeGreaterThanOrEqual(0);

    const res = resolveCriticalSlot(fixedRng((empty + 0.5) / zoneSlots.length), new Rng(1), unit, HitZone.Torso);
    expect(res.effect).toBe('empty');
    expect(res.unit.slots[HitZone.Torso]![empty]!.destroyed).toBe(false);
    expect(res.unit).toBe(unit);
  });
});

describe('ремонт ячеек считает только то, что было сломано', () => {
  const torso = HitZone.Torso as number;

  it('старая метка пустой ячейки не стоит денег и не мешает мехлабу', () => {
    const probe = recordWithMarks(torso, []);
    const empty = layoutOf(probe, torso).findIndex((s) => s.kind === 'empty');
    expect(empty).toBeGreaterThanOrEqual(0);

    const record = recordWithMarks(torso, [empty]);
    expect(brokenSlots(record, torso)).toEqual([]);
    expect(repairPlan(record).jobs.some((j) => j.kind === 'slot')).toBe(false);
    expect(isRefittable(record)).toBe(true);
    expect(stripBlockAt(record, 'torso')).toBeNull();
  });

  it('непустая выбитая ячейка стоит `REPAIR.cost.slot` — 10 000', () => {
    expect(REPAIR.cost.slot).toBe(10_000);
    const probe = recordWithMarks(torso, []);
    const layout = layoutOf(probe, torso);
    const empty = layout.findIndex((s) => s.kind === 'empty');
    const real = layout.findIndex((s) => s.kind !== 'empty' && s.kind !== 'fixed');
    expect(real).toBeGreaterThanOrEqual(0);

    const record = recordWithMarks(torso, [real, empty]);
    expect(brokenSlots(record, torso)).toEqual([real]);
    const slotJob = repairPlan(record).jobs.find((j) => j.kind === 'slot');
    expect(slotJob?.cost).toBe(10_000);
    expect(isRefittable(record)).toBe(false);
    expect(stripBlockAt(record, 'torso')).toBe('slotsDestroyed');
  });
});
