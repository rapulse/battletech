import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  blockedOffers,
  domainBorder,
  domainCapitalIndex,
  execute,
  frontTick,
  realmAttackSize,
  withTheater,
  judgedContracts,
  relationOf,
  withRelation,
  frontSectors,
  frontShares,
  frontWeights,
  liveEnmity,
  makeSaveFile,
  notePlayerCapture,
  notePlayerFight,
  ownerOf,
  pactHolds,
  pactOf,
  pactPrice,
  parseSaveFile,
  peaceTerms,
  playerWarOf,
  playerWarTick,
  offensiveCost,
  realmWarFund,
  resolveFrontBattle,
  sectorForces,
  theaterOf,
  withFund,
  signPact,
  snapshot,
  standingOf,
  withDelta,
  withPlayerWar,
  withStanding,
  FACTION_LIST,
  notePlayerLosses,
  peaceOutcome,
  orderLance,
  detachmentFloor,
  availableContracts,
  canSubmit,
  realmBloc,
  withVassal,
  contractBrief,
  recordToUnit,
  CONTRACTS,
  EMPTY_TALLY,
  type BattleOutcome,
  type CampaignState,
  type PlayerWar,
} from '../src/core/campaign/index.js';
import { Direction } from '../src/core/hex/index.js';
import type { MechUnit } from '../src/core/model/index.js';
import { RELATIONS } from '../src/core/campaign/contracts/schema.js';
import { unitToRecord } from '../src/core/campaign/bridge/fromBattle.js';
import { forceParts, strengthOf } from '../src/core/campaign/contracts/power.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { cbills, t } from '../src/ui/i18n/index.js';

/**
 * Война и мир роты (шаг 76): объявление, счёт, условия мира, такт ИИ.
 */

const P = WAR.playerWar;

function makeUi(): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  return ui;
}

function buy(ui: CampaignUi, i: number): boolean {
  const owner = ownerOf(ui.state.deltas, i);
  ui.state.systemId = GALAXY.id(i);
  ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
  ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
  return ui.run({ kind: 'buyWorld' });
}

/**
 * Держава из двух миров одного Дома, у одного из которых сосед — другой Дом:
 * `foe` — тот, кому объявляют войну. Два мира — чтобы было что уступить.
 */
function realmWithHouseNeighbour(ui: CampaignUi): { home: number; second: number; foe: string } {
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    const foe = GALAXY.neighbors(i)
      .map((j) => ownerOf(ui.state.deltas, j))
      .find((o) => o !== owner && FACTIONS.get(o)?.kind === 'house');
    if (foe === undefined) continue;
    const second = GALAXY.neighbors(i).find(
      (j) => !GALAXY.hasFlag(j, 'capital') && ownerOf(ui.state.deltas, j) === owner,
    );
    if (second === undefined) continue;
    if (!buy(ui, i)) continue;
    if (!buy(ui, second)) continue;
    // Столица — второй мир: тогда первый, соседний с врагом, можно уступить.
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + (ui.realmPrices?.capital ?? 0) };
    if (domainCapitalIndex(ui.state.deltas) !== second) ui.run({ kind: 'moveCapital', systemId: GALAXY.id(second) });
    return { home: i, second, foe };
  }
  throw new Error('нет подходящей пары миров');
}

/** Сдвинуть начало войны назад — вместо прокрутки мира, которая меняла бы всё остальное. Цель и прочее — как были. */
function age(state: CampaignState, foe: string, days: number, won = 0, lost = 0): void {
  const rec = playerWarOf(state.war, foe);
  if (rec === undefined) throw new Error('войны нет');
  state.war = withPlayerWar(state.war, foe, { ...rec, since: state.day - days, won, lost });
}

/** Прокрутка на `days` суток с отказом на требования соседа (шаг 89): карточка останавливает время, а тест — о другом. */
function runThrough(ui: CampaignUi, days: number): boolean {
  const end = ui.state.day + days;
  for (;;) {
    if (ui.state.war.demands?.pending !== undefined && !ui.run({ kind: 'answerDemand', accept: false })) return false;
    if (ui.state.day >= end) return true;
    if (!ui.run({ kind: 'advanceTo', day: end })) return false;
  }
}

describe('война роты (шаг 76)', () => {
  it('объявление: фронт в ту же декаду, работа фракции закрыта, запись войны', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    expect(liveEnmity(ui.state.reputation, PLAYER_ACTOR_ID, foe)).toBeLessThan(WAR.front.minEnmity);

    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(liveEnmity(ui.state.reputation, PLAYER_ACTOR_ID, foe)).toBeGreaterThanOrEqual(WAR.front.minEnmity);
    expect(standingOf(ui.state.reputation, foe)).toBeLessThanOrEqual(P.declareStanding);
    expect(playerWarOf(ui.state.war, foe)).toEqual({ since: ui.state.day, won: 0, lost: 0, byRealm: true });
    const sectors = frontSectors(ui.state.war, ui.state.reputation, ui.state.deltas, ui.state.day);
    expect(sectors.some((s) => s.attacker === PLAYER_ACTOR_ID && s.defender === foe)).toBe(true);
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.alreadyAtWar'));
  });

  it('договор войну не пускает, соседство обязательно', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const signed = signPact(ui.state.war, ui.state.reputation, PLAYER_ACTOR_ID, foe, 'truce', ui.state.day);
    ui.state.war = signed.war;
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.warBlocked'));
    const far = [...FACTIONS.keys()].find(
      (f) => FACTIONS.get(f)?.kind === 'house' && !ui.realmNeighbours.some((n) => n.factionId === f),
    ) as string;
    expect(ui.why({ kind: 'declareWar', factionId: far })).toBe(t('reject.notNeighbour'));
  });

  it('ИИ объявляет войну соседу, чьё отношение к роте упало до порога', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    s.reputation = withStanding(s.reputation, foe, P.aiDeclareStanding - standingOf(s.reputation, foe));
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(tick.moves).toContainEqual({ kind: 'war', over: foe, under: PLAYER_ACTOR_ID });
    expect(playerWarOf(tick.war, foe)?.since).toBe(s.day);
    expect(liveEnmity(tick.reputation, PLAYER_ACTOR_ID, foe)).toBeGreaterThanOrEqual(WAR.front.minEnmity);
  });
});

describe('мир роты (шаг 76)', () => {
  it('рано — отказ; ничья — отступные ценой договора; после мира нет фронта и идёт перемирие', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    expect(ui.why({ kind: 'makePeace', factionId: foe })).toBe(t('reject.peaceTooEarly'));

    age(ui.state, foe, P.minWarDays);
    const s = ui.state;
    const price = pactPrice(s.worldSeed, s.deltas);
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'pay', cost: price });
    s.company = { ...s.company, cbills: price };
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(playerWarOf(s.war, foe)).toBeUndefined();
    // Память о войне (шаг 81): вражда не стирается в день мира — фронт держит закрытым перемирие.
    expect(liveEnmity(s.reputation, PLAYER_ACTOR_ID, foe)).toBeGreaterThanOrEqual(WAR.front.minEnmity);
    expect(pactHolds(s.war, PLAYER_ACTOR_ID, foe, 'truce', s.day)).toBe(true);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    expect(sectors.some((x) => [x.attacker, x.defender].includes(PLAYER_ACTOR_ID) && [x.attacker, x.defender].includes(foe))).toBe(false);
    // Перемирие не пускает новую войну до срока.
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.warBlocked'));
  });

  it('рота впереди — мир даром; отстаёт — отступные растут, с двух миров можно уступить мир', () => {
    const ui = makeUi();
    const { home, second, foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    const price = pactPrice(s.worldSeed, s.deltas);

    age(s, foe, P.minWarDays, 1, 0);
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'free', offered: false });
    age(s, foe, P.minWarDays, 0, 1);
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'pay', cost: price * 2 });

    age(s, foe, P.minWarDays, 0, P.cedeFrom);
    const terms = peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day);
    expect(terms).toEqual({ kind: 'pay', cost: price * (1 + P.cedeFrom), cede: GALAXY.id(home) });
    const before = s.company.cbills;
    expect(ui.run({ kind: 'makePeace', factionId: foe, cede: true })).toBe(true);
    expect(s.company.cbills).toBe(before);
    expect(ownerOf(s.deltas, home)).toBe(foe);
    expect(domainCapitalIndex(s.deltas)).toBe(second);
    expect(ui.logs[0]?.text).toContain(GALAXY.name(home));
  });

  it('уставшая фракция сама предлагает мир, и он даром (шаг 81: по усталости, не по счёту)', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 5, 0);
    // Перевес сам по себе мира не приносит: фракция ещё не устала.
    const fresh = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(fresh.moves).not.toContainEqual({ kind: 'peaceOffer', over: foe, under: PLAYER_ACTOR_ID });
    s.war = withPlayerWar(s.war, foe, { ...(playerWarOf(s.war, foe) as PlayerWar), won: 0, foeFatigue: P.fatigueThreshold });
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(tick.moves).toContainEqual({ kind: 'peaceOffer', over: foe, under: PLAYER_ACTOR_ID });
    expect(playerWarOf(tick.war, foe)?.offerUntil).toBe(s.day + P.offerDays);

    // Даром по предложению — даже при равном счёте, пока оно действует.
    s.war = withPlayerWar(tick.war, foe, { since: s.day - P.minWarDays, won: 0, lost: 0, offerUntil: s.day + 1 });
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'free', offered: true });
  });

  it('с вольницей мира нет; без державы записи войн снимаются; сохранение их переносит', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    s.war = withPlayerWar(s.war, 'pirates', { since: s.day - P.minWarDays, won: 0, lost: 0 });
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, 'pirates', s.day)).toEqual({ kind: 'noPolitics' });

    ui.run({ kind: 'declareWar', factionId: foe });
    const back = parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s)))));
    expect(back.war.playerWars?.[foe]).toEqual(playerWarOf(s.war, foe));

    const tick = playerWarTick(s.war, s.reputation, {}, s.day);
    expect(tick.war.playerWars).toBeUndefined();
  });
});

describe('счёт войны роты (шаг 76)', () => {
  it('бой с ротой заводит запись, захват пишется в счёт; бои без роты запись не трогают', () => {
    const ui = makeUi();
    const s = ui.state;
    let war = notePlayerFight(s.war, 'davion', 'kurita', 10);
    expect(war.playerWars).toBeUndefined();
    war = notePlayerFight(war, 'pirates', PLAYER_ACTOR_ID, 10);
    expect(playerWarOf(war, 'pirates')).toEqual({ since: 10, won: 0, lost: 0 });
    war = notePlayerCapture(war, PLAYER_ACTOR_ID, 'pirates', 20, GALAXY.id(1));
    war = notePlayerCapture(war, 'pirates', PLAYER_ACTOR_ID, 30, GALAXY.id(2));
    war = notePlayerCapture(war, PLAYER_ACTOR_ID, 'pirates', 40, GALAXY.id(3));
    // Взятое ротой помнится списком (шаг 81) — из него мир отдаёт лишнее; взятое у роты — только счётом.
    expect(playerWarOf(war, 'pirates')).toEqual({ since: 10, won: 2, lost: 1, taken: [GALAXY.id(1), GALAXY.id(3)] });
  });
});

describe('захват мира врага (шаг 76; право флага — шаг 90)', () => {
  /** Держава воюет с соседом-Домом; рота стоит на его пограничном мире не в столице. */
  function atEnemyWorld(): { ui: CampaignUi; foe: string; target: number } {
    const ui = makeUi();
    const { home, foe } = realmWithHouseNeighbour(ui);
    const target = GALAXY.neighbors(home).find(
      (j) => ownerOf(ui.state.deltas, j) === foe && !GALAXY.hasFlag(j, 'capital'),
    ) as number;
    ui.state.systemId = GALAXY.id(target);
    return { ui, foe, target };
  }

  it('победы роты на самого владельца права флага не дают — ни до войны, ни в войну (notes §10zu п. 4)', () => {
    const { ui, foe, target } = atEnemyWorld();
    const s = ui.state;
    s.deltas = withDelta(s.deltas, GALAXY.id(target), {
      fought: WAR.domain.conquerWins,
      foughtWon: WAR.domain.conquerWins,
      foughtFor: foe,
    });
    expect(ui.why({ kind: 'conquerWorld' })).toBe(t('reject.worldNotConquerable'));
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(ui.why({ kind: 'conquerWorld' })).toBe(t('reject.worldNotConquerable'));
  });

  it('победы работы державы против владельца — право флага: мир берётся и идёт в счёт, а счёт снимается', () => {
    const { ui, foe, target } = atEnemyWorld();
    const s = ui.state;
    const id = GALAXY.id(target);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    s.deltas = withDelta(s.deltas, id, { realmWon: WAR.domain.conquerWins - 1 });
    expect(ui.why({ kind: 'conquerWorld' })).toBe(t('reject.worldNotConquerable'));
    s.deltas = withDelta(s.deltas, id, { realmWon: WAR.domain.conquerWins });
    expect(ui.run({ kind: 'conquerWorld' })).toBe(true);
    expect(ownerOf(s.deltas, target)).toBe(PLAYER_ACTOR_ID);
    expect(playerWarOf(s.war, foe)?.won).toBe(1);
    // Смена владельца снимает счёт: победы над прежним хозяином права на мир нового не дают.
    expect(s.deltas[id]?.realmWon).toBeUndefined();
  });

  it('работа державы на мире врага есть только в войне и не в столице; гонорара нет, наниматель — держава', () => {
    const { ui, foe, target } = atEnemyWorld();
    const s = ui.state;
    const id = GALAXY.id(target);
    const war = (): readonly ReturnType<typeof availableContracts>[number][] =>
      availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).filter((c) => c.warWork === true);
    expect(war()).toHaveLength(0);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    const offers = war();
    expect(offers).toHaveLength(CONTRACTS.board.warWorkOffers);
    for (const c of offers) {
      expect(c.employer).toBe(PLAYER_ACTOR_ID);
      expect(c.target).toBe(foe);
      expect([c.payout, c.advance, c.penalty]).toEqual([0, 0, 0]);
    }
    const capital = [...Array(GALAXY.count).keys()].find(
      (i) => GALAXY.hasFlag(i, 'capital') && ownerOf(s.deltas, i) === foe,
    ) as number;
    expect(
      availableContracts(s.worldSeed, s.deltas, GALAXY.id(capital), s.day, [], s.reputation, s.war).some((c) => c.warWork === true),
    ).toBe(false);
  });

  it('выигранная работа державы на мире врага прибавляет право флага и счёт войны', () => {
    const { ui, foe, target } = atEnemyWorld();
    const s = ui.state;
    const id = GALAXY.id(target);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    const offer = availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).find((c) => c.warWork === true);
    if (offer === undefined) throw new Error('нет работы державы');
    expect(execute(s, { kind: 'takeContract', contractId: offer.id }).ok).toBe(true);
    const lance = s.company.mechs.filter((m) => m.pilotId !== null).slice(0, 4).map((m) => m.id);
    expect(execute(s, { kind: 'deploy', recordIds: lance }).ok).toBe(true);
    const brief = contractBrief(s);
    const unitOf = (p: (typeof brief.company)[number], side: 'player' | 'opfor'): MechUnit =>
      recordToUnit(p.record, p.pilot, { q: 0, r: 0 }, Direction.NE, side);
    const outcome: BattleOutcome = {
      winner: 'player',
      heldField: true,
      units: [
        ...brief.company.map((p) => ({ recordId: p.record.id, side: 'player' as const, unit: unitOf(p, 'player'), ...EMPTY_TALLY })),
        ...brief.enemy.map((p) => ({ recordId: p.record.id, side: 'opfor' as const, unit: { ...unitOf(p, 'opfor'), destroyed: true }, ...EMPTY_TALLY })),
      ],
    };
    expect(execute(s, { kind: 'resolveContract', outcome, salvage: [] }).ok).toBe(true);
    expect(s.deltas[id]?.realmWon).toBe(1);
    expect(playerWarOf(s.war, foe)?.won).toBe(1);
  });

  it('клану без записи войны её можно объявить — «уже воюет» только при записи (notes §10zu п. 9)', () => {
    const ui = makeUi();
    const s = ui.state;
    // Мир Дома не в столице, граничащий с кланом: держава из него граничит с кланом.
    let foe: string | undefined;
    for (let i = 0; i < GALAXY.count && foe === undefined; i++) {
      if (GALAXY.hasFlag(i, 'capital') || FACTIONS.get(ownerOf(s.deltas, i))?.kind !== 'house') continue;
      const clan = GALAXY.neighbors(i).map((j) => ownerOf(s.deltas, j)).find((o) => FACTIONS.get(o)?.kind === 'clan');
      if (clan === undefined) continue;
      // Тест о праве объявить войну, а не о покупке: пограничный мир не продаётся («за него идёт война»).
      s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID, loyalty: 70, formerOwner: ownerOf(s.deltas, i) });
      foe = clan;
    }
    if (foe === undefined) throw new Error('нет мира Дома у клановой границы');
    s.reputation = withRelation(s.reputation, PLAYER_ACTOR_ID, foe, -1);
    expect(playerWarOf(s.war, foe)).toBeUndefined();
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(playerWarOf(s.war, foe)).toBeDefined();
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.alreadyAtWar'));
  });

  it('объявить повторно нельзя: запись войны уже есть', () => {
    const { ui, foe } = atEnemyWorld();
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.alreadyAtWar'));
  });
});

describe('приказ армии наступать (проект державы, шаг 3)', () => {
  /** Держава в войне с соседом-Домом, полки на театре против него, фонд на один приказ. */
  function armedWar(): { ui: CampaignUi; foe: string; target: string } {
    const ui = makeUi();
    const { foe, home, second } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    // Приказу нужен итог державы в плюсе: два купленных мира на лояльности 70 (шаг 85) содержания не окупают.
    // Тест о приказе, а не о лояльности, — миры верные.
    for (const i of [home, second]) s.deltas = withDelta(s.deltas, GALAXY.id(i), { loyalty: 100 });
    s.company = { ...s.company, cbills: s.company.cbills + 20 * WAR.economy.mechCost };
    expect(ui.run({ kind: 'raiseRegiment', mechs: 20 })).toBe(true);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    const target = ui.realmOffensives.fronts.find((f) => f.factionId === foe)?.targets[0]?.id;
    if (target === undefined) throw new Error('нет участка против врага');
    return { ui, foe, target };
  }

  it('без державы, без войны и не на фронте — отказ своими причинами', () => {
    const bare = makeUi();
    expect(bare.why({ kind: 'orderOffensive', systemId: GALAXY.id(0) })).toBe(t('reject.diplomacyLocked'));
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const far = GALAXY.id(
      [...Array(GALAXY.count).keys()].find(
        (i) => ownerOf(ui.state.deltas, i) === foe && !GALAXY.neighbors(i).some((j) => ownerOf(ui.state.deltas, j) === PLAYER_ACTOR_ID),
      ) as number,
    );
    expect(ui.why({ kind: 'orderOffensive', systemId: far })).toBe(t('reject.notAtWar'));
    ui.run({ kind: 'declareWar', factionId: foe });
    expect(ui.why({ kind: 'orderOffensive', systemId: far })).toBe(t('reject.notOnFront'));
  });

  it('полки в резерве — отказ; после логистики без фонда — отказ; с фондом — приказ', () => {
    const { ui, foe, target } = armedWar();
    // В день объявления полки ещё в резерве: театра против врага нет.
    expect(ui.why({ kind: 'orderOffensive', systemId: target })).toBe(t('reject.noTheaterArmy'));
    execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    expect(ui.why({ kind: 'orderOffensive', systemId: target })).toBe(t('reject.noWarFund'));
    const cost = offensiveCost(ui.state.war, foe);
    expect(cost).toBeGreaterThan(0);
    ui.state.war = withFund(ui.state.war, PLAYER_ACTOR_ID, 'pirates', cost);
    expect(ui.why({ kind: 'orderOffensive', systemId: target })).toBeNull();
  });

  it('приказ: фонд списан на цену, потери — с театров, счёт войны и откат на декаду', () => {
    const { ui, foe, target } = armedWar();
    execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    const s = ui.state;
    const cost = offensiveCost(s.war, foe);
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', cost + 1000);
    const shown = ui.realmOffensives.fronts.find((f) => f.factionId === foe)?.targets.find((x) => x.id === target);
    const oursBefore = theaterOf(s.war, PLAYER_ACTOR_ID, foe);
    const theirsBefore = theaterOf(s.war, foe, PLAYER_ACTOR_ID);

    const r = execute(s, { kind: 'orderOffensive', systemId: target });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'frontClash') : undefined;
    if (e?.kind !== 'frontClash') throw new Error('нет события приказа');
    const won = e.outcome === 'captured';
    expect(e.outcome === 'captured' || e.outcome === 'repelled').toBe(true);
    expect(e.attacker).toBe(PLAYER_ACTOR_ID);
    // Цифра на кнопке — та, по которой собраны стороны.
    expect(e.odds).toBe(Math.round((shown?.odds ?? -1) * 1000) / 1000);
    expect(e.cost).toBe(cost);
    expect(realmWarFund(s.war)).toBe(1000);
    expect(theaterOf(s.war, PLAYER_ACTOR_ID, foe)).toBe(Math.max(0, oursBefore - e.attackerLost));
    expect(theaterOf(s.war, foe, PLAYER_ACTOR_ID)).toBe(Math.max(0, theirsBefore - e.defenderLost));
    const rec = playerWarOf(s.war, foe);
    expect(rec?.lastOffensive).toBe(s.day);
    expect(ownerOf(s.deltas, GALAXY.require(target))).toBe(won ? PLAYER_ACTOR_ID : foe);
    expect(rec?.won).toBe(won ? 1 : 0);

    // Откат: второй приказ против той же фракции в ту же декаду — отказ, и такт ИИ его не сбрасывает.
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', cost * 2);
    const again = ui.realmOffensives.fronts.find((f) => f.factionId === foe)?.targets[0];
    if (again !== undefined) expect(again.why).toBe(t('reject.offensiveCooldown'));
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(playerWarOf(tick.war, foe)?.lastOffensive).toBe(s.day);
  });

  it('приказ в день такта на том же участке — свой бой, не повтор боя такта', () => {
    const { ui, foe, target } = armedWar();
    execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    const s = ui.state;
    // С шага 80 сторона роты — не больше её театра: из одной-двух машин оба боя кончаются одинаково,
    // и разницу сидов не увидеть. Двадцать машин на театре — бой, в котором сид решает.
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, 20);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.system === GALAXY.require(target) && x.attacker === PLAYER_ACTOR_ID && x.defender === foe);
    if (sector === undefined) throw new Error('нет участка');
    const forces = sectorForces(s.war, s.worldSeed, s.deltas, sector, frontShares(frontWeights(sectors)));
    const asTick = resolveFrontBattle(sector, forces, s.war, s.worldSeed, s.deltas, s.day);
    const asOrder = resolveFrontBattle(sector, forces, s.war, s.worldSeed, s.deltas, s.day, 'order');
    expect(asOrder.attackerSize).toBe(asTick.attackerSize);
    expect(asOrder).not.toEqual(asTick);
  });
});

describe('звено роты в приказе армии (шаг 86)', () => {
  /** Война с соседом, двадцать машин на театре, фонд на приказ; рота — в прыжке от цели. */
  function ready(): { s: CampaignState; foe: string; target: number } {
    const ui = makeUi();
    const { foe, home, second } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    for (const i of [home, second]) s.deltas = withDelta(s.deltas, GALAXY.id(i), { loyalty: 100 });
    s.company = { ...s.company, cbills: s.company.cbills + 20 * WAR.economy.mechCost };
    expect(ui.run({ kind: 'raiseRegiment', mechs: 20 })).toBe(true);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    execute(s, { kind: 'advance', days: WAR.front.tickDays });
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, 20);
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', offensiveCost(s.war, foe) + 1000);
    const id = ui.realmOffensives.fronts.find((f) => f.factionId === foe)?.targets[0]?.id;
    if (id === undefined) throw new Error('нет участка против врага');
    const target = GALAXY.require(id);
    // В прыжке от цели, но не в ней самой: так проверяется именно «прыжок».
    const near = GALAXY.neighbors(target).find((j) => j !== target);
    if (near === undefined) throw new Error('у цели нет соседей');
    s.systemId = GALAXY.id(near);
    return { s, foe, target };
  }

  function battle(s: CampaignState, foe: string, target: number, company = orderLance(s, target)) {
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.system === target && x.attacker === PLAYER_ACTOR_ID && x.defender === foe);
    if (sector === undefined) throw new Error('нет участка');
    const forces = sectorForces(s.war, s.worldSeed, s.deltas, sector, frontShares(frontWeights(sectors)));
    return resolveFrontBattle(sector, forces, s.war, s.worldSeed, s.deltas, s.day, 'order', company);
  }

  it('рота далеко — приказ без неё, бой побитово прежний', () => {
    const { s, foe, target } = ready();
    const far = [...Array(GALAXY.count).keys()].find((i) => GALAXY.distance(i, target) > 3 * GALAXY.jumpRangeLy) as number;
    s.systemId = GALAXY.id(far);
    expect(orderLance(s, target)).toEqual([]);
    expect(battle(s, foe, target)).toEqual(battle(s, foe, target, []));
    expect(battle(s, foe, target).company).toBeUndefined();
  });

  it('столкновение: отряд по доле роты, выбитое — до главного боя, воспроизводимо по сиду', () => {
    const { s, foe, target } = ready();
    const lance = orderLance(s, target);
    expect(lance.length).toBeGreaterThan(0);
    const a = battle(s, foe, target);
    expect(battle(s, foe, target)).toEqual(a);
    const c = a.company;
    if (c === undefined) throw new Error('рота в бою не была');
    expect(c.brief.company.map((p) => p.record.id)).toEqual(lance.map((p) => p.record.id));
    // Пол — равный бой: первые машины обороны, вместе не сильнее роты (не меньше одной).
    const floor = detachmentFloor(lance, c.brief.enemy);
    expect(c.detachment).toBeGreaterThanOrEqual(floor);
    expect(c.detachment).toBeGreaterThanOrEqual(1);
    expect(c.detachment).toBeLessThanOrEqual(Math.min(24, a.defenderSize));
    if (floor > 1) expect(strengthOf(forceParts(c.brief.enemy.slice(0, floor)))).toBeLessThanOrEqual(strengthOf(forceParts(lance)));
    expect(c.knocked).toBeLessThanOrEqual(c.detachment);
    expect(a.defenderLost).toBeGreaterThanOrEqual(c.knocked);
    // Армия та же, что без роты: рота — прибавка к стороне, не замена.
    expect(a.attackerSize).toBe(battle(s, foe, target, []).attackerSize);
  });

  it('приказ: урон и потери роты — в записях ангара, выбитое ротой — с театра врага', () => {
    const { s, foe, target } = ready();
    const expected = battle(s, foe, target);
    const c = expected.company;
    if (c === undefined) throw new Error('рота в бою не была');
    const theirsBefore = theaterOf(s.war, foe, PLAYER_ACTOR_ID);

    const r = execute(s, { kind: 'orderOffensive', systemId: GALAXY.id(target) });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'frontClash') : undefined;
    if (e?.kind !== 'frontClash' || e.company === undefined) throw new Error('нет столкновения роты в событии');
    expect(e.company.mechs).toBe(c.brief.company.length);
    expect(e.company.detachment).toBe(c.detachment);
    expect(e.company.knocked).toBe(c.knocked);
    expect(e.defenderLost).toBe(expected.defenderLost);
    expect(theaterOf(s.war, foe, PLAYER_ACTOR_ID)).toBe(Math.max(0, theirsBefore - e.defenderLost));

    const units = new Map(c.outcome.units.filter((u) => u.side === 'player').map((u) => [u.recordId, u]));
    for (const p of c.brief.company) {
      const now = s.company.mechs.find((m) => m.id === p.record.id);
      if (e.company.lostRecordIds.includes(p.record.id)) {
        expect(now).toBeUndefined();
        continue;
      }
      const u = units.get(p.record.id);
      if (u === undefined || now === undefined) throw new Error(`машина ${p.record.id} пропала`);
      expect(now.condition.zones).toEqual(unitToRecord(u.unit, p.record).condition.zones);
    }
  });
});

describe('перемирие после мира длиннее на каждый взятый мир (проект державы, шаг 3b)', () => {
  it('срок на экране — тот, что ставит мир, и растёт на truceDaysPerWorld за мир', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 2, 0);
    const base = P.truceBaseDays;
    const shown = ui.realmWars.find((w) => w.factionId === foe)?.truceDays;
    // Войну объявила рота — к перемирию ещё и надбавка объявившему (шаг 81).
    expect(shown).toBe(Math.min(P.truceMaxDays, base + 2 * P.truceDaysPerWorld + P.declarerTruceDays));
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    expect(pactOf(s.war, PLAYER_ACTOR_ID, foe)?.untilDay).toBe(s.day + (shown ?? 0));
    expect(pactHolds(s.war, PLAYER_ACTOR_ID, foe, 'truce', s.day + base + 1)).toBe(true);
  });

  it('перемирие не длиннее потолка, сколько бы держава ни взяла (шаг 90)', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    age(ui.state, foe, P.minWarDays, 50, 0);
    expect(ui.realmWars.find((w) => w.factionId === foe)?.truceDays).toBe(P.truceMaxDays);
  });

  it('после мира сосед не требует дани до конца перемирия и ещё afterTruceDays суток (шаг 90)', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 1, 0);
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    const until = pactOf(s.war, PLAYER_ACTOR_ID, foe)?.untilDay ?? 0;
    expect(s.war.demands?.quiet?.[foe]).toBe(until + WAR.demands.afterTruceDays);
  });
});

describe('война державы не гаснет сама (шаг 79)', () => {
  it('оттаявшая вражда войну не кончает: запись живёт, отношения держатся на уровне войны', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    // Сеть отношений подняла пару до дружбы, а отношение к роте оттаяло к нулю — так проба и теряла войну.
    s.reputation = withRelation(s.reputation, PLAYER_ACTOR_ID, foe, 0.5);
    s.reputation = withStanding(s.reputation, foe, -standingOf(s.reputation, foe));
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(playerWarOf(tick.war, foe)).toBeDefined();
    expect(tick.ended).toEqual([]);
    expect(relationOf(tick.reputation, PLAYER_ACTOR_ID, foe)).toBe(P.warRelation);
    expect(liveEnmity(tick.reputation, PLAYER_ACTOR_ID, foe)).toBeGreaterThanOrEqual(WAR.front.minEnmity);
    expect(standingOf(tick.reputation, foe)).toBe(P.declareStanding);
  });

  it('затухание не поднимает отношение воюющей фракции выше −25; после мира тает как обычно', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    expect(ui.run({ kind: 'advance', days: 120 })).toBe(true);
    expect(playerWarOf(s.war, foe)).toBeDefined();
    expect(standingOf(s.reputation, foe)).toBeLessThanOrEqual(P.declareStanding);

    age(s, foe, P.minWarDays, 1, 0);
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    const after = standingOf(s.reputation, foe);
    expect(runThrough(ui, 120)).toBe(true);
    expect(standingOf(s.reputation, foe)).toBeGreaterThan(after);
  });

  it('снимается договором, подчинением и падением державы — с событием и строкой сводки', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;

    const pact = signPact(s.war, s.reputation, PLAYER_ACTOR_ID, foe, 'truce', s.day);
    const byPact = playerWarTick(pact.war, pact.reputation, s.deltas, s.day);
    expect(playerWarOf(byPact.war, foe)).toBeUndefined();
    expect(byPact.ended).toEqual([{ factionId: foe, how: 'pact' }]);

    const fallen = playerWarTick(s.war, s.reputation, {}, s.day);
    expect(fallen.ended).toEqual([{ factionId: foe, how: 'realmFallen' }]);

    // Пираты: мира с ними нет, и запись живёт, пока есть общая граница.
    s.war = withPlayerWar(s.war, 'pirates', { since: s.day, won: 0, lost: 0 });
    const noBorder = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    const piratesNear = domainBorder(s.deltas).some((b) => b.owner === 'pirates');
    expect(playerWarOf(noBorder.war, 'pirates') !== undefined).toBe(piratesNear);
    if (!piratesNear) expect(noBorder.ended).toContainEqual({ factionId: 'pirates', how: 'noBorder' });

    // Мир командой идёт в сводку строкой «конец войны» с меткой державы.
    s.war = withPlayerWar(s.war, 'pirates', undefined);
    age(s, foe, P.minWarDays, 1, 0);
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    const line = ui.warLog.find((l) => l.kind === 'warEnded');
    expect(line?.ended).toBe('free');
    expect(line?.defender).toBe(foe);
    expect(line?.realm).toBe(true);
  });

  it('враг не нанимает роту: работа нанимателя закрыта причиной employerAtWar', () => {
    const ui = makeUi();
    const { home, foe } = realmWithHouseNeighbour(ui);
    const target = GALAXY.neighbors(home).find(
      (j) => ownerOf(ui.state.deltas, j) === foe && !GALAXY.hasFlag(j, 'capital'),
    ) as number;
    const s = ui.state;
    s.systemId = GALAXY.id(target);
    s.reputation = withStanding(s.reputation, foe, 60 - standingOf(s.reputation, foe));
    const open = judgedContracts(s.worldSeed, s.deltas, s.systemId, s.day, s.reputation, s.war);
    expect(open.some((o) => o.allowed && o.contract.employer === foe)).toBe(true);

    ui.run({ kind: 'declareWar', factionId: foe });
    const judged = judgedContracts(s.worldSeed, s.deltas, s.systemId, s.day, s.reputation, s.war);
    const theirs = judged.filter((o) => o.contract.employer === foe);
    expect(theirs.length).toBeGreaterThan(0);
    for (const o of theirs) {
      expect(o.allowed).toBe(false);
      expect(o.employerAtWar).toBe(true);
    }
    expect(judged.some((o) => o.contract.atonement === true)).toBe(false);
    const blocked = blockedOffers(s.worldSeed, s.deltas, s.systemId, s.day, s.reputation, s.war);
    expect(blocked.atWar).toBe(theirs.length);
    const id = theirs[0]?.contract.id as string;
    expect(ui.why({ kind: 'takeContract', contractId: id })).toBe(t('reject.employerAtWar'));
  });

  it('повторное объявление после мира упирается в перемирие с надбавкой за взятые миры', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 2, 0);
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    const until = pactOf(s.war, PLAYER_ACTOR_ID, foe)?.untilDay ?? 0;
    expect(until).toBe(s.day + Math.min(P.truceMaxDays, P.truceBaseDays + 2 * P.truceDaysPerWorld + P.declarerTruceDays));
    expect(ui.why({ kind: 'declareWar', factionId: foe })).toBe(t('reject.warBlocked'));
  });
});

describe('армия державы решает исход (шаг 80)', () => {
  /** Держава в войне с соседом-Домом; армии нет, если `mechs` = 0. */
  function realmWar(mechs: number): { ui: CampaignUi; foe: string } {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    if (mechs > 0) {
      s.company = { ...s.company, cbills: s.company.cbills + mechs * WAR.economy.mechCost };
      expect(ui.run({ kind: 'raiseRegiment', mechs })).toBe(true);
    }
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(ui.run({ kind: 'advance', days: WAR.front.tickDays })).toBe(true);
    return { ui, foe };
  }

  it('пустой театр роты не наступает: участок есть, а боя с ротой-нападающим нет', () => {
    const { ui, foe } = realmWar(0);
    const s = ui.state;
    expect(theaterOf(s.war, PLAYER_ACTOR_ID, foe)).toBe(0);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    expect(sectors.some((x) => x.attacker === PLAYER_ACTOR_ID && x.defender === foe)).toBe(true);
    // Фонд так велик, что до шага 80 такт выбирал бы участки роты почти всегда.
    let war = withFund(s.war, PLAYER_ACTOR_ID, foe, 1e12);
    let deltas = s.deltas;
    let rep = s.reputation;
    const rng = s.rng.stream('camp.war');
    for (let k = 0; k < 6; k++) {
      const r = frontTick(war, deltas, rep, s.worldSeed, s.day + k * WAR.front.tickDays, rng);
      expect(r.clashes.filter((c) => c.attacker === PLAYER_ACTOR_ID)).toEqual([]);
      war = r.war;
      deltas = r.deltas;
      rep = r.reputation;
    }
  });

  it('сторона роты не больше её театра и без пола forceMin; потери не больше стороны', () => {
    const { ui, foe } = realmWar(20);
    const s = ui.state;
    expect(realmAttackSize(1e9, 3)).toBe(3);
    expect(realmAttackSize(0.01, 50)).toBe(Math.round(0.01 * WAR.front.mechsPerWeight));
    expect(realmAttackSize(1e9, 1e9)).toBe(WAR.front.forceMax);

    const small = Math.max(1, WAR.front.forceMin - 5);
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, small);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.attacker === PLAYER_ACTOR_ID && x.defender === foe);
    if (sector === undefined) throw new Error('нет участка');
    const forces = sectorForces(s.war, s.worldSeed, s.deltas, sector, frontShares(frontWeights(sectors)));
    const fought = resolveFrontBattle(sector, forces, s.war, s.worldSeed, s.deltas, s.day);
    expect(fought.attackerSize).toBeLessThanOrEqual(small);
    expect(fought.attackerSize).toBeLessThan(WAR.front.forceMin);
    expect(fought.attackerLost).toBeLessThanOrEqual(fought.attackerSize);
  });

  it('fundWar: касса — в фонд державы; отказы без державы, при нехватке денег и неверной сумме', () => {
    const bare = makeUi();
    expect(bare.why({ kind: 'fundWar', amount: 1_000_000 })).toBe(t('reject.diplomacyLocked'));

    const { ui } = realmWar(0);
    const s = ui.state;
    expect(ui.why({ kind: 'fundWar', amount: 0 })).toBe(t('reject.badFundAmount'));
    expect(ui.why({ kind: 'fundWar', amount: 1.5 })).toBe(t('reject.badFundAmount'));
    expect(ui.why({ kind: 'fundWar', amount: s.company.cbills + 1 })).toBe(t('reject.insufficientFunds'));
    const cash = s.company.cbills;
    const fund = realmWarFund(s.war);
    expect(ui.run({ kind: 'fundWar', amount: 5_000_000 })).toBe(true);
    expect(s.company.cbills).toBe(cash - 5_000_000);
    expect(realmWarFund(s.war)).toBe(fund + 5_000_000);
    expect(ui.logs[0]?.text).toBe(t('event.warFunded', { sum: cbills(5_000_000) }));
  });

  it('цена приказа — за машину армии на направлении, а не от дохода державы (шаг 90)', () => {
    const { ui, foe } = realmWar(20);
    const s = ui.state;
    expect(offensiveCost(s.war, foe)).toBe(theaterOf(s.war, PLAYER_ACTOR_ID, foe) * WAR.domain.offensiveCostPerMech);
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, 7);
    expect(offensiveCost(s.war, foe)).toBe(7 * WAR.domain.offensiveCostPerMech);
    expect(ui.realmOffensives.fronts.find((f) => f.factionId === foe)?.cost).toBe(7 * WAR.domain.offensiveCostPerMech);
  });
});

describe('цель войны, усталость, мир договором (шаг 81)', () => {
  /** Пограничный мир врага, годный в цель, и ещё один его мир — «взятый сверх цели». */
  function goalAndExtra(ui: CampaignUi, foe: string): { goal: string; extra: string } {
    const border = domainBorder(ui.state.deltas).find((b) => b.owner === foe)?.systems ?? [];
    const goal = border.find((i) => !GALAXY.hasFlag(i, 'capital'));
    if (goal === undefined) throw new Error('нет пограничного мира врага');
    const extra = [...Array(GALAXY.count).keys()].find(
      (i) => i !== goal && ownerOf(ui.state.deltas, i) === foe && !GALAXY.hasFlag(i, 'capital'),
    ) as number;
    return { goal: GALAXY.id(goal), extra: GALAXY.id(extra) };
  }

  /** Рота взяла мир у врага — так, как его пишет такт: владелец и счёт войны. */
  function take(s: CampaignState, foe: string, systemId: string): void {
    s.deltas = withDelta(s.deltas, systemId, { owner: PLAYER_ACTOR_ID });
    s.war = notePlayerCapture(s.war, PLAYER_ACTOR_ID, foe, s.day, systemId);
  }

  function tire(s: CampaignState, foe: string, fields: Partial<PlayerWar>): void {
    s.war = withPlayerWar(s.war, foe, { ...(playerWarOf(s.war, foe) as PlayerWar), ...fields });
  }

  it('цель проверяется: столица, чужой мир и больше goalWorldsMax — отказ', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const { goal, extra } = goalAndExtra(ui, foe);
    const capital = [...Array(GALAXY.count).keys()].find((i) => GALAXY.hasFlag(i, 'capital') && ownerOf(ui.state.deltas, i) === foe) as number;
    const bad = t('reject.badWarGoal');
    expect(ui.why({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: [] } })).toBe(bad);
    expect(ui.why({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: [GALAXY.id(capital)] } })).toBe(bad);
    expect(ui.why({ kind: 'declareWar', factionId: foe, goal: { kind: 'tribute', systems: [goal, goal] } })).toBe(bad);
    if (!domainBorder(ui.state.deltas).some((b) => b.systems.includes(GALAXY.require(extra)))) {
      expect(ui.why({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: [extra] } })).toBe(bad);
    }
    const many = Array.from({ length: P.goalWorldsMax + 1 }, () => goal);
    expect(ui.why({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: many } })).toBe(bad);
    expect(ui.run({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: [goal] } })).toBe(true);
    expect(playerWarOf(ui.state.war, foe)?.goal).toEqual({ kind: 'worlds', systems: [goal] });
  });

  it('мир по предложению даёт ровно цель; взятое сверх цели и счёта — назад фракции', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const { goal, extra } = goalAndExtra(ui, foe);
    ui.run({ kind: 'declareWar', factionId: foe, goal: { kind: 'worlds', systems: [goal] } });
    const s = ui.state;
    age(s, foe, P.minWarDays);
    take(s, foe, extra);

    // Перевес без усталости врага — мир «как есть»: цели нет, взятое держит счёт (1 − 0 − 0).
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'free', offered: false });
    expect(peaceOutcome(s.war, s.deltas, foe, false)).toEqual({ gained: [], tributaries: [], humiliation: false, returned: [], ceded: [] });

    // Устали поровну — только от времени: мира на цели нет, иначе цель давалась бы без единого боя.
    tire(s, foe, { fatigue: P.fatigueThreshold, foeFatigue: P.fatigueThreshold });
    expect(playerWarTick(s.war, s.reputation, s.deltas, s.day).moves).not.toContainEqual({ kind: 'peaceOffer', over: foe, under: PLAYER_ACTOR_ID });
    tire(s, foe, { fatigue: 0, foeFatigue: P.fatigueThreshold });
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(tick.moves).toContainEqual({ kind: 'peaceOffer', over: foe, under: PLAYER_ACTOR_ID });
    s.war = tick.war;
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'free', offered: true });
    // Экран показывает тот же исход, что исполнит команда: цель — роте, лишнее (1 − 0 − 1 = 0) — назад.
    const shown = ui.realmWars.find((w) => w.factionId === foe)?.outcome;
    expect(shown).toEqual({ gained: [GALAXY.name(GALAXY.require(goal))], tributaries: [], humiliation: false, returned: [GALAXY.name(GALAXY.require(extra))], ceded: [] });

    const r = execute(s, { kind: 'makePeace', factionId: foe });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'peaceMade') : undefined;
    expect(e).toMatchObject({ kind: 'peaceMade', cost: 0, gained: [goal], returned: [extra] });
    expect(ownerOf(s.deltas, GALAXY.require(goal))).toBe(PLAYER_ACTOR_ID);
    expect(ownerOf(s.deltas, GALAXY.require(extra))).toBe(foe);
    expect(playerWarOf(s.war, foe)).toBeUndefined();
  });

  it('цель «дань» ставит миры цели данниками роты на срок лена; «унижение» — волна по сети без самой фракции', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const { goal } = goalAndExtra(ui, foe);
    ui.run({ kind: 'declareWar', factionId: foe, goal: { kind: 'tribute', systems: [goal] } });
    const s = ui.state;
    age(s, foe, P.minWarDays);
    tire(s, foe, { offerUntil: s.day + 1 });
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    expect(ownerOf(s.deltas, GALAXY.require(goal))).toBe(foe);
    expect(s.deltas[goal]?.tribute).toBe(PLAYER_ACTOR_ID);
    expect(s.deltas[goal]?.tributeUntil).toBe(s.day + WAR.diplomacy.tributeDecades * WAR.front.tickDays);

    const ui2 = makeUi();
    const two = realmWithHouseNeighbour(ui2);
    ui2.run({ kind: 'declareWar', factionId: two.foe, goal: { kind: 'humiliation' } });
    const s2 = ui2.state;
    age(s2, two.foe, P.minWarDays);
    tire(s2, two.foe, { offerUntil: s2.day + 1 });
    const before = s2.reputation;
    const r = execute(s2, { kind: 'makePeace', factionId: two.foe });
    expect(r.ok && r.events.find((x) => x.kind === 'peaceMade')).toMatchObject({ humiliated: true });
    expect(standingOf(s2.reputation, two.foe)).toBe(standingOf(before, two.foe));
    expect(FACTION_LIST.some((f) => f.id !== two.foe && standingOf(s2.reputation, f.id) !== standingOf(before, f.id))).toBe(true);
  });

  it('усталость растёт от времени и потерь; пираты не устают', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    // В день объявления время ещё не шло.
    expect(playerWarOf(playerWarTick(s.war, s.reputation, s.deltas, s.day).war, foe)?.fatigue).toBeUndefined();
    age(s, foe, P.minWarDays);
    const later = playerWarOf(playerWarTick(s.war, s.reputation, s.deltas, s.day).war, foe);
    expect(later?.fatigue).toBe(P.fatiguePerDecade);
    expect(later?.foeFatigue).toBe(P.fatiguePerDecade);

    // Рота потеряла половину театра против врага, враг — ничего.
    const before = withTheater(withTheater(s.war, PLAYER_ACTOR_ID, foe, 10), foe, PLAYER_ACTOR_ID, 20);
    const after = withTheater(before, PLAYER_ACTOR_ID, foe, 5);
    const noted = playerWarOf(notePlayerLosses(before, after, PLAYER_ACTOR_ID, foe, 10, 8), foe);
    expect(noted?.fatigue).toBe(P.fatigueLossWeight * 0.5);
    expect(noted?.foeFatigue).toBeUndefined();
    // Театр врага в одну машину, а в бой он вывел восемь (ополчение): потеря машины — восьмая часть армии.
    const thin = withTheater(before, foe, PLAYER_ACTOR_ID, 1);
    const lostOne = playerWarOf(notePlayerLosses(thin, withTheater(thin, foe, PLAYER_ACTOR_ID, 0), PLAYER_ACTOR_ID, foe, 10, 8), foe);
    // Усталость хранится с точностью 1e-4 (`withFatigue`).
    expect(lostOne?.foeFatigue).toBe(Math.round((P.fatigueLossWeight / 8) * 1e4) / 1e4);

    s.war = withPlayerWar(s.war, 'pirates', { since: s.day - P.minWarDays, won: 0, lost: 0 });
    expect(playerWarOf(playerWarTick(s.war, s.reputation, s.deltas, s.day).war, 'pirates')?.fatigue).toBeUndefined();
  });

  it('взятый мир утомляет потерявшего; вольница не устаёт (отладка 2026-10-03)', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    const taken = playerWarOf(notePlayerCapture(s.war, PLAYER_ACTOR_ID, foe, s.day, GALAXY.id(1)), foe);
    expect(taken?.foeFatigue).toBe(P.fatiguePerWorld);
    expect(taken?.fatigue).toBeUndefined();
    const lost = playerWarOf(notePlayerCapture(s.war, foe, PLAYER_ACTOR_ID, s.day, GALAXY.id(2)), foe);
    expect(lost?.fatigue).toBe(P.fatiguePerWorld);
    expect(lost?.foeFatigue).toBeUndefined();
    const pirates = playerWarOf(notePlayerCapture(s.war, PLAYER_ACTOR_ID, 'pirates', s.day, GALAXY.id(3)), 'pirates');
    expect(pirates?.won).toBe(1);
    expect(pirates?.foeFatigue).toBeUndefined();
  });

  it('уставшей роте мир дешевле: отступные падают линейно от порога к нулю', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays);
    const price = pactPrice(s.worldSeed, s.deltas);
    tire(s, foe, { fatigue: P.fatigueThreshold });
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'pay', cost: price });
    const half = P.fatigueThreshold + (1 - P.fatigueThreshold) / 2;
    tire(s, foe, { fatigue: half });
    expect(peaceTerms(s.war, s.deltas, s.worldSeed, foe, s.day)).toEqual({ kind: 'pay', cost: Math.round(price / 2) });
  });

  it('на 100 % усталости мир заключается сам в конце такта фронта — «как есть», запись снята, усталости нет', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    tire(s, foe, { fatigue: 1 });
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'peaceMade') : undefined;
    expect(e).toMatchObject({ kind: 'peaceMade', factionId: foe, cost: 0, forced: 'realm' });
    expect(playerWarOf(s.war, foe)).toBeUndefined();
    expect(pactHolds(s.war, PLAYER_ACTOR_ID, foe, 'truce', s.day)).toBe(true);
    expect(ui.realmWars.some((w) => w.factionId === foe)).toBe(false);
  });

  it('память о войне: после мира отношение пары тает тактом перемирия до peaceRelation', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 1, 0);
    expect(ui.run({ kind: 'makePeace', factionId: foe })).toBe(true);
    const r0 = relationOf(s.reputation, PLAYER_ACTOR_ID, foe);
    expect(r0).toBeCloseTo(P.warRelation + RELATIONS.moves.pact, 6);
    const tick = playerWarTick(s.war, s.reputation, s.deltas, s.day);
    expect(relationOf(tick.reputation, PLAYER_ACTOR_ID, foe)).toBeCloseTo(r0 + P.thawPerDecade, 6);
    const near = withRelation(s.reputation, PLAYER_ACTOR_ID, foe, P.peaceRelation - P.thawPerDecade / 2);
    expect(relationOf(playerWarTick(s.war, near, s.deltas, s.day).reputation, PLAYER_ACTOR_ID, foe)).toBe(P.peaceRelation);
  });
});

describe('протекторат державы (шаг 90)', () => {
  it('размер державы — вместе с вассалами; ничейные миры вассалом державы не становятся', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    const s = ui.state;
    const own = realmBloc(s.war, s.deltas);
    expect(own).toBe(2);
    s.war = withVassal(s.war, foe, { suzerain: PLAYER_ACTOR_ID, sinceDay: s.day });
    expect(realmBloc(s.war, s.deltas)).toBeGreaterThan(own + 100);
    expect(canSubmit(s.war, s.reputation, s.deltas, PLAYER_ACTOR_ID, 'independent', s.day)).toBe(false);
  });

  it('уставшая фракция, предложившая мир, может миром признать сюзеренитет — если держава не меньше её', () => {
    const ui = makeUi();
    const { foe } = realmWithHouseNeighbour(ui);
    ui.run({ kind: 'declareWar', factionId: foe });
    const s = ui.state;
    age(s, foe, P.minWarDays, 1, 0);
    // Без предложения мира — нельзя.
    expect(ui.why({ kind: 'makePeace', factionId: foe, protectorate: true })).toBe(t('reject.protectorateNotOffered'));
    const rec = playerWarOf(s.war, foe) as PlayerWar;
    s.war = withPlayerWar(s.war, foe, { ...rec, offerUntil: s.day + 30 });
    // Дом в сотни миров против державы в два — нельзя и с предложением.
    expect(ui.realmWars.find((w) => w.factionId === foe)?.protectorate).toBe(false);
    expect(ui.why({ kind: 'makePeace', factionId: foe, protectorate: true })).toBe(t('reject.protectorateNotOffered'));
    // Порог условия — из данных: при нулевом пороге размер не мешает.
    const D = WAR.diplomacy as { peaceVassalRatio: number };
    const ratio = D.peaceVassalRatio;
    D.peaceVassalRatio = 0.001;
    try {
      expect(ui.realmWars.find((w) => w.factionId === foe)?.protectorate).toBe(true);
      expect(ui.run({ kind: 'makePeace', factionId: foe, protectorate: true })).toBe(true);
    } finally {
      D.peaceVassalRatio = ratio;
    }
    expect(playerWarOf(s.war, foe)).toBeUndefined();
    expect(s.war.vassals[foe]?.suzerain).toBe(PLAYER_ACTOR_ID);
  });
});
