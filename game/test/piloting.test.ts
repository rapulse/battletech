import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/core/data/tables.js';
import { Direction, hex } from '../src/core/hex/index.js';
import { HitZone, makeUnit, type MechUnit } from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import {
  hitFallFromCrit,
  makePilot,
  needsRoutinePilotingCheck,
  resolveSalvo,
  unitPilotingTarget,
  type CriticalResult,
  type ZoneRoll,
} from '../src/core/rules/index.js';

/**
 * Броски пилотирования от попадания (2026-09-15, `wiki/design/combat/piloting.md`):
 * порог урона по весовому классу, криты гироскопа и привода ноги, иммунитет
 * только для движения.
 */

function mech(chassis: string, piloting: number, over: Partial<MechUnit> = {}): MechUnit {
  const p = makePilot(new Rng(7), { id: `p-${chassis}`, tier: 5 });
  const unit = makeUnit({
    id: `m-${chassis}`,
    side: 'opfor',
    chassis,
    pilot: { ...p, skills: { ...p.skills, piloting }, firstBattle: false },
    hex: hex(0, 0),
    facing: Direction.NW,
  });
  return { ...unit, ...over };
}

/** Один выстрел среднего лазера в торс: 5 урона, броня торса его держит — крита нет. */
const torsoHit: ZoneRoll = { zone: HitZone.Torso, roll: 7, confirmRoll: null, glanced: false };
const shoot = (target: MechUnit) => resolveSalvo(new RngSet(1), target, 'is_ml', [torsoHit]);

const LIGHT = 'IS-H35-R3F1';
const MEDIUM = 'IS-H55-R3F2';
const HEAVY = 'IS-H75-R3F3';

describe('падение от урона — порог своего весового класса', () => {
  // 2026-09-15: штурмовой 44 -> 40 — при 44 он почти не падал (0.01 на 100 ходов в строю).
  // 2026-09-15, шаг 51: структура 0.75 -> 1.0 на тонну; пороги подобраны замером (600 процедурных
  // боёв на точку): 17/24/34/40 -> 23/30/37/40, падений от урона на 100 ходов 0.19/0.17/0.13/0.10.
  // 2026-09-16, шаг 53: структура 1.0 -> 1.3, крупные классы стали живучее и падать почти перестали
  // (0.35/0.31/0.21/0.16), поэтому тяжёлому и штурмовому пороги СНИЖЕНЫ: 37/40 -> 35/37. Стало
  // 0.36/0.30/0.32/0.21. Вариант «минус три обоим» (34/37) ставил тяжёлого на край допуска критерия.
  // 2026-09-16, шаг 54: порог дальности сдвинул парк к крупному калибру (средний ствол у тяжёлых
  // 4.6 -> 5.5 т), пакеты урона стали больше, и при 35/37 тяжёлый обогнал среднего на 27 % при
  // допуске 20 % (0.36/0.30/0.38/0.26). Тяжёлому порог возвращён, штурмовому поднят на пункт:
  // 23/30/37/38 дают 0.37/0.31/0.28/0.22 — монотонно и с запасом.
  it('пороги в данных те, что подтверждены замером: 23 / 30 / 37 / 38', () => {
    expect(COMBAT.piloting.fallDamageByClass).toEqual({ light: 23, medium: 30, heavy: 37, assault: 38 });
  });

  it('тяжёлую машину роняет только урон через её порог, а не через общие 20', () => {
    const heavy = COMBAT.piloting.fallDamageByClass.heavy;
    const below = shoot(mech(HEAVY, 5, { damageThisTurn: heavy - 8 }));
    expect(below.hitFalls.some((f) => f.reason === 'piloting.massiveDamage')).toBe(false);

    const before = mech(HEAVY, 5, { damageThisTurn: heavy - 2 });
    const crossed = shoot(before);
    const check = crossed.hitFalls.find((f) => f.reason === 'piloting.massiveDamage');
    expect(check).toBeDefined();
    expect(check!.target).toBe(unitPilotingTarget(before) + COMBAT.piloting.onHit.massiveDamage);
  });

  it('одни и те же 25 урона роняют лёгкую машину и не трогают среднюю', () => {
    expect(shoot(mech(LIGHT, 5, { damageThisTurn: 20 })).hitFalls.map((f) => f.reason)).toContain(
      'piloting.massiveDamage',
    );
    expect(shoot(mech(MEDIUM, 5, { damageThisTurn: 20 })).hitFalls).toEqual([]);
  });

  // 2026-09-24, решение пользователя: ранение от урона — на пороге класса, тем же
  // «тяжёлым ударом», что и падение. Общие 20 ранили пилотов тяжёлых машин вдвое
  // чаще лёгких (замер 300 боёв: 6.5 / 10.1 / 15.2 / 12.9 на 100 машин).
  it('ранение пилота от урона — на пороге своего класса, как падение', () => {
    const medium = COMBAT.piloting.fallDamageByClass.medium;
    const below = shoot(mech(MEDIUM, 5, { damageThisTurn: 16 }));
    expect(below.injuries.map((i) => i.cause)).not.toContain('massiveDamage');

    const crossed = shoot(mech(MEDIUM, 5, { damageThisTurn: medium - 2 }));
    expect(crossed.injuries.map((i) => i.cause)).toContain('massiveDamage');
    expect(crossed.hitFalls.map((f) => f.reason)).toContain('piloting.massiveDamage');
  });

  it('лежачую машину не бросают: валить некуда', () => {
    expect(shoot(mech(LIGHT, 5, { damageThisTurn: 20, prone: true })).hitFalls).toEqual([]);
  });

  it('иммунитет по навыку на бросок от попадания не действует — бросает и элита', () => {
    const elite = mech(LIGHT, 10, { damageThisTurn: 20 });
    expect(needsRoutinePilotingCheck(elite)).toBe(false);
    expect(shoot(elite).hitFalls.map((f) => f.reason)).toContain('piloting.massiveDamage');
  });
});

describe('иммунитет к броскам на местности — только при движении, с навыка 5', () => {
  it('навык 4 бросает, навык 5 на исправной машине — нет', () => {
    expect(COMBAT.piloting.routineImmunitySkill).toBe(5);
    expect(needsRoutinePilotingCheck(mech(MEDIUM, 4))).toBe(true);
    expect(needsRoutinePilotingCheck(mech(MEDIUM, 5))).toBe(false);
  });

  it('повреждённая машина бросает при любом навыке', () => {
    expect(needsRoutinePilotingCheck(mech(MEDIUM, 10, { gyroHits: 1 }))).toBe(true);
  });
});

describe('крит сам назначает бросок: число машины до крита плюс модификатор', () => {
  const crit = (over: Partial<CriticalResult>): CriticalResult =>
    ({ zone: HitZone.Torso, slotIndex: 0, ...over }) as CriticalResult;

  it('крит гироскопа: +3, а постоянная +1 от этого же крита второй раз не ложится', () => {
    const before = mech(MEDIUM, 5);
    const check = hitFallFromCrit(before, crit({ slotKind: 'gyro', effect: 'gyroHit', unit: { ...before, gyroHits: 1 } }));
    expect(check).toEqual({ reason: 'piloting.gyroHit', target: unitPilotingTarget(before) + 3 });
  });

  it('крит привода ноги: +1; привод руки броска не даёт', () => {
    const before = mech(MEDIUM, 5);
    expect(hitFallFromCrit(before, crit({ slotKind: 'leg_actuator', effect: 'actuatorHit', unit: before }))).toEqual({
      reason: 'piloting.legActuator',
      target: unitPilotingTarget(before) + 1,
    });
    expect(hitFallFromCrit(before, crit({ slotKind: 'arm_actuator', effect: 'actuatorHit', unit: before }))).toBeNull();
  });

  it('шансы из таблицы piloting.md: новичок 42 %, средний 28 %, элита 17 % на крите гироскопа', () => {
    // Гироскоп +3 к числу навыка: новичок 4+3 = 7, средний 3+3 = 6, элита 2+3 = 5.
    // 2d6 меньше числа: меньше 7 — 15/36 (42 %), меньше 6 — 10/36 (28 %), меньше 5 — 6/36 (17 %).
    const fall = (target: number): number => {
      let n = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b < target) n++;
      return Math.round((n / 36) * 100);
    };
    const gyro = (piloting: number) => {
      const before = mech(MEDIUM, piloting);
      return hitFallFromCrit(before, crit({ slotKind: 'gyro', effect: 'gyroHit', unit: before }))!.target;
    };
    expect(fall(gyro(1))).toBe(42);
    expect(fall(gyro(5))).toBe(28);
    expect(fall(gyro(10))).toBe(17);
  });
});
