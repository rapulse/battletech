import { describe, expect, it } from 'vitest';
import { Direction } from '../src/core/hex/index.js';
import { HitZone, type MechUnit, type Pilot, type Side } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { PILOTS } from '../src/core/data/tables.js';
import {
  EMPTY_TALLY,
  CampaignRngSet,
  debrief,
  makeRecord,
  recordToUnit,
  type BattleBrief,
  type BattleOutcome,
} from '../src/core/campaign/index.js';

/**
 * Шаг 12, послебоевой разбор (`core/campaign/debrief/`).
 *
 * `BattleOutcome` собирается вручную — тем же приёмом, что и в `test/quality.test.ts` для
 * `applyWear`: разбор чистый и от него не нужен настоящий бой, чтобы проверить, как он читает
 * итог.
 */

const CODE = 'IS-H55-R3F2';

function freshUnit(id: string, side: Side): { record: ReturnType<typeof makeRecord>; pilot: Pilot; unit: MechUnit } {
  const record = makeRecord({ id, assembly: generateAssembly({ chassisCode: CODE, role: 'brawler' }, new Rng(4242)) });
  const pilot = makePilot(new Rng(1), { id: `${id}-пилот`, callsign: id, tier: 4 });
  const unit = recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, side);
  return { record, pilot, unit };
}

function soloBrief(record: ReturnType<typeof makeRecord>, pilot: Pilot): BattleBrief {
  return { mapSeed: 1, battleSeed: 1, company: [{ record, pilot }], enemy: [] };
}

function soloOutcome(
  unit: MechUnit,
  opts: {
    heldField: boolean;
    hits?: number;
    pilotingPassed?: number;
    kills?: number;
    initiativeWins?: number;
    composureHeld?: number;
    overheatTurns?: number;
  },
): BattleOutcome {
  return {
    winner: opts.heldField ? 'player' : 'opfor',
    heldField: opts.heldField,
    units: [
      {
        recordId: 'C-1',
        side: 'player',
        unit,
        ...EMPTY_TALLY,
        hits: opts.hits ?? 0,
        pilotingPassed: opts.pilotingPassed ?? 0,
        kills: opts.kills ?? 0,
        initiativeWins: opts.initiativeWins ?? 0,
        composureHeld: opts.composureHeld ?? 0,
        overheatTurns: opts.overheatTurns ?? 0,
      },
    ],
  };
}

describe('трофеи', () => {
  it('появляется ровно при целых торсе и кокпите вражеской машины', () => {
    const company = freshUnit('C-1', 'player');
    const enemy = freshUnit('E-1', 'opfor');

    const outcomeGood: BattleOutcome = {
      winner: 'player',
      heldField: true,
      units: [
        { recordId: 'C-1', side: 'player', unit: company.unit, ...EMPTY_TALLY },
        {
          recordId: 'E-1',
          side: 'opfor',
          unit: { ...enemy.unit, destroyed: true },
          ...EMPTY_TALLY,
        },
      ],
    };
    const brief: BattleBrief = {
      mapSeed: 1,
      battleSeed: 1,
      company: [{ record: company.record, pilot: company.pilot }],
      enemy: [{ record: enemy.record, pilot: enemy.pilot }],
    };

    const good = debrief({ brief, outcome: outcomeGood, rng: new CampaignRngSet(1) });
    expect(good.trophies).toHaveLength(1);
    expect(good.trophies[0]!.assembly.quality).toEqual({ reactor: 'recovered', frame: 'recovered' });
    expect(good.trophies[0]!.pilotId).toBeNull();

    const enemyTorsoDestroyed: MechUnit = {
      ...enemy.unit,
      destroyed: true,
      zones: enemy.unit.zones.map((z, i) => (i === HitZone.Torso ? { ...z, destroyed: true } : z)),
    };
    const outcomeBad: BattleOutcome = {
      ...outcomeGood,
      units: [outcomeGood.units[0]!, { ...outcomeGood.units[1]!, unit: enemyTorsoDestroyed }],
    };
    const bad = debrief({ brief, outcome: outcomeBad, rng: new CampaignRngSet(1) });
    expect(bad.trophies).toHaveLength(0);
  });
});

describe('судьба своей машины (решение 3)', () => {
  it('катапультировавшийся пилот возвращается в строй, а его машина — нет', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');
    const ejectedPilot: Pilot = { ...pilot, status: 'ejected', injuries: 2 };
    const destroyedUnit: MechUnit = { ...unit, destroyed: true, pilot: ejectedPilot };

    const result = debrief({
      brief: soloBrief(record, pilot),
      outcome: soloOutcome(destroyedUnit, { heldField: false }),
      rng: new CampaignRngSet(1),
    });

    expect(result.lostRecordIds).toEqual(['C-1']);
    expect(result.company).toHaveLength(0);
    expect(result.pilots).toHaveLength(1);
    expect(result.pilots[0]!.status).not.toBe('lost');
    expect(result.pilots[0]!.status).toBe('active'); // 2 травмы < порога 'out'
  });

  it('поле удержано — свой остов остаётся у отряда, а не пропадает', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');
    const outUnit: MechUnit = { ...unit, destroyed: true, pilot: { ...pilot, status: 'out', injuries: 6 } };

    const result = debrief({
      brief: soloBrief(record, pilot),
      outcome: soloOutcome(outUnit, { heldField: true }),
      rng: new CampaignRngSet(1),
    });

    expect(result.lostRecordIds).toEqual([]);
    expect(result.company.map((r) => r.id)).toEqual(['C-1']);
    expect(result.pilots[0]!.status).toBe('out');
  });

  it('пилот, потерянный навсегда, не возвращается', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');
    const lostUnit: MechUnit = { ...unit, destroyed: true, pilot: { ...pilot, status: 'lost' } };

    const result = debrief({
      brief: soloBrief(record, pilot),
      outcome: soloOutcome(lostUnit, { heldField: false }),
      rng: new CampaignRngSet(1),
    });

    expect(result.pilots[0]!.status).toBe('lost');
    expect(result.company).toHaveLength(0);
  });
});

describe('опыт', () => {
  /** Величины берутся из данных, а не переписываются сюда: иначе тест сторожит копию. */
  const XP = PILOTS.progression.xp;
  const amount = (event: string, skill: string): number => {
    const row = XP[event];
    return row !== undefined && row.skills.includes(skill) ? row.amount : 0;
  };

  it('начисляется ровно по числу событий в сводке боя, один раз за бой', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');

    const result = debrief({
      brief: soloBrief(record, pilot),
      outcome: soloOutcome(unit, {
        heldField: true,
        hits: 3,
        pilotingPassed: 2,
        kills: 1,
        initiativeWins: 4,
        composureHeld: 2,
      }),
      rng: new CampaignRngSet(1),
    });

    const p = result.pilots[0]!;
    expect(p.xp.gunnery).toBe(3 * amount('hit', 'gunnery') + amount('kill', 'gunnery'));
    expect(p.xp.piloting).toBe(2 * amount('pilotingPassed', 'piloting'));
    expect(p.xp.tactics).toBe(4 * amount('initiativeWon', 'tactics'));
    expect(p.xp.composure).toBe(2 * amount('heldUnderPressure', 'composure'));
    // Вернулся с поля — Выносливость, независимо от того, сколько стрелял.
    expect(p.xp.endurance).toBe(amount('battleSurvived', 'endurance'));
    expect(p.firstBattle).toBe(false);
  });

  it('выполненный контракт платит каждому задействованному навыку разом', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');
    const opts = { brief: soloBrief(record, pilot), outcome: soloOutcome(unit, { heldField: true }), rng: new CampaignRngSet(1) };

    const idle = debrief(opts).pilots[0]!;
    const done = debrief({ ...opts, contractDone: true }).pilots[0]!;

    for (const skill of XP.contractDone!.skills) {
      expect(
        (done.xp[skill] ?? 0) - (idle.xp[skill] ?? 0),
        `навык ${skill} не получил опыта за выполненный контракт`,
      ).toBe(XP.contractDone!.amount);
    }
  });

  it('потерянному пилоту опыта не начисляется', () => {
    const { record, pilot, unit } = freshUnit('C-1', 'player');
    const lost: MechUnit = { ...unit, pilot: { ...pilot, status: 'lost' } };

    const result = debrief({
      brief: soloBrief(record, { ...pilot, status: 'lost' }),
      outcome: soloOutcome(lost, { heldField: true, hits: 3 }),
      rng: new CampaignRngSet(1),
      contractDone: true,
    });

    const p = result.pilots[0]!;
    expect(p.xp.endurance ?? 0).toBe(0);
    expect(p.xp.gunnery ?? 0).toBe(3 * amount('hit', 'gunnery'));
  });
});

describe('износ (шаг 11, впервые подключён здесь)', () => {
  it('растёт вместе с повреждениями и сводкой боя', () => {
    const clean = freshUnit('C-1', 'player');
    const dmg = freshUnit('C-1', 'player');

    const damagedUnit: MechUnit = {
      ...dmg.unit,
      reactorHits: 2,
      zones: dmg.unit.zones.map((z, i) =>
        i === HitZone.Torso ? { ...z, structure: Math.max(0, z.structure - 10) } : z,
      ),
    };

    const resultClean = debrief({
      brief: soloBrief(clean.record, clean.pilot),
      outcome: soloOutcome(clean.unit, { heldField: true, overheatTurns: 0 }),
      rng: new CampaignRngSet(1),
    });
    const resultDamaged = debrief({
      brief: soloBrief(dmg.record, dmg.pilot),
      outcome: soloOutcome(damagedUnit, { heldField: true, overheatTurns: 5 }),
      rng: new CampaignRngSet(1),
    });

    expect(resultDamaged.wear).toHaveLength(1);
    expect(resultClean.wear).toHaveLength(1);
    expect(resultDamaged.wear[0]!.added.reactor).toBeGreaterThan(resultClean.wear[0]!.added.reactor);
    expect(resultDamaged.wear[0]!.added.frame).toBeGreaterThan(resultClean.wear[0]!.added.frame);
  });
});
