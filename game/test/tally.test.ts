import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '../src/core/commands/types.js';
import { PILOTS } from '../src/core/data/tables.js';
import { BattleTally } from '../src/sim/tally.js';

/**
 * Опыт за ракетную пачку (шаг 66c): попадание и «держался под риском»
 * считаются по ПЕРВОЙ ракете — её судьба и есть прежний один бросок на залп.
 * Остальные ракеты несут только урон, и добивание засчитывается по любому
 * долетевшему урону.
 */

function shot(overrides: Partial<Extract<BattleEvent, { kind: 'shot' }>>): BattleEvent {
  return {
    kind: 'shot',
    unitId: 'альфа',
    targetId: 'браво',
    weapon: 'is_lrm20',
    toHitTarget: 8,
    factors: [],
    toHitBase: 4,
    toHitSituationalCut: 0,
    toHitOverflow: 0,
    range: 9,
    roll: 9,
    intentHit: true,
    poiseSaved: false,
    botched: false,
    botchChance: 0,
    botchReasons: [],
    composure: 0,
    hit: true,
    ...overrides,
  };
}

const destroyed: BattleEvent = { kind: 'unitDestroyed', unitId: 'браво', reason: 'torso' };

function tallyOf(events: readonly BattleEvent[]) {
  const t = new BattleTally();
  t.collect(events);
  return t.map.get('альфа');
}

describe('опыт за ракетную пачку — по первой ракете (шаг 66c)', () => {
  it('первая ракета промахнулась, остальные долетели: урон и добивание есть, опыта попадания нет', () => {
    const e = shot({ intentHit: false, hit: true, clusterLanded: 12, clusterTotal: 20 });
    const t = tallyOf([e, destroyed]);
    expect(t?.hits).toBe(0);
    expect(t?.kills).toBe(1);
  });

  it('первая ракета долетела: одно попадание на залп, сколько бы ракет ни долетело', () => {
    const t = tallyOf([shot({ clusterLanded: 17, clusterTotal: 20 })]);
    expect(t?.hits).toBe(1);
  });

  it('первая ракета сорвалась: попадания нет, «держался» тоже нет', () => {
    const chance = PILOTS.progression.pressureFrom + 0.1;
    const t = tallyOf([shot({ botched: true, botchChance: chance, clusterLanded: 9, clusterTotal: 20 })]);
    expect(t?.hits ?? 0).toBe(0);
    expect(t?.composureHeld ?? 0).toBe(0);
  });

  it('первая ракета удержана под риском — «держался» засчитан раз за залп', () => {
    const chance = PILOTS.progression.pressureFrom + 0.1;
    const t = tallyOf([shot({ botchChance: chance, clusterLanded: 9, clusterTotal: 20 })]);
    expect(t?.composureHeld).toBe(1);
  });

  it('некластерный ствол — как раньше: попадание по `hit`', () => {
    expect(tallyOf([shot({ weapon: 'is_ac10' })])?.hits).toBe(1);
    expect(tallyOf([shot({ weapon: 'is_ac10', hit: false, botched: true })])?.hits ?? 0).toBe(0);
  });
});
