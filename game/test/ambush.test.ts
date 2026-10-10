import { describe, expect, it } from 'vitest';
import { enumerateLegalCommands, execute, refreshContacts } from '../src/core/commands/index.js';
import { COMBAT } from '../src/core/data/tables.js';
import { Direction, distance, hex, hexToOffset, offsetToHex } from '../src/core/hex/index.js';
import { HexMap, describeMap, generateMap, placeOnDiagonal } from '../src/core/map/index.js';
import {
  BattleState,
  ContactLevel,
  hashBattleState,
  makeUnit,
  Phase,
  type MechUnit,
} from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { makePilot } from '../src/core/rules/index.js';
import {
  CampaignState,
  CONTRACTS,
  GALAXY,
  actualForce,
  ambushCount,
  buildOpfor,
  fastResolveDetailed,
  foundingInit,
  judgedContracts,
  makeBattleFromBrief,
  missionField,
  type BattleBrief,
  type Contract,
} from '../src/core/campaign/index.js';
import { runOn } from '../src/sim/autoBattle.js';

/**
 * Засада (шаг 73a, правила пользователя 2026-09-24): лишняя машина сверх
 * сводки на поле противника стоит обесточенной на диагонали, где никто не
 * ходит; видна в `ambush.spotRange` гексах и по траектории хода; включается с
 * первым выстрелом своей стороны — необнаруженная сразу стреляет,
 * обнаруженная пропускает фазу огня.
 */

function pilot(id: string) {
  return { ...makePilot(new Rng(42), { id, tier: 5 }), firstBattle: false };
}

function unit(id: string, side: 'player' | 'opfor', at: { q: number; r: number }): MechUnit {
  return makeUnit({ id, side, chassis: 'IS-H35-R3F1', pilot: pilot(`p-${id}`), hex: hex(at.q, at.r), facing: Direction.NW });
}

function asleep(u: MechUnit): MechUnit {
  return { ...u, dormant: true, shutdown: true };
}

/** Прогон фаз до фазы тепла включительно: инициатива → движение → стрельба → тепло. */
function endTurn(state: BattleState): void {
  for (let guard = 0; guard < 8; guard++) {
    const wasHeat = state.phase === Phase.Heat;
    const r = execute(state, { kind: 'endPhase' });
    if (!r.ok) throw new Error(`endPhase отклонён: ${JSON.stringify(r)}`);
    if (wasHeat) return;
  }
  throw new Error('ход не закончился');
}

describe('засада в бою', () => {
  it('необнаруженную не видно дальше spotRange; ближе — видно, и она остаётся обнаруженной', () => {
    const state = new BattleState(new HexMap(20, 20), new RngSet(1));
    state.addUnit(unit('a', 'player', offsetToHex(5, 5)));
    const at = offsetToHex(5 + COMBAT.ambush.spotRange + 1, 5);
    state.addUnit(asleep(unit('e', 'opfor', at)));
    refreshContacts(state);
    expect(state.contact('player', 'e')).toBe(ContactLevel.None);
    expect(state.requireUnit('e').spotted).toBe(false);

    state.replaceUnit({ ...state.requireUnit('a'), hex: offsetToHex(6, 5) });
    expect(distance(state.requireUnit('a').hex, at)).toBe(COMBAT.ambush.spotRange);
    const events = refreshContacts(state);
    expect(state.contact('player', 'e')).toBeGreaterThan(ContactLevel.None);
    expect(state.requireUnit('e').spotted).toBe(true);
    expect(events.some((e) => e.kind === 'ambushSpotted')).toBe(true);

    // Отошли — обнаруженная засада видна дальше как обычная обесточенная машина.
    state.replaceUnit({ ...state.requireUnit('a'), hex: offsetToHex(2, 5) });
    refreshContacts(state);
    expect(state.contact('player', 'e')).toBeGreaterThan(ContactLevel.None);
  });

  it('засаду находят по траектории хода, а не только из конечной клетки', () => {
    const state = new BattleState(new HexMap(20, 20), new RngSet(2));
    state.addUnit(unit('a', 'player', offsetToHex(3, 10)));
    // На старте засада дальше spotRange: пересчёт контактов в инициативе её не находит.
    const at = offsetToHex(3 + COMBAT.ambush.spotRange + 1, 10);
    state.addUnit(asleep(unit('e', 'opfor', at)));
    execute(state, { kind: 'endPhase' }); // инициатива → движение
    expect(state.requireUnit('e').spotted).toBe(false);
    const range = COMBAT.ambush.spotRange;
    const move = enumerateLegalCommands(state, 'a').find(
      (c): c is Extract<typeof c, { kind: 'move' }> =>
        c.kind === 'move' &&
        c.path.some((h) => distance(h, at) <= range) &&
        distance(c.path[c.path.length - 1]!, at) > range,
    );
    expect(move).toBeDefined();
    const r = execute(state, move!);
    expect(r.ok).toBe(true);
    expect(state.requireUnit('e').spotted).toBe(true);
    expect(state.contact('player', 'e')).toBeGreaterThan(ContactLevel.None);
  });

  function duel(seed: number, spotted: boolean): BattleState {
    const state = new BattleState(new HexMap(20, 20), new RngSet(seed));
    state.addUnit(unit('a', 'player', offsetToHex(5, 5)));
    state.addUnit(unit('b', 'opfor', offsetToHex(8, 5)));
    state.addUnit({ ...asleep(unit('e', 'opfor', offsetToHex(15, 15))), spotted });
    execute(state, { kind: 'endPhase' }); // инициатива
    execute(state, { kind: 'endPhase' }); // движение → стрельба
    return state;
  }

  it('необнаруженная включается с первым выстрелом своей стороны и стреляет в той же фазе', () => {
    const state = duel(3, false);
    expect(state.phase).toBe(Phase.Attack);
    const r = execute(state, { kind: 'attack', unitId: 'b', targetId: 'a', mountIndex: 0 });
    expect(r.ok).toBe(true);
    const e = state.requireUnit('e');
    expect(e.dormant).toBe(false);
    expect(e.shutdown).toBe(false);
    if (r.ok) expect(r.events).toContainEqual({ kind: 'ambushWoke', unitId: 'e', instant: true });
  });

  it('обнаруженная включается перезапуском: первую фазу огня пропускает', () => {
    const state = duel(3, true);
    execute(state, { kind: 'attack', unitId: 'b', targetId: 'a', mountIndex: 0 });
    expect(state.requireUnit('e').dormant).toBe(false);
    expect(state.requireUnit('e').shutdown).toBe(true);
    execute(state, { kind: 'endPhase' }); // стрельба → тепло
    execute(state, { kind: 'endPhase' }); // тепло: перезапуск
    expect(state.requireUnit('e').shutdown).toBe(false);
  });

  it('попадание по обнаруженной засаде включает её перезапуском', () => {
    let hits = 0;
    for (let seed = 1; seed <= 40 && hits < 3; seed++) {
      const state = new BattleState(new HexMap(20, 20), new RngSet(seed));
      state.addUnit(unit('a', 'player', offsetToHex(5, 5)));
      state.addUnit(unit('b', 'opfor', offsetToHex(18, 18)));
      state.addUnit({ ...asleep(unit('e', 'opfor', offsetToHex(7, 5))), spotted: true });
      execute(state, { kind: 'endPhase' });
      execute(state, { kind: 'endPhase' });
      const r = execute(state, { kind: 'attack', unitId: 'a', targetId: 'e', mountIndex: 0 });
      if (!r.ok) continue;
      const shot = r.events.find((x) => x.kind === 'shot');
      const e = state.requireUnit('e');
      if (shot?.kind === 'shot' && shot.hit && !e.destroyed) {
        hits++;
        expect(e.dormant).toBe(false);
        expect(e.shutdown).toBe(true);
      } else if (!e.destroyed) {
        expect(e.dormant).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('без огня своей стороны засада спит; у стороны не осталось никого, кроме спящих, — включаются', () => {
    const state = new BattleState(new HexMap(20, 20), new RngSet(4));
    state.addUnit(unit('a', 'player', offsetToHex(2, 2)));
    state.addUnit(unit('b', 'opfor', offsetToHex(15, 15)));
    state.addUnit(asleep(unit('e', 'opfor', offsetToHex(10, 18))));
    for (let i = 0; i < 3; i++) endTurn(state);
    expect(state.requireUnit('e').dormant).toBe(true);
    state.replaceUnit({ ...state.requireUnit('b'), destroyed: true });
    endTurn(state);
    expect(state.requireUnit('e').dormant).toBe(false);
  });

  it('засада не сдвигает свой край стороны для отхода', () => {
    const plain = new BattleState(new HexMap(20, 20), new RngSet(5));
    plain.addUnit(unit('b', 'opfor', offsetToHex(15, 15)));
    const withAmbush = new BattleState(new HexMap(20, 20), new RngSet(5));
    withAmbush.addUnit(unit('b', 'opfor', offsetToHex(15, 15)));
    withAmbush.addUnit(asleep(unit('e', 'opfor', offsetToHex(10, 10))));
    expect(withAmbush.deploymentCentre('opfor')).toEqual(plain.deploymentCentre('opfor'));
  });

  it('спящая машина входит в хэш, бой без засады — нет', () => {
    const a = new BattleState(new HexMap(10, 10), new RngSet(6));
    a.addUnit(unit('a', 'player', offsetToHex(2, 2)));
    a.addUnit(asleep(unit('e', 'opfor', offsetToHex(7, 7))));
    const sleeping = hashBattleState(a);
    a.replaceUnit({ ...a.requireUnit('e'), dormant: false });
    expect(hashBattleState(a)).not.toBe(sleeping);
  });
});

// --- кампания ------------------------------------------------------------------

function sampleBoard(): Contract[] {
  const state = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count && out.length < 400; i += 8) {
    for (const { contract, allowed } of judgedContracts(
      state.worldSeed,
      state.deltas,
      GALAXY.id(i),
      0,
      state.reputation,
      state.war,
    )) {
      if (allowed) out.push(contract);
    }
  }
  return out;
}

const BOARD = sampleBoard();
const LANCE = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) }).company.mechs;
const noisyEnemy = BOARD.filter((c) => missionField(c.mission) === 'enemy' && c.intel <= 0.5);
// На своей земле сводка точнее (`intel.missionShift` +0.06): порог мягче.
const noisyOwn = BOARD.filter((c) => missionField(c.mission) === 'own' && c.intel <= 0.75);

describe('засада в контракте', () => {
  it('поле: разведка, рейд, штурм — чужое; гарнизон и оборона — своё', () => {
    expect(missionField('recon')).toBe('enemy');
    expect(missionField('raid')).toBe('enemy');
    expect(missionField('assault')).toBe('enemy');
    expect(missionField('garrison')).toBe('own');
    expect(missionField('defense')).toBe('own');
  });

  it('засада — только лишние машины сверх сводки, только на чужом поле, с шансом ambushChance', () => {
    expect(noisyEnemy.length).toBeGreaterThan(5);
    expect(noisyOwn.length).toBeGreaterThan(0);
    let extra = 0;
    let ambush = 0;
    // Броски зависят только от сида вылета, поэтому ширину выборке дают сиды,
    // а не контракты: 60 сидов на сотню контрактов — это всё те же 60 жребиев.
    for (const c of noisyEnemy.slice(0, 10)) {
      for (let seed = 1; seed <= 1000; seed++) {
        const over = Math.max(0, actualForce(c, seed).units - c.opforUnits);
        const n = ambushCount(c, seed);
        expect(n).toBeLessThanOrEqual(over);
        extra += over;
        ambush += n;
      }
    }
    for (const c of noisyOwn) for (let seed = 1; seed <= 60; seed++) expect(ambushCount(c, seed)).toBe(0);
    expect(extra).toBeGreaterThan(200);
    expect(ambush / extra).toBeGreaterThan(CONTRACTS.intel.ambushChance - 0.04);
    expect(ambush / extra).toBeLessThan(CONTRACTS.intel.ambushChance + 0.04);
  });

  it('засада не меняет состав: те же машины, помечены последние', () => {
    const c = noisyEnemy[0] as Contract;
    for (let seed = 1; seed <= 200; seed++) {
      const n = ambushCount(c, seed);
      if (n === 0) continue;
      const force = buildOpfor(c, LANCE, seed);
      expect(force.length).toBe(actualForce(c, seed).units);
      expect(force.filter((p) => p.ambush === true).length).toBe(n);
      expect(force.slice(force.length - n).every((p) => p.ambush === true)).toBe(true);
      return;
    }
    throw new Error('на 200 сидах не нашлось ни одной засады');
  });
});

/** Брифинг с засадой: противник с засадником против стартового звена роты. */
function ambushBrief(): BattleBrief {
  const pilots = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) }).company.pilots;
  const company = LANCE.map((record) => ({
    record,
    pilot: pilots.find((p) => p.id === record.pilotId) as (typeof pilots)[number],
  }));
  for (const c of noisyEnemy) {
    for (let seed = 1; seed <= 300; seed++) {
      if (ambushCount(c, seed) === 0) continue;
      return {
        mapSeed: seed * 7 + 1,
        battleSeed: seed,
        map: { biome: c.biome, width: 24, height: 24 },
        company,
        enemy: buildOpfor(c, LANCE, seed),
      };
    }
  }
  throw new Error('не нашлось брифинга с засадой');
}

describe('засада на поле', () => {
  const brief = ambushBrief();

  it('засадник стоит спящим на диагонали, остальные — там же, где без засады', () => {
    const state = makeBattleFromBrief(brief);
    const plain = makeBattleFromBrief({
      ...brief,
      enemy: brief.enemy.filter((p) => p.ambush !== true),
    });
    const sleepers = state.units.filter((u) => u.dormant);
    expect(sleepers.length).toBe(brief.enemy.filter((p) => p.ambush === true).length);
    for (const u of sleepers) expect(u.shutdown).toBe(true);
    for (const u of plain.units) expect(state.requireUnit(u.id).hex).toEqual(u.hex);
    const size = state.map.w;
    for (const u of sleepers) {
      const { col, row } = hexToOffset(u.hex);
      expect(Math.abs(col - row) / Math.SQRT2).toBeLessThanOrEqual(COMBAT.ambush.diagonal.width + 1e-9);
      expect(col).toBeLessThan(size);
    }
    // Роты засадник не видит, пока никто не подошёл.
    for (const u of sleepers) expect(state.contact('player', u.id)).toBe(ContactLevel.None);
  });

  it('на диагонали засада чаще посередине между центром и углом, чем у центра или у угла', () => {
    const generated = generateMap(describeMap({ seed: 5, width: 24, height: 24 }));
    const bins = { centre: 0, middle: 0, corner: 0 };
    for (let seed = 1; seed <= 300; seed++) {
      const [h] = placeOnDiagonal(
        generated.map,
        generated,
        1,
        { ...COMBAT.ambush.diagonal, spacing: COMBAT.ambush.spacing },
        new Set(),
        new Rng(seed),
      );
      if (h === undefined) continue;
      const { col, row } = hexToOffset(h);
      const d = Math.abs((col + row) / 2 / 23 - 0.5) * 2;
      if (d < 0.2) bins.centre++;
      else if (d > 0.8) bins.corner++;
      else if (d >= 0.35 && d <= 0.65) bins.middle++;
    }
    expect(bins.middle).toBeGreaterThan(bins.centre * 2);
    expect(bins.middle).toBeGreaterThan(bins.corner * 2);
  });

  it('полный бой и быстрый расчёт с засадой доходят до конца и повторяемы', () => {
    const a = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
    const b = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed, maxTurns: 40 });
    expect(a.hash).toBe(b.hash);
    const fast = fastResolveDetailed(brief);
    expect(fastResolveDetailed(brief).outcome).toEqual(fast.outcome);
  });
});
