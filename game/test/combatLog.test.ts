import { describe, expect, it } from 'vitest';
import { formatEvent, lineText, type LogNames } from '../src/core/log/combatLog.js';
import type { BattleEvent } from '../src/core/commands/types.js';

/** Строка боевого журнала (шаг 66b): ракетная пачка не может показать
 * «попал/промах» одним словом — теперь у неё свой шаблон «долетело N из M». */

const names: LogNames = { unit: (id) => id, pilot: (id) => id };

function shotEvent(overrides: Partial<Extract<BattleEvent, { kind: 'shot' }>>): BattleEvent {
  return {
    kind: 'shot',
    unitId: 'альфа',
    targetId: 'браво',
    weapon: 'is_srm6',
    toHitTarget: 8,
    factors: [],
    toHitBase: 4,
    toHitSituationalCut: 0,
    toHitOverflow: 0,
    range: 3,
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

describe('строка журнала: ракетная пачка (шаг 66b)', () => {
  it('частичное попадание показывает «долетело N из M», а не попал/промах', () => {
    const e = shotEvent({ clusterLanded: 2, clusterTotal: 6 });
    const [line1] = formatEvent(e, names);
    const text = lineText(line1!);
    expect(text).toContain('2');
    expect(text).toContain('6');
    // Старого «попадание»/«промах» одним словом тут быть не должно — оно
    // относится к некластерному шаблону.
    expect(text).not.toMatch(/попадание|промах/);
  });

  it('все ракеты долетели или ни одна — крайние случаи не падают', () => {
    const full = lineText(formatEvent(shotEvent({ clusterLanded: 6, clusterTotal: 6 }), names)[0]!);
    expect(full).toContain('6');
    const none = lineText(formatEvent(shotEvent({ clusterLanded: 0, clusterTotal: 6, hit: false }), names)[0]!);
    expect(none).toContain('0');
  });

  it('некластерное оружие рендерится по-старому: одна строка «попал/промах»', () => {
    const e = shotEvent({ weapon: 'is_ac10' });
    const text = lineText(formatEvent(e, names)[0]!);
    expect(text).toMatch(/попадание|промах/);
  });
});
