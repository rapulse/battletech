import { describe, expect, it } from 'vitest';
import {
  CampaignRngSet,
  CampaignState,
  CONTRACTS,
  GALAXY,
  alliesFor,
  alliesSimpleThreat,
  buildAllies,
  buildOpfor,
  collectTrophies,
  companyThreat,
  contractSimpleThreat,
  contractThreat,
  debrief,
  fastResolve,
  foundingInit,
  judgedContracts,
  landingQuote,
  makeBattleFromBrief,
  outcomeOf,
  type BattleBrief,
  type BattleOutcome,
  type Contract,
} from '../src/core/campaign/index.js';
import { progressOf } from '../src/core/rules/objective.js';
import { runOn } from '../src/sim/autoBattle.js';

/**
 * Звено нанимателя (шаг 73b): опция штурма, сила не выше половины противника,
 * деньги и трофеи урезаны, машины союзника — не роты ни в каком смысле.
 */

function sampleBoard(): Contract[] {
  const state = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count && out.length < 3000; i += 2) {
    for (const { contract } of judgedContracts(
      state.worldSeed,
      state.deltas,
      GALAXY.id(i),
      0,
      state.reputation,
      state.war,
    )) {
      out.push(contract);
    }
  }
  return out;
}

const BOARD = sampleBoard();
const WITH_ALLIES = BOARD.filter((c) => c.allies !== undefined);
const START = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
const LANCE = START.company.mechs;
const COMPANY = LANCE.map((record) => ({
  record,
  pilot: START.company.pilots.find((p) => p.id === record.pilotId) as (typeof START.company.pilots)[number],
}));

describe('звено нанимателя на бирже', () => {
  it('бывает только у штурма, и примерно с шансом allyChance', () => {
    expect(WITH_ALLIES.length).toBeGreaterThan(20);
    for (const c of WITH_ALLIES) expect(c.mission).toBe('assault');
    const assaults = BOARD.filter((c) => c.mission === 'assault');
    const withShare = assaults.filter((c) => c.allies !== undefined).length / assaults.length;
    // Звена нет, если даже одна машина сильнее половины противника (противник в одну машину).
    expect(withShare).toBeLessThanOrEqual(CONTRACTS.missions.assault.allyChance + 0.05);
    expect(withShare).toBeGreaterThan(CONTRACTS.missions.assault.allyChance / 2);
  });

  it('сила звена не выше половины противника — тем же числом, что на карточке', () => {
    for (const c of WITH_ALLIES) {
      const a = c.allies!;
      expect(a.units).toBeGreaterThanOrEqual(1);
      expect(a.units).toBeLessThanOrEqual(Math.floor(c.opforUnits / 2));
      expect(a.share).toBeLessThanOrEqual(CONTRACTS.allies.maxShare);
      expect(alliesSimpleThreat(c) / contractSimpleThreat(c)).toBeCloseTo(a.share, 2);
    }
  });

  it('бросок мимо шанса — звена нет', () => {
    expect(alliesFor(0.99, 'assault', 'davion', 3, 1, 'line', 1, 6)).toBeUndefined();
    expect(alliesFor(0, 'raid', 'davion', 3, 1, 'line', 1, 6)).toBeUndefined();
  });

  it('доля противника для бота и плата за высадку уменьшены на долю звена', () => {
    const c = WITH_ALLIES[0] as Contract;
    expect(companyThreat(c)).toBeCloseTo(contractThreat(c) * (1 - c.allies!.share), 6);
    const { allies: _allies, ...alone } = c;
    expect(landingQuote(c, LANCE, 'standard').fee).toBeLessThanOrEqual(landingQuote(alone, LANCE, 'standard').fee);
    expect(landingQuote(c, LANCE, 'standard').allowance).toBeLessThanOrEqual(landingQuote(alone, LANCE, 'standard').allowance);
    // Подсказка окна высадки показывает именно эту силу: противник за вычетом звена нанимателя.
    expect(landingQuote(c, LANCE, 'standard').theirs).toBeCloseTo(contractSimpleThreat(c) - alliesSimpleThreat(c), 10);
  });
});

/** Брифинг штурма со звеном нанимателя против стартового звена роты. */
function alliedBrief(seed: number): BattleBrief {
  const c = WITH_ALLIES[seed % WITH_ALLIES.length] as Contract;
  return {
    mapSeed: seed * 13 + 5,
    battleSeed: seed,
    map: { biome: c.biome, width: 24, height: 24 },
    company: COMPANY,
    enemy: buildOpfor(c, LANCE, seed),
    allies: buildAllies(c, seed),
  };
}

describe('звено нанимателя в бою', () => {
  it('состав звена — объявленное число машин, в полосе тоннажа противника', () => {
    const c = WITH_ALLIES[0] as Contract;
    const allies = buildAllies(c, 7);
    expect(allies.length).toBe(c.allies!.units);
    const ids = new Set(buildOpfor(c, LANCE, 7).map((p) => p.record.id));
    for (const p of allies) expect(ids.has(p.record.id)).toBe(false);
  });

  it('союзники на стороне роты и помечены; рота встаёт туда же, где без них', () => {
    const brief = alliedBrief(3);
    const state = makeBattleFromBrief(brief);
    const alone = makeBattleFromBrief({ ...brief, allies: [] });
    const allies = state.units.filter((u) => u.ally);
    expect(allies.length).toBe(brief.allies!.length);
    for (const u of allies) expect(u.side).toBe('player');
    for (const u of alone.units) expect(state.requireUnit(u.id).hex).toEqual(u.hex);
  });

  it('последняя машина роты вышла из строя — бой проигран, сколько бы союзников ни стояло', () => {
    const state = makeBattleFromBrief(alliedBrief(4));
    const units = state.units.map((u) => (u.side === 'player' && !u.ally ? { ...u, destroyed: true } : u));
    const p = progressOf(units, 3);
    expect(p.playerActive).toBe(0);
    expect(units.some((u) => u.ally && !u.destroyed)).toBe(true);
  });

  /**
   * ГЛАВНЫЙ СТРАЖ (решение пользователя 2026-09-24): машины нанимателя ни при
   * каких условиях не попадают в трофеи роты, в её потери и в её состав.
   */
  it('выбитый союзник — не трофей, не потеря и не машина роты; на полном бою и быстром расчёте', () => {
    let alliesDown = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const brief = alliedBrief(seed);
      const allyIds = new Set(brief.allies!.map((p) => p.record.id));
      const companyIds = new Set(brief.company.map((p) => p.record.id));

      const full = runOn(makeBattleFromBrief(brief), { seed, maxTurns: 40 }).outcome;
      const fast = fastResolve(brief);
      for (const outcome of [full, fast] as BattleOutcome[]) {
        // Союзник, которого выбили, — для проверки нужен хоть один такой.
        alliesDown += outcome.units.filter((u) => u.unit.ally && u.unit.destroyed).length;
        for (const held of [true, false]) {
          const trophies = collectTrophies(brief, outcome, held);
          for (const t of trophies) expect(allyIds.has(t.id)).toBe(false);
          const result = debrief({ brief, outcome: { ...outcome, heldField: held }, rng: new CampaignRngSet(seed) });
          for (const id of result.lostRecordIds) {
            expect(allyIds.has(id)).toBe(false);
            expect(companyIds.has(id)).toBe(true);
          }
          for (const r of result.company) expect(allyIds.has(r.id)).toBe(false);
          for (const t of result.trophies) expect(allyIds.has(t.id)).toBe(false);
        }
      }
    }
    expect(alliesDown).toBeGreaterThan(0);
  });

  it('исход по списку машин: союзники в строю роты не держат поле', () => {
    const state = makeBattleFromBrief(alliedBrief(5));
    const units = state.units.map((u) => (u.side === 'player' && !u.ally ? { ...u, destroyed: true } : u));
    expect(outcomeOf(units).winner).toBe('opfor');
  });
});

describe('звено нанимателя на экране боя', () => {
  /**
   * Экран ведёт союзников тем же проходом бота, что и противника
   * (`battle.svelte.ts::stepBotSide`): игрок жмёт только «конец фазы», его
   * машины стоят, а звено нанимателя ходит само.
   */
  it('союзники ходят сами, машины роты без приказа стоят, командовать союзником нельзя', async () => {
    const { battle } = await import('../src/ui/state/battle.svelte.js');
    const { battleUnitId } = await import('../src/core/campaign/index.js');
    const brief = alliedBrief(6);
    battle.startFromBrief(brief);
    battle.botSpeed = 0;
    const allyIds = new Set(brief.allies!.map((p) => battleUnitId('player', p.record.id)));
    const where = () => new Map(battle.scene.units.map((u) => [u.id, `${u.col},${u.row},${u.destroyed}`]));
    const start = where();
    const own = battle.ownUnits.map((u) => u.id);
    // Сборка боя запускает ход бота, не дожидаясь его (`botIfFirst`), а пока бот
    // думает, «конец фазы» молча ничего не делает. Под нагрузкой полного прогона
    // это съедало все шаги теста.
    const idle = async (): Promise<void> => {
      while (battle.botThinking) await new Promise((r) => setTimeout(r, 0));
    };
    for (let i = 0; i < 6 && !battle.finished; i++) {
      await idle();
      await battle.endPhase();
    }
    await idle();
    const end = where();

    expect([...allyIds].some((id) => end.get(id) !== start.get(id))).toBe(true);
    for (const id of own) expect(end.get(id)).toBe(start.get(id));
    // Список машин под командой игрока — только рота.
    expect(battle.ownUnits.every((u) => !allyIds.has(u.id))).toBe(true);
    const sample = battle.ownUnits[0]!;
    expect(battle.commands(sample)).toBe(true);
    expect(battle.commands({ ...sample, ally: true })).toBe(false);
  });
});
