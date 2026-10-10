import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  execute,
  makeCompany,
  makeRecord,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { zoneFromId, type ZoneId } from '../src/core/model/index.js';
import { generateAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { bayStands } from '../src/ui/state/bays.js';

/**
 * Полоса стапелей обязана считать так же, как ядро: стапель занимает МАШИНА.
 *
 * Плейтест 2026-09-16: «Починить всё звено» ставит по ремонту на каждую
 * повреждённую зону, и полоса, раскладывавшая по ячейкам работы, показывала
 * один Javelin сразу на трёх стапелях со счётчиком «3 / 3 (макс. 4)» — цех
 * выглядел забитым, хотя занята была одна машина из четырёх возможных.
 */

const CODE = 'IS-H40-R1F3';

function freshRecord(id: string, seed = 1): MechRecord {
  const assembly = generateAssembly({ chassisCode: CODE, role: 'brawler' }, new Rng(seed));
  return makeRecord({ id, assembly, name: id });
}

/** Зона повреждена, но не разрушена — есть что чинить `repairZone`. */
function damaged(record: MechRecord, ...zones: ZoneId[]): MechRecord {
  let out = record;
  for (const zone of zones) {
    const idx = zoneFromId(zone);
    out = {
      ...out,
      condition: {
        ...out.condition,
        zones: out.condition.zones.map((z, i) => (i === idx ? { ...z, armor: 0 } : z)),
      },
    };
  }
  return out;
}

function stateWith(mechs: readonly MechRecord[], bays: number): CampaignState {
  const state = new CampaignState(1);
  state.company = { ...makeCompany(), mechs: [...mechs], cbills: 5_000_000, bays };
  return state;
}

describe('полоса стапелей', () => {
  it('несколько работ по одной машине занимают ОДИН стапель', () => {
    const state = stateWith([damaged(freshRecord('M-1'), 'leftArm', 'rightArm', 'leftLeg')], 4);
    for (const zone of ['leftArm', 'rightArm', 'leftLeg'] as const) {
      expect(execute(state, { kind: 'repairZone', recordId: 'M-1', zone }).ok).toBe(true);
    }

    const stands = bayStands(state);
    expect(stands.length).toBe(4);
    expect(stands.filter((b) => b !== null).length).toBe(1);
    expect(stands[0]?.recordId).toBe('M-1');
    expect(stands[0]?.jobs.length).toBe(3);
    // Срок ячейки — когда машина уйдёт из цеха, то есть максимум по работам.
    expect(stands[0]?.daysLeft).toBe(Math.max(...stands[0]!.jobs.map((j) => j.daysLeft)));
    // Отмена остаётся у каждой работы своя.
    expect(new Set(stands[0]!.jobs.map((j) => j.jobId)).size).toBe(3);
  });

  it('разные машины занимают разные стапели, свободные ячейки остаются пустыми', () => {
    const state = stateWith(
      [damaged(freshRecord('M-1'), 'leftArm'), damaged(freshRecord('M-2', 2), 'leftArm')],
      4,
    );
    expect(execute(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' }).ok).toBe(true);
    expect(execute(state, { kind: 'repairZone', recordId: 'M-2', zone: 'leftArm' }).ok).toBe(true);

    const stands = bayStands(state);
    expect(stands.filter((b) => b !== null).map((b) => b?.recordId)).toEqual(['M-1', 'M-2']);
    expect(stands[2]).toBeNull();
    expect(stands[3]).toBeNull();
  });

  it('машина сверх числа стапелей с полосы не пропадает', () => {
    const state = stateWith([damaged(freshRecord('M-1'), 'leftArm'), damaged(freshRecord('M-2', 2), 'leftArm')], 2);
    expect(execute(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' }).ok).toBe(true);
    expect(execute(state, { kind: 'repairZone', recordId: 'M-2', zone: 'leftArm' }).ok).toBe(true);
    // Цех ужали до одного стапеля уже с двумя машинами в работе — обе видны.
    state.company = { ...state.company, bays: 1 };

    const stands = bayStands(state);
    expect(stands.length).toBe(2);
    expect(stands.filter((b) => b !== null).length).toBe(2);
  });
});
