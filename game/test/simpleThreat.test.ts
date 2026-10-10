import { describe, expect, it } from 'vitest';
import {
  CONTRACTS,
  GALAXY,
  availableContracts,
  buildForce,
  contractSimpleThreat,
  lanceSimpleThreat,
  makeRecord,
  mechSimpleThreat,
  mechThreat,
  opforTonsAverage,
  recordChassisDef,
  type Contract,
} from '../src/core/campaign/index.js';
import { generateAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Простая оценка сил — то, что видит игрок (решения пользователя 2026-09-23).
 *
 * Сторожит два перекоса прежней тоннажной оценки, из-за которых «оценка сил»
 * обманывала (`notes.md` §10t): клановая машина игрока шла как сферная, а
 * численность противника шла в степени 1.2 при линейной своей.
 */

function record(code: string, seed = 7) {
  return makeRecord({ id: `M-${seed}`, assembly: generateAssembly({ chassisCode: code }, new Rng(seed)) });
}

function offers(): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count && out.length < 300; i += 3) out.push(...availableContracts(1, {}, GALAXY.id(i), 0));
  return out;
}

describe('простая оценка сил', () => {
  it('клановая машина игрока — ×1.8 к той же оценке, сферная — без множителя', () => {
    const clan = record('CL-H55-R3F2');
    const sphere = record('IS-H55-R3F2');
    expect(mechSimpleThreat(clan)).toBeCloseTo(mechThreat(clan) * CONTRACTS.opfor.simple.clanFactor, 10);
    expect(mechSimpleThreat(sphere)).toBeCloseTo(mechThreat(sphere), 10);
    expect(mechSimpleThreat(clan)).toBeGreaterThan(mechSimpleThreat(sphere) * 1.5);
  });

  it('армейская клановая машина игрока стоит почти как машина клановой части противника', () => {
    // 1.8 × 1.2 = 2.16 против 2.2: разница — пилоты, их в оценке роты нет намеренно.
    const player = CONTRACTS.opfor.simple.clanFactor * CONTRACTS.opfor.threatByQuality.military;
    expect(player / CONTRACTS.opfor.types.clan.threat).toBeGreaterThan(0.95);
    expect(player / CONTRACTS.opfor.types.clan.threat).toBeLessThanOrEqual(1);
  });

  it('численность линейна с обеих сторон', () => {
    const c = offers()[0] as Contract;
    const double = { ...c, opforUnits: c.opforUnits * 2 };
    expect(contractSimpleThreat(double)).toBeCloseTo(contractSimpleThreat(c) * 2, 10);
    const m = record('IS-H55-R3F2');
    expect(lanceSimpleThreat([m, { ...m, id: 'M-copy' }])).toBeCloseTo(mechSimpleThreat(m) * 2, 10);
  });

  it('тип части различается: гвардия того же веса и снабжения опаснее ополчения', () => {
    const c = offers()[0] as Contract;
    const militia = contractSimpleThreat({ ...c, opforType: 'militia', opforTechBase: 'is' });
    const guard = contractSimpleThreat({ ...c, opforType: 'guard', opforTechBase: 'is' });
    expect(guard / militia).toBeCloseTo(
      CONTRACTS.opfor.types.guard.threat / CONTRACTS.opfor.types.militia.threat,
      10,
    );
  });

  it('пилота в оценке нет: машина стоит одинаково с любым пилотом', () => {
    const m = record('IS-H55-R3F2');
    expect(mechSimpleThreat({ ...m, pilotId: 'P-ace' })).toBe(mechSimpleThreat({ ...m, pilotId: null }));
  });

  it('вес противника в оценке — средний вес корпусов, которые выйдут, а не середина полосы на бумаге', () => {
    // Каталог начинается с 20 т и идёт шагом 5 т: «до 20 т» выходит только
    // двадцатитонными, а середина полосы 11–20 т дала бы 15.5 т.
    const c = offers()[0] as Contract;
    expect(opforTonsAverage({ ...c, opforTons: 20, opforTechBase: 'is' })).toBe(20);
    expect(opforTonsAverage({ ...c, opforTons: 25, opforTechBase: 'is' })).toBe(22.5);
    for (let cap = 20; cap <= 100; cap += 5) {
      const floor = cap * CONTRACTS.opfor.tons.floor;
      // Независимо от кода: тоннажи каталога — 20..100 т шагом 5 т, равное число шасси на каждый.
      const tons: number[] = [];
      for (let t = 20; t <= cap; t += 5) if (t >= floor) tons.push(t);
      const expected = tons.reduce((sum, t) => sum + t, 0) / tons.length;
      for (const techBase of ['is', 'clan'] as const) {
        expect(opforTonsAverage({ ...c, opforTons: cap, opforTechBase: techBase })).toBeCloseTo(expected, 10);
        const force = buildForce(
          {
            count: 12,
            factionId: c.target,
            opforType: 'line',
            techBase,
            supply: 1,
            tonnageCap: cap,
            tonnageMin: floor,
            idPrefix: 'T',
          },
          cap,
        );
        for (const p of force) expect(tons).toContain(recordChassisDef(p.record).tons);
      }
    }
  });
});
