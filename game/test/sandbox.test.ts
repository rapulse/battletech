import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  GALAXY,
  availableContracts,
  canExecute,
  contractThreat,
  execute,
  hashCampaignState,
  landingQuote,
  makeCompany,
  makeRecord,
  makeSaveFile,
  parseSaveFile,
  restore,
  snapshot,
  type Contract,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { ECONOMY } from '../src/core/data/index.js';
import type { Pilot } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Шаг 74, часть Б: режим «Песочница». Кредиты по требованию шагом
 * `sandbox.loanStep` и высадка без удержания гонорара; стандарт не меняется.
 */

const STEP = ECONOMY.sandbox.loanStep;

function lance(count: number, code: string): MechRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord({ id: `M-${i + 1}`, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(i + 1)) }),
  );
}

/** Рота с пилотами в строю: без пилота машина на вылет не выходит. */
function crewed(count: number, code: string): { mechs: MechRecord[]; pilots: Pilot[] } {
  const pilots = Array.from({ length: count }, (_, i) =>
    makePilot(new Rng(20 + i), { id: `P-${i + 1}`, callsign: `P-${i + 1}`, tier: 4 }),
  );
  const mechs = lance(count, code).map((m, i) => ({ ...m, pilotId: pilots[i]!.id }));
  return { mechs, pilots };
}

function roundTrip(state: CampaignState): CampaignState {
  return restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
}

describe('режим кампании (шаг 74)', () => {
  it('по умолчанию стандарт; песочница переживает сохранение', () => {
    expect(new CampaignState(1).mode).toBe('standard');
    const sandbox = new CampaignState(1, { mode: 'sandbox' });
    const loaded = roundTrip(sandbox);
    expect(loaded.mode).toBe('sandbox');
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(sandbox));
  });

  it('снимок без поля режима не читается: старые сохранения не поддерживаются', () => {
    const { mode: _drop, ...old } = snapshot(new CampaignState(1));
    expect(() => parseSaveFile(JSON.parse(JSON.stringify({ format: 'battletech-campaign', state: old })))).toThrow();
  });

  it('хэш стандартной кампании режима не содержит', () => {
    const a = new CampaignState(7);
    const b = new CampaignState(7, { mode: 'standard' });
    expect(hashCampaignState(a)).toBe(hashCampaignState(b));
    expect(hashCampaignState(new CampaignState(7, { mode: 'sandbox' }))).not.toBe(hashCampaignState(a));
  });
});

describe('кредиты песочницы (шаг 74)', () => {
  it('в стандарте обе команды отклоняются', () => {
    const s = new CampaignState(1);
    expect(canExecute(s, { kind: 'takeSandboxLoan' })).toBe(CampaignRejectReason.SandboxOnly);
    expect(canExecute(s, { kind: 'repaySandboxLoan' })).toBe(CampaignRejectReason.SandboxOnly);
  });

  it('взять и вернуть — шагом loanStep, без процента и без лимита', () => {
    const s = new CampaignState(1, { mode: 'sandbox', company: { cbills: 0 } });
    expect(canExecute(s, { kind: 'repaySandboxLoan' })).toBe(CampaignRejectReason.NoSandboxDebt);

    expect(execute(s, { kind: 'takeSandboxLoan' }).ok).toBe(true);
    expect(execute(s, { kind: 'takeSandboxLoan' }).ok).toBe(true);
    expect(execute(s, { kind: 'takeSandboxLoan' }).ok).toBe(true);
    expect(s.company.cbills).toBe(3 * STEP);
    expect(s.company.sandboxDebt).toBe(3 * STEP);
    // Заём Гильдии — отдельная вещь, кредит песочницы его не трогает.
    expect(s.company.loan).toBeUndefined();

    expect(execute(s, { kind: 'repaySandboxLoan' }).ok).toBe(true);
    expect(s.company.cbills).toBe(2 * STEP);
    expect(s.company.sandboxDebt).toBe(2 * STEP);
    expect(roundTrip(s).company.sandboxDebt).toBe(2 * STEP);

    execute(s, { kind: 'repaySandboxLoan' });
    execute(s, { kind: 'repaySandboxLoan' });
    expect(s.company.cbills).toBe(0);
    expect(s.company.sandboxDebt).toBeUndefined();
  });

  it('вернуть без денег в кассе нельзя', () => {
    const s = new CampaignState(1, { mode: 'sandbox', company: { cbills: 0 } });
    execute(s, { kind: 'takeSandboxLoan' });
    s.company = { ...s.company, cbills: STEP - 1 };
    expect(execute(s, { kind: 'repaySandboxLoan' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InsufficientFunds,
    });
    expect(s.company.sandboxDebt).toBe(STEP);
  });
});

describe('высадка в песочнице (шаг 74)', () => {
  it('24 штурмовые машины против самой мелкой работы — плата ноль, в стандарте — весь гонорар', () => {
    const offers: Contract[] = [];
    for (let i = 0; i < GALAXY.count && offers.length < 200; i += 3) {
      offers.push(...availableContracts(1, {}, GALAXY.id(i), 0, [], new CampaignState(1).reputation));
    }
    const small = offers.reduce((a, b) => (contractThreat(a) <= contractThreat(b) ? a : b));
    const assault = lance(ECONOMY.sandbox.landingMechs, 'IS-H100-R1F1');

    const standard = landingQuote(small, assault, 'standard');
    expect(standard.share).toBe(ECONOMY.sortie.landing.maxShare);

    const sandbox = landingQuote(small, assault, 'sandbox');
    expect(sandbox.fee).toBe(0);
    expect(sandbox.share).toBe(0);
    // Отношение сил считается как прежде: меняется только квота нанимателя.
    expect(sandbox.ratio).toBe(standard.ratio);
  });

  it('вылет в песочнице не списывает плату за высадку', () => {
    for (let i = 0; i < GALAXY.count; i++) {
      const company = { ...makeCompany(), ...crewed(4, 'IS-H75-R3F3'), dropship: 'overlord' as const, cbills: 0 };
      const s = new CampaignState(1, { mode: 'sandbox', systemId: GALAXY.id(i), company });
      const c = availableContracts(s.worldSeed, s.deltas, s.systemId, s.day, [], s.reputation, s.war).find(
        (o) => landingQuote(o, s.company.mechs, 'standard').fee > 0,
      );
      if (c === undefined) continue;
      expect(execute(s, { kind: 'takeContract', contractId: c.id }).ok).toBe(true);
      const before = s.company.cbills;
      const res = execute(s, { kind: 'deploy', recordIds: s.company.mechs.map((m) => m.id) });
      expect(res.ok).toBe(true);
      expect(res.ok && res.events.some((e) => e.kind === 'landingPaid')).toBe(false);
      expect(s.company.cbills).toBe(before);
      return;
    }
    throw new Error('не нашлось работы с платой за высадку');
  });
});
