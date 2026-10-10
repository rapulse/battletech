import { describe, expect, it } from 'vitest';
import {
  EMPTY_TALLY,
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  applySystemCapture,
  availableContracts,
  contractBrief,
  execute,
  judgedContracts,
  loyaltyFactor,
  loyaltyTick,
  makeCompany,
  makeRecord,
  ownerOf,
  playerWarOf,
  recordToUnit,
  theaterOf,
  withDelta,
  postHomeRaids,
  PIRATE_FACTION,
  CONTRACTS,
  withPlayerWar,
  withStanding,
  withTheater,
  withEconomy,
  totalArmy,
  worldContributionAt,
  type BattleOutcome,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { Direction } from '../src/core/hex/index.js';
import type { MechUnit, Pilot } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Лояльность взятых миров и работа роты дома (шаг 85): старт по способу получения, рост и падение за
 * декаду, доход и мощность по лояльности, восстание на бирже мира, подавление и отпадение; работа против
 * врага войны на своём мире — без гонорара, в счёт войны.
 */

const L = WAR.loyalty;
const WORLD = 1;

function lanceCompany(): Partial<Company> {
  const mechs: MechRecord[] = [];
  const pilots: Pilot[] = [];
  for (let i = 1; i <= 4; i++) {
    const pilotId = `P-${i}`;
    mechs.push({
      ...makeRecord({ id: `M-${i}`, assembly: generateAssembly({ chassisCode: 'IS-H55-R3F2', role: 'brawler' }, new Rng(i)) }),
      pilotId,
    });
    pilots.push(makePilot(new Rng(7), { id: pilotId, callsign: pilotId, tier: 4 }));
  }
  return { mechs, pilots, cbills: 2_000_000, dropship: 'union', hangar: 12 };
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

/** Победа на поле: противник сбит целиком. Разбор чистый, бой ему не нужен (`contracts.test.ts`). */
function wonOutcome(state: CampaignState): BattleOutcome {
  const brief = contractBrief(state);
  const unitOf = (record: MechRecord, pilot: Pilot, side: 'player' | 'opfor'): MechUnit =>
    recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, side);
  return {
    winner: 'player',
    heldField: true,
    units: [
      ...brief.company.map((p) => ({ recordId: p.record.id, side: 'player' as const, unit: unitOf(p.record, p.pilot, 'player'), ...EMPTY_TALLY })),
      ...brief.enemy.map((p) => ({
        recordId: p.record.id,
        side: 'opfor' as const,
        unit: { ...unitOf(p.record, p.pilot, 'opfor'), destroyed: true },
        ...EMPTY_TALLY,
      })),
    ],
  };
}

/** Мир Дома не в столице — тот, который рота «держит» в тесте. */
function houseWorld(from = 0): number {
  for (let i = from; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    if (FACTIONS.get(GALAXY.ownerId(i))?.kind === 'house') return i;
  }
  throw new Error('нет мира Дома');
}

/** Мир роты на лояльности `loyalty`, полученный у владельца по канону. */
function ownedAt(state: CampaignState, i: number, loyalty: number): void {
  state.deltas = withDelta(state.deltas, GALAXY.id(i), {
    owner: PLAYER_ACTOR_ID,
    loyalty,
    formerOwner: GALAXY.ownerId(i),
    realmCapital: true,
  });
}

describe('лояльность мира роты (шаг 85)', () => {
  it('старт по способу получения: взятый силой ниже купленного; ушедший мир поля теряет', () => {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    const s = ui.state;
    const bought = houseWorld();
    const owner = ownerOf(s.deltas, bought);
    s.systemId = GALAXY.id(bought);
    s.reputation = withStanding(s.reputation, owner, 200);
    s.company = { ...s.company, cbills: s.company.cbills + ui.worldPriceAt(s.systemId) };
    expect(ui.run({ kind: 'buyWorld' })).toBe(true);
    expect(s.deltas[s.systemId]?.loyalty).toBe(L.startBought);
    expect(s.deltas[s.systemId]?.formerOwner).toBe(owner);

    // Соседний мир чужого владельца — силой, тем швом, которым берут фронт, приказ и контракт.
    const taken = GALAXY.neighbors(bought).find((j) => ownerOf(s.deltas, j) !== PLAYER_ACTOR_ID) as number;
    const from = ownerOf(s.deltas, taken);
    const applied = applySystemCapture(s.war, s.deltas, s.worldSeed, taken, PLAYER_ACTOR_ID, from, new Rng(1), s.day);
    const d = applied.deltas[GALAXY.id(taken)];
    expect(d?.loyalty).toBe(L.startForce);
    expect(d?.formerOwner).toBe(from);
    expect(L.startForce).toBeLessThan(L.startBought);

    // Отбитый прежним хозяином — без полей лояльности.
    const back = applySystemCapture(applied.war, applied.deltas, s.worldSeed, taken, from, PLAYER_ACTOR_ID, new Rng(2), s.day);
    const after = back.deltas[GALAXY.id(taken)];
    expect(after?.loyalty).toBeUndefined();
    expect(after?.formerOwner).toBeUndefined();
  });

  it('миры фракций правила не видят: захват Дома у Дома полей не пишет', () => {
    const s = new CampaignState(WORLD, { worldSeed: WORLD });
    const i = houseWorld();
    const owner = GALAXY.ownerId(i);
    const foe = FACTIONS.get(owner)?.id === 'davion' ? 'kurita' : 'davion';
    const applied = applySystemCapture(s.war, s.deltas, s.worldSeed, i, foe, owner, new Rng(1), s.day);
    const d = applied.deltas[GALAXY.id(i)];
    expect(d?.loyalty).toBeUndefined();
    expect(d?.formerOwner).toBeUndefined();
    expect(d?.revoltSince).toBeUndefined();
    expect(loyaltyFactor(applied.deltas, GALAXY.id(i))).toBe(1);
  });

  it('доход и мощность следуют лояльности: (0.5 + лояльность / 200)', () => {
    const s = new CampaignState(WORLD, { worldSeed: WORLD });
    const i = houseWorld();
    ownedAt(s, i, 100);
    const full = worldContributionAt(s.worldSeed, s.deltas, i);
    ownedAt(s, i, 20);
    const fresh = worldContributionAt(s.worldSeed, s.deltas, i);
    expect(loyaltyFactor(s.deltas, GALAXY.id(i))).toBeCloseTo(0.6, 10);
    expect(fresh.income).toBe(Math.round(full.income * 0.6));
    expect(fresh.capacity).toBe(Math.round(full.capacity * 0.6));
    expect(fresh.upkeep).toBe(full.upkeep);
    expect(fresh.lift).toBe(full.lift);
  });

  it('такт: рост × (1 − разорение); под данью — стоит; война с прежним владельцем — вниз', () => {
    const s = new CampaignState(WORLD, { worldSeed: WORLD });
    const i = houseWorld();
    const id = GALAXY.id(i);
    ownedAt(s, i, 40);
    s.deltas = withDelta(s.deltas, id, { ruined: 0.5 });
    expect(loyaltyTick(s.deltas, s.war, s.reputation, s.day).deltas[id]?.loyalty).toBe(40 + L.growth * 0.5);

    const tributed = withDelta(s.deltas, id, { tribute: 'kurita', tributeUntil: s.day + 100 });
    expect(loyaltyTick(tributed, s.war, s.reputation, s.day).deltas[id]?.loyalty).toBe(40);

    const war = withPlayerWar(s.war, GALAXY.ownerId(i), { since: s.day, won: 0, lost: 0 });
    expect(loyaltyTick(s.deltas, war, s.reputation, s.day).deltas[id]?.loyalty).toBe(40 - L.warDecay);
  });

  it('война бьёт по лояльности только мира на границе с прежним владельцем (шаг 90)', () => {
    const s = new CampaignState(WORLD, { worldSeed: WORLD });
    const i = houseWorld();
    const id = GALAXY.id(i);
    const former = GALAXY.ownerId(i);
    ownedAt(s, i, 40);
    // Соседи мира — тоже державы роты: прежний владелец до него не дотягивается.
    for (const j of GALAXY.neighbors(i)) s.deltas = withDelta(s.deltas, GALAXY.id(j), { owner: PLAYER_ACTOR_ID });
    const war = withPlayerWar(s.war, former, { since: s.day, won: 0, lost: 0 });
    expect(loyaltyTick(s.deltas, war, s.reputation, s.day).deltas[id]?.loyalty).toBe(40 + L.growth);
  });

  it('восстание, не подавленное ротой, в последнюю декаду подавляет армия — ценой машин; без армии мир отходит (шаг 90)', () => {
    const i = houseWorld();
    const id = GALAXY.id(i);
    const setup = (army: number): CampaignState => {
      const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
      ownedAt(s, i, L.revoltBelow - 5);
      // Восстание шло весь срок, кроме последней декады.
      s.deltas = withDelta(s.deltas, id, { revoltSince: s.day - (L.revoltDecades - 1) * WAR.front.tickDays });
      s.war = withEconomy(s.war, PLAYER_ACTOR_ID, { army });
      return s;
    };
    const armed = setup(L.armyQuellMechs);
    const events = run(armed, { kind: 'advance', days: WAR.front.tickDays });
    expect(events.some((e) => e.kind === 'worldRevoltSuppressed' && e.systemId === id && e.by === 'army')).toBe(true);
    expect(armed.deltas[id]?.revoltSince).toBeUndefined();
    expect(ownerOf(armed.deltas, i)).toBe(PLAYER_ACTOR_ID);
    expect(totalArmy(armed.war, PLAYER_ACTOR_ID)).toBeLessThanOrEqual(L.armyQuellMechs - L.armyQuellLoss);

    const bare = setup(L.armyQuellMechs - 1);
    run(bare, { kind: 'advance', days: 2 * WAR.front.tickDays });
    expect(ownerOf(bare.deltas, i)).toBe(GALAXY.ownerId(i));
  });

  it('восстание: ниже порога — контракт на бирже мира; победа — лояльность вверх, восстание снято', () => {
    const i = houseWorld();
    const id = GALAXY.id(i);
    const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
    s.company = { ...makeCompany(), ...lanceCompany() };
    // Такт сперва прибавляет рост, потом сверяет порог.
    ownedAt(s, i, L.revoltBelow - L.growth - 0.5);

    const events = run(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(events.some((e) => e.kind === 'worldRevolt' && e.systemId === id && e.formerOwner === GALAXY.ownerId(i))).toBe(true);
    expect(s.deltas[id]?.revoltSince).toBeDefined();

    const offer = availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).find((c) => c.revolt === true);
    if (offer === undefined) throw new Error('нет контракта восстания');
    expect(offer.mission).toBe('defense');
    expect(offer.target).toBe(GALAXY.ownerId(i));
    expect(offer.employer).toBe(PLAYER_ACTOR_ID);
    expect(offer.opforType).toBe('militia');
    expect([offer.payout, offer.advance, offer.penalty]).toEqual([0, 0, 0]);

    const before = s.deltas[id]?.loyalty as number;
    run(s, { kind: 'takeContract', contractId: offer.id });
    run(s, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    const resolved = run(s, { kind: 'resolveContract', outcome: wonOutcome(s), salvage: [] });
    expect(s.deltas[id]?.revoltSince).toBeUndefined();
    expect(s.deltas[id]?.loyalty).toBe(Math.round((before + L.win + L.revoltWin) * 100) / 100);
    // Держава себе не платит: расчёта с нанимателем нет, трофеи — как у любой работы.
    expect(resolved.find((e) => e.kind === 'contractResolved')).toMatchObject({ settlement: 0 });
  });

  it('восстание без победы за срок — мир отходит прежнему владельцу', () => {
    const i = houseWorld();
    const id = GALAXY.id(i);
    const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
    ownedAt(s, i, 5);
    s.deltas = withDelta(s.deltas, id, { revoltSince: s.day - L.revoltDecades * WAR.front.tickDays + 1 });
    const events = run(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(events.some((e) => e.kind === 'worldSeceded' && e.systemId === id && e.to === GALAXY.ownerId(i))).toBe(true);
    expect(ownerOf(s.deltas, i)).toBe(GALAXY.ownerId(i));
    expect(s.deltas[id]?.loyalty).toBeUndefined();
    expect(s.deltas[id]?.formerOwner).toBeUndefined();
    expect(s.deltas[id]?.revoltSince).toBeUndefined();
  });

  it('дома против врага войны: работа есть, без гонорара; победа — в счёт и с театра врага', () => {
    // Мир роты у границы с Домом, с которым держава воюет: биржа видит живую войну.
    let home = -1;
    let foe = '';
    for (let i = 0; i < GALAXY.count && home < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital') || FACTIONS.get(GALAXY.ownerId(i))?.kind !== 'house') continue;
      const f = GALAXY.neighbors(i)
        .map((j) => GALAXY.ownerId(j))
        .find((o) => o !== GALAXY.ownerId(i) && FACTIONS.get(o)?.kind === 'house');
      if (f !== undefined) [home, foe] = [i, f];
    }
    const id = GALAXY.id(home);
    const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
    s.company = { ...makeCompany(), ...lanceCompany() };
    ownedAt(s, home, 50);
    const peaceful = judgedContracts(s.worldSeed, s.deltas, id, s.day, s.reputation, s.war);
    expect(peaceful.some((o) => o.contract.target === foe)).toBe(false);

    run(s, { kind: 'declareWar', factionId: foe });
    s.war = withTheater(s.war, foe, PLAYER_ACTOR_ID, 30);
    const offers = judgedContracts(s.worldSeed, s.deltas, id, s.day, s.reputation, s.war);
    // Часть работы разбирают местные отряды (`takenByLocals`): берётся из того, что дошло до биржи.
    const offer = availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).find(
      (c) => c.target === foe && c.revolt !== true,
    );
    if (offer === undefined) throw new Error('нет работы против врага войны');
    for (const o of offers) {
      expect(o.allowed).toBe(true);
      expect([o.contract.payout, o.contract.advance, o.contract.penalty, o.contract.stakes]).toEqual([0, 0, 0, 'none']);
    }

    const rec = playerWarOf(s.war, foe);
    const theater = theaterOf(s.war, foe, PLAYER_ACTOR_ID);
    run(s, { kind: 'takeContract', contractId: offer.id });
    run(s, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    const outcome = wonOutcome(s);
    const sunk = outcome.units.filter((u) => u.side === 'opfor').length;
    run(s, { kind: 'resolveContract', outcome, salvage: [] });
    expect(playerWarOf(s.war, foe)?.won).toBe((rec?.won ?? 0) + 1);
    expect(theaterOf(s.war, foe, PLAYER_ACTOR_ID)).toBe(theater - Math.min(theater, sunk));
    expect(playerWarOf(s.war, foe)?.foeFatigue ?? 0).toBeGreaterThan(rec?.foeFatigue ?? 0);
    expect(s.deltas[id]?.loyalty).toBe(50 + L.win);
  });
});

describe('пираты у дома (шаг 89)', () => {
  it('прорыв на мир роты — оборона против вольницы на бирже; победа вычищает мир и снимает работу', () => {
    const i = houseWorld();
    const id = GALAXY.id(i);
    const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
    s.company = { ...makeCompany(), ...lanceCompany() };
    ownedAt(s, i, 80);
    const none = availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).find((c) => c.homeRaid === true);
    expect(none).toBeUndefined();

    const posted = postHomeRaids(s.deltas, [{ systemId: id, owner: PLAYER_ACTOR_ID }], s.day);
    s.deltas = posted.deltas;
    expect(posted.posted).toHaveLength(1);
    const offer = availableContracts(s.worldSeed, s.deltas, id, s.day, [], s.reputation, s.war).find((c) => c.homeRaid === true);
    if (offer === undefined) throw new Error('нет работы «пираты у дома»');
    expect(offer.target).toBe(PIRATE_FACTION);
    expect(offer.employer).toBe(PLAYER_ACTOR_ID);
    expect([offer.payout, offer.advance, offer.penalty]).toEqual([0, 0, 0]);

    const before = s.deltas[id]?.loyalty as number;
    const clearedBefore = s.deltas[id]?.cleared ?? 0;
    run(s, { kind: 'takeContract', contractId: offer.id });
    run(s, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    const resolved = run(s, { kind: 'resolveContract', outcome: wonOutcome(s), salvage: [] });
    expect(resolved.some((e) => e.kind === 'homeRaidRepelled' && e.systemId === id && e.by === 'company')).toBe(true);
    expect(s.deltas[id]?.raidedUntil).toBeUndefined();
    expect(s.deltas[id]?.cleared ?? 0).toBeGreaterThan(clearedBefore);
    expect(s.deltas[id]?.loyalty).toBe(Math.round((before + L.win) * 100) / 100);
  });

  it('набег на чужой мир работы не ставит; срок истекает; мир ушёл — срок снят', () => {
    const i = houseWorld();
    const id = GALAXY.id(i);
    const s = new CampaignState(WORLD, { worldSeed: WORLD, systemId: id });
    ownedAt(s, i, 80);
    const other = GALAXY.id(houseWorld(i + 1));
    const r = postHomeRaids(s.deltas, [{ systemId: id, owner: PLAYER_ACTOR_ID }, { systemId: other, owner: ownerOf(s.deltas, GALAXY.require(other)) }], s.day);
    expect(r.posted.map((p) => p.systemId)).toEqual([id]);
    const until = r.deltas[id]?.raidedUntil as number;
    expect(until).toBeGreaterThanOrEqual(s.day + (CONTRACTS.pirates.homeRaidDecades - 1) * WAR.front.tickDays);
    expect(postHomeRaids(r.deltas, [], until).deltas[id]?.raidedUntil).toBe(until);
    expect(postHomeRaids(r.deltas, [], until + 1).deltas[id]?.raidedUntil).toBeUndefined();
    const lost = withDelta(r.deltas, id, { owner: GALAXY.ownerId(i) });
    expect(postHomeRaids(lost, [], s.day).deltas[id]?.raidedUntil).toBeUndefined();
  });
});
