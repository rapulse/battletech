import { describe, expect, it } from 'vitest';
import { execute, enumerateLegalCommands } from '../src/core/commands/index.js';
import { HitZone } from '../src/core/model/HitZone.js';
import { BattleState, Phase } from '../src/core/model/BattleState.js';
import { WeightClass } from '../src/core/model/WeightClass.js';
import type { MechUnit } from '../src/core/model/MechUnit.js';
import { Rng } from '../src/core/rng/index.js';
import { ejectionOdds, rollCockpitBreach, rollEjection } from '../src/core/rules/ejection.js';
import { resolveAttack } from '../src/core/rules/attack.js';
import { PILOTS } from '../src/core/data/tables.js';
import { makeBattle } from '../src/sim/scenario.js';

function makeMockUnit(overrides: Partial<MechUnit> = {}): MechUnit {
  return {
    id: 'test_unit',
    side: 'player',
    chassis: 'IS-H55-R3F2',
    weightClass: WeightClass.Medium,
    walkMP: 5,
    pilot: {
      id: 'pilot_1',
      name: 'Test Pilot',
      callsign: 'Ace',
      origin: 'sphereRegular',
      affiliation: 'davion',
      gender: 'male',
      face: 0,
      skills: {
      gunnery: 5, piloting: 5, tactics: 5, composure: 5, tech: 5,
      strength: 5, melee: 5, endurance: 5, will: 5, presence: 5,
    },
      caps: {},
      xp: {},
      injuries: 0,
      status: 'active',
      firstBattle: false,
    },
    hex: { q: 0, r: 0 },
    facing: 0,
    heat: 0,
    mpLeft: 5,
    moveMode: null,
    hexesMoved: 0,
    hasFired: false,
    shotsSeen: 0,
    damageThisTurn: 0,
    fellThisTurn: false,
    prone: false,
    submerged: 0,
    destroyed: false,
    withdrawn: false,
    zones: [
      { armor: 6, structure: 3, maxArmor: 6, maxStructure: 3, destroyed: false },
      { armor: 15, structure: 10, maxArmor: 15, maxStructure: 10, destroyed: false },
      { armor: 8, structure: 5, maxArmor: 8, maxStructure: 5, destroyed: false },
      { armor: 8, structure: 5, maxArmor: 8, maxStructure: 5, destroyed: false },
      { armor: 10, structure: 7, maxArmor: 10, maxStructure: 7, destroyed: false },
      { armor: 10, structure: 7, maxArmor: 10, maxStructure: 7, destroyed: false },
    ],
    mounts: [
      { weapon: 'is_ml', zone: HitZone.RightArm, destroyed: false, ammo: null, slotIndices: [], firedThisTurn: false },
    ],
    slots: [[], [], [], [], [], []],
    shutdown: false,
    dormant: false,
    spotted: false,
    ally: false,
    frame: 'mech',
    objectiveTarget: false,
    shutdownLastTurn: false,
    reactorHits: 0,
    gyroHits: 0,
    sensorHits: 0,
    legActuatorHits: [0, 0],
    armActuatorHits: [0, 0],
    ...overrides,
  };
}

describe('Механика катапультирования (Ejection)', () => {
  describe('Расчёт шансов (ejectionOdds)', () => {
    it('базовые шансы для всех триггеров', () => {
      const unit = makeMockUnit();
      expect(ejectionOdds(unit, 'voluntary').chance).toBeCloseTo(0.98, 2);
      expect(ejectionOdds(unit, 'torso').chance).toBe(1);
      expect(ejectionOdds(unit, 'head').chance).toBeCloseTo(0.55, 2);
    });

    it('модификаторы обстановки уменьшают шанс', () => {
      // Кокпит: обстановка бьёт в полную силу, порог низкий.
      const proneHead = makeMockUnit({ prone: true });
      expect(ejectionOdds(proneHead, 'head').chance).toBeCloseTo(0.45, 2); // 0.55 - 0.10

      const submergedHead = makeMockUnit({ submerged: 1 });
      expect(ejectionOdds(submergedHead, 'head').chance).toBeCloseTo(0.30, 2); // 0.55 - 0.25

      // Добровольный уход обстановка тоже ухудшает, но не ниже своего порога 0.90:
      // иначе решение спасаться становится лотереей и игрок перестаёт его принимать.
      const proneUnit = makeMockUnit({ prone: true });
      expect(ejectionOdds(proneUnit, 'voluntary').chance).toBeCloseTo(0.90, 2);

      const submergedUnit = makeMockUnit({ submerged: 1 });
      expect(ejectionOdds(submergedUnit, 'voluntary').chance).toBe(0.90);
    });

    it('разрушенный торс отпускает всегда: обстановка на него не влияет', () => {
      // Ровно тот случай, в котором механика ломалась: мех гибнет поваленным,
      // раскалённым и с раненым пилотом — то есть штрафы били бы всегда.
      const doomed = makeMockUnit({ prone: true, submerged: 2, heat: 40 });
      const odds = ejectionOdds(doomed, 'torso');
      expect(odds.chance).toBe(1);
      expect(odds.factors).toHaveLength(0);
    });

    it('травмы уменьшают шанс, а высокое пилотирование увеличивает', () => {
      const injuredUnit = makeMockUnit({
        pilot: {
          id: 'p1',
          name: 'P',
          callsign: 'P',
          origin: 'sphereRegular',
      affiliation: 'davion',
      gender: 'male',
      face: 0,
          skills: { piloting: 5, endurance: 5 },
          caps: {},
          xp: {},
          injuries: 2,
          status: 'active',
          firstBattle: false,
        },
      });
      // 0.98 - 2*0.05 - 1*0.02 = 0.86, но порог добровольного ухода поднимает до 0.90
      expect(ejectionOdds(injuredUnit, 'voluntary').chance).toBe(0.90);
      // У кокпита порог низкий, поэтому там те же штрафы видны полностью:
      // 0.55 - 0.10 - 0.02 = 0.43
      expect(ejectionOdds(injuredUnit, 'head').chance).toBeCloseTo(0.43, 2);

      const elitePilotUnit = makeMockUnit({
        pilot: {
          id: 'p1',
          name: 'P',
          callsign: 'P',
          origin: 'sphereRegular',
      affiliation: 'davion',
      gender: 'male',
      face: 0,
          skills: { piloting: 9, endurance: 5 }, // +4 уровня выше 5 -> +0.08
          caps: {},
          xp: {},
          injuries: 0,
          status: 'active',
          firstBattle: false,
        },
      });
      // 0.55 + 4*0.02 = 0.63
      expect(ejectionOdds(elitePilotUnit, 'head').chance).toBeCloseTo(0.63, 2);
    });

    it('шанс ограничен сверху (0.99) и снизу (0.25)', () => {
      const bestUnit = makeMockUnit({
        pilot: {
          id: 'p1',
          name: 'P',
          callsign: 'P',
          origin: 'sphereRegular',
      affiliation: 'davion',
      gender: 'male',
      face: 0,
          skills: { piloting: 10, endurance: 5 },
          caps: {},
          xp: {},
          injuries: 0,
          status: 'active',
          firstBattle: false,
        },
      });
      expect(ejectionOdds(bestUnit, 'voluntary').chance).toBeLessThanOrEqual(0.99);

      const worstUnit = makeMockUnit({
        prone: true,
        submerged: 2,
        heat: 15,
        pilot: {
          id: 'p1',
          name: 'P',
          callsign: 'P',
          origin: 'sphereRegular',
      affiliation: 'davion',
      gender: 'male',
      face: 0,
          skills: { piloting: 1, endurance: 5 },
          caps: {},
          xp: {},
          injuries: 4,
          status: 'active',
          firstBattle: false,
        },
      });
      expect(ejectionOdds(worstUnit, 'head').chance).toBe(0.25);
    });
  });

  describe('Бросок катапультирования (rollEjection)', () => {
    it('при успехе пилот получает статус ejected, а юнит destroyed', () => {
      const rng = new Rng(1);
      const unit = makeMockUnit();
      const result = rollEjection(rng, unit, 'voluntary');

      expect(result.success).toBe(true);
      expect(result.pilot.status).toBe('ejected');
      expect(result.unit.destroyed).toBe(true);
    });
  });

  describe('Пробитие кокпита (шаг 6): 1d6 на остекление', () => {
    // Заглушка ГПСЧ: next() выдаёт долю, из которой rollCockpitBreach делает
    // ровно нужную грань кубика. Так проверяется правило, а не арифметика.
    const face = (n: number): Rng =>
      ({ next: () => (n - 1 + 0.5) / PILOTS.cockpitBreach.die }) as unknown as Rng;

    /** Двое в упор: залпы доходят, и голова попадает под раздачу регулярно. */
    function closeRange(): { state: BattleState; attacker: MechUnit; target: MechUnit } {
      const state = makeBattle({ seed: 11 });
      const player = state.units.find((u) => u.side === 'player')!;
      const opfor = state.units.find((u) => u.side === 'opfor')!;
      const attacker = { ...player, hex: { q: 0, r: 0 } };
      const target = { ...opfor, hex: { q: 0, r: 2 } };
      state.replaceUnit(attacker);
      state.replaceUnit(target);
      state.phase = Phase.Attack;
      return { state, attacker, target };
    }

    it('грани ниже порога оставляют пилота в кабине', () => {
      const unit = makeMockUnit();
      for (let n = 1; n < PILOTS.cockpitBreach.lostFrom; n++) {
        const res = rollCockpitBreach(face(n), unit.pilot);
        expect(res.roll).toBe(n);
        expect(res.lost).toBe(false);
        expect(res.pilot.status).toBe('active');
      }
    });

    it('грани от порога и выше теряют пилота без броска на уход', () => {
      const unit = makeMockUnit();
      for (let n = PILOTS.cockpitBreach.lostFrom; n <= PILOTS.cockpitBreach.die; n++) {
        const res = rollCockpitBreach(face(n), unit.pilot);
        expect(res.roll).toBe(n);
        expect(res.lost).toBe(true);
        expect(res.pilot.status).toBe('lost');
      }
    });

    it('бросок делается ровно тогда, когда броня головы пробита, и один на залп', () => {
      const { state, attacker, target } = closeRange();

      // Целая голова: сколько ни стреляй, бросок на остекление не случается.
      let intactHeadHits = 0;
      for (let i = 0; i < 400; i++) {
        const res = resolveAttack(state.rng, {
          map: state.map,
          attacker,
          target,
          mountIndex: 0,
        });
        const headHit = res.shots.some((sh) => sh.outcome.zone === HitZone.Head);
        if (headHit && res.shots.every((sh) => sh.outcome.armorHeld)) {
          intactHeadHits += 1;
          expect(res.cockpitBreach).toBeNull();
        }
      }
      expect(intactHeadHits).toBeGreaterThan(0);

      // Броня головы снята заранее — любое попадание в голову её пробивает,
      // и на весь залп приходится ровно один бросок.
      const bare = {
        ...target,
        zones: target.zones.map((z, i) => (i === HitZone.Head ? { ...z, armor: 0 } : z)),
      };
      let breaches = 0;
      for (let i = 0; i < 400; i++) {
        const res = resolveAttack(state.rng, { map: state.map, attacker, target: bare, mountIndex: 0 });
        const headHit = res.shots.some((sh) => sh.outcome.zone === HitZone.Head);
        if (headHit) {
          breaches += 1;
          expect(res.cockpitBreach).not.toBeNull();
          expect(res.cockpitBreach!.roll).toBeGreaterThanOrEqual(1);
          expect(res.cockpitBreach!.roll).toBeLessThanOrEqual(PILOTS.cockpitBreach.die);
        } else {
          expect(res.cockpitBreach).toBeNull();
        }
      }
      expect(breaches).toBeGreaterThan(0);
    });

    it('потерянный в кабине пилот не бросает на уход — катапульта не сработала', () => {
      const { state, attacker, target } = closeRange();
      const bare = {
        ...target,
        zones: target.zones.map((z, i) => (i === HitZone.Head ? { ...z, armor: 0 } : z)),
      };

      let lost = 0;
      for (let i = 0; i < 600; i++) {
        const res = resolveAttack(state.rng, { map: state.map, attacker, target: bare, mountIndex: 0 });
        if (res.cockpitBreach?.lost === true) {
          lost += 1;
          expect(res.pilotLost).toBe(true);
          expect(res.ejection).toBeNull();
          expect(res.target.pilot.status).toBe('lost');
          expect(res.target.destroyed).toBe(true);
        }
      }
      expect(lost).toBeGreaterThan(0);
    });
  });

  describe('Команда катапультирования в бою', () => {
    it('команда eject предлагается в фазе движения', () => {
      const state = makeBattle({ seed: 42 });
      state.phase = Phase.Movement;
      const unit = state.units[0]!;

      const commands = enumerateLegalCommands(state, unit.id);
      const hasEject = commands.some((c) => c.kind === 'eject');
      expect(hasEject).toBe(true);
    });

    it('исполнение eject выводит юнита и спасает пилота', () => {
      const state = makeBattle({ seed: 42 });
      state.phase = Phase.Movement;
      const unit = state.units[0]!;

      const res = execute(state, { kind: 'eject', unitId: unit.id });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.events.some((e) => e.kind === 'pilotEjected')).toBe(true);
        expect(res.events.some((e) => e.kind === 'unitDestroyed')).toBe(true);
      }

      const updated = state.getUnit(unit.id)!;
      expect(updated.destroyed).toBe(true);
      expect(['ejected', 'lost']).toContain(updated.pilot.status);
    });
  });
});
