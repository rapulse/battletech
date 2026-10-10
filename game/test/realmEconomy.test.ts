import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  economyOf,
  execute,
  makeCompany,
  ownerOf,
  playerWarOf,
  realmArmyCap,
  realmArmyUpkeep,
  syncDomainEconomy,
  tributeFlows,
  withDelta,
  withEconomy,
  withPact,
  withPlayerWar,
  withTheater,
  worldContributionAt,
} from '../src/core/campaign/index.js';

/**
 * Экономика армии державы (шаг 90, ступень 8): содержание со скидками построек, учебный
 * лагерь в потолке армии, космопорты в доле торговых договоров, трофеи захвата.
 */

const D = WAR.domain;
const B = WAR.buildings;

/** Держава из `worlds` миров Домов не в столицах. */
function realm(worlds = 3): CampaignState {
  const s = new CampaignState(5);
  s.company = { ...makeCompany(), cbills: 1_000_000_000 };
  let taken = 0;
  for (let i = 0; i < GALAXY.count && taken < worlds; i++) {
    if (GALAXY.hasFlag(i, 'capital') || FACTIONS.get(ownerOf(s.deltas, i))?.kind !== 'house') continue;
    s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID, loyalty: 100, formerOwner: ownerOf(s.deltas, i) });
    taken++;
  }
  s.war = syncDomainEconomy(s.war, s.worldSeed, s.deltas, s.company.cbills);
  return s;
}

function mine(s: CampaignState): number[] {
  const out: number[] = [];
  for (let i = 0; i < GALAXY.count; i++) if (ownerOf(s.deltas, i) === PLAYER_ACTOR_ID) out.push(i);
  return out;
}

describe('содержание армии державы (шаг 90, ступень 8)', () => {
  it('каждая машина армии — в резерве и на театре — стоит armyUpkeep за декаду', () => {
    const s = realm();
    s.war = withEconomy(s.war, PLAYER_ACTOR_ID, { army: 20 });
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, 'steiner', 10);
    const u = realmArmyUpkeep(s.war, s.deltas, s.realm);
    expect(u.mechs).toBe(30);
    expect(u.total).toBe(30 * D.armyUpkeep);
  });

  it('казармы и учебный лагерь снимают долю содержания, но не ниже пола', () => {
    const s = realm(3);
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, 'steiner', 10);
    const [a, b] = mine(s) as [number, number];
    s.deltas = withDelta(s.deltas, GALAXY.id(a), { buildings: ['barracks'] });
    s.deltas = withDelta(s.deltas, GALAXY.id(b), { buildings: ['barracks', 'drill'] });
    const u = realmArmyUpkeep(s.war, s.deltas, s.realm);
    expect(u.factor).toBeCloseTo(Math.max(B.armyUpkeepFloor, 1 - 2 * B.barracksUpkeepCut - B.drillUpkeepCut), 10);
    for (const i of mine(s)) s.deltas = withDelta(s.deltas, GALAXY.id(i), { buildings: ['barracks', 'drill'] });
    const many = realmArmyUpkeep(s.war, s.deltas, s.realm);
    expect(many.factor).toBeGreaterThanOrEqual(B.armyUpkeepFloor);
  });

  it('учебный лагерь прибавляет к потолку армии', () => {
    const s = realm(1);
    const capacity = economyOf(s.war, PLAYER_ACTOR_ID).capacity;
    const before = realmArmyCap(s.deltas, capacity);
    s.deltas = withDelta(s.deltas, GALAXY.id(mine(s)[0] as number), { buildings: ['drill'] });
    expect(realmArmyCap(s.deltas, capacity).buildings).toBe(before.buildings + B.drillArmy);
  });
});

describe('космопорты в торговых договорах державы (шаг 90, ступень 8)', () => {
  it('каждый космопорт державы прибавляет spaceportTradeShare к её доле договора', () => {
    const s = realm(2);
    s.war = withPact(s.war, PLAYER_ACTOR_ID, 'steiner', { kind: 'trade', untilDay: s.day + 1000 });
    const income = economyOf(s.war, PLAYER_ACTOR_ID).income;
    const base = tributeFlows(s.war, s.worldSeed, s.deltas, s.day)[PLAYER_ACTOR_ID] ?? 0;
    for (const i of mine(s)) s.deltas = withDelta(s.deltas, GALAXY.id(i), { buildings: ['spaceport'] });
    const ported = tributeFlows(s.war, s.worldSeed, s.deltas, s.day)[PLAYER_ACTOR_ID] ?? 0;
    expect(ported - base).toBe(
      Math.round(income * (WAR.diplomacy.tradeIncomeShare + 2 * B.spaceportTradeShare)) -
        Math.round(income * WAR.diplomacy.tradeIncomeShare),
    );
  });
});

describe('трофеи захвата (шаг 90, ступень 8)', () => {
  it('мир врага, взятый по праву флага, отдаёт кассе captureLootTicks тактов своего дохода', () => {
    const s = realm(1);
    const home = mine(s)[0] as number;
    const target = GALAXY.neighbors(home).find(
      (j) => !GALAXY.hasFlag(j, 'capital') && FACTIONS.get(ownerOf(s.deltas, j))?.kind === 'house',
    );
    if (target === undefined) throw new Error('нет соседа-Дома');
    const foe = ownerOf(s.deltas, target);
    s.war = withPlayerWar(s.war, foe, { since: s.day, won: 0, lost: 0 });
    s.systemId = GALAXY.id(target);
    s.deltas = withDelta(s.deltas, s.systemId, { realmWon: D.conquerWins });
    const loot = Math.round(worldContributionAt(s.worldSeed, s.deltas, target).income * D.captureLootTicks);
    const cash = s.company.cbills;
    const r = execute(s, { kind: 'conquerWorld' });
    expect(r.ok).toBe(true);
    expect(s.company.cbills).toBe(cash + loot);
    expect(r.ok && r.events.find((e) => e.kind === 'worldConquered')).toMatchObject({ loot });
    expect(playerWarOf(s.war, foe)?.won).toBe(1);
  });
});
