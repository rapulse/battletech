import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  GALAXY,
  availableContracts,
  contractThreat,
  execute,
  landingFullRatio,
  landingQuote,
  landingShare,
  makeCompany,
  makeRecord,
  type Company,
  type Contract,
  type MechRecord,
} from '../src/core/campaign/index.js';
import type { Pilot } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Шаг 67: плата за высадку сверх нормы нанимателя.
 *
 * Точки кривой — решение пользователя 2026-09-29: наниматель оплачивает силу
 * 1 к 1, перевес 1 к 2 стоит половину гонорара, 1 к 3 — весь; между ними прямая,
 * выше — потолок.
 */

function company(count: number, code: string, cbills: number): Company {
  const mechs: MechRecord[] = [];
  const pilots: Pilot[] = [];
  for (let i = 1; i <= count; i++) {
    const pilotId = `P-${i}`;
    mechs.push({
      ...makeRecord({ id: `M-${i}`, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(i)) }),
      pilotId,
    });
    pilots.push(makePilot(new Rng(20 + i), { id: pilotId, callsign: `П-${i}`, tier: 4 }));
  }
  return { ...makeCompany(), mechs, pilots, cbills, dropship: 'overlord', bays: Math.max(4, count) };
}

describe('плата за высадку (шаг 67)', () => {
  it('кривая: ноль до равенства сил, половина гонорара при 1 к 2, весь — с 1 к 3', () => {
    expect(landingShare(0.5)).toBe(0);
    expect(landingShare(1)).toBe(0);
    expect(landingShare(1.5)).toBeCloseTo(0.25, 5);
    expect(landingShare(2)).toBeCloseTo(0.5, 5);
    expect(landingShare(3)).toBeCloseTo(1, 5);
    expect(landingFullRatio()).toBeCloseTo(3, 5);
    expect(landingShare(5)).toBe(1);
  });

  it('одна машина — всегда за счёт нанимателя, вторая сверх нормы уже стоит денег', () => {
    // Тяжёлая машина против самой мелкой работы: перевес огромный, но машина одна.
    const heavy = company(4, 'IS-H75-R3F2', 10_000_000);
    const offers: Contract[] = [];
    for (let i = 0; i < GALAXY.count && offers.length < 200; i += 3) {
      offers.push(...availableContracts(1, {}, GALAXY.id(i), 0, [], new CampaignState(1).reputation));
    }
    const small = offers.reduce((a, b) => (contractThreat(a) <= contractThreat(b) ? a : b));
    const one = landingQuote(small, heavy.mechs.slice(0, 1), 'standard');
    expect(one.ratio).toBeGreaterThan(1.4);
    expect(one.fee).toBe(0);
    // Плату объясняет перевес сверх оплаченной машины, а не сырое отношение сил.
    expect(one.feeRatio).toBe(1);
    const two = landingQuote(small, heavy.mechs.slice(0, 2), 'standard');
    expect(two.fee).toBeGreaterThan(0);
    expect(two.feeRatio).toBeLessThan(two.ratio);
    expect(landingShare(two.feeRatio)).toBeCloseTo(two.share, 10);
  });

  it('вылет списывает плату и сообщает о ней; не хватает денег — отказ без следа', () => {
    let state: CampaignState | null = null;
    let offer: Contract | null = null;
    for (let i = 0; i < GALAXY.count && offer === null; i++) {
      const s = new CampaignState(1, { systemId: GALAXY.id(i), company: company(4, 'IS-H55-R3F2', 10_000_000) });
      const c = availableContracts(s.worldSeed, s.deltas, s.systemId, s.day, [], s.reputation, s.war).find(
        (o) => landingQuote(o, s.company.mechs, 'standard').fee > 0,
      );
      if (c !== undefined) {
        state = s;
        offer = c;
      }
    }
    expect(offer).not.toBeNull();
    const s = state as CampaignState;
    const c = offer as Contract;
    expect(execute(s, { kind: 'takeContract', contractId: c.id }).ok).toBe(true);
    const ids = s.company.mechs.map((m) => m.id);
    const fee = landingQuote(c, s.company.mechs, 'standard').fee;

    // Денег меньше платы: вылета нет, касса и контракт не тронуты.
    s.company = { ...s.company, cbills: fee - 1 };
    const denied = execute(s, { kind: 'deploy', recordIds: ids });
    expect(denied.ok).toBe(false);
    expect(s.company.cbills).toBe(fee - 1);
    expect(s.contract?.sortie).toBeNull();

    s.company = { ...s.company, cbills: fee + 1000 };
    const done = execute(s, { kind: 'deploy', recordIds: ids });
    expect(done.ok).toBe(true);
    expect(s.company.cbills).toBe(1000);
    const paid = done.ok ? done.events.find((e) => e.kind === 'landingPaid') : undefined;
    expect(paid?.kind === 'landingPaid' ? paid.amount : 0).toBe(fee);
  });
});
