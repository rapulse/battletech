import { describe, expect, it } from 'vitest';
import { chance2d6, makeRecord, mechPower, strengthOf } from '../src/core/campaign/index.js';
import { HitZone } from '../src/core/model/index.js';
import { generateAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Шаг 68: оценка сил по огню и живучести (`contracts/power.ts`).
 *
 * Охраняется устройство, а не числа: числа подбирает `pnpm threatcalib`.
 */

const CODE = 'IS-H55-R3F2';

function record() {
  return makeRecord({ id: 'M', assembly: generateAssembly({ chassisCode: CODE }, new Rng(4242)) });
}

describe('оценка сил по огню и живучести', () => {
  it('2d6: края и середина', () => {
    expect(chance2d6(2)).toBe(1);
    expect(chance2d6(7)).toBeCloseTo(21 / 36);
    expect(chance2d6(12)).toBeCloseTo(1 / 36);
    expect(chance2d6(13)).toBe(0);
  });

  it('две одинаковые машины ровно вдвое сильнее одной', () => {
    const m = mechPower(record(), 4);
    const one = strengthOf(m);
    const two = strengthOf({ fire: m.fire * 2, hull: m.hull * 2 });
    expect(two).toBeCloseTo(one * 2);
  });

  it('лучший стрелок даёт больше огня, живучесть та же', () => {
    const r = record();
    const good = mechPower(r, 3);
    const poor = mechPower(r, 6);
    expect(good.fire).toBeGreaterThan(poor.fire);
    expect(good.hull).toBe(poor.hull);
  });

  it('разбитая рука снимает её стволы и её броню', () => {
    const r = record();
    const whole = mechPower(r, 4);
    const zones = r.condition.zones.map((z, i) =>
      i === HitZone.RightArm ? { ...z, armor: 0, structure: 0, destroyed: true } : z,
    );
    const broken = mechPower({ ...r, condition: { ...r.condition, zones } }, 4);
    expect(broken.hull).toBeLessThan(whole.hull);
    expect(broken.fire).toBeLessThanOrEqual(whole.fire);
  });
});
