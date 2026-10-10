import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  domainCapitalIndex,
  economyOf,
  execute,
  foundingInit,
  frontTick,
  ownerOf,
  standingOf,
  totalArmy,
  withFund,
  withStanding,
  type CampaignEvent,
} from '../src/core/campaign/index.js';
import { REPUTATION } from '../src/core/campaign/reputation/schema.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { t } from '../src/ui/i18n/index.js';

/**
 * Журнал фронта державы (шаг 78): каждый бой фронта с ротой — событие при любом исходе, итог
 * потерь за такт — одной строкой, в сводке войны — метка «держава».
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

/** Два мира роты у границы с другим Домом — тот же подбор, что в `playerWar.test.ts`. */
function realmWithHouseNeighbour(ui: CampaignUi): { home: number; foe: string } {
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
    if (!buy(ui, i) || !buy(ui, second)) continue;
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + (ui.realmPrices?.capital ?? 0) };
    if (domainCapitalIndex(ui.state.deltas) !== second) ui.run({ kind: 'moveCapital', systemId: GALAXY.id(second) });
    return { home: i, foe };
  }
  throw new Error('нет подходящей пары миров');
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

/**
 * Держава в войне с соседом, полки развезены по театрам, и её фонд против врага так велик, что такт
 * фронта выбирает её участки почти всегда (`front.ts::pickSector` — вес по напору): иначе бой с
 * ротой случался бы раз в несколько лет, и тест мерил бы удачу сида.
 */
function realmAtWar(): { ui: CampaignUi; foe: string } {
  const ui = makeUi();
  const { foe } = realmWithHouseNeighbour(ui);
  const s = ui.state;
  s.company = { ...s.company, cbills: s.company.cbills + 20 * WAR.economy.mechCost };
  expect(ui.run({ kind: 'raiseRegiment', mechs: 20 })).toBe(true);
  expect(ui.run({ kind: 'declareWar', factionId: foe })).toBe(true);
  expect(runThrough(ui, WAR.front.tickDays)).toBe(true);
  s.war = withFund(s.war, PLAYER_ACTOR_ID, foe, 1e12);
  return { ui, foe };
}

/** Сколько машин рота потеряла в боях — по событиям, её стороной боя. */
function realmLosses(events: readonly CampaignEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.kind !== 'frontClash') continue;
    n += e.attacker === PLAYER_ACTOR_ID ? e.attackerLost : e.defenderLost;
  }
  return n;
}

describe('журнал фронта державы (шаг 78)', () => {
  it('бой такта с ротой — событие при любом исходе; бой двух фракций — нет', () => {
    const { ui, foe } = realmAtWar();
    const s = ui.state;
    // Напор обеих сторон — одинаковое число тактов СОБСТВЕННОГО дохода (`pushOf`): участки роты
    // выбираются часто, а силы на них сопоставимы, и исходы выходят разные.
    const pushed = (id: string): number => economyOf(s.war, id).income * WAR.front.pushScale * 40;
    s.war = withFund(s.war, PLAYER_ACTOR_ID, foe, pushed(PLAYER_ACTOR_ID));
    s.war = withFund(s.war, foe, PLAYER_ACTOR_ID, pushed(foe));
    const outcomes = new Set<string>();
    let war = s.war;
    let deltas = s.deltas;
    let rep = s.reputation;
    const rng = s.rng.stream('camp.war');
    for (let k = 0; k < 8; k++) {
      const r = frontTick(war, deltas, rep, s.worldSeed, s.day + k * WAR.front.tickDays, rng);
      for (const c of r.clashes) {
        expect(c.attacker === PLAYER_ACTOR_ID || c.defender === PLAYER_ACTOR_ID).toBe(true);
        outcomes.add(c.outcome);
      }
      war = r.war;
      deltas = r.deltas;
      rep = r.reputation;
    }
    // Проигранный бой тоже виден: до шага 78 он не оставлял следа.
    expect(outcomes.has('repelled')).toBe(true);
    expect(outcomes.size).toBeGreaterThan(1);

    // Мир без державы: фронт двигается, а боёв с ротой нет.
    const bare = new CampaignState(3, { company: foundingInit(3) });
    let moves = 0;
    for (let k = 0; k < 6; k++) {
      const tick = frontTick(bare.war, bare.deltas, bare.reputation, bare.worldSeed, bare.day + k * WAR.front.tickDays, bare.rng.stream('camp.war'));
      moves += tick.moves.length;
      expect(tick.clashes).toEqual([]);
      bare.war = tick.war;
      bare.deltas = tick.deltas;
      bare.reputation = tick.reputation;
    }
    expect(moves).toBeGreaterThan(0);
  });

  it('итог такта: армия до и после; потери боёв равны убыли армии, пока театры не пусты', () => {
    const { ui } = realmAtWar();
    const s = ui.state;
    const before = totalArmy(s.war, PLAYER_ACTOR_ID);
    const r = execute(s, { kind: 'advance', days: WAR.front.tickDays });
    if (!r.ok) throw new Error('прокрутка не прошла');
    const tally = r.events.filter((e) => e.kind === 'realmFrontTally');
    expect(tally).toHaveLength(1);
    const x = tally[0];
    if (x?.kind !== 'realmFrontTally') throw new Error('нет итога');
    expect(x.battles).toBe(r.events.filter((e) => e.kind === 'frontClash').length);
    expect(x.armyAfter).toBe(totalArmy(s.war, PLAYER_ACTOR_ID));
    // Все бои — наступления роты (её фонд велик, участки врага против неё выбираются редко). В
    // наступлении сторона роты не больше её театра (шаг 80), потери не больше стороны — значит,
    // каждая потеря списана целиком, и сумма потерь боёв обязана сойтись с убылью армии.
    const clashes = r.events.filter((e) => e.kind === 'frontClash');
    expect(clashes.every((e) => e.kind === 'frontClash' && e.attacker === PLAYER_ACTOR_ID)).toBe(true);
    expect(x.armyBefore - x.armyAfter).toBe(realmLosses(r.events));
    expect(x.armyBefore).toBe(before);
  });

  it('сводка войны после долгой прокрутки — новые сверху, как журнал роты (отладка 2026-10-03)', () => {
    const { ui } = realmAtWar();
    expect(ui.run({ kind: 'advance', days: 3 * WAR.front.tickDays })).toBe(true);
    const days = ui.warLog.map((l) => l.day);
    expect(new Set(days).size).toBeGreaterThan(1);
    for (let k = 1; k < days.length; k++) expect(days[k] as number).toBeLessThanOrEqual(days[k - 1] as number);
  });

  it('сводка войны: строки боя с меткой «держава», без второй строки захвата, и итог потерь', () => {
    const { ui } = realmAtWar();
    const had = ui.warLog.length;
    expect(ui.run({ kind: 'advance', days: WAR.front.tickDays })).toBe(true);
    const fresh = ui.warLog.slice(0, ui.warLog.length - had);
    const clashes = fresh.filter((l) => l.kind === 'clash');
    expect(clashes.length).toBeGreaterThan(0);
    for (const l of clashes) expect(l.realm).toBe(true);
    // Захват с боем державы — одной строкой боя, а не ещё и «сменой флага».
    for (const l of fresh.filter((x) => x.kind === 'capture')) {
      expect(clashes.some((c) => c.systemId === l.systemId && c.attacker === l.attacker)).toBe(false);
    }
    const loss = fresh.filter((l) => l.kind === 'realmLoss');
    expect(loss).toHaveLength(1);
    expect(loss[0]?.size).toBe(clashes.length);
    expect(loss[0]?.realm).toBe(true);
    // Строки фракций между собой метки не получают.
    for (const l of fresh) {
      if (l.attacker !== PLAYER_ACTOR_ID && l.defender !== PLAYER_ACTOR_ID) expect(l.realm).toBeUndefined();
    }
  });

  it('тексты отказов: приказ на свой мир и дань при низком отношении', () => {
    const ui = makeUi();
    const { home, foe } = realmWithHouseNeighbour(ui);
    expect(ui.why({ kind: 'orderOffensive', systemId: GALAXY.id(home) })).toBe(t('reject.offensiveOwnWorld'));
    const target = GALAXY.neighbors(home).find(
      (j) => ownerOf(ui.state.deltas, j) === foe && !GALAXY.hasFlag(j, 'capital'),
    ) as number;
    const s = ui.state;
    s.reputation = withStanding(s.reputation, foe, REPUTATION.diplomacy.minStanding - 1 - standingOf(s.reputation, foe));
    expect(ui.why({ kind: 'demandTribute', systemId: GALAXY.id(target) })).toBe(t('reject.tributeStandingTooLow'));
  });
});
