import { describe, expect, it } from 'vitest';
import { Direction } from '../src/core/hex/index.js';
import { HitZone, type Side } from '../src/core/model/index.js';
import { generateAssembly, makePilot, type MechAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import {
  battleUnitId,
  buildOutcome,
  makeBattleFromBrief,
  makeRecord,
  recordToUnit,
  unitToRecord,
  type BattleBrief,
} from '../src/core/campaign/index.js';
import { chassis } from '../src/core/data/tables.js';
import { LANCE_VS_LANCE, makeBattle } from '../src/sim/scenario.js';

/**
 * Шаг 12, часть моста «кампания → бой → кампания».
 *
 * Главное, что здесь охраняется: `record → unit` и обратно не теряет и не выдумывает данные
 * без боя (это и есть проверка того, что наложение состояния работает индексами верно), а
 * состав и противник, случайно использующие один id записи, не путаются в одном бою.
 */

const CODE = 'IS-H55-R3F2';

function assembly(role: 'brawler' | 'sniper' = 'brawler'): MechAssembly {
  return generateAssembly({ chassisCode: CODE, role }, new Rng(4242));
}

function freshUnit(id: string, side: Side) {
  const record = makeRecord({ id, assembly: assembly() });
  const pilot = makePilot(new Rng(1), { id: `${id}-пилот`, callsign: id, tier: 4 });
  const unit = recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, side);
  return { record, pilot, unit };
}

describe('recordToUnit / unitToRecord', () => {
  it('без боя круговой прогон не теряет и не выдумывает ни одного очка брони', () => {
    const record = makeRecord({ id: 'M-1', assembly: assembly() });
    const pilot = makePilot(new Rng(1), { id: 'P-1', callsign: 'X', tier: 4 });
    const unit = recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, 'player');
    expect(unitToRecord(unit, record).condition).toEqual(record.condition);
  });

  it('повреждённая запись переживает круг record → unit → record без потерь', () => {
    const base = makeRecord({ id: 'M-1', assembly: assembly() });
    const damaged = {
      ...base,
      condition: {
        zones: base.condition.zones.map((z, i) =>
          i === HitZone.LeftArm ? { ...z, destroyed: true, armor: 0, structure: 0 } : z,
        ),
        destroyedSlots: base.condition.destroyedSlots.map((arr, i) => (i === HitZone.Torso ? [0] : arr)),
        ammo: base.condition.ammo.map((a) => (a === null ? null : Math.max(0, a - 1))),
        destroyedMounts: base.condition.destroyedMounts.map((d, i) => (i === 0 ? true : d)),
      },
    };
    const pilot = makePilot(new Rng(1), { id: 'P-1', callsign: 'X', tier: 4 });
    const unit = recordToUnit(damaged, pilot, { q: 0, r: 0 }, Direction.NE, 'player');
    expect(unitToRecord(unit, damaged).condition).toEqual(damaged.condition);
  });

  it('бросает, если в записи разрушен торс или голова — это обломки, не машина для боя', () => {
    const base = makeRecord({ id: 'M-1', assembly: assembly() });
    const wrecked = {
      ...base,
      condition: {
        ...base.condition,
        zones: base.condition.zones.map((z, i) => (i === HitZone.Torso ? { ...z, destroyed: true } : z)),
      },
    };
    const pilot = makePilot(new Rng(1), { id: 'P-1', callsign: 'X', tier: 4 });
    expect(() => recordToUnit(wrecked, pilot, { q: 0, r: 0 }, Direction.NE, 'player')).toThrow();
  });

  it('отвязывает пилота от записи только при статусе lost', () => {
    const record = makeRecord({ id: 'M', assembly: assembly(), pilotId: 'P-1' });
    const pilot = makePilot(new Rng(1), { id: 'P-1', callsign: 'x', tier: 4 });
    const unit = recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, 'player');

    const stillThere = unitToRecord({ ...unit, pilot: { ...pilot, status: 'ejected' } }, record);
    expect(stillThere.pilotId).toBe('P-1');

    const cleared = unitToRecord({ ...unit, pilot: { ...pilot, status: 'lost' } }, record);
    expect(cleared.pilotId).toBeNull();
  });

  it('две записи одного шасси получают разные id в динамическом каталоге', () => {
    const a = freshUnit('A', 'player');
    const recordB = makeRecord({ id: 'B', assembly: assembly('sniper') });
    const pilotB = makePilot(new Rng(1), { id: 'B-пилот', callsign: 'B', tier: 4 });
    const unitB = recordToUnit(recordB, pilotB, { q: 1, r: 0 }, Direction.NE, 'player');
    expect(a.unit.chassis).not.toBe(unitB.chassis);
    expect(a.unit.mounts.map((m) => m.weapon)).not.toEqual(unitB.mounts.map((m) => m.weapon));
  });
});

describe('battleUnitId', () => {
  it('id записи не может содержать двоеточие', () => {
    expect(() => battleUnitId('player', 'a:b')).toThrow();
  });
});

describe('makeBattleFromBrief', () => {
  it('состав и противник могут случайно использовать один id записи — бой не путает их', () => {
    const rng = new Rng(1);
    const companyRecord = makeRecord({ id: 'M-1', assembly: generateAssembly({ chassisCode: CODE }, rng) });
    const enemyRecord = makeRecord({ id: 'M-1', assembly: generateAssembly({ chassisCode: CODE }, rng) });
    const pilotRng = new Rng(2);
    const brief: BattleBrief = {
      mapSeed: 5,
      battleSeed: 5,
      company: [{ record: companyRecord, pilot: makePilot(pilotRng, { id: 'P1', callsign: 'A', tier: 4 }) }],
      enemy: [{ record: enemyRecord, pilot: makePilot(pilotRng, { id: 'P2', callsign: 'B', tier: 4 }) }],
    };

    const state = makeBattleFromBrief(brief);
    expect(state.units.map((u) => u.id).sort()).toEqual(['opfor:M-1', 'player:M-1']);

    // И в динамическом каталоге тоже: `def.id` выводится из кода шасси и класса, навеску он не
    // видит, поэтому ключ обязан нести сторону. Иначе вторая машина затрёт первую, и обе будут
    // рассеивать тепло по чужому теплоотводу — `heatSinks` читается из каталога ПО ХОДУ боя.
    const ids = state.units.map((u) => u.chassis);
    expect(new Set(ids).size).toBe(2);
    for (const u of state.units) {
      expect(chassis(u.chassis).mounts.map((m) => m.weapon)).toEqual(u.mounts.map((m) => m.weapon));
    }

    const outcome = buildOutcome(state);
    expect(outcome.winner).toBe('draw');
    expect(outcome.units.map((u) => `${u.side}:${u.recordId}`).sort()).toEqual(['opfor:M-1', 'player:M-1']);
  });
});

describe('buildOutcome без префикса стороны', () => {
  it('не роняет бой, собранный не мостом (sim/scenario.ts)', () => {
    const state = makeBattle({ seed: 1, units: LANCE_VS_LANCE });
    const outcome = buildOutcome(state);
    expect(outcome.units.map((u) => u.recordId)).toEqual(state.units.map((u) => u.id));
    expect(outcome.units.map((u) => u.side)).toEqual(state.units.map((u) => u.side));
  });
});
