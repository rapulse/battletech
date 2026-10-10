import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  bordersOf,
  borderShare,
  conquestOf,
  decayConquests,
  domainCapitalIndex,
  domainWorlds,
  execute,
  frontSectors,
  frontShares,
  frontWeights,
  growthOf,
  liveEnmity,
  ownerOf,
  pactHolds,
  pactOf,
  peaceOutcome,
  peaceTerms,
  playerWarOf,
  playerWarTick,
  politicalActor,
  relationOf,
  signPact,
  theaterOf,
  threatOf,
  withConquest,
  withPlayerWar,
  withRelation,
  withStanding,
  withTheater,
  worldDiplomacy,
  type PlayerWar,
  type WarState,
} from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Дипломатия ИИ (шаг 83): угроза по памяти захватов, второй фронт, торговля, коалиция и объявление
 * войны державе роты по угрозе с целью вернуть миры.
 */

const D = WAR.diplomacy;
const P = WAR.playerWar;

function conquer(war: WarState, attacker: string, defender: string, n: number): WarState {
  let next = war;
  for (let k = 0; k < n; k++) next = withConquest(next, attacker, defender);
  return next;
}

describe('угроза (шаг 83)', () => {
  it('растёт от захватов и тает без них; истаявшая память снимается', () => {
    const s = new CampaignState(1);
    const borders = bordersOf(s.deltas);
    let war = conquer(s.war, 'liao', 'davion', 5);
    expect(conquestOf(war, 'liao', 'davion')).toBe(5);
    expect(growthOf(war).get('liao')).toBe(5);

    const before = threatOf(war, borders, growthOf(war), 'davion', 'liao');
    expect(before).toBeGreaterThan(0);
    // Ещё захват — угроза выше; у того, с кем Лиао не граничит, угрозы нет вовсе.
    const more = withConquest(war, 'liao', 'davion');
    expect(threatOf(more, borders, growthOf(more), 'davion', 'liao')).toBeGreaterThan(before);
    const far = [...FACTIONS.keys()].find((f) => politicalActor(f) && borderShare(borders, 'liao', f) === 0) as string;
    expect(threatOf(war, borders, growthOf(war), far, 'liao')).toBe(0);

    war = decayConquests(war);
    expect(conquestOf(war, 'liao', 'davion')).toBeCloseTo(5 * D.conquestDecay, 4);
    expect(threatOf(war, borders, growthOf(war), 'davion', 'liao')).toBeLessThan(before);
    for (let k = 0; k < 200; k++) war = decayConquests(war);
    expect(war.conquests).toEqual({});
  });

  it('растущий пугает всех соседей, каждого по доле своей границы', () => {
    const s = new CampaignState(1);
    const borders = bordersOf(s.deltas);
    const war = conquer(s.war, 'liao', 'davion', 10);
    const growth = growthOf(war);
    const neighbours = [...(borders.touching.get('liao')?.keys() ?? [])].filter(politicalActor);
    expect(neighbours.length).toBeGreaterThan(1);
    for (const n of neighbours) expect(threatOf(war, borders, growth, n, 'liao')).toBeGreaterThan(0);
  });

  it('взятый фронтом мир попадает в память захватов', () => {
    const s = new CampaignState(1);
    let captured = 0;
    for (let tick = 1; tick <= 30 && captured === 0; tick++) {
      if (!execute(s, { kind: 'advanceTo', day: tick * WAR.front.tickDays }).ok) throw new Error('такт не прошёл');
      captured = Object.keys(s.war.conquests).length;
    }
    expect(captured).toBeGreaterThan(0);
  });
});

describe('второй фронт (шаг 83)', () => {
  /** Дэвион, у которого враг перевешивает театром на двух направлениях. */
  function twoFronts(): { s: CampaignState; shares: ReturnType<typeof frontShares>; a: string; b: string } {
    const s = new CampaignState(1);
    const shares = frontShares(frontWeights(frontSectors(s.war, s.reputation, s.deltas, s.day)));
    const dirs = Object.keys(shares['davion'] ?? {}).filter(politicalActor).sort();
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = dirs as [string, string];
    let war = s.war;
    for (const e of [a, b]) {
      war = withTheater(war, 'davion', e, 10);
      war = withTheater(war, e, 'davion', 100);
      s.reputation = withRelation(s.reputation, 'davion', e, -0.5);
    }
    s.war = war;
    return { s, shares, a, b };
  }

  it('держава, которой враг перевешивает на двух направлениях, покупает мир у того, кто взял больше', () => {
    const { s, shares, a, b } = twoFronts();
    s.war = conquer(conquer(s.war, a, 'davion', 2), b, 'davion', 4);
    expect(theaterOf(s.war, b, 'davion')).toBeGreaterThan(theaterOf(s.war, 'davion', b));
    const r = worldDiplomacy(s.war, s.reputation, s.deltas, s.worldSeed, s.day, shares);
    expect(r.moves).toContainEqual({ kind: 'pact', over: 'davion', under: b, pact: 'truce' });
    expect(pactHolds(r.war, 'davion', b, 'truce', s.day)).toBe(true);
    expect(pactOf(r.war, 'davion', a)).toBeUndefined();
  });

  it('без потерянных миров перевес по машинам мира не требует; перемирие уже есть — второго нет', () => {
    const { s, shares, a, b } = twoFronts();
    const quiet = worldDiplomacy(s.war, s.reputation, s.deltas, s.worldSeed, s.day, shares);
    expect(quiet.moves.some((m) => m.over === 'davion' && m.pact === 'truce')).toBe(false);

    s.war = conquer(conquer(s.war, a, 'davion', 2), b, 'davion', 4);
    const third = [...FACTIONS.keys()].find((f) => politicalActor(f) && f !== 'davion' && f !== a && f !== b) as string;
    s.war = signPact(s.war, s.reputation, 'davion', third, 'truce', s.day).war;
    const busy = worldDiplomacy(s.war, s.reputation, s.deltas, s.worldSeed, s.day, shares);
    expect(busy.moves.some((m) => m.over === 'davion' && m.kind === 'pact' && m.pact === 'truce')).toBe(false);
  });
});

describe('торговля и коалиция ИИ (шаг 83)', () => {
  /** Пара соседей с политикой; отношение ставится явно. */
  function neighbours(s: CampaignState): [string, string] {
    const borders = bordersOf(s.deltas);
    for (const a of [...borders.touching.keys()].sort()) {
      if (!politicalActor(a)) continue;
      for (const b of [...(borders.touching.get(a)?.keys() ?? [])].sort()) {
        if (b > a && politicalActor(b)) return [a, b];
      }
    }
    throw new Error('нет пары соседей');
  }

  it('мирные соседи подписывают торговый договор с шансом от отношения; ниже порога — никогда', () => {
    const s = new CampaignState(1);
    const [a, b] = neighbours(s);
    const empty = { ...s.war, pacts: {} };
    const tryDays = (relation: number): number => {
      const rep = withRelation(s.reputation, a, b, relation);
      let signed = 0;
      for (let k = 0; k < 400; k++) {
        const r = worldDiplomacy(empty, rep, s.deltas, s.worldSeed, s.day + k * WAR.front.tickDays, {});
        if (r.moves.some((m) => m.kind === 'pact' && m.pact === 'trade' && m.over === a && m.under === b)) signed++;
      }
      return signed;
    };
    expect(tryDays(D.tradeMinRelation - 0.05)).toBe(0);
    const high = tryDays(1);
    // Шанс при отношении 1 — tradeChanceMax за декаду: на 400 попытках около 20.
    expect(high).toBeGreaterThan(400 * D.tradeChanceMax * 0.4);
    expect(high).toBeLessThan(400 * D.tradeChanceMax * 2);
  });

  it('те, кому угрожает один сосед, сближаются, а враждующие между собой подписывают перемирие', () => {
    const s = new CampaignState(1);
    const borders = bordersOf(s.deltas);
    // Растущий j с двумя соседями, между которыми живая вражда.
    let found: { j: string; a: string; b: string } | undefined;
    for (const j of ['liao', 'kurita', 'marik', 'steiner', 'davion']) {
      const ns = [...(borders.touching.get(j)?.keys() ?? [])].filter(politicalActor).sort();
      for (let x = 0; x < ns.length && found === undefined; x++) {
        for (let y = x + 1; y < ns.length && found === undefined; y++) {
          const a = ns[x] as string;
          const b = ns[y] as string;
          if (liveEnmity(s.reputation, a, b) >= WAR.front.minEnmity) found = { j, a, b };
        }
      }
      if (found !== undefined) break;
    }
    if (found === undefined) throw new Error('нет тройки для коалиции');
    const { j, a, b } = found;
    s.reputation = withRelation(s.reputation, a, b, -0.5);
    s.war = conquer({ ...s.war, pacts: {} }, j, a, 200);
    const growth = growthOf(s.war);
    expect(threatOf(s.war, borders, growth, a, j)).toBeGreaterThanOrEqual(D.threatMin);
    expect(threatOf(s.war, borders, growth, b, j)).toBeGreaterThanOrEqual(D.threatMin);

    const r = worldDiplomacy(s.war, s.reputation, s.deltas, s.worldSeed, s.day, {});
    const pair = [a, b].sort() as [string, string];
    expect(r.moves).toContainEqual({ kind: 'coalition', over: pair[0], under: pair[1], pact: 'truce', against: j });
    expect(pactHolds(r.war, a, b, 'truce', s.day)).toBe(true);
    // Угроза роняет отношение к растущему.
    expect(relationOf(r.reputation, a, j)).toBeLessThan(relationOf(s.reputation, a, j));
  });
});

describe('ИИ объявляет войну державе по угрозе (шаг 83)', () => {
  function makeUi(): CampaignUi {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    return ui;
  }

  /** Держава из двух миров Дома с соседом-Домом `foe`; столица — второй мир (как в `playerWar.test.ts`). */
  function realm(ui: CampaignUi): { foe: string } {
    const buy = (i: number): boolean => {
      const owner = ownerOf(ui.state.deltas, i);
      ui.state.systemId = GALAXY.id(i);
      ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
      ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
      return ui.run({ kind: 'buyWorld' });
    };
    for (let i = 0; i < GALAXY.count; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const owner = ownerOf(ui.state.deltas, i);
      if (FACTIONS.get(owner)?.kind !== 'house') continue;
      const foe = GALAXY.neighbors(i)
        .map((j) => ownerOf(ui.state.deltas, j))
        .find((o) => o !== owner && FACTIONS.get(o)?.kind === 'house');
      if (foe === undefined) continue;
      const second = GALAXY.neighbors(i).find((j) => !GALAXY.hasFlag(j, 'capital') && ownerOf(ui.state.deltas, j) === owner);
      if (second === undefined || !buy(i) || !buy(second)) continue;
      ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + (ui.realmPrices?.capital ?? 0) };
      if (domainCapitalIndex(ui.state.deltas) !== second) ui.run({ kind: 'moveCapital', systemId: GALAXY.id(second) });
      return { foe };
    }
    throw new Error('нет подходящей пары миров');
  }

  /** Держава «взяла» у соседа столько миров, что угроза от неё — выше порога объявления. */
  function menace(ui: CampaignUi, foe: string): void {
    const s = ui.state;
    s.war = conquer(s.war, PLAYER_ACTOR_ID, foe, 200);
    const borders = bordersOf(s.deltas);
    expect(threatOf(s.war, borders, growthOf(s.war), foe, PLAYER_ACTOR_ID)).toBeGreaterThanOrEqual(P.aiDeclareThreat);
  }

  it('сосед, которому держава угрожает и который сильнее на границе, объявляет войну с целью вернуть миры', () => {
    const ui = makeUi();
    const { foe } = realm(ui);
    menace(ui, foe);
    const s = ui.state;
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(tick.moves).toContainEqual({ kind: 'war', over: foe, under: PLAYER_ACTOR_ID });
    const goal = playerWarOf(tick.war, foe)?.foeGoal ?? [];
    expect(goal.length).toBeGreaterThan(0);
    expect(goal.length).toBeLessThanOrEqual(P.goalWorldsMax);
    const capital = domainCapitalIndex(s.deltas);
    for (const id of goal) {
      const i = GALAXY.require(id);
      expect(ownerOf(s.deltas, i)).toBe(PLAYER_ACTOR_ID);
      expect(i).not.toBe(capital);
      expect(GALAXY.neighbors(i).some((j) => ownerOf(s.deltas, j) === foe)).toBe(true);
    }
  });

  it('не объявляет под перемирием и под торговым договором; без угрозы не объявляет', () => {
    for (const kind of ['truce', 'trade'] as const) {
      const ui = makeUi();
      const { foe } = realm(ui);
      menace(ui, foe);
      const s = ui.state;
      s.war = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, foe, kind, s.day).war;
      const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
      expect(tick.moves.some((m) => m.kind === 'war' && m.over === foe)).toBe(false);
    }
    const ui = makeUi();
    const { foe } = realm(ui);
    const s = ui.state;
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(tick.moves.some((m) => m.kind === 'war' && m.over === foe)).toBe(false);
  });

  it('держава, уставшая сильнее фракции, получает мир без отступных и отдаёт миры цели', () => {
    const ui = makeUi();
    const { foe } = realm(ui);
    menace(ui, foe);
    const s = ui.state;
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    s.war = tick.war;
    s.reputation = tick.reputation;
    const rec = playerWarOf(s.war, foe) as PlayerWar;
    const goal = rec.foeGoal ?? [];
    s.war = withPlayerWar(s.war, foe, { ...rec, since: s.day - P.minWarDays });
    // Устала от порога, но меньше фракции — цель не выдаётся.
    s.war = withPlayerWar(s.war, foe, { ...(playerWarOf(s.war, foe) as PlayerWar), fatigue: P.fatigueThreshold, foeFatigue: 0.9 });
    expect(peaceOutcome(s.war, s.deltas, foe, false).ceded).toEqual([]);
    // Сильнее фракции — мир на её цели.
    s.war = withPlayerWar(s.war, foe, { ...(playerWarOf(s.war, foe) as PlayerWar), fatigue: 0.8, foeFatigue: 0.1 });
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'free', offered: false, yields: true });
    expect(peaceOutcome(s.war, s.deltas, foe, false).ceded).toEqual(goal);

    const worlds = domainWorlds(s.deltas).length;
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    for (const id of goal) expect(ownerOf(ui.state.deltas, GALAXY.require(id))).toBe(foe);
    expect(domainWorlds(ui.state.deltas).length).toBe(worlds - goal.length);
    expect(playerWarOf(ui.state.war, foe)).toBeUndefined();
  });
});
