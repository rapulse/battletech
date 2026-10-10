import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  RIVALS,
  WAR,
  CampaignRejectReason,
  domainCapitalIndex,
  economyOf,
  execute,
  fundOf,
  greatHirePrice,
  hashCampaignState,
  makeSaveFile,
  ownerOf,
  parseSaveFile,
  restore,
  snapshot,
  syncDomainEconomy,
  withDelta,
  FACTION_LIST,
  withPlayerWar,
  withStanding,
  type CampaignState,
  type Regiment,
  bordersOf,
  cardOpen,
  demandForceRatio,
  answerDemand,
  demandTick,
  playerWarTick,
  signPact,
  standingOf,
  tributeOf,
  withEconomy,
  domainWorlds,
  nextTitle,
  realmBonuses,
  realmTitle,
  sectorLimit,
  stateConditionMet,
  titleBonusOf,
  titleOf,
} from '../src/core/campaign/index.js';
import { MILESTONES } from '../src/core/data/index.js';
import { regimentTick } from '../src/core/campaign/rivals/regiments.js';
import { Rng } from '../src/core/rng/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Шаг 89 — давление на державу и её рост: наём великого полка, требования соседей, пираты у дома, титулы.
 */

const H = RIVALS.regiment.hire;

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
function realmWithFoe(): { s: CampaignState; home: number; second: number; foe: string } {
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
    for (const w of [i, second]) ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(w), { loyalty: 100 });
    ui.state.company = { ...ui.state.company, cbills: 500_000_000 };
    return { s: ui.state, home: i, second, foe };
  }
  throw new Error('нет подходящей пары миров');
}

/** Война державы с соседом — командой игрока: запись войны и вражда, с которой у пары есть участки фронта. */
function atWar(s: CampaignState, foe: string): void {
  const r = execute(s, { kind: 'declareWar', factionId: foe });
  if (!r.ok) throw new Error(`войну не объявить: ${r.reason}`);
}

/** Полк без верности врагу — его можно нанять против любого. */
function freeRegiment(s: CampaignState, foe: string): string {
  const unit = RIVALS.registry.find(
    (u) => u.great !== undefined && u.great.loyalTo !== foe && s.rivals.regiments.some((r) => r.id === u.id),
  );
  if (unit === undefined) throw new Error('нет полка без верности');
  return unit.id;
}

describe('наём великого полка (шаг 89)', () => {
  it('цена из кассы, полк встаёт на мир державы у врага, наниматель — держава, срок', () => {
    const { s, home, foe } = realmWithFoe();
    atWar(s, foe);
    const id = freeRegiment(s, foe);
    const before = s.rivals.regiments.find((r) => r.id === id)!;
    const price = greatHirePrice(before);
    expect(price).toBe(before.mechs * H.pricePerMechDecade * H.termDecades);
    const cash = s.company.cbills;
    const r = execute(s, { kind: 'hireGreatRegiment', regimentId: id, against: foe });
    expect(r.ok).toBe(true);
    expect(s.company.cbills).toBe(cash - price);
    const hired = s.rivals.regiments.find((x) => x.id === id)!;
    expect(hired.employer).toBe(PLAYER_ACTOR_ID);
    expect(hired.systemId).toBe(GALAXY.id(home)); // единственный мир державы на границе с врагом
    expect(hired.hire).toEqual({ against: foe, until: s.day + H.termDecades * WAR.front.tickDays });
  });

  it('отказы: нет войны, уже нанят, верен врагу, мало денег, нет полка', () => {
    const { s, foe } = realmWithFoe();
    const id = freeRegiment(s, foe);
    const run = (regimentId: string, against: string) => execute(s, { kind: 'hireGreatRegiment', regimentId, against });
    expect(run(id, foe)).toMatchObject({ ok: false, reason: CampaignRejectReason.NotAtWar });
    atWar(s, foe);
    expect(run('нет-такого', foe)).toMatchObject({ ok: false, reason: CampaignRejectReason.RegimentNotFound });
    // Гончие Келла верны Штайнеру: против него — отказ, даже на войне (проверка верности идёт до места стоянки).
    expect(RIVALS.registry.find((u) => u.id === 'kell_hounds')?.great?.loyalTo).toBe('steiner');
    s.war = withPlayerWar(s.war, 'steiner', { since: s.day, won: 0, lost: 0 });
    expect(run('kell_hounds', 'steiner')).toMatchObject({ ok: false, reason: CampaignRejectReason.RegimentLoyal });
    const cash = s.company.cbills;
    s.company = { ...s.company, cbills: 0 };
    expect(run(id, foe)).toMatchObject({ ok: false, reason: CampaignRejectReason.InsufficientFunds });
    s.company = { ...s.company, cbills: cash };
    expect(run(id, foe).ok).toBe(true);
    expect(run(id, foe)).toMatchObject({ ok: false, reason: CampaignRejectReason.RegimentHired });
  });

  it('нанятый полк бьётся только с врагом найма, без гонорара; вклад в фонд — не выше потолка', () => {
    const { s, foe } = realmWithFoe();
    atWar(s, foe);
    const id = freeRegiment(s, foe);
    expect(execute(s, { kind: 'hireGreatRegiment', regimentId: id, against: foe }).ok).toBe(true);
    let regiments: readonly Regiment[] = s.rivals.regiments.filter((r) => r.id === id);
    // Доход державы в экономике — проекция, которую обновляет такт; здесь такта не было.
    let war = syncDomainEconomy(s.war, s.worldSeed, s.deltas, s.company.cbills);
    const cap = H.fundCapTicks * economyOf(war, PLAYER_ACTOR_ID).income;
    expect(cap).toBeGreaterThan(0);
    const rng = new Rng(7);
    let fought = 0;
    let wonAny = false;
    for (let tick = 0; tick < 30; tick++) {
      const out = regimentTick(regiments, war, s.reputation, s.deltas, s.worldSeed, s.day + tick * 10, rng);
      expect(out.hireEnds).toEqual([]);
      const before = regiments[0]!;
      for (const c of out.commissions) {
        fought++;
        wonAny ||= c.won;
        expect(c.employer).toBe(PLAYER_ACTOR_ID);
        expect(c.target).toBe(foe);
      }
      // Гонорара нет: касса полка тратится только на пополнение, приходов нет.
      expect(out.regiments[0]!.cbills).toBeLessThanOrEqual(before.cbills);
      expect(fundOf(out.war, PLAYER_ACTOR_ID, foe)).toBeLessThanOrEqual(Math.max(cap, fundOf(war, PLAYER_ACTOR_ID, foe)));
      regiments = out.regiments;
      war = out.war;
    }
    // Тест не проходит впустую: подряды были, и хоть один выигран.
    expect(fought).toBeGreaterThan(0);
    expect(wonAny).toBe(true);
    expect(fundOf(war, PLAYER_ACTOR_ID, foe)).toBeGreaterThan(0);
  });

  it('найм кончается: мир с врагом, срок; полк снова живёт по правилам шага 82', () => {
    const { s, foe } = realmWithFoe();
    atWar(s, foe);
    const id = freeRegiment(s, foe);
    expect(execute(s, { kind: 'hireGreatRegiment', regimentId: id, against: foe }).ok).toBe(true);
    const hired = s.rivals.regiments.filter((r) => r.id === id);

    const peace = regimentTick(hired, withPlayerWar(s.war, foe, undefined), s.reputation, s.deltas, s.worldSeed, s.day, new Rng(1));
    expect(peace.hireEnds).toEqual([{ regimentId: id, regimentName: hired[0]!.name, against: foe, how: 'peace' }]);
    expect(peace.regiments[0]!.hire).toBeUndefined();
    // Держава полк не нанимает: без найма он уходит с её мира в ту же декаду.
    expect(peace.moves.map((m) => m.regimentId)).toEqual([id]);

    const until = hired[0]!.hire!.until;
    const term = regimentTick(hired, s.war, s.reputation, s.deltas, s.worldSeed, until, new Rng(1));
    expect(term.hireEnds.map((e) => e.how)).toEqual(['term']);
  });

  it('круг сохранения с наймом; хэш его различает', () => {
    const { s, foe } = realmWithFoe();
    atWar(s, foe);
    expect(execute(s, { kind: 'hireGreatRegiment', regimentId: freeRegiment(s, foe), against: foe }).ok).toBe(true);
    const withHire = hashCampaignState(s);
    // Тот же снимок без одного поля найма — хэш обязан отличаться.
    const regiments = s.rivals.regiments;
    s.rivals = { ...s.rivals, regiments: regiments.map(({ hire: _h, ...r }) => r) };
    expect(hashCampaignState(s)).not.toBe(withHire);
    s.rivals = { ...s.rivals, regiments };
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(loaded.rivals.regiments).toEqual(s.rivals.regiments);
    expect(hashCampaignState(loaded)).toBe(withHire);
  });
});

describe('требования соседей (шаг 89)', () => {
  const DM = WAR.demands;

  /** Первый сосед, который сейчас предъявит требование, и мир требования; тест падает, если такого нет. */
  function issue(s: CampaignState): { from: string; systemId: string } {
    const r = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day);
    expect(r.card).toBeDefined();
    return r.card as { from: string; systemId: string };
  }

  it('сильный сосед без войны и угрозы требует дань с пограничного мира не столицы', () => {
    const { s, home, second } = realmWithFoe();
    const card = issue(s);
    expect(domainCapitalIndex(s.deltas)).toBe(second);
    expect(card.systemId).toBe(GALAXY.id(home));
    expect(demandForceRatio(s.war, bordersOf(s.deltas), card.from)).toBeGreaterThanOrEqual(DM.forceRatio);
  });

  it('не приходит: договор, угроза, слабый сосед, откат, открытая карточка', () => {
    const { s } = realmWithFoe();
    const { from } = issue(s);
    const none = (war = s.war, day = s.day) => demandTick(war, s.reputation, s.deltas, s.worldSeed, day).card?.from;
    // Договор с соседом — от него требования нет (первым становится следующий по id или никто).
    expect(none(signPact(s.war, s.reputation, PLAYER_ACTOR_ID, from, 'trade', s.day).war)).not.toBe(from);
    // Угроза: держава растёт за его счёт — он не требует, а объявляет войну (шаг 83).
    expect(none({ ...s.war, conquests: { ...s.war.conquests, [`${PLAYER_ACTOR_ID}>${from}`]: 50 } })).not.toBe(from);
    // Слабый сосед: у державы армия, перед которой его граница меньше чем вдвое сильнее.
    const strong = withEconomy(s.war, PLAYER_ACTOR_ID, { army: 1_000_000 });
    expect(demandForceRatio(strong, bordersOf(s.deltas), from)).toBeLessThan(DM.forceRatio);
    expect(none(strong)).not.toBe(from);
    // Откат: после требования того же соседа нет `cooldownDecades` декад; карточка открыта — новых нет вовсе.
    const issued = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day).war;
    expect(none(issued)).toBeUndefined();
    const closed = { ...issued, demands: { last: issued.demands!.last } };
    expect(none(closed, s.day + (DM.cooldownDecades - 1) * WAR.front.tickDays)).not.toBe(from);
    expect(none(closed, s.day + DM.cooldownDecades * WAR.front.tickDays)).toBe(from);
  });

  it('не требует с мира, взятого в идущую войну, и с мира в восстании (отладка 2026-10-03)', () => {
    const { s, home } = realmWithFoe();
    const id = GALAXY.id(home);
    const first = issue(s);
    expect(first.systemId).toBe(id);
    const other = FACTION_LIST.find((f) => f.kind === 'house' && f.id !== first.from)?.id as string;
    const card = (deltas = s.deltas, war = s.war) => demandTick(war, s.reputation, deltas, s.worldSeed, s.day).card?.systemId;
    const taken = withDelta(s.deltas, id, { formerOwner: other });
    // Прежний владелец без войны с державой — мир годится, как прежде.
    expect(card(taken)).toBe(id);
    const war = { ...s.war, playerWars: { [other]: { since: s.day, won: 1, lost: 0 } } };
    expect(card(taken, war)).not.toBe(id);
    expect(card(withDelta(s.deltas, id, { revoltSince: s.day }))).not.toBe(id);
  });

  it('карточка останавливает время; принять — дань и отношение вверх, отказать — набег или отношение вниз', () => {
    const { s } = realmWithFoe();
    const issued = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day);
    s.war = issued.war;
    const card = issued.card!;
    expect(cardOpen(s.war)).toBe(true);
    expect(execute(s, { kind: 'advance', days: 10 })).toMatchObject({ ok: false, reason: CampaignRejectReason.EventPending });

    // Отношение — с середины шкалы, чтобы сдвиг не упёрся в потолок (миры куплены при отношении 100).
    s.reputation = withStanding(s.reputation, card.from, -standingOf(s.reputation, card.from));
    const before = standingOf(s.reputation, card.from);
    const copy = restore(snapshot(s));
    const accepted = execute(s, { kind: 'answerDemand', accept: true });
    expect(accepted).toMatchObject({ ok: true, events: [{ kind: 'demandAnswered', outcome: 'accepted' }] });
    expect(tributeOf(s.deltas, card.systemId, s.day)).toBe(card.from);
    expect(s.deltas[card.systemId]?.tributeUntil).toBe(s.day + WAR.diplomacy.tributeDecades * WAR.front.tickDays);
    expect(standingOf(s.reputation, card.from)).toBe(before + DM.acceptStanding);
    expect(cardOpen(s.war)).toBe(false);
    expect(execute(s, { kind: 'answerDemand', accept: true })).toMatchObject({ ok: false, reason: CampaignRejectReason.NoDemand });

    const ruinBefore = copy.deltas[card.systemId]?.ruined ?? 0;
    const refused = execute(copy, { kind: 'answerDemand', accept: false });
    expect(refused).toMatchObject({ ok: true, events: [{ outcome: 'refused' }] });
    expect(tributeOf(copy.deltas, card.systemId, copy.day)).toBeUndefined();
    const punishment = refused.ok && refused.events[0]?.kind === 'demandAnswered' ? refused.events[0].punishment : undefined;
    if (punishment?.kind === 'raid') {
      // Набег: мир разорён, отношение не тронуто.
      expect(copy.deltas[card.systemId]?.ruined ?? 0).toBeGreaterThan(ruinBefore);
      expect(standingOf(copy.reputation, card.from)).toBe(before);
    } else {
      expect(punishment).toEqual({ kind: 'standing', delta: DM.refuseStanding });
      expect(standingOf(copy.reputation, card.from)).toBe(before + DM.refuseStanding);
    }
  });

  it('отказ: набег или отношение — бросок своим сидом из мира и дня, оба исхода около refuseRaidChance', () => {
    const { s } = realmWithFoe();
    s.war = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day).war;
    const card = s.war.demands!.pending!;
    let raids = 0;
    const n = 200;
    for (let d = 0; d < n; d++) {
      const r = answerDemand(s.war, s.reputation, s.deltas, s.day + d, false, s.worldSeed);
      const again = answerDemand(s.war, s.reputation, s.deltas, s.day + d, false, s.worldSeed);
      expect(again.punishment).toEqual(r.punishment);
      if (r.punishment?.kind === 'raid') {
        raids++;
        expect(r.deltas[card.systemId]?.ruined ?? 0).toBeGreaterThan(s.deltas[card.systemId]?.ruined ?? 0);
        expect(standingOf(r.reputation, card.from)).toBe(standingOf(s.reputation, card.from));
      } else {
        expect(r.punishment).toEqual({ kind: 'standing', delta: DM.refuseStanding });
      }
    }
    expect(raids / n).toBeGreaterThan(DM.refuseRaidChance - 0.15);
    expect(raids / n).toBeLessThan(DM.refuseRaidChance + 0.15);
  });

  it('отказы до aiDeclareStanding — война тем же такт-правилом шага 76', () => {
    const { s } = realmWithFoe();
    const { from } = issue(s);
    s.reputation = withStanding(s.reputation, from, WAR.playerWar.aiDeclareStanding - DM.refuseStanding - standingOf(s.reputation, from));
    s.war = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day).war;
    // День, в который сосед отвечает отношением, а не набегом: бросок отказа — из мира и дня.
    while (answerDemand(s.war, s.reputation, s.deltas, s.day, false, s.worldSeed).punishment?.kind !== 'standing') s.day++;
    expect(execute(s, { kind: 'answerDemand', accept: false }).ok).toBe(true);
    expect(standingOf(s.reputation, from)).toBeLessThanOrEqual(WAR.playerWar.aiDeclareStanding);
    const out = playerWarTick(s.war, s.reputation, s.deltas, s.day + WAR.front.tickDays);
    expect(out.moves).toContainEqual({ kind: 'war', over: from, under: PLAYER_ACTOR_ID });
  });

  it('мир ушёл до ответа — требование теряет смысл', () => {
    const { s } = realmWithFoe();
    s.war = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day).war;
    const card = s.war.demands!.pending!;
    s.deltas = withDelta(s.deltas, card.systemId, { owner: card.from });
    expect(execute(s, { kind: 'answerDemand', accept: true })).toMatchObject({ ok: true, events: [{ outcome: 'lapsed' }] });
    expect(tributeOf(s.deltas, card.systemId, s.day)).toBeUndefined();
  });

  it('круг сохранения с открытой карточкой и откатом; хэш их различает', () => {
    const { s } = realmWithFoe();
    const plain = hashCampaignState(s);
    s.war = demandTick(s.war, s.reputation, s.deltas, s.worldSeed, s.day).war;
    const open = hashCampaignState(s);
    expect(open).not.toBe(plain);
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(s))))));
    expect(loaded.war.demands).toEqual(s.war.demands);
    expect(hashCampaignState(loaded)).toBe(open);
    s.war = { ...s.war, demands: { last: s.war.demands!.last } };
    expect(hashCampaignState(s)).not.toBe(open);
  });
});

describe('титулы державы (шаг 89)', () => {
  const T = WAR.realm.titles;

  it('титул — по числу миров сейчас, прибавки копятся, следующий и миров до него', () => {
    expect(titleOf(0)).toBeNull();
    for (const [k, t] of T.entries()) {
      expect(titleOf(t.worlds)?.id).toBe(t.id);
      if (k > 0) expect(titleOf(t.worlds - 1)?.id).toBe(T[k - 1]!.id);
    }
    const top = T[T.length - 1]!;
    const sum = (key: 'loyalty' | 'points' | 'sectors' | 'army') => T.reduce((a, t) => a + (t[key] ?? 0), 0);
    expect(titleBonusOf(top.worlds)).toEqual({ loyalty: sum('loyalty'), points: sum('points'), sectors: sum('sectors'), army: sum('army') });
    expect(titleBonusOf(T[0]!.worlds)).toEqual({
      loyalty: T[0]!.loyalty ?? 0,
      points: T[0]!.points ?? 0,
      sectors: T[0]!.sectors ?? 0,
      army: T[0]!.army ?? 0,
    });
    expect(nextTitle(top.worlds)).toBeNull();
    expect(nextTitle(T[0]!.worlds)?.id).toBe(T[1]!.id);
  });

  it('прибавка титула — всем мирам державы в бонусах тактов и к пределу секторов', () => {
    const { s, home, second } = realmWithFoe();
    // Обязательная проверка: у какого-то титула есть прибавка лояльности, очков и секторов — иначе тест пуст.
    const withLoyalty = T.find((t) => (t.loyalty ?? 0) > 0)!;
    const withSectors = T.find((t) => (t.sectors ?? 0) > 0)!;
    expect(withLoyalty).toBeDefined();
    expect(withSectors).toBeDefined();
    const extra: number[] = [];
    for (let i = 0; i < GALAXY.count && extra.length < withSectors.worlds - 2; i++) {
      if (i !== home && i !== second && ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID) extra.push(i);
    }
    const before = sectorLimit(s.deltas);
    for (const i of extra) s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID, loyalty: 100, formerOwner: GALAXY.ownerId(i) });
    const worlds = 2 + extra.length;
    expect(realmTitle(s.deltas)?.id).toBe(titleOf(worlds)!.id);
    const bonus = titleBonusOf(worlds);
    const b = realmBonuses(s.deltas, s.realm, s.company.pilots);
    for (const i of [home, second, ...extra]) {
      expect(b.get(GALAXY.id(i))).toEqual({ loyalty: bonus.loyalty, points: bonus.points, defence: 1 });
    }
    expect(sectorLimit(s.deltas)).toBe(Math.floor(worlds / WAR.realm.worldsPerSector) + bonus.sectors);
    expect(sectorLimit(s.deltas)).toBeGreaterThan(before);
  });

  it('смена титула — событие той команды, что сменила число миров', () => {
    const { s, home } = realmWithFoe();
    // До следующего титула держава добирает миры дельтой, последний — командой отказа от мира в обратную сторону.
    const need = T.find((t) => t.worlds > 2)!;
    const extra: number[] = [];
    for (let i = 0; i < GALAXY.count && extra.length < need.worlds - 2; i++) {
      if (!GALAXY.hasFlag(i, 'capital') && ownerOf(s.deltas, i) !== PLAYER_ACTOR_ID) extra.push(i);
    }
    for (const i of extra) s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID, loyalty: 100, formerOwner: GALAXY.ownerId(i) });
    expect(realmTitle(s.deltas)?.id).toBe(need.id);
    s.systemId = GALAXY.id(home);
    const r = execute(s, { kind: 'abandonWorld', systemId: GALAXY.id(home) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.events.find((e) => e.kind === 'realmTitleChanged')).toEqual({
      kind: 'realmTitleChanged',
      from: need.id,
      to: titleOf(need.worlds - 1)!.id,
    });
  });

  it('вершина — веха главы «Звёздная Лига»; id вех-титулов есть в данных', () => {
    const { s } = realmWithFoe();
    const top = T[T.length - 1]!;
    const cond = { type: 'realmTitle' as const, id: top.id };
    expect(stateConditionMet(cond, s)).toBe(false);
    let n = domainWorlds(s.deltas).length;
    for (let i = 0; i < GALAXY.count && n < top.worlds; i++) {
      if (ownerOf(s.deltas, i) === PLAYER_ACTOR_ID) continue;
      s.deltas = withDelta(s.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID });
      n++;
    }
    expect(stateConditionMet(cond, s)).toBe(true);
    const ids = new Set(T.map((t) => t.id));
    const used = MILESTONES.campaigns.merc.chapters.flatMap((c) => c.milestones.map((m) => m.condition));
    const titled = used.filter((c) => c.type === 'realmTitle');
    expect(titled.length).toBeGreaterThan(0);
    for (const c of titled) expect(c.type === 'realmTitle' && ids.has(c.id)).toBe(true);
  });
});
