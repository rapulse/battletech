import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  GALAXY_RULES,
  applySystemCapture,
  developCostAt,
  developmentMaxAt,
  makeWarState,
  systemProfile,
  worldProfile,
  MARKET,
  PLAYER_ACTOR_ID,
  WAR,
  CampaignRejectReason,
  activeBuildings,
  buildEtaDecades,
  buildPoints,
  buildTick,
  buildingCost,
  buildingRefund,
  buildingUpkeep,
  buildingsLostPatch,
  domainCapitalIndex,
  execute,
  factoryAllowed,
  frontSectors,
  frontShares,
  frontWeights,
  garrisonAt,
  hashCampaignState,
  loyaltyDrift,
  makeRecord,
  makeSaveFile,
  marketProfile,
  mechStock,
  ownerOf,
  parseSaveFile,
  realmMarketOf,
  regimentPrice,
  restore,
  sectorForces,
  snapshot,
  withDelta,
  withStanding,
  withTheater,
  zoneRepairPlan,
  type BuildingKind,
  type CampaignEvent,
  type CampaignState,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { ECONOMY } from '../src/core/data/index.js';
import { zoneFromId } from '../src/core/model/index.js';
import { generateAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Постройки мира роты (шаг 87): очередь стройки, содержание, потеря мира, эффекты шести построек, сохранение.
 */

const B = WAR.buildings;

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
    ui.state.company = { ...ui.state.company, cbills: 200_000_000 };
    return { ui, s: ui.state, home: i, second, foe };
  }
  throw new Error('нет подходящей пары миров');
}

function built(s: CampaignState, i: number, ...kinds: BuildingKind[]): void {
  s.deltas = withDelta(s.deltas, GALAXY.id(i), { buildings: kinds });
}

function piloted(s: CampaignState): string[] {
  return s.company.mechs.filter((m) => m.pilotId !== null).map((m) => m.id);
}

function damage(s: CampaignState, recordId: string): void {
  const idx = zoneFromId('leftArm');
  s.company = {
    ...s.company,
    mechs: s.company.mechs.map((m) =>
      m.id !== recordId
        ? m
        : { ...m, condition: { ...m.condition, zones: m.condition.zones.map((z, i) => (i === idx ? { ...z, armor: 0 } : z)) } },
    ),
  };
}

function spare(id: string): MechRecord {
  return makeRecord({ id, name: id, assembly: generateAssembly({ chassisCode: 'IS-H40-R1F3', role: 'brawler' }, new Rng(1)) });
}

/** Прокрутка на `days` суток с отказом на требования соседа (шаг 89): карточка останавливает время, а тест — о другом. */
function advanceThrough(s: CampaignState, days: number): CampaignEvent[] {
  const end = s.day + days;
  const events: CampaignEvent[] = [];
  for (;;) {
    if (s.war.demands?.pending !== undefined) execute(s, { kind: 'answerDemand', accept: false });
    if (s.day >= end) return events;
    const r = execute(s, { kind: 'advanceTo', day: end });
    if (!r.ok) throw new Error(`прокрутка не прошла: ${r.reason}`);
    events.push(...r.events);
  }
}

describe('стройка: очередь, деньги, срок (шаг 87)', () => {
  it('поставить — цена списана, одна стройка на мир; отмена — половина назад', () => {
    const { s, home, second, foe } = realm();
    const id = GALAXY.id(home);
    const cash = s.company.cbills;
    const r = execute(s, { kind: 'startBuilding', systemId: id, building: 'workshop' });
    expect(r.ok).toBe(true);
    expect(s.company.cbills).toBe(cash - buildingCost('workshop'));
    const ev = r.ok ? r.events[0] : undefined;
    expect(ev?.kind === 'buildingStarted' && ev.decades).toBe(buildEtaDecades(s.worldSeed, s.deltas, home, 'workshop'));
    expect(execute(s, { kind: 'startBuilding', systemId: id, building: 'depot' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.BuildBusy,
    });
    // Другой мир строит параллельно; чужой — нельзя.
    expect(execute(s, { kind: 'startBuilding', systemId: GALAXY.id(second), building: 'depot' }).ok).toBe(true);
    const foreign = GALAXY.neighbors(home).find((j) => ownerOf(s.deltas, j) === foe) as number;
    expect(execute(s, { kind: 'startBuilding', systemId: GALAXY.id(foreign), building: 'depot' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotOwned,
    });
    const before = s.company.cbills;
    expect(execute(s, { kind: 'cancelBuilding', systemId: id }).ok).toBe(true);
    expect(s.company.cbills).toBe(before + buildingRefund('workshop'));
    expect(buildingRefund('workshop')).toBe(Math.round(buildingCost('workshop') * B.cancelRefund));
    expect(execute(s, { kind: 'cancelBuilding', systemId: id })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NothingToCancel,
    });
    // Готовую второй раз не построить.
    built(s, home, 'workshop');
    expect(execute(s, { kind: 'startBuilding', systemId: id, building: 'workshop' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadyBuilt,
    });
  });

  it('срок — трудоёмкость ÷ очки мира; очки — мощность, но не меньше пола', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    const points = buildPoints(s.worldSeed, s.deltas, home);
    expect(points).toBeGreaterThanOrEqual(B.minPoints);
    s.deltas = withDelta(s.deltas, id, { building: 'defence', buildProgress: 0 });
    const eta = Math.ceil(B.kinds.defence.work / points);
    let deltas = s.deltas;
    for (let n = 1; n <= eta; n++) {
      const t = buildTick(s.worldSeed, deltas);
      deltas = t.deltas;
      expect(t.done.length > 0).toBe(n === eta);
    }
    expect(deltas[id]?.buildings).toEqual(['defence']);
    expect(deltas[id]?.building).toBeUndefined();
    expect(deltas[id]?.buildProgress).toBeUndefined();
  });

  it('завод — только на мире с военной промышленностью от порога', () => {
    const { s, home, second } = realm();
    for (const i of [home, second]) {
      const r = execute(s, { kind: 'startBuilding', systemId: GALAXY.id(i), building: 'factory' });
      if (factoryAllowed(s.worldSeed, s.deltas, i)) expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, reason: CampaignRejectReason.BuildNeedsIndustry });
    }
  });

  it('такт державы: стройка идёт, готовая — событие; содержание — строкой итога', () => {
    const { s, home } = realm();
    built(s, home, 'workshop', 'barracks');
    expect(execute(s, { kind: 'startBuilding', systemId: GALAXY.id(home), building: 'depot' }).ok).toBe(true);
    const events = [];
    for (let n = 0; n < 12; n++) events.push(...advanceThrough(s, WAR.front.tickDays));
    const tick = events.find((e) => e.kind === 'domainTicked');
    expect(tick?.kind === 'domainTicked' && tick.buildings).toBe(buildingUpkeep('workshop') + buildingUpkeep('barracks'));
    expect(events.some((e) => e.kind === 'buildingDone' && e.building === 'depot')).toBe(true);
    expect(activeBuildings(s.deltas, home)).toEqual(['workshop', 'depot', 'barracks']);
  });
});

describe('потеря мира (шаг 87)', () => {
  it('уцелевшие спят, пока мир чужой; бросок воспроизводим; доля — около surviveLoss', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    built(s, home, 'workshop', 'depot', 'barracks', 'defence', 'spaceport', 'factory');
    const a = buildingsLostPatch(s.worldSeed, s.deltas, id, s.day);
    expect(buildingsLostPatch(s.worldSeed, s.deltas, id, s.day)).toEqual(a);
    expect(a.kept.length + a.lost.length).toBe(6);
    let kept = 0;
    for (let day = 0; day < 400; day++) kept += buildingsLostPatch(s.worldSeed, s.deltas, id, day).kept.length;
    expect(kept / 2400).toBeGreaterThan(B.surviveLoss - 0.05);
    expect(kept / 2400).toBeLessThan(B.surviveLoss + 0.05);
    // Спящие не действуют у чужого хозяина и просыпаются у роты.
    s.deltas = withDelta(s.deltas, id, { owner: 'davion' });
    expect(activeBuildings(s.deltas, home)).toEqual([]);
    s.deltas = withDelta(s.deltas, id, { owner: PLAYER_ACTOR_ID });
    expect(activeBuildings(s.deltas, home).length).toBe(6);
  });

  it('отказ от мира: недострой пропадает, постройки — броском; событие в журнал', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    built(s, home, 'workshop', 'barracks');
    expect(execute(s, { kind: 'startBuilding', systemId: id, building: 'depot' }).ok).toBe(true);
    const roll = buildingsLostPatch(s.worldSeed, s.deltas, id, s.day);
    const r = execute(s, { kind: 'abandonWorld', systemId: id });
    expect(r.ok).toBe(true);
    const e = r.ok ? r.events.find((x) => x.kind === 'buildingsLost') : undefined;
    expect(e).toEqual({ kind: 'buildingsLost', systemId: id, lost: roll.lost, kept: roll.kept, construction: 'depot' });
    expect(s.deltas[id]?.building).toBeUndefined();
    expect(s.deltas[id]?.buildings ?? []).toEqual(roll.kept);
  });
});

describe('эффекты построек (шаг 87)', () => {
  it('цех: без него машина на мире не чинится; в цехе — дешевле и быстрее, свои стапели', () => {
    const { s, home } = realm();
    const [a, b, c] = piloted(s);
    damage(s, a as string);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string] }).ok).toBe(true);
    expect(execute(s, { kind: 'repairZone', recordId: a as string, zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NoWorkshop,
    });
    built(s, home, 'workshop');
    const plan = zoneRepairPlan(s.company.mechs.find((m) => m.id === a) as MechRecord, 'leftArm');
    const cash = s.company.cbills;
    const r = execute(s, { kind: 'repairZone', recordId: a as string, zone: 'leftArm' });
    expect(r.ok).toBe(true);
    expect(cash - s.company.cbills).toBe(Math.round(plan.cost * B.workshopCost));
    const job = s.queue.find((e) => e.task.kind === 'repairJob' && e.task.recordId === a);
    expect(job?.task.kind === 'repairJob' && job.task.workshop).toBe(GALAXY.id(home));
    expect(job?.day).toBe(s.day + Math.max(1, Math.ceil(plan.days * B.workshopDays)));
    // Машина корабля в системе с цехом встаёт в цех, пока там есть место, дальше — на стапель корабля.
    for (const id of [b, c]) damage(s, id as string);
    expect(execute(s, { kind: 'repairZone', recordId: b as string, zone: 'leftArm' }).ok).toBe(true);
    expect(execute(s, { kind: 'repairZone', recordId: c as string, zone: 'leftArm' }).ok).toBe(true);
    const site = (id: string) => {
      const e = s.queue.find((x) => x.task.kind === 'repairJob' && x.task.recordId === id);
      return e?.task.kind === 'repairJob' ? e.task.workshop : 'нет';
    };
    expect(site(b as string)).toBe(GALAXY.id(home));
    expect(site(c as string)).toBeUndefined();
  });

  it('казармы: предел гарнизона, лояльность, автонайм дешевле', () => {
    const { s, home, second } = realm();
    const id = GALAXY.id(home);
    const [a] = piloted(s);
    const fake = Object.fromEntries(
      Array.from({ length: B.garrisonCap }, (_, n) => [`x${n}`, { systemId: id, arrives: s.day }]),
    );
    s.garrison = { ...s.garrison, posts: { ...s.garrison.posts, ...fake } };
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.GarrisonFull,
    });
    const drift = loyaltyDrift(s.deltas, s.war, s.reputation, id, s.day);
    built(s, home, 'barracks');
    expect(loyaltyDrift(s.deltas, s.war, s.reputation, id, s.day)).toBeCloseTo(drift + B.barracksLoyalty, 10);
    expect(execute(s, { kind: 'garrisonUnload', recordIds: [a as string] }).ok).toBe(true);
    // Автонайм гарнизону — доля цены поиска.
    s.garrison = { ...s.garrison, posts: Object.fromEntries(Object.entries(s.garrison.posts).filter(([k]) => !k.startsWith('x'))) };
    s.company = { ...s.company, mechs: s.company.mechs.map((m) => (m.id === a ? { ...m, pilotId: null } : m)) };
    s.systemId = GALAXY.id(second);
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    const e = r.ok ? r.events.find((x) => x.kind === 'garrisonPilotHired') : undefined;
    expect(e?.kind === 'garrisonPilotHired' && e.cost).toBe(Math.round(ECONOMY.hiring.searchFee * B.barracksHireFee));
  });

  it('склад: машина без пилота встаёт на склад, автонайм её не трогает; с пилотом — гарнизон', () => {
    const { s, home, second } = realm();
    const id = GALAXY.id(home);
    s.company = { ...s.company, mechs: [...s.company.mechs, spare('S-1')] };
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ['S-1'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.GarrisonNeedsPilot,
    });
    built(s, home, 'depot');
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ['S-1'] }).ok).toBe(true);
    expect(s.garrison.posts['S-1']).toEqual({ systemId: id, arrives: s.day, depot: true });
    s.systemId = GALAXY.id(second);
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok && r.events.some((x) => x.kind === 'garrisonPilotHired')).toBe(false);
    expect(s.company.mechs.find((m) => m.id === 'S-1')?.pilotId).toBeNull();
    // Пилот на машину склада — она становится гарнизоном.
    s.systemId = id;
    const idle = s.company.pilots.find((p) => p.status === 'active' && !s.company.mechs.some((m) => m.pilotId === p.id));
    const donor = s.company.mechs.find((m) => m.pilotId !== null && s.garrison.posts[m.id] === undefined);
    const pilotId = idle?.id ?? (donor?.pilotId as string);
    expect(execute(s, { kind: 'assignPilot', recordId: 'S-1', pilotId }).ok).toBe(true);
    expect(s.garrison.posts['S-1']).toEqual({ systemId: id, arrives: s.garrison.posts['S-1']?.arrives });
    expect(garrisonAt(s.company, s.garrison, id, s.day).some((m) => m.id === 'S-1')).toBe(true);
  });

  it('орбитальная оборона: множитель обороны участка, рядом с фокусом', () => {
    const { ui, s, home, foe } = realm();
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    execute(s, { kind: 'advance', days: WAR.front.tickDays });
    s.war = withTheater(s.war, foe, PLAYER_ACTOR_ID, 60);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.system === home && x.attacker === foe && x.defender === PLAYER_ACTOR_ID);
    if (sector === undefined) throw new Error('нет участка врага на мир роты');
    const shares = frontShares(frontWeights(sectors));
    const plain = sectorForces(s.war, s.worldSeed, s.deltas, sector, shares);
    built(s, home, 'defence');
    const fort = sectorForces(s.war, s.worldSeed, s.deltas, sector, shares);
    expect(fort.attack).toBe(plain.attack);
    expect(fort.defence).toBeCloseTo(plain.defence * B.orbitalDefence, 6);
  });

  it('космопорт — класс лавки на ступень выше; завод — признак завода, цена машин и полка', () => {
    const { s, home } = realm();
    const id = GALAXY.id(home);
    const plain = marketProfile(s.worldSeed, id, 0, 0, realmMarketOf(s.deltas, id));
    const lots = mechStock(s.worldSeed, id, s.day, 0, 0, realmMarketOf(s.deltas, id));
    const army = regimentPrice(10, s.deltas);
    built(s, home, 'spaceport', 'factory');
    const up = marketProfile(s.worldSeed, id, 0, 0, realmMarketOf(s.deltas, id));
    const order = ['capital', 'industrial', 'developed', 'agrarian', 'backwater', 'periphery'];
    expect(order.indexOf(up.marketClass)).toBe(Math.max(0, order.indexOf(plain.marketClass) - 1));
    expect(up.mechFactory).toBe(true);
    expect(up.realmFactory).toBe(true);
    // Профиль мира не тронут: космопорт меняет только лавку.
    expect(marketProfile(s.worldSeed, id, 0, 0).marketClass).toBe(plain.marketClass);
    expect(regimentPrice(10, s.deltas)).toBe(Math.round(army * (1 - B.factoryArmyCut)));
    const factoryLots = mechStock(s.worldSeed, id, s.day, 0, 0, realmMarketOf(s.deltas, id));
    expect(factoryLots.length).toBeGreaterThan(lots.length);
    for (const lot of factoryLots) {
      expect(lot.price).toBe(Math.round(lot.value * up.priceFactor * MARKET.mechs.markup * B.factoryMechPrice));
    }
  });
});

describe('сохранение (шаг 87)', () => {
  it('круг: стройка, готовые и спящие постройки, пост склада; хэш их различает', () => {
    const { s, home, second } = realm();
    const before = hashCampaignState(s);
    built(s, home, 'workshop', 'depot');
    const afterBuilt = hashCampaignState(s);
    expect(afterBuilt).not.toBe(before);
    expect(execute(s, { kind: 'startBuilding', systemId: GALAXY.id(second), building: 'barracks' }).ok).toBe(true);
    expect(hashCampaignState(s)).not.toBe(afterBuilt);
    s.company = { ...s.company, mechs: [...s.company.mechs, spare('S-1')] };
    expect(execute(s, { kind: 'garrisonUnload', recordIds: ['S-1'] }).ok).toBe(true);
    const sleeping = GALAXY.neighbors(home).find((j) => ownerOf(s.deltas, j) !== PLAYER_ACTOR_ID) as number;
    built(s, sleeping, 'defence');
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(loaded.deltas).toEqual(s.deltas);
    expect(loaded.garrison).toEqual(s.garrison);
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(s));
  });
});

/** Ручки буста космопорта на время теста: зонд замера правит `WAR` так же, на лету. */
function withKnobs(patch: Partial<typeof B>, body: () => void): void {
  const knobs = B as unknown as Record<string, number>;
  const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, knobs[k] as number]));
  Object.assign(knobs, patch);
  try {
    body();
  } finally {
    Object.assign(knobs, saved);
  }
}

describe('космопорт: буст развития (2026-10-04)', () => {
  it('ручки по нулю: космопорт не трогает ни профиль, ни цену ступени, ни очки стройки', () => {
    // С шага 90 (ступень 8) класс порта включён в данных — здесь все четыре ручки обнулены явно.
    withKnobs({ spaceportDevelopCut: 0, spaceportPoints: 0, spaceportDevelopMax: 0, spaceportPortSteps: 0 }, () => {
      const { s, home } = realm();
      const profile = worldProfile(s.worldSeed, s.deltas, home);
      const points = buildPoints(s.worldSeed, s.deltas, home);
      built(s, home, 'spaceport');
      expect(worldProfile(s.worldSeed, s.deltas, home)).toEqual(profile);
      expect(developCostAt(s.deltas, home)).toBe(WAR.development.stepCost);
      expect(developmentMaxAt(s.deltas, home)).toBe(GALAXY_RULES.profile.development.max);
      expect(buildPoints(s.worldSeed, s.deltas, home)).toBe(points);
    });
  });

  it('скидка на ступень и очки стройки — только с космопортом', () => {
    withKnobs({ spaceportDevelopCut: 0.25, spaceportPoints: 3 }, () => {
      const { s, home } = realm();
      const points = buildPoints(s.worldSeed, s.deltas, home);
      expect(developCostAt(s.deltas, home)).toBe(WAR.development.stepCost);
      built(s, home, 'spaceport');
      expect(developCostAt(s.deltas, home)).toBe(Math.round(WAR.development.stepCost * 0.75));
      expect(buildPoints(s.worldSeed, s.deltas, home)).toBe(points + 3);
    });
  });

  it('потолок развития и класс порта поднимаются у мира роты и спят у чужого владельца', () => {
    withKnobs({ spaceportDevelopMax: 1, spaceportPortSteps: 1 }, () => {
      const { s, home } = realm();
      const id = GALAXY.id(home);
      const port = worldProfile(s.worldSeed, s.deltas, home).spaceport;
      built(s, home, 'spaceport');
      const max = GALAXY_RULES.profile.development.max;
      expect(developmentMaxAt(s.deltas, home)).toBe(max + 1);
      const up = worldProfile(s.worldSeed, s.deltas, home).spaceport;
      expect(up).toBe(port === 'A' ? 'A' : String.fromCharCode(port.charCodeAt(0) - 1));
      // Ступень сверх общего потолка не упирается в него (может упереться в «ступень ничего не меняет»).
      s.deltas = withDelta(s.deltas, id, { development: max });
      s.company = { ...s.company, cbills: WAR.development.stepCost * 2 };
      const r = execute(s, { kind: 'developWorld', systemId: id });
      if (!r.ok) expect(r.reason).toBe(CampaignRejectReason.DevelopmentNoEffect);
      // У чужого владельца постройка спит — профиль канонический.
      const foreign = withDelta(s.deltas, id, { owner: 'davion' });
      expect(developmentMaxAt(foreign, home)).toBe(max);
      expect(worldProfile(s.worldSeed, foreign, home)).toEqual(systemProfile(s.worldSeed, home, max));
    });
  });

  it('захват мира с бустом: экономика нового владельца сходится с полным пересчётом', () => {
    withKnobs({ spaceportDevelopMax: 1, spaceportPortSteps: 2 }, () => {
      const { s, home, foe } = realm();
      const id = GALAXY.id(home);
      built(s, home, 'spaceport');
      s.deltas = withDelta(s.deltas, id, { development: GALAXY_RULES.profile.development.max + 1 });
      const applied = applySystemCapture(s.war, s.deltas, s.worldSeed, home, foe, PLAYER_ACTOR_ID, new Rng(1), s.day);
      const full = makeWarState(s.worldSeed, applied.deltas).economy[foe];
      const live = applied.war.economy[foe];
      expect(live?.income).toBe(full?.income);
      expect(live?.upkeep).toBe(full?.upkeep);
      expect(live?.capacity).toBe(full?.capacity);
      expect(live?.lift).toBe(full?.lift);
    });
  });

  it('сохранение держит ступень сверх общего потолка, пока ручка поднята', () => {
    withKnobs({ spaceportDevelopMax: 1 }, () => {
      const { s, home } = realm();
      built(s, home, 'spaceport');
      s.deltas = withDelta(s.deltas, GALAXY.id(home), { development: GALAXY_RULES.profile.development.max + 1 });
      const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
      expect(hashCampaignState(back)).toBe(hashCampaignState(s));
    });
  });
});
