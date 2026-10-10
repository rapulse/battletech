import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  CampaignRejectReason,
  applyRealmPolicies,
  buildPoints,
  buildingCost,
  domainCapitalIndex,
  execute,
  frontSectors,
  frontShares,
  frontWeights,
  governorBonus,
  hashCampaignState,
  loyaltyDrift,
  makeSaveFile,
  offensiveCost,
  ownerOf,
  parseSaveFile,
  planOffensive,
  playerWarOf,
  realmBonuses,
  restore,
  sectorForces,
  sectorLimit,
  sectorMap,
  snapshot,
  stanceTarget,
  withDelta,
  withFund,
  withPlayerWar,
  withTheater,
  fundsOf,
  theaterOf,
  withStanding,
  type CampaignCommand,
  type CampaignEvent,
  type CampaignState,
} from '../src/core/campaign/index.js';
import type { Pilot } from '../src/core/model/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Секторы, губернаторы и стойки фронтов (шаг 88): сектор и предел, губернатор — пилот роты, бонусы навыков, политика
 * губернатора и стойки отдаёт те же команды, что игрок, такт и сохранение.
 */

const R = WAR.realm;

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

/** Держава из двух соседних миров Дома; у `home` сосед — другой Дом `foe`; столица — `second`. */
function realmWithFoe(): { ui: CampaignUi; s: CampaignState; home: number; second: number; foe: string } {
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
    // Верные миры: тест о политиках, а не о лояльности (купленные на 70 содержания не окупают, шаг 85).
    for (const w of [i, second]) ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(w), { loyalty: 100 });
    ui.state.company = { ...ui.state.company, cbills: 200_000_000 };
    return { ui, s: ui.state, home: i, second, foe };
  }
  throw new Error('нет подходящей пары миров');
}

/** Отдать роте ещё миры (минуя покупку): тесты сектора считают миры, а не цену. */
function own(s: CampaignState, ...worlds: number[]): void {
  for (const i of worlds) {
    s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID, loyalty: 100, formerOwner: GALAXY.ownerId(i) });
  }
}

/** Системы ровно в `d` прыжках от `from` (обход в ширину). */
function ring(from: number, d: number): number[] {
  const seen = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let k = 1; k <= d; k++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.set(j, k);
        next.push(j);
      }
    }
    frontier = next;
  }
  return [...seen].filter(([, k]) => k === d).map(([i]) => i);
}

function seatedPilot(s: CampaignState): string {
  const m = s.company.mechs.find((x) => x.pilotId !== null);
  if (m?.pilotId == null) throw new Error('нет пилота в машине');
  return m.pilotId;
}

function withSkills(s: CampaignState, pilotId: string, skills: Record<string, number>): void {
  s.company = {
    ...s.company,
    pilots: s.company.pilots.map((p) => (p.id === pilotId ? { ...p, skills: { ...p.skills, ...skills } } : p)),
  };
}

function kinds(events: readonly CampaignEvent[]): string[] {
  return events.map((e) => e.kind);
}

/** Политики с записью команд: исполняются через `execute`, как у игрока. */
function recordPolicies(s: CampaignState): { events: CampaignEvent[]; commands: CampaignCommand[] } {
  const commands: CampaignCommand[] = [];
  const events = applyRealmPolicies(s, (command) => {
    const r = execute(s, command);
    if (!r.ok) return null;
    commands.push(command);
    return r.events;
  });
  return { events, commands };
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

describe('сектор (шаг 88)', () => {
  it('миры в радиусе центра; ближайший центр, при равенстве — старший; вне радиуса — ничей', () => {
    const { s, home } = realmWithFoe();
    const near = ring(home, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, 2);
    const far = ring(home, R.sectorJumps + 1)[0] as number;
    own(s, ...near, far);
    s.realm = { ...s.realm, sectors: [{ center: GALAXY.id(home), governor: null, priority: 'income' }] };
    const map = sectorMap(s.deltas, s.realm);
    for (const i of [home, ...near]) expect(map.get(GALAXY.id(i))).toBe(GALAXY.id(home));
    expect(map.has(GALAXY.id(far))).toBe(false);

    // Второй сектор с центром в `near[0]`: мир на равном расстоянии от обоих остаётся старшему.
    const b = near[0] as number;
    s.realm = { ...s.realm, sectors: [...s.realm.sectors, { center: GALAXY.id(b), governor: null, priority: 'income' }] };
    const two = sectorMap(s.deltas, s.realm);
    expect(two.get(GALAXY.id(b))).toBe(GALAXY.id(b));
    expect(two.get(GALAXY.id(home))).toBe(GALAXY.id(home));
    // Мир в прыжке и от `home`, и от `b` — отдать роте и проверить, что он у старшего сектора.
    const tie = GALAXY.neighbors(home).find((i) => i !== b && GALAXY.neighbors(b).includes(i));
    if (tie === undefined) throw new Error('нет мира в прыжке от обоих центров');
    own(s, tie);
    expect(sectorMap(s.deltas, s.realm).get(GALAXY.id(tie))).toBe(GALAXY.id(home));
  });

  it('предел — миров ÷ worldsPerSector; лишний сектор — отказ, сектор с тем же центром меняет губернатора', () => {
    const { s, home } = realmWithFoe();
    const pilot = seatedPilot(s);
    expect(sectorLimit(s.deltas)).toBe(Math.floor(2 / R.worldsPerSector));
    const cmd: CampaignCommand = { kind: 'appointGovernor', centerId: GALAXY.id(home), pilotId: pilot, priority: 'income' };
    if (sectorLimit(s.deltas) === 0) {
      const r = execute(s, cmd);
      expect(!r.ok && r.reason).toBe(CampaignRejectReason.SectorLimit);
    }
    own(s, ...ring(home, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, R.worldsPerSector));
    expect(sectorLimit(s.deltas)).toBeGreaterThanOrEqual(1);
    expect(execute(s, cmd).ok).toBe(true);
    const other = s.company.pilots.find((p) => p.id !== pilot && p.status === 'active') as Pilot;
    const r = execute(s, { kind: 'appointGovernor', centerId: GALAXY.id(home), pilotId: other.id, priority: 'defence' });
    expect(r.ok && r.events.find((e) => e.kind === 'governorAppointed')).toMatchObject({ replaced: pilot, priority: 'defence' });
    expect(s.realm.sectors).toHaveLength(1);
  });
});

describe('губернатор — пилот роты (шаг 88)', () => {
  function withSector(): { s: CampaignState; home: number; pilot: string; recordId: string } {
    const { s, home } = realmWithFoe();
    own(s, ...ring(home, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, R.worldsPerSector));
    const pilot = seatedPilot(s);
    const recordId = s.company.mechs.find((m) => m.pilotId === pilot)?.id as string;
    const r = execute(s, { kind: 'appointGovernor', centerId: GALAXY.id(home), pilotId: pilot, priority: 'income' });
    expect(r.ok).toBe(true);
    return { s, home, pilot, recordId };
  }

  it('снят с машины, в машину не садится; снятие с поста распускает сектор и освобождает пилота', () => {
    const { s, home, pilot, recordId } = withSector();
    expect(s.company.mechs.find((m) => m.id === recordId)?.pilotId).toBeNull();
    const seat = execute(s, { kind: 'assignPilot', recordId, pilotId: pilot });
    expect(!seat.ok && seat.reason).toBe(CampaignRejectReason.PilotIsGovernor);
    const r = execute(s, { kind: 'releaseGovernor', centerId: GALAXY.id(home) });
    expect(r.ok && r.events[0]).toMatchObject({ kind: 'sectorDissolved', pilotId: pilot, reason: 'command' });
    expect(s.realm.sectors).toHaveLength(0);
    expect(execute(s, { kind: 'assignPilot', recordId, pilotId: pilot }).ok).toBe(true);
  });

  it('уволен — пост пуст, сектор стоит и ничего не делает', () => {
    const { s, home, pilot } = withSector();
    const r = execute(s, { kind: 'dismissPilot', pilotId: pilot });
    expect(r.ok && kinds(r.events)).toEqual(['pilotDismissed', 'governorLeft']);
    expect(s.realm.sectors[0]).toMatchObject({ center: GALAXY.id(home), governor: null });
    expect(recordPolicies(s).events).toEqual([]);
  });

  it('бонус навыков: presence — дрейф лояльности, tech — очки стройки, tactics — оборона; от пола линейно', () => {
    const { s, home, pilot } = withSector();
    withSkills(s, pilot, { presence: R.governor.skillFloor, tech: R.governor.skillFloor, tactics: R.governor.skillFloor });
    const flat = governorBonus(s.company.pilots.find((p) => p.id === pilot) as Pilot);
    expect(flat).toEqual({ loyalty: 0, points: 0, defence: 1 });
    const id = GALAXY.id(home);
    const drift = loyaltyDrift(s.deltas, s.war, s.reputation, id, s.day, realmBonuses(s.deltas, s.realm, s.company.pilots));
    const points = buildPoints(s.worldSeed, s.deltas, home, realmBonuses(s.deltas, s.realm, s.company.pilots));

    withSkills(s, pilot, { presence: R.governor.skillFloor + 3, tech: R.governor.skillFloor + 2, tactics: R.governor.skillFloor + 4 });
    const bonuses = realmBonuses(s.deltas, s.realm, s.company.pilots);
    expect(loyaltyDrift(s.deltas, s.war, s.reputation, id, s.day, bonuses)).toBeCloseTo(drift + 3 * R.governor.loyaltyPerLevel, 10);
    expect(buildPoints(s.worldSeed, s.deltas, home, bonuses)).toBe(points + 2 * R.governor.pointsPerLevel);
    expect(bonuses.get(id)?.defence).toBeCloseTo(1 + 4 * R.governor.defencePerLevel, 10);
    // Мир вне сектора бонуса не получает.
    const outside = ring(home, R.sectorJumps + 1)[0] as number;
    expect(bonuses.has(GALAXY.id(outside))).toBe(false);
  });

  it('оборона: множитель губернатора ложится в sectorForces мира роты', () => {
    const { ui, s, foe } = realmWithFoe();
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
    const sector = sectors.find((x) => x.defender === PLAYER_ACTOR_ID);
    if (sector === undefined) throw new Error('нет участка против мира роты');
    const shares = frontShares(frontWeights(sectors));
    const plain = sectorForces(s.war, s.worldSeed, s.deltas, sector, shares);
    const held = sectorForces(s.war, s.worldSeed, s.deltas, sector, shares, 1.2);
    expect(held.defence).toBeCloseTo(plain.defence * 1.2, 10);
    expect(held.odds).toBeLessThan(plain.odds);
  });
});

describe('политика губернатора (шаг 88)', () => {
  function governed(priority: 'income' | 'loyalty' = 'loyalty'): { s: CampaignState; home: number; pilot: string } {
    const { s, home } = realmWithFoe();
    own(s, ...ring(home, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, R.worldsPerSector));
    const pilot = seatedPilot(s);
    expect(execute(s, { kind: 'appointGovernor', centerId: GALAXY.id(home), pilotId: pilot, priority }).ok).toBe(true);
    return { s, home, pilot };
  }

  it('отдаёт те же команды, что игрок: те же команды через execute дают то же состояние', () => {
    const { s } = governed();
    const before = restore(snapshot(s));
    const { events, commands } = recordPolicies(s);
    expect(commands.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === 'realmPolicy')).toHaveLength(commands.length);
    for (const c of commands) expect(execute(before, c).ok).toBe(true);
    expect(hashCampaignState(before)).toBe(hashCampaignState(s));
  });

  it('порядок построек — по приоритету; закреплённый мир без команд', () => {
    const { s, home } = governed('loyalty');
    expect(execute(s, { kind: 'pinWorld', systemId: GALAXY.id(home), pinned: true }).ok).toBe(true);
    const { events } = recordPolicies(s);
    const builds = events.flatMap((e) => (e.kind === 'realmPolicy' && e.act.kind === 'build' ? [e.act] : []));
    expect(builds.length).toBeGreaterThan(0);
    for (const b of builds) expect(b.building).toBe(R.priorities.loyalty.buildings[0]);
    expect(builds.some((b) => b.systemId === GALAXY.id(home))).toBe(false);
  });

  it('касса не опускается ниже резерва', () => {
    const { s } = governed();
    expect(execute(s, { kind: 'setRealmReserve', amount: 300_000_000 }).ok).toBe(true);
    const cheapest = Math.min(...R.priorities.loyalty.buildings.map((k) => buildingCost(k)));
    s.company = { ...s.company, cbills: 300_000_000 + cheapest + buildingCost('barracks') - 1 };
    // Денег сверх резерва — на одну постройку из двух: одна встаёт, вторая упирается в резерв.
    expect(recordPolicies(s).commands).toHaveLength(1);
    expect(s.company.cbills).toBeGreaterThanOrEqual(300_000_000);
    const bad = execute(s, { kind: 'setRealmReserve', amount: 12_345 });
    expect(!bad.ok && bad.reason).toBe(CampaignRejectReason.BadReserve);
  });
});

describe('стойка фронта (шаг 88)', () => {
  /** Война с соседом-Домом, полки на театре после такта, фонд на приказ. */
  function armedWar(): { ui: CampaignUi; s: CampaignState; foe: string } {
    const { ui, s, foe } = realmWithFoe();
    s.company = { ...s.company, cbills: s.company.cbills + 20 * WAR.economy.mechCost };
    expect(ui.run({ kind: 'raiseRegiment', mechs: 20 })).toBe(true);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    execute(s, { kind: 'advance', days: WAR.front.tickDays });
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', offensiveCost(s.war, foe) * 3);
    return { ui, s, foe };
  }

  it('стойка только против врага, с которым война; «держать» не отдаёт приказов', () => {
    const { s, foe } = armedWar();
    const none = execute(s, { kind: 'setFrontStance', factionId: 'pirates-nowhere', stance: 'advance' });
    expect(!none.ok && none.reason).toBe(CampaignRejectReason.NotAtWar);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'advance' }).ok).toBe(true);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'hold' }).ok).toBe(true);
    expect(s.realm.stances).toEqual({});
    expect(recordPolicies(s).commands).toEqual([]);
  });

  it('«наступать» — приказ, только где он разрешён и шанс не ниже порога; второй в ту же декаду — нет', () => {
    const { s, foe } = armedWar();
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'advance' }).ok).toBe(true);
    const odds = (): number[] =>
      frontSectors(s.war, s.reputation, s.deltas, s.day)
        .filter((x) => x.attacker === PLAYER_ACTOR_ID && x.defender === foe)
        .flatMap((x) => {
          const c = planOffensive(s.war, s.reputation, s.deltas, s.worldSeed, x.system, s.day);
          return c.ok ? [c.forces.odds] : [];
        });
    // Пять машин против Дома — шанс ниже порога: стойка молчит, хотя приказ разрешён.
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, 5);
    expect(odds().length).toBeGreaterThan(0);
    expect(Math.max(...odds())).toBeLessThan(R.stanceMinOdds);
    expect(stanceTarget(s, foe)).toBeUndefined();
    expect(recordPolicies(s).commands).toEqual([]);

    // Театр втрое сильнее — шанс выше порога, приказ уходит на лучший участок.
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, theaterOf(s.war, PLAYER_ACTOR_ID, foe) * 10);
    // Цена приказа — за машину на направлении (шаг 90): фонд под усиленный театр.
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', offensiveCost(s.war, foe) * 3);
    const target = stanceTarget(s, foe);
    if (target === undefined) throw new Error('нет участка для стойки при сильном театре');
    expect(Math.max(...odds())).toBeGreaterThanOrEqual(R.stanceMinOdds);
    expect(recordPolicies(s).commands).toEqual([{ kind: 'orderOffensive', systemId: GALAXY.id(target) }]);
    expect(recordPolicies(s).commands).toEqual([]);
  });

  it('«наступать» без фонда — ни одного приказа, даже при сильном театре', () => {
    const { s, foe } = armedWar();
    s.war = withTheater(s.war, PLAYER_ACTOR_ID, foe, theaterOf(s.war, PLAYER_ACTOR_ID, foe) * 10);
    s.war = withFund(s.war, PLAYER_ACTOR_ID, 'pirates', offensiveCost(s.war, foe) * 3);
    expect(stanceTarget(s, foe)).toBeDefined();
    for (const r of fundsOf(s.war, PLAYER_ACTOR_ID)) s.war = withFund(s.war, PLAYER_ACTOR_ID, r.against, 0);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'advance' }).ok).toBe(true);
    expect(stanceTarget(s, foe)).toBeUndefined();
    expect(recordPolicies(s).commands).toEqual([]);
  });

  it('«уступать» — мир, только когда он даром', () => {
    const { s, foe } = armedWar();
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'yield' }).ok).toBe(true);
    const rec = playerWarOf(s.war, foe);
    if (rec === undefined) throw new Error('войны нет');
    // Ничья после срока — отступные: мира нет.
    s.war = withPlayerWar(s.war, foe, { ...rec, since: s.day - WAR.playerWar.minWarDays, won: 0, lost: 0 });
    expect(recordPolicies(s).commands).toEqual([]);
    // Рота впереди — мир даром.
    s.war = withPlayerWar(s.war, foe, { ...rec, since: s.day - WAR.playerWar.minWarDays, won: 1, lost: 0 });
    expect(recordPolicies(s).commands).toEqual([{ kind: 'makePeace', factionId: foe }]);
    expect(playerWarOf(s.war, foe)).toBeUndefined();
  });
});

describe('такт и сохранение (шаг 88)', () => {
  it('в такте фронта: стойка без войны снята, сектор без центра распущен, губернатор строит', () => {
    const { ui, s, home, second, foe } = realmWithFoe();
    const extra = ring(second, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, R.worldsPerSector);
    own(s, ...extra);
    const pilot = seatedPilot(s);
    expect(execute(s, { kind: 'appointGovernor', centerId: GALAXY.id(second), pilotId: pilot, priority: 'loyalty' }).ok).toBe(true);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'hold' }).ok).toBe(false);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'yield' }).ok).toBe(true);
    // Мир после срока даром — стойка «уступать» его заключит, и стойка снимется следующим тактом.
    const rec = playerWarOf(s.war, foe);
    if (rec === undefined) throw new Error('войны нет');
    s.war = withPlayerWar(s.war, foe, { ...rec, since: s.day - WAR.playerWar.minWarDays, won: 1 });
    const ev = advanceThrough(s, WAR.front.tickDays);
    const policy = ev.filter((e) => e.kind === 'realmPolicy');
    expect(policy.some((e) => e.kind === 'realmPolicy' && e.by.kind === 'governor' && e.act.kind === 'build')).toBe(true);
    expect(kinds(ev)).toContain('buildingStarted');
    advanceThrough(s, WAR.front.tickDays);
    expect(playerWarOf(s.war, foe)).toBeUndefined();
    expect(s.realm.stances).toEqual({});

    // Центр потерян (отказ от мира) — сектор распускается в такте, пилот свободен.
    expect(execute(s, { kind: 'abandonWorld', systemId: GALAXY.id(second) }).ok).toBe(true);
    const after = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    expect(after.ok && after.events.find((e) => e.kind === 'sectorDissolved')).toMatchObject({
      centerId: GALAXY.id(second),
      pilotId: pilot,
      reason: 'centerLost',
    });
    expect(s.realm.sectors).toHaveLength(0);
    expect(home).toBeGreaterThanOrEqual(0);
  });

  it('круг сохранения: секторы, стойки, резерв и закреплённые миры; хэш их различает', () => {
    const { ui, s, home, foe } = realmWithFoe();
    own(s, ...ring(home, 1).filter((i) => ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID).slice(0, R.worldsPerSector));
    const plain = hashCampaignState(s);
    expect(execute(s, { kind: 'appointGovernor', centerId: GALAXY.id(home), pilotId: seatedPilot(s), priority: 'army' }).ok).toBe(true);
    expect(execute(s, { kind: 'pinWorld', systemId: GALAXY.id(home), pinned: true }).ok).toBe(true);
    expect(execute(s, { kind: 'setRealmReserve', amount: R.reserveSteps[R.reserveSteps.length - 1] as number }).ok).toBe(true);
    expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
    expect(execute(s, { kind: 'setFrontStance', factionId: foe, stance: 'advance' }).ok).toBe(true);
    expect(hashCampaignState(s)).not.toBe(plain);
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(loaded.realm).toEqual(s.realm);
    expect(hashCampaignState(loaded)).toBe(hashCampaignState(s));
  });
});
