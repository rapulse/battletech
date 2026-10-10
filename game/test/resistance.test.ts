import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  bordersOf,
  domainCapitalIndex,
  foeOffensives,
  growthOf,
  loyaltyPressure,
  loyaltyTick,
  ownerOf,
  playerWarOf,
  playerWarTick,
  realmAlarm,
  signPact,
  standingOf,
  threatOf,
  withConquest,
  withDelta,
  withStanding,
  withTheater,
  makeSaveFile,
  parseSaveFile,
  restore,
  snapshot,
  withEconomy,
  theaterOf,
  borderForce,
  economyOf,
  withPlayerWar,
  withFund,
  type CampaignState,
  type WarState,
} from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Сопротивление растущей державе (шаг 91): тревога соседей, коалиция одновременными войнами, подстрекательство
 * прежнего владельца и меры против него, наступление фракции на миры державы.
 */

const R = WAR.resistance;
const P = WAR.playerWar;

function makeUi(): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  return ui;
}

/**
 * Держава из двух купленных миров Дома `seller`, у первого из которых сосед — другой Дом `foe`; столица — второй мир
 * (как в `playerWar.test.ts`). Оба соседа ведут политику.
 */
function realm(ui: CampaignUi): { home: number; second: number; seller: string; foe: string } {
  const buy = (i: number): boolean => {
    const owner = ownerOf(ui.state.deltas, i);
    ui.state.systemId = GALAXY.id(i);
    ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
    return ui.run({ kind: 'buyWorld' });
  };
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const seller = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(seller)?.kind !== 'house') continue;
    const foe = GALAXY.neighbors(i)
      .map((j) => ownerOf(ui.state.deltas, j))
      .find((o) => o !== seller && FACTIONS.get(o)?.kind === 'house');
    if (foe === undefined) continue;
    const second = GALAXY.neighbors(i).find((j) => !GALAXY.hasFlag(j, 'capital') && ownerOf(ui.state.deltas, j) === seller);
    if (second === undefined || !buy(i) || !buy(second)) continue;
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + (ui.realmPrices?.capital ?? 0) };
    if (domainCapitalIndex(ui.state.deltas) !== second) ui.run({ kind: 'moveCapital', systemId: GALAXY.id(second) });
    return { home: i, second, seller, foe };
  }
  throw new Error('нет подходящей пары миров');
}

/** Держава «взяла» у `foe` столько миров, что угроза от неё каждому из `who` — не ниже `min`. */
function grow(s: CampaignState, foe: string, who: readonly string[], min: number): void {
  for (let n = 0; n < 400; n++) {
    const borders = bordersOf(s.deltas);
    const growth = growthOf(s.war);
    if (who.every((f) => threatOf(s.war, borders, growth, f, PLAYER_ACTOR_ID) >= min)) return;
    s.war = withConquest(s.war, PLAYER_ACTOR_ID, foe);
  }
  throw new Error('угроза не набралась');
}

function threat(war: WarState, s: CampaignState, f: string): number {
  return threatOf(war, bordersOf(s.deltas), growthOf(war), f, PLAYER_ACTOR_ID);
}

describe('тревога соседей (шаг 91)', () => {
  it('растущая держава роняет отношение соседа: alarmStanding × угроза, не больше потолка; договор и война — ноль', () => {
    const ui = makeUi();
    const { foe } = realm(ui);
    const s = ui.state;
    expect(realmAlarm(s.war, bordersOf(s.deltas), growthOf(s.war), foe)).toBe(0);
    grow(s, foe, [foe], R.alarmMin);
    const t = threat(s.war, s, foe);
    const alarm = realmAlarm(s.war, bordersOf(s.deltas), growthOf(s.war), foe);
    expect(alarm).toBeCloseTo(Math.min(R.alarmStandingMax, R.alarmStanding * t), 10);
    expect(alarm).toBeGreaterThan(0);

    const before = standingOf(s.reputation, foe);
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    if (playerWarOf(tick.war, foe) === undefined) {
      expect(standingOf(tick.reputation, foe)).toBeCloseTo(before - alarm, 2);
    }

    for (const kind of ['truce', 'trade'] as const) {
      const signed = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, foe, kind, s.day).war;
      expect(realmAlarm(signed, bordersOf(s.deltas), growthOf(signed), foe)).toBe(0);
    }
    expect(ui.realmNeighbours.find((n) => n.factionId === foe)?.alarm).toBeCloseTo(alarm, 10);
  });
});

describe('коалиция против державы (шаг 91)', () => {
  it('враждебные и встревоженные соседи объявляют войну в один такт, каждый свою, с целью', () => {
    const ui = makeUi();
    const { seller, foe } = realm(ui);
    const s = ui.state;
    grow(s, foe, [seller, foe], R.coalitionThreat);
    // Ниже порога коалиции, но выше порога одиночного объявления по отношению.
    const hostile = (R.coalitionStanding + P.aiDeclareStanding) / 2;
    for (const f of [seller, foe]) s.reputation = withStanding(s.reputation, f, hostile - standingOf(s.reputation, f));
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    const wars = tick.moves.filter((m) => m.kind === 'war' && m.under === PLAYER_ACTOR_ID);
    expect(wars.map((m) => m.over).sort()).toEqual([seller, foe].sort());
    // Ведущий — первый; второй вступает вслед за ним.
    const [first, next] = [...wars].sort((a, b) => (a.leader === undefined ? -1 : b.leader === undefined ? 1 : 0));
    expect(first?.leader).toBeUndefined();
    expect(next?.leader).toBe(first?.over);
    for (const f of [seller, foe]) expect((playerWarOf(tick.war, f)?.foeGoal ?? []).length).toBeGreaterThan(0);
  });

  it('договор выводит соседа из коалиции; одному без чужого объявления её не собрать', () => {
    const ui = makeUi();
    const { seller, foe } = realm(ui);
    const s = ui.state;
    grow(s, foe, [seller, foe], R.coalitionThreat);
    const hostile = (R.coalitionStanding + P.aiDeclareStanding) / 2;
    for (const f of [seller, foe]) s.reputation = withStanding(s.reputation, f, hostile - standingOf(s.reputation, f));
    s.war = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, seller, 'trade', s.day).war;
    expect(R.coalitionMin).toBeGreaterThan(1);
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    // Угроза ниже порога объявления по угрозе — иначе сосед объявил бы и один.
    if (threat(s.war, s, foe) < P.aiDeclareThreat) {
      expect(tick.moves.some((m) => m.kind === 'war')).toBe(false);
    }
  });
});

describe('подстрекательство и меры против него (шаг 91)', () => {
  it('враждебный прежний владелец у границы тянет лояльность вниз; торговый договор гасит, перемирие — нет', () => {
    const ui = makeUi();
    const { home, foe } = realm(ui);
    const s = ui.state;
    const id = GALAXY.id(home);
    s.deltas = withDelta(s.deltas, id, { formerOwner: foe, loyalty: 50 });
    expect(loyaltyPressure(s.deltas, s.war, s.reputation, id, s.day)).toBeNull();

    s.reputation = withStanding(s.reputation, foe, R.inciteStanding - standingOf(s.reputation, foe));
    expect(loyaltyPressure(s.deltas, s.war, s.reputation, id, s.day)).toBe('incite');
    const drifted = loyaltyTick(s.deltas, s.war, s.reputation, s.day).deltas[id]?.loyalty ?? 0;
    const base = loyaltyTick(s.deltas, s.war, withStanding(s.reputation, foe, 50), s.day).deltas[id]?.loyalty ?? 0;
    expect(base - drifted).toBeCloseTo(WAR.loyalty.growth + R.inciteDecay, 2);

    const truce = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, foe, 'truce', s.day).war;
    expect(loyaltyPressure(s.deltas, truce, s.reputation, id, s.day)).toBe('incite');
    const trade = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, foe, 'trade', s.day).war;
    expect(loyaltyPressure(s.deltas, trade, s.reputation, id, s.day)).toBeNull();

    expect(ui.realmWorlds.find((w) => w.id === id)?.loyaltyPressure).toBe('incite');
  });

  it('благосостояние: ступень развития выше канона прибавляет к дрейфу всегда', () => {
    const ui = makeUi();
    const { home } = realm(ui);
    const s = ui.state;
    const id = GALAXY.id(home);
    s.deltas = withDelta(s.deltas, id, { loyalty: 50 });
    const flat = loyaltyTick(s.deltas, s.war, s.reputation, s.day).deltas[id]?.loyalty ?? 0;
    const developed = withDelta(s.deltas, id, { development: 2 });
    expect(loyaltyTick(developed, s.war, s.reputation, s.day).deltas[id]?.loyalty).toBeCloseTo(flat + 2 * R.welfarePerStep, 2);
  });
});

describe('наступление фракции на миры державы (шаг 91)', () => {
  it('враг с театром бьёт по своему бывшему миру у границы; откат — foeOrderDecades декад; без театра и при малом шансе — нет', () => {
    const ui = makeUi();
    const { home, foe } = realm(ui);
    const s = ui.state;
    const id = GALAXY.id(home);
    s.deltas = withDelta(s.deltas, id, { formerOwner: foe });
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(foeOffensives(s.war, s.reputation, s.deltas, s.worldSeed, s.day).clashes).toEqual([]);

    // Театр в одну машину — шанс ниже порога стойки: на защищённый мир фракция не лезет.
    s.war = withTheater(s.war, foe, PLAYER_ACTOR_ID, 1);
    expect(foeOffensives(s.war, s.reputation, s.deltas, s.worldSeed, s.day).clashes).toEqual([]);

    // Шанс поднимают и театр, и напор — фонд против державы.
    s.war = withFund(withTheater(s.war, foe, PLAYER_ACTOR_ID, 600), foe, PLAYER_ACTOR_ID, 1e10);
    const r = foeOffensives(s.war, s.reputation, s.deltas, s.worldSeed, s.day);
    expect(r.clashes).toHaveLength(1);
    const c = r.clashes[0];
    expect(c?.systemId).toBe(id);
    expect(c?.attacker).toBe(foe);
    expect(c?.defender).toBe(PLAYER_ACTOR_ID);
    expect(c?.odds ?? 0).toBeGreaterThanOrEqual(WAR.realm.stanceMinOdds);
    const rec = playerWarOf(r.war, foe);
    expect(rec?.lastFoeOffensive).toBe(s.day);
    expect(ownerOf(r.deltas, home)).toBe(c?.outcome === 'captured' ? foe : PLAYER_ACTOR_ID);
    expect(rec?.lost).toBe(c?.outcome === 'captured' ? 1 : 0);
    // Тот же сид — тот же исход.
    expect(foeOffensives(s.war, s.reputation, s.deltas, s.worldSeed, s.day).clashes).toEqual(r.clashes);

    const soon = foeOffensives(r.war, r.reputation, r.deltas, s.worldSeed, s.day + (R.foeOrderDecades - 1) * WAR.front.tickDays);
    expect(soon.clashes).toEqual([]);
  });
});

describe('война, объявленная ИИ (шаг 92)', () => {
  /** Сосед `foe` на пороге объявления по отношению; армия державы — `army` машин в резерве. */
  function hostile(army: number): { s: CampaignState; foe: string } {
    const ui = makeUi();
    const { foe } = realm(ui);
    const s = ui.state;
    s.reputation = withStanding(s.reputation, foe, P.aiDeclareStanding - standingOf(s.reputation, foe));
    s.war = withEconomy(s.war, PLAYER_ACTOR_ID, { army });
    return { s, foe };
  }

  it('по отношению объявляет только сосед, не слабее державы на границе; слабый копит обиду', () => {
    const strong = hostile(0);
    expect(playerWarOf(playerWarTick(strong.s.war, strong.s.reputation, strong.s.deltas, strong.s.day).war, strong.foe)).toBeDefined();

    const weak = hostile(1_000_000);
    const b = bordersOf(weak.s.deltas);
    expect(borderForce(weak.s.war, b, weak.foe, PLAYER_ACTOR_ID)).toBeLessThan(
      R.standingWarForce * borderForce(weak.s.war, b, PLAYER_ACTOR_ID, weak.foe),
    );
    const tick = playerWarTick(weak.s.war, weak.s.reputation, weak.s.deltas, weak.s.day);
    expect(playerWarOf(tick.war, weak.foe)).toBeUndefined();
    expect(standingOf(tick.reputation, weak.foe)).toBeLessThanOrEqual(P.aiDeclareStanding);
  });

  it('объявивший с целью в тот же день выводит к границе declareMuster × силу державы — из резерва', () => {
    const { s, foe } = hostile(40);
    const b = bordersOf(s.deltas);
    const want = Math.round(R.declareMuster * borderForce(s.war, b, PLAYER_ACTOR_ID, foe));
    expect(want).toBeGreaterThan(0);
    const reserve = economyOf(s.war, foe).army;
    const before = theaterOf(s.war, foe, PLAYER_ACTOR_ID);
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(playerWarOf(tick.war, foe)?.foeGoal).toBeDefined();
    const moved = Math.min(reserve, Math.max(0, want - before));
    expect(theaterOf(tick.war, foe, PLAYER_ACTOR_ID)).toBe(before + moved);
    expect(economyOf(tick.war, foe).army).toBe(reserve - moved);
  });

  it('в войне, объявленной фракцией, она бьёт каждые declaredOrderDecades декад; в войне державы — раз в foeOrderDecades', () => {
    const ui = makeUi();
    const { home, foe } = realm(ui);
    const s = ui.state;
    const id = GALAXY.id(home);
    s.deltas = withDelta(s.deltas, id, { formerOwner: foe });
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    s.war = withFund(withTheater(s.war, foe, PLAYER_ACTOR_ID, 600), foe, PLAYER_ACTOR_ID, 1e10);
    const rec = playerWarOf(s.war, foe);
    if (rec === undefined) throw new Error('войны нет');
    const next = s.day + R.declaredOrderDecades * WAR.front.tickDays;
    expect(R.declaredOrderDecades).toBeLessThan(R.foeOrderDecades);
    // Войну объявила держава — у фракции цели нет, откат общий.
    const ours = withPlayerWar(s.war, foe, { ...rec, lastFoeOffensive: s.day });
    expect(foeOffensives(ours, s.reputation, s.deltas, s.worldSeed, next).clashes).toEqual([]);
    // Войну объявила фракция (у неё есть цель) — следующий удар через declaredOrderDecades.
    const { byRealm: _byRealm, ...declaredByFoe } = rec;
    const theirs = withPlayerWar(s.war, foe, { ...declaredByFoe, foeGoal: [id], lastFoeOffensive: s.day });
    expect(foeOffensives(theirs, s.reputation, s.deltas, s.worldSeed, next).clashes).toHaveLength(1);
  });
});

describe('сохранение (шаг 92)', () => {
  it('запись войны без lastFoeOffensive (снимок версии 25) читается, с ним — переживает сохранение и загрузку', () => {
    const ui = makeUi();
    const { foe } = realm(ui);
    const s = ui.state;
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    const old = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(playerWarOf(old.war, foe)?.lastFoeOffensive).toBeUndefined();

    const rec = playerWarOf(s.war, foe);
    if (rec === undefined) throw new Error('войны нет');
    s.war = withPlayerWar(s.war, foe, { ...rec, lastFoeOffensive: s.day });
    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(playerWarOf(back.war, foe)?.lastFoeOffensive).toBe(s.day);
  });
});
