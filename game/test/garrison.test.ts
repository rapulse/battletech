import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  CampaignRejectReason,
  domainCapitalIndex,
  execute,
  findRoute,
  fitLance,
  frontSectors,
  frontShares,
  frontWeights,
  garrisonAt,
  hashCampaignState,
  makeSaveFile,
  mechCapacityOf,
  orderLance,
  ownerOf,
  parseSaveFile,
  resolveFrontBattle,
  restore,
  sectorForces,
  shipboardMechs,
  snapshot,
  withDelta,
  withStanding,
  withTheater,
  withFund,
  detachmentFloor,
  type CampaignState,
  postHomeRaids,
} from '../src/core/campaign/index.js';
import { ECONOMY } from '../src/core/data/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Гарнизон мира из машин роты (шаг 86b): команды, место в ангаре, бой за мир, отход, восстание.
 */

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

/** Держава из двух соседних миров Дома; у `home` сосед — другой Дом `foe`; столица — `second`. Рота — на `home`. */
function realm(): { ui: CampaignUi; s: CampaignState; home: number; second: number; foe: string } {
  const ui = makeUi();
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    const foe = GALAXY.neighbors(i)
      .map((j) => ownerOf(ui.state.deltas, j))
      .find((o) => o !== owner && FACTIONS.get(o)?.kind === 'house');
    if (foe === undefined) continue;
    const second = GALAXY.neighbors(i).find((j) => !GALAXY.hasFlag(j, 'capital') && ownerOf(ui.state.deltas, j) === owner);
    if (second === undefined) continue;
    if (!buy(ui, i) || !buy(ui, second)) continue;
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + (ui.realmPrices?.capital ?? 0) };
    if (domainCapitalIndex(ui.state.deltas) !== second) ui.run({ kind: 'moveCapital', systemId: GALAXY.id(second) });
    ui.state.systemId = GALAXY.id(i);
    return { ui, s: ui.state, home: i, second, foe };
  }
  throw new Error('нет подходящей пары миров');
}

function ids(s: CampaignState): string[] {
  return s.company.mechs.filter((m) => m.pilotId !== null).map((m) => m.id);
}

describe('гарнизон: команды и место в ангаре (шаг 86b)', () => {
  it('выгрузить — место в ангаре свободно, приказ армии гарнизон не берёт; забрать — обратно', () => {
    const { s, home, second } = realm();
    const [a, b] = ids(s);
    if (a === undefined || b === undefined) throw new Error('в роте нет двух машин с пилотами');
    const aboard = shipboardMechs(s.company, s.garrison).length;
    const r = execute(s, { kind: 'garrisonUnload', recordIds: [a] });
    expect(r.ok).toBe(true);
    expect(shipboardMechs(s.company, s.garrison).length).toBe(aboard - 1);
    expect(s.company.mechs.length).toBe(aboard);
    expect(garrisonAt(s.company, s.garrison, GALAXY.id(home), s.day).map((m) => m.id)).toEqual([a]);
    // Приказ на соседний мир — гарнизон не идёт, хоть рота и стоит рядом.
    expect(orderLance(s, second).some((p) => p.record.id === a)).toBe(false);
    // Машину гарнизона не продать; пилота не пересадить из другой системы, а стоя здесь — можно.
    const pilot = s.company.mechs.find((m) => m.id === a)?.pilotId as string;
    expect(execute(s, { kind: 'sellMech', recordId: a })).toEqual({ ok: false, reason: CampaignRejectReason.MechStationed });
    s.systemId = GALAXY.id(second);
    expect(execute(s, { kind: 'assignPilot', recordId: b, pilotId: pilot })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechStationed,
    });
    s.systemId = GALAXY.id(home);
    const back = s.company.mechs.find((m) => m.id === b)?.pilotId as string;
    expect(execute(s, { kind: 'assignPilot', recordId: a, pilotId: back }).ok).toBe(true);
    expect(execute(s, { kind: 'assignPilot', recordId: a, pilotId: pilot }).ok).toBe(true);
    expect(execute(s, { kind: 'assignPilot', recordId: b, pilotId: back }).ok).toBe(true);
    // Второй раз ту же машину не выгрузить; на чужом мире — нельзя.
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechStationed,
    });
    // Забрать из другой системы — нельзя.
    s.systemId = GALAXY.id(second);
    expect(execute(s, { kind: 'garrisonLoad', recordIds: [a] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotInGarrison,
    });
    s.systemId = GALAXY.id(home);
    expect(execute(s, { kind: 'garrisonLoad', recordIds: [a] }).ok).toBe(true);
    expect(s.garrison.posts).toEqual({});
  });

  it('забрать при полном ангаре — отказ; выгрузить на чужом мире — отказ', () => {
    const { s, home } = realm();
    const [a] = ids(s);
    if (a === undefined) throw new Error('нет машины');
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a] }).ok).toBe(true);
    s.company = { ...s.company, hangar: shipboardMechs(s.company, s.garrison).length };
    expect(mechCapacityOf(s.company)).toBe(shipboardMechs(s.company, s.garrison).length);
    expect(execute(s, { kind: 'garrisonLoad', recordIds: [a] })).toEqual({ ok: false, reason: CampaignRejectReason.HangarFull });
    const foreign = GALAXY.neighbors(home).find((j) => ownerOf(s.deltas, j) !== PLAYER_ACTOR_ID) as number;
    s.systemId = GALAXY.id(foreign);
    const [, b] = ids(s);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [b as string] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotOwned,
    });
  });

  it('сохранение и загрузка: гарнизон на мире, в пути и политика; хэш различает гарнизон', () => {
    const { s, home } = realm();
    const [a, b] = ids(s);
    const before = hashCampaignState(s);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string, b as string] }).ok).toBe(true);
    expect(hashCampaignState(s)).not.toBe(before);
    expect(execute(s, { kind: 'setGarrisonPolicy', systemId: GALAXY.id(home), policy: 'withdraw' }).ok).toBe(true);
    s.garrison = { ...s.garrison, posts: { ...s.garrison.posts, [b as string]: { systemId: GALAXY.id(home), arrives: s.day + 7 } } };
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(loaded.garrison).toEqual(s.garrison);
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(s));
  });
});

describe('гарнизон в бою за мир (шаг 86b)', () => {
  /** Война с соседом; у врага — сильный театр против державы, чтобы участок «враг → home» был. */
  function atWar(): { s: CampaignState; home: number; second: number; foe: string } {
    const r = realm();
    const { s, foe } = r;
    expect(r.ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    execute(s, { kind: 'advance', days: WAR.front.tickDays });
    s.war = withTheater(s.war, foe, PLAYER_ACTOR_ID, 60);
    s.systemId = GALAXY.id(r.home);
    return r;
  }

  function battle(s: CampaignState, foe: string, home: number, garrison?: Parameters<typeof resolveFrontBattle>[8]) {
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.system === home && x.attacker === foe && x.defender === PLAYER_ACTOR_ID);
    if (sector === undefined) throw new Error('нет участка врага на мир роты');
    const forces = sectorForces(s.war, s.worldSeed, s.deltas, sector, frontShares(frontWeights(sectors)));
    return resolveFrontBattle(sector, forces, s.war, s.worldSeed, s.deltas, s.day, 'front', [], garrison);
  }

  it('без гарнизона бой побитово прежний; гарнизон — отряд по доле, пол — равный бой, воспроизводимо', () => {
    const { s, foe, home } = atWar();
    expect(battle(s, foe, home, undefined)).toEqual(battle(s, foe, home));
    expect(battle(s, foe, home).garrison).toBeUndefined();

    expect(execute(s, { kind: 'garrisonUnload', recordIds: ids(s) }).ok).toBe(true);
    const lance = fitLance(s, garrisonAt(s.company, s.garrison, GALAXY.id(home), s.day));
    expect(lance.length).toBeGreaterThan(0);
    const a = battle(s, foe, home, { lance, mayWithdraw: false });
    expect(battle(s, foe, home, { lance, mayWithdraw: false })).toEqual(a);
    const c = a.garrison?.clash;
    if (c === undefined) throw new Error('гарнизон в бою не был');
    expect(a.garrison?.withdrew).toBe(false);
    const floor = detachmentFloor(lance, c.brief.enemy);
    expect(c.detachment).toBeGreaterThanOrEqual(Math.max(1, floor));
    expect(c.detachment).toBeLessThanOrEqual(Math.min(24, a.attackerSize));
    expect(a.attackerLost).toBeGreaterThanOrEqual(c.knocked);
    // Оборона мира та же: гарнизон — прибавка, а не замена ополчения.
    expect(a.defenderSize).toBe(battle(s, foe, home).defenderSize);
  });

  it('политика «отходить»: нападающий вдвое сильнее всей обороны — гарнизон уходит без боя, главный бой как без него', () => {
    const { s, foe, home } = atWar();
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ids(s) }).ok).toBe(true);
    const lance = fitLance(s, garrisonAt(s.company, s.garrison, GALAXY.id(home), s.day));
    // Перевеса нет — при «отходить» гарнизон всё равно дерётся.
    const even = battle(s, foe, home, { lance, mayWithdraw: true });
    expect(even.garrison?.ratio).toBeLessThan(2);
    expect(even.garrison?.withdrew).toBe(false);
    expect(even.garrison?.clash).toBeDefined();

    // Мир разорён, у врага огромный фонд — нападающий много сильнее всей обороны.
    s.deltas = withDelta(s.deltas, GALAXY.id(home), { ruined: 1 });
    s.war = withFund(s.war, foe, PLAYER_ACTOR_ID, 1e10);
    const away = battle(s, foe, home, { lance, mayWithdraw: true });
    expect(away.garrison?.ratio).toBeGreaterThanOrEqual(2);
    expect(away.garrison?.withdrew).toBe(true);
    expect(away.garrison?.clash).toBeUndefined();
    expect({ ...away, garrison: undefined }).toEqual({ ...battle(s, foe, home), garrison: undefined });
    // Отходить некуда или политика «драться» — дерётся.
    expect(battle(s, foe, home, { lance, mayWithdraw: false }).garrison?.withdrew).toBe(false);
  });
});

describe('гарнизон и потерянный мир (шаг 86b)', () => {
  it('мир отдан — гарнизон уходит на свой мир в прыжке; некуда — потерян с пилотами', () => {
    const { s, home, second } = realm();
    const [a, b] = ids(s);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string] }).ok).toBe(true);
    // Рота улетела — на корабль гарнизону не погрузиться.
    s.systemId = GALAXY.id(second);
    const r = execute(s, { kind: 'abandonWorld', systemId: GALAXY.id(home) });
    expect(r.ok).toBe(true);
    const moved = r.ok ? r.events.find((e) => e.kind === 'garrisonWithdrawn') : undefined;
    if (moved?.kind !== 'garrisonWithdrawn') throw new Error('гарнизон не ушёл');
    expect(moved.to).toBe(GALAXY.id(second));
    expect(moved.arrives).toBe(s.day + (findRoute(home, second)?.days ?? NaN));
    expect(s.garrison.posts[a as string]).toEqual({ systemId: GALAXY.id(second), arrives: moved.arrives });
    // В пути машина не дерётся и не забирается.
    expect(garrisonAt(s.company, s.garrison, GALAXY.id(second), s.day)).toEqual([]);

    // Последний мир: своего соседа нет, корабль далеко — гарнизон потерян вместе с пилотом.
    s.garrison = { ...s.garrison, posts: { [a as string]: { systemId: GALAXY.id(second), arrives: s.day } } };
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [b as string] }).ok).toBe(true);
    s.systemId = GALAXY.id(home);
    const pilots = s.company.mechs.filter((m) => m.id === a || m.id === b).map((m) => m.pilotId);
    const lost = execute(s, { kind: 'abandonWorld', systemId: GALAXY.id(second) });
    expect(lost.ok).toBe(true);
    const e = lost.ok ? lost.events.find((x) => x.kind === 'garrisonLost') : undefined;
    if (e?.kind !== 'garrisonLost') throw new Error('гарнизон не потерян');
    expect([...e.recordIds].sort()).toEqual([a, b].sort());
    expect(s.company.mechs.some((m) => m.id === a || m.id === b)).toBe(false);
    expect(s.company.pilots.some((p) => pilots.includes(p.id))).toBe(false);
    expect(s.garrison.posts).toEqual({});
  });
});

describe('гарнизон: погрузка и пилот (шаг 86b)', () => {
  it('мир отдан, а корабль здесь — гарнизон грузится на корабль, сколько поместится', () => {
    const { s, home } = realm();
    const [a, b] = ids(s);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string, b as string] }).ok).toBe(true);
    // Места — ровно на одну машину сверх тех, что на корабле.
    s.company = { ...s.company, hangar: shipboardMechs(s.company, s.garrison).length + 1 };
    const r = execute(s, { kind: 'abandonWorld', systemId: GALAXY.id(home) });
    expect(r.ok).toBe(true);
    const loaded = r.ok ? r.events.find((e) => e.kind === 'garrisonLoaded') : undefined;
    if (loaded?.kind !== 'garrisonLoaded') throw new Error('гарнизон не погрузился');
    expect(loaded.recordIds).toEqual([a]);
    expect(s.garrison.posts[a as string]).toBeUndefined();
    expect(r.ok && r.events.some((e) => e.kind === 'garrisonWithdrawn' && e.recordIds.includes(b as string))).toBe(true);
  });

  it('машина гарнизона без пилота нанимает его сама в такте, по цене поиска', () => {
    const { s, home, second } = realm();
    const [a] = ids(s);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string] }).ok).toBe(true);
    const old = s.company.mechs.find((m) => m.id === a)?.pilotId;
    s.company = { ...s.company, mechs: s.company.mechs.map((m) => (m.id === a ? { ...m, pilotId: null } : m)) };
    s.systemId = GALAXY.id(second);
    const cash = s.company.cbills;
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    const e = r.ok ? r.events.find((x) => x.kind === 'garrisonPilotHired') : undefined;
    if (e?.kind !== 'garrisonPilotHired') throw new Error('пилот не нанят');
    expect(e.systemId).toBe(GALAXY.id(home));
    expect(e.cost).toBe(ECONOMY.hiring.searchFee);
    const seat = s.company.mechs.find((m) => m.id === a)?.pilotId;
    expect(seat).toBe(e.pilotId);
    expect(seat).not.toBe(old);
    expect(s.company.pilots.some((p) => p.id === e.pilotId)).toBe(true);
    expect(s.company.cbills).toBeLessThan(cash);
  });
});

describe('гарнизон против восстания (шаг 86b)', () => {
  it('восставший мир с гарнизоном даёт бой в такте; победа гасит восстание, урон — в записях ангара', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ids(s) }).ok).toBe(true);
    const before = new Map(s.company.mechs.map((m) => [m.id, m]));
    s.deltas = withDelta(s.deltas, id, { loyalty: 10, formerOwner: ownerOf(s.deltas, GALAXY.neighbors(home)[0] as number), revoltSince: s.day });
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'garrisonRevoltBattle') : undefined;
    if (e?.kind !== 'garrisonRevoltBattle') throw new Error('боя восстания не было');
    expect(e.systemId).toBe(id);
    expect(s.deltas[id]?.revoltSince === undefined).toBe(e.won);
    for (const lostId of e.lostRecordIds) expect(s.company.mechs.some((m) => m.id === lostId)).toBe(false);
    // Бой был — хотя бы одна машина вышла из него не такой, какой вошла.
    const changed = s.company.mechs.some((m) => before.get(m.id) !== m) || e.lostRecordIds.length > 0;
    expect(changed).toBe(true);
  });

  it('восставший мир без гарнизона — боя нет', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    s.deltas = withDelta(s.deltas, id, { loyalty: 10, formerOwner: ownerOf(s.deltas, GALAXY.neighbors(home)[0] as number), revoltSince: s.day });
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok && r.events.some((x) => x.kind === 'garrisonRevoltBattle')).toBe(false);
  });
});

describe('гарнизон против вольницы (шаг 89)', () => {
  it('мир роты с работой «пираты у дома» и гарнизоном даёт бой в такте; победа снимает работу', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ids(s) }).ok).toBe(true);
    s.deltas = postHomeRaids(s.deltas, [{ systemId: id, owner: PLAYER_ACTOR_ID }], s.day).deltas;
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'garrisonRaidBattle') : undefined;
    if (e?.kind !== 'garrisonRaidBattle') throw new Error('боя с вольницей не было');
    expect(e.systemId).toBe(id);
    expect(s.deltas[id]?.raidedUntil === undefined).toBe(e.won);
    for (const lostId of e.lostRecordIds) expect(s.company.mechs.some((m) => m.id === lostId)).toBe(false);
  });

  it('без гарнизона — боя нет, работа ждёт роту', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    s.deltas = postHomeRaids(s.deltas, [{ systemId: id, owner: PLAYER_ACTOR_ID }], s.day).deltas;
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok && r.events.some((x) => x.kind === 'garrisonRaidBattle')).toBe(false);
    expect(s.deltas[id]?.raidedUntil).toBeDefined();
  });
});
