import { describe, expect, it } from 'vitest';
import { EMPLACEMENTS, emplacementKind } from '../src/core/data/tables.js';
import { Direction, hex } from '../src/core/hex/index.js';
import { BattleState, ContactLevel, HitZone, makeUnit, Phase, type MechUnit } from '../src/core/model/index.js';
import { enumerateLegalCommands, execute } from '../src/core/commands/index.js';
import { HexMap, invalidateLos, MoveMode } from '../src/core/map/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { makePilot, moraleReadingOf, mpBudget, progressOf, resolveSalvo, toHitBreakdown } from '../src/core/rules/index.js';
import { emplacementKindOf, makeEmplacement } from '../src/core/rules/emplacement.js';
import {
  CampaignRngSet,
  CampaignState,
  CONTRACTS,
  GALAXY,
  buildOpfor,
  collectTrophies,
  debrief,
  emplacementsFor,
  fastResolve,
  foundingInit,
  judgedContracts,
  makeBattleFromBrief,
  missionField,
  type BattleBrief,
  type Contract,
} from '../src/core/campaign/index.js';
import { runOn } from '../src/sim/autoBattle.js';
import coreRu from '../src/core/log/ru.json';
import coreEn from '../src/core/log/en.json';

/**
 * Огневые точки (шаг 73c): неподвижные установки на поле противника —
 * участники боя с `frame: 'emplacement'`, без правил меха, которых у них нет.
 */

function turret(kind = 'lrm10', at = hex(5, 5)): MechUnit {
  return makeEmplacement({ id: `opfor:T-${kind}`, side: 'opfor', kind, hex: at, facing: Direction.W, seed: 7, gunnery: 5 });
}

describe('огневая точка как участник боя', () => {
  it('не ходит, вся прочность — в корпусе, как в данных', () => {
    for (const k of EMPLACEMENTS.kinds) {
      const t = turret(k.id);
      expect(t.frame).toBe('emplacement');
      expect(t.walkMP).toBe(0);
      expect(emplacementKindOf(t)).toBe(k.id);
      expect(t.zones[HitZone.Torso]!.structure).toBe(k.structure);
      const rest = t.zones.filter((_, i) => i !== HitZone.Torso);
      for (const z of rest) expect(z.armor + z.structure).toBe(0);
      expect(t.mounts.map((m) => m.weapon)).toEqual([k.weapon]);
    }
  });

  it('попадание всегда в корпус; ни критов, ни падений, ни ранений; пробит корпус — выбита', () => {
    const t = turret('lrm20');
    const salvo = resolveSalvo(new RngSet(1), t, 'is_ac20', [
      { zone: HitZone.LeftLeg, roll: 1, confirmRoll: null, glanced: false },
    ]);
    expect(salvo.shots[0]!.outcome.zone).toBe(HitZone.Torso);
    expect(salvo.criticalHits).toEqual([]);
    expect(salvo.injuries).toEqual([]);
    expect(salvo.hitFalls).toEqual([]);
    expect(salvo.target.prone).toBe(false);
    expect(salvo.target.destroyed).toBe(true); // АС/20 против 20 прочности
  });

  it('установке нет законных ходов ни в каком режиме — даже одного гекса', () => {
    const state = new BattleState(new HexMap(12, 12), new RngSet(1));
    state.addUnit(turret('lrm20', hex(5, 5)));
    execute(state, { kind: 'endPhase' }); // инициатива → движение
    expect(state.phase).toBe(Phase.Movement);
    const id = 'opfor:T-lrm20';
    const moves = enumerateLegalCommands(state, id).filter((c) => c.kind === 'move');
    expect(moves).toEqual([]);
    for (const mode of [MoveMode.Walk, MoveMode.Run, MoveMode.Jump]) {
      expect(mpBudget(state.requireUnit(id), mode)).toBe(0);
      const r = execute(state, { kind: 'move', unitId: id, path: [hex(5, 5), hex(6, 5)], mode });
      expect(r.ok).toBe(false);
    }
    expect(state.requireUnit(id).hex).toEqual(hex(5, 5));
  });

  it('по установке нет поправок за засветку, силуэт и частичное укрытие — только физические', () => {
    const pilot = { ...makePilot(new Rng(1), { id: 'p', tier: 4 }), firstBattle: false };
    const shooter = makeUnit({ id: 'player:a', side: 'player', chassis: 'IS-H35-R3F1', pilot, hex: hex(0, 0), facing: Direction.E });
    const mech = makeUnit({ id: 'opfor:m', side: 'opfor', chassis: 'IS-H35-R3F1', pilot, hex: hex(4, 0), facing: Direction.W });
    const post = { ...turret('lrm15', hex(4, 0)) };
    const map = new HexMap(12, 12);
    const keys = (target: MechUnit, contact: ContactLevel) =>
      toHitBreakdown(map, shooter, target, shooter.mounts[0]!.weapon, shooter.mounts[0]!.zone, contact, [shooter, target])
        .factors.map((f) => f.key);
    expect(keys(mech, ContactLevel.Blip)).toContain('toHit.blip');
    expect(keys(post, ContactLevel.Blip)).not.toContain('toHit.blip');
    expect(keys(mech, ContactLevel.Silhouette)).toContain('toHit.silhouette');
    expect(keys(post, ContactLevel.Silhouette)).not.toContain('toHit.silhouette');
    expect(keys(post, ContactLevel.Identified)).not.toContain('toHit.targetMove');
    // Гребень на уровень выше цели прямо перед ней, стрелок на холме: робот прячет
    // за гребнем ноги, установка — нет.
    map.setElevation(hex(3, 0), 1);
    map.setElevation(hex(0, 0), 3);
    invalidateLos(map);
    expect(keys(mech, ContactLevel.Identified)).toContain('toHit.partialCover');
    expect(keys(post, ContactLevel.Identified)).not.toContain('toHit.partialCover');
  });

  it('в задачу боя и в мораль огневые точки не входят', () => {
    const pilot = { ...makePilot(new Rng(1), { id: 'p', tier: 4 }), firstBattle: false };
    const mech = makeUnit({ id: 'player:a', side: 'player', chassis: 'IS-H35-R3F1', pilot, hex: hex(0, 0), facing: Direction.E });
    const enemy = makeUnit({ id: 'opfor:b', side: 'opfor', chassis: 'IS-H35-R3F1', pilot, hex: hex(9, 9), facing: Direction.W });
    const withTurret = [mech, enemy, turret()];
    expect(progressOf(withTurret, 0)).toEqual(progressOf([mech, enemy], 0));
    // Выбит единственный робот противника — турель задачу «вывести всех» не держит.
    const p = progressOf([mech, { ...enemy, destroyed: true }, turret()], 3);
    expect(p.opforActive).toBe(0);
    expect(moraleReadingOf(withTurret, 'opfor', 5)).toEqual(moraleReadingOf([mech, enemy], 'opfor', 5));
  });

  it('у каждого вида есть имя в обоих словарях журнала', () => {
    const ru = coreRu as Record<string, string>;
    const en = coreEn as Record<string, string>;
    for (const k of EMPLACEMENTS.kinds) {
      expect(ru[`emplacement.${k.id}`], k.id).toBeTypeOf('string');
      expect(en[`emplacement.${k.id}`], k.id).toBeTypeOf('string');
    }
    for (const kind of Object.keys(CONTRACTS.emplacements.mix)) expect(() => emplacementKind(kind)).not.toThrow();
  });
});

// --- кампания -----------------------------------------------------------------

const START = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
const LANCE = START.company.mechs;
const COMPANY = LANCE.map((record) => ({
  record,
  pilot: START.company.pilots.find((p) => p.id === record.pilotId) as (typeof START.company.pilots)[number],
}));

function board(): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count && out.length < 600; i += 5) {
    for (const { contract } of judgedContracts(START.worldSeed, START.deltas, GALAXY.id(i), 0, START.reputation, START.war)) {
      out.push(contract);
    }
  }
  return out;
}
const BOARD = board();

describe('огневые точки в контракте', () => {
  it('только на поле противника; число — в рамках масштаба; чистая функция от сида', () => {
    let seen = 0;
    for (const c of BOARD) {
      for (let seed = 1; seed <= 10; seed++) {
        const list = emplacementsFor(c, seed);
        if (missionField(c.mission) === 'own') expect(list).toEqual([]);
        const [, hi] = CONTRACTS.emplacements.countByScale[c.scale];
        expect(list.length).toBeLessThanOrEqual(hi);
        expect(emplacementsFor(c, seed)).toEqual(list);
        seen += list.length;
      }
    }
    expect(seen).toBeGreaterThan(50);
  });
});

function turretBrief(): BattleBrief {
  for (const c of BOARD) {
    if (missionField(c.mission) !== 'enemy') continue;
    for (let seed = 1; seed <= 40; seed++) {
      const list = emplacementsFor(c, seed);
      if (list.length < 2) continue;
      return {
        mapSeed: seed * 11 + 3,
        battleSeed: seed,
        map: { biome: c.biome, width: 24, height: 24 },
        company: COMPANY,
        enemy: buildOpfor(c, LANCE, seed),
        emplacements: list,
      };
    }
  }
  throw new Error('не нашлось брифинга с двумя огневыми точками');
}

describe('огневые точки на поле', () => {
  const brief = turretBrief();

  it('стоят спящими в полосе, на +1 к клетке; остальное поле и машины — как без них', () => {
    const state = makeBattleFromBrief(brief);
    const plain = makeBattleFromBrief({ ...brief, emplacements: [] });
    const turrets = state.units.filter((u) => u.frame === 'emplacement');
    expect(turrets.length).toBe(brief.emplacements!.length);
    for (const t of turrets) {
      expect(t.dormant).toBe(true);
      expect(t.side).toBe('opfor');
      expect(state.map.getElevation(t.hex)).toBe(Math.min(5, plain.map.getElevation(t.hex) + 1));
      expect(state.contact('player', t.id)).toBe(0);
    }
    for (const u of plain.units) expect(state.requireUnit(u.id).hex).toEqual(u.hex);
    // Карта за пределами клеток под установками не тронута.
    const under = new Set(turrets.map((t) => `${t.hex.q},${t.hex.r}`));
    for (const h of plain.map.cells()) {
      if (under.has(`${h.q},${h.r}`)) continue;
      expect(state.map.getElevation(h)).toBe(plain.map.getElevation(h));
    }
  });

  it('полный бой и быстрый расчёт повторяемы; турели не трофеи, не потери и не добивания', () => {
    const turretIds = new Set(brief.emplacements!.map((e) => `opfor:${e.id}`));
    const a = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
    const b = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
    expect(a.hash).toBe(b.hash);
    const fast = fastResolve(brief);
    expect(fastResolve(brief)).toEqual(fast);
    for (const outcome of [a.outcome, fast]) {
      for (const held of [true, false]) {
        for (const t of collectTrophies(brief, outcome, held)) expect(turretIds.has(`opfor:${t.id}`)).toBe(false);
        const r = debrief({ brief, outcome: { ...outcome, heldField: held }, rng: new CampaignRngSet(1) });
        for (const id of r.lostRecordIds) expect(turretIds.has(`opfor:${id}`)).toBe(false);
      }
      const victims = outcome.units.flatMap((u) => u.victims ?? []);
      for (const v of victims) expect(turretIds.has(v)).toBe(false);
    }
  });
});
