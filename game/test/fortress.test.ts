import { describe, expect, it } from 'vitest';
import { EMPLACEMENTS, structureKind } from '../src/core/data/tables.js';
import { Direction, distance, hex } from '../src/core/hex/index.js';
import { HitZone, makeUnit, type MechUnit } from '../src/core/model/index.js';
import type { ObjectiveProgress } from '../src/core/model/Objective.js';
import { Rng } from '../src/core/rng/index.js';
import { judgeObjective, makePilot, progressOf } from '../src/core/rules/index.js';
import { makeStructure, sideGunnery } from '../src/core/rules/emplacement.js';
import { skillLevel } from '../src/core/model/Pilot.js';
import {
  CampaignRngSet,
  CampaignState,
  CONTRACTS,
  GALAXY,
  buildOpfor,
  collectTrophies,
  contractObjective,
  debrief,
  fastResolve,
  fortressField,
  foundingInit,
  judgedContracts,
  makeBattleFromBrief,
  outcomeOf,
  type BattleBrief,
  type Contract,
} from '../src/core/campaign/index.js';
import { runOn } from '../src/sim/autoBattle.js';

/**
 * Укрепления (шаг 73d): конструкции — те же установки, что огневые точки;
 * штурм — разрушить объекты-цели, оборона — удержать свои; укрепление стоит у
 * старта обороняющегося, на обороне его ведёт бот за роту.
 */

function structure(kind: string, weapons: string[] = [], side: 'player' | 'opfor' = 'opfor'): MechUnit {
  return makeStructure({
    id: `${side}:S-${kind}`,
    side,
    structure: kind,
    weapons,
    hex: hex(4, 4),
    facing: Direction.W,
    seed: 3,
    gunnery: 6,
  });
}

describe('конструкции укрепления', () => {
  it('прочность — base × factor, оружие по числу мест, цель помечена', () => {
    for (const s of EMPLACEMENTS.structures) {
      const weapons = Array.from({ length: s.mounts }, () => 'ppc');
      const u = structure(s.id, weapons);
      expect(u.frame).toBe('emplacement');
      expect(u.walkMP).toBe(0);
      expect(u.objectiveTarget).toBe(s.objective);
      expect(u.zones[HitZone.Torso]!.structure).toBe(Math.round(EMPLACEMENTS.base * s.factor));
      expect(u.mounts.length).toBe(s.mounts);
    }
    expect(() => structure('bunker', ['ppc'])).toThrow();
  });

  it('точность расчёта — средняя Стрельба пилотов своей стороны, с округлением', () => {
    const pilot = (g: number) => {
      const p = makePilot(new Rng(g), { id: `p${g}`, tier: 4 });
      return { ...p, skills: { ...p.skills, gunnery: g }, firstBattle: false };
    };
    const mech = (id: string, g: number) =>
      makeUnit({ id, side: 'opfor', chassis: 'IS-H35-R3F1', pilot: pilot(g), hex: hex(0, 0), facing: Direction.E });
    const units = [mech('a', 4), mech('b', 7), mech('c', 6), structure('relay')];
    expect(sideGunnery(units, 'opfor')).toBe(Math.round((4 + 7 + 6) / 3));
    expect(skillLevel(structure('relay').pilot, 'gunnery')).toBe(6);
  });
});

describe('задачи с объектами', () => {
  const base: ObjectiveProgress = {
    roundsCompleted: 2,
    playerActive: 3,
    opforActive: 3,
    opforTotal: 4,
    playerTargets: 0,
    opforTargets: 0,
    playerTargetsTotal: 0,
    opforTargetsTotal: 0,
  };

  it('штурм: разрушены все объекты — победа, машины противника добивать не нужно', () => {
    const task = { kind: 'destroyTargets' } as const;
    expect(judgeObjective(task, { ...base, opforTargetsTotal: 2, opforTargets: 1 })).toBeNull();
    expect(judgeObjective(task, { ...base, opforTargetsTotal: 2, opforTargets: 0 })).toBe('player');
    expect(judgeObjective(task, { ...base, opforTargetsTotal: 2, opforTargets: 2, playerActive: 0 })).toBe('opfor');
  });

  it('оборона: продержаться срок, пока цел хоть один объект; разрушены все — поражение досрочно', () => {
    const task = { kind: 'protectTargets', rounds: 11 } as const;
    const held = { ...base, playerTargetsTotal: 2, playerTargets: 1 };
    expect(judgeObjective(task, held)).toBeNull();
    expect(judgeObjective(task, { ...held, roundsCompleted: 11 })).toBe('player');
    expect(judgeObjective(task, { ...held, playerTargets: 0 })).toBe('opfor');
    expect(judgeObjective(task, { ...held, playerTargets: 0, opforActive: 0 })).toBe('opfor');
  });

  it('объекты считаются отдельно от строя: не держат поле и не входят в долю', () => {
    const p = progressOf([structure('relay'), structure('depot', [], 'player')], 0);
    expect(p).toMatchObject({ opforActive: 0, opforTotal: 0, playerActive: 0, opforTargetsTotal: 1, playerTargetsTotal: 1 });
  });
});

// --- кампания ------------------------------------------------------------------

const START = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
const LANCE = START.company.mechs;
const COMPANY = LANCE.map((record) => ({
  record,
  pilot: START.company.pilots.find((p) => p.id === record.pilotId) as (typeof START.company.pilots)[number],
}));

function board(): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count; i += 2) {
    for (const { contract } of judgedContracts(START.worldSeed, START.deltas, GALAXY.id(i), 0, START.reputation, START.war)) {
      out.push(contract);
    }
  }
  return out;
}
const BOARD = board();
const FORTIFIED = BOARD.filter((c) => c.fortified !== undefined);

describe('укреплённая работа на бирже', () => {
  it('только штурм и оборона, с шансом из данных; цель названа, бункеры — по масштабу', () => {
    expect(FORTIFIED.length).toBeGreaterThan(10);
    for (const c of FORTIFIED) {
      expect(['assault', 'defense']).toContain(c.mission);
      const f = c.fortified!;
      expect(f.targets.length).toBeGreaterThanOrEqual(CONTRACTS.fortified.targets[0]);
      for (const t of f.targets) expect(structureKind(t).objective).toBe(true);
      const [lo, hi] = CONTRACTS.fortified.bunkersByScale[c.scale];
      expect(f.bunkers.length).toBeGreaterThanOrEqual(lo);
      expect(f.bunkers.length).toBeLessThanOrEqual(hi);
      for (const b of f.bunkers) expect(b.length).toBe(structureKind('bunker').mounts);
    }
    for (const m of ['assault', 'defense'] as const) {
      const all = BOARD.filter((c) => c.mission === m);
      const share = all.filter((c) => c.fortified !== undefined).length / all.length;
      expect(Math.abs(share - CONTRACTS.fortified.missions[m]!.chance)).toBeLessThan(0.15);
    }
  });

  it('задача контракта — задача укрепления', () => {
    for (const c of FORTIFIED) {
      expect(contractObjective(c)).toEqual(CONTRACTS.fortified.missions[c.mission]!.objective);
    }
  });
});

function fortBrief(mission: 'assault' | 'defense'): BattleBrief {
  const c = FORTIFIED.find((x) => x.mission === mission && x.fortified!.bunkers.length > 0) ??
    FORTIFIED.find((x) => x.mission === mission);
  if (c === undefined) throw new Error(`нет укреплённой работы «${mission}»`);
  return {
    mapSeed: 71,
    battleSeed: 9,
    map: { biome: c.biome, width: 24, height: 24 },
    company: COMPANY,
    enemy: buildOpfor(c, LANCE, 9),
    ...fortressField(c),
    objective: contractObjective(c),
  };
}

describe('укрепление на поле', () => {
  it('штурм: укрепление у старта противника, +1 к клетке; цели видны, бункеры спят', () => {
    const brief = fortBrief('assault');
    const state = makeBattleFromBrief(brief);
    const plain = makeBattleFromBrief({ ...brief, structures: [] });
    const built = state.units.filter((u) => u.frame === 'emplacement');
    expect(built.length).toBe(brief.structures!.length);
    const opfor = plain.deploymentCentre('opfor')!;
    const player = plain.deploymentCentre('player')!;
    const round = (h: { q: number; r: number }) => ({ q: Math.round(h.q), r: Math.round(h.r) });
    for (const u of built) {
      expect(u.side).toBe('opfor');
      expect(distance(u.hex, round(opfor))).toBeLessThan(distance(u.hex, round(player)));
      expect(state.map.getElevation(u.hex)).toBe(Math.min(5, plain.map.getElevation(u.hex) + 1));
      expect(u.dormant).toBe(!u.objectiveTarget);
      expect(skillLevel(u.pilot, 'gunnery')).toBe(sideGunnery(state.units, 'opfor'));
    }
    for (const u of plain.units) expect(state.requireUnit(u.id).hex).toEqual(u.hex);
  });

  it('оборона: укрепление за роту, его ведёт бот, спящих нет', () => {
    const state = makeBattleFromBrief(fortBrief('defense'));
    const built = state.units.filter((u) => u.frame === 'emplacement');
    expect(built.length).toBeGreaterThan(0);
    for (const u of built) {
      expect(u.side).toBe('player');
      expect(u.ally).toBe(true);
      expect(u.dormant).toBe(false);
    }
  });

  it('полный бой и быстрый расчёт повторяемы; конструкции — не трофеи и не потери роты', () => {
    for (const mission of ['assault', 'defense'] as const) {
      const brief = fortBrief(mission);
      const ids = new Set(brief.structures!.map((s) => s.id));
      const a = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
      const b = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
      expect(a.hash).toBe(b.hash);
      expect(fastResolve(brief)).toEqual(fastResolve(brief));
      for (const outcome of [a.outcome, fastResolve(brief)]) {
        for (const held of [true, false]) {
          for (const t of collectTrophies(brief, outcome, held)) expect(ids.has(t.id)).toBe(false);
          const r = debrief({ brief, outcome: { ...outcome, heldField: held }, rng: new CampaignRngSet(1) });
          for (const id of r.lostRecordIds) expect(ids.has(id)).toBe(false);
          for (const rec of r.company) expect(ids.has(rec.id)).toBe(false);
        }
      }
    }
  });

  it('штурм выигран, когда разрушены все объекты, хотя машины противника целы', () => {
    const state = makeBattleFromBrief(fortBrief('assault'));
    const units = state.units.map((u) => (u.objectiveTarget ? { ...u, destroyed: true } : u));
    expect(outcomeOf(units, undefined, { objective: state.objective, roundsCompleted: 3 }).winner).toBe('player');
  });
});
