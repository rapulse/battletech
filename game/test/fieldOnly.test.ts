import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  CONTRACTS,
  GALAXY,
  availableContracts,
  canExecute,
  execute,
  fieldOnly,
  foundingInit,
  judgedContracts,
  type Contract,
} from '../src/core/campaign/index.js';

/**
 * Шаг 74, часть А: работа «только на поле». Укреплённая работа и работа судьбы
 * сектора отыгрываются на карте: авто-расчёт штабом у игрока закрыт, гонорар —
 * с надбавкой `fieldOnly.payBonus`, начисленной один раз при рождении
 * предложения.
 */

const START = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });

function board(): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count; i += 2) {
    for (const { contract } of judgedContracts(START.worldSeed, START.deltas, GALAXY.id(i), 0, START.reputation, START.war)) {
      out.push(contract);
    }
  }
  return out;
}

describe('работа «только на поле» (шаг 74)', () => {
  it('признак — ровно укреплённая работа или судьба сектора', () => {
    const fort = { targets: [], bunkers: [] } as unknown as NonNullable<Contract['fortified']>;
    expect(fieldOnly({ stakes: 'none' })).toBe(false);
    expect(fieldOnly({ stakes: 'sector' })).toBe(true);
    expect(fieldOnly({ stakes: 'none', fortified: fort })).toBe(true);
    expect(fieldOnly({ stakes: 'sector', fortified: fort })).toBe(true);
  });

  it('надбавка начисляется один раз при рождении предложения и только такой работе', () => {
    const bonus = CONTRACTS.fieldOnly.payBonus;
    expect(bonus).toBeGreaterThanOrEqual(0.1);
    expect(bonus).toBeLessThanOrEqual(0.15);
    const withBonus = board();
    const rules = CONTRACTS.fieldOnly as { payBonus: number };
    let without: Contract[];
    try {
      rules.payBonus = 0;
      without = board();
    } finally {
      rules.payBonus = bonus;
    }
    expect(without.map((c) => c.id)).toEqual(withBonus.map((c) => c.id));
    let marked = 0;
    for (let i = 0; i < withBonus.length; i++) {
      const a = withBonus[i]!;
      const b = without[i]!;
      if (fieldOnly(a)) {
        marked++;
        // Гонорар округляется до C-Bill, отсюда допуск в единицу.
        expect(Math.abs(a.payout - b.payout * (1 + bonus))).toBeLessThanOrEqual(1);
      } else {
        expect(a.payout).toBe(b.payout);
      }
    }
    expect(marked).toBeGreaterThan(10);
  });

  it('авто-расчёт у такой работы отклоняется до вылета, у обычной — доступен', () => {
    const found = { field: false, plain: false };
    for (let i = 0; i < GALAXY.count && !(found.field && found.plain); i++) {
      const s = new CampaignState(1, { worldSeed: 42, systemId: GALAXY.id(i), company: foundingInit(1) });
      for (const c of availableContracts(s.worldSeed, s.deltas, s.systemId, s.day, [], s.reputation, s.war)) {
        const kind = fieldOnly(c) ? 'field' : 'plain';
        if (found[kind]) continue;
        const probe = new CampaignState(1, { worldSeed: 42, systemId: GALAXY.id(i), company: foundingInit(1) });
        if (!execute(probe, { kind: 'takeContract', contractId: c.id }).ok) continue;
        const ids = probe.company.mechs.map((m) => m.id);
        const auto = { kind: 'deploy', recordIds: ids, auto: true } as const;
        if (kind === 'field') {
          const cbills = probe.company.cbills;
          expect(canExecute(probe, auto)).toBe(CampaignRejectReason.FieldOnly);
          expect(execute(probe, auto)).toEqual({ ok: false, reason: CampaignRejectReason.FieldOnly });
          expect(probe.company.cbills).toBe(cbills);
          expect(probe.contract!.sortie).toBeNull();
          // На поле — пожалуйста.
          expect(canExecute(probe, { kind: 'deploy', recordIds: ids })).toBeNull();
        } else {
          if (canExecute(probe, { kind: 'deploy', recordIds: ids }) !== null) continue;
          expect(canExecute(probe, auto)).toBeNull();
        }
        found[kind] = true;
      }
    }
    expect(found).toEqual({ field: true, plain: true });
  });
});
