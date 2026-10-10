import { Rng } from '../../rng/index.js';
import type { BattleParticipant } from '../bridge/toBattle.js';
import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { relationOf, withRelation, type ReputationState } from '../reputation/state.js';
import { PLAYER_ACTOR_ID } from './actors.js';
import { resolveFrontBattle, type FrontBattleResult } from './battle.js';
import { isPlayerRealm } from './domain.js';
import { politicalActor } from './threat.js';
import { domainCapitalIndex, fundsOf, theaterOf, withFund, withTheaterLoss, type WarState } from './economy.js';
import {
  applySystemCapture,
  frontSectors,
  sectorForces,
  spendFrontFund,
  frontWeights,
  type FrontClash,
  type FrontMove,
  type FrontSector,
  type GarrisonSource,
  type SectorForces,
} from './front.js';
import { frontShares } from './logistics.js';
import {
  atWarWithPlayer,
  notePlayerCapture,
  notePlayerFight,
  notePlayerLosses,
  playerWarOf,
  withPlayerWar,
  type PlayerWar,
} from './playerWar.js';
import { WAR } from './schema.js';

/**
 * ПРИКАЗ АРМИИ ДЕРЖАВЫ НАСТУПАТЬ (проект державы, шаг 3; бывший шаг 77).
 *
 * **Зачем.** Такт фронта делает на всю карту 4–7 наступлений за декаду на ~200 участков — около
 * 0.03 боя на участок в декаду, у всех одинаково. Дом с сотней участков двигает границу; держава
 * роты в 2–3 участка получает ту же долю на участок и видит бой раз в два года войны. Военный бюджет
 * (шаг 2) это не лечит — замер: 3.1–3.4 боя за 5 лет при любой доле. Частоту задаёт число участков, а
 * не напор. Поэтому у державы роты есть приказ: наступление туда, куда решил игрок.
 *
 * **Тем же боем, что такт.** Участок — из `frontSectors` (с тем же `adjacent`), силы — `sectorForces`
 * с долями `frontShares(frontWeights(...))`, бой — `resolveFrontBattle` со своей меткой сида, потери —
 * с театров обеих сторон, захват — `applySystemCapture`. Второго набора правил нет.
 *
 * **Чем платится.** Военным фондом державы: `domain.offensiveCostTicks` тактов дохода. Фонд копит
 * военный бюджет (шаг 2), и приказ — то, на что он тратится. Берётся из ВСЕГО фонда, долями по
 * направлениям, а не из фонда против этой фракции: фонд делится между всеми живыми врагами (пираты и
 * кланы — враги от рождения), и на фракцию, которой только что объявили войну, он начинает копиться с
 * нуля. Замер первой версии (цена — 2 такта из фонда против фракции): 1–3 приказа на 4 сида за 5 лет.
 * Для игрока фонд — одна казна войны; раскладка по врагам остаётся тем, чем была, — напором на
 * участках. Обороняющийся платит как в такте — `front.attemptCost` своего фонда против роты. Сверх
 * денег — потери на театре.
 *
 * **Чего здесь нет намеренно.** Дани вместо захвата (`prefersTribute` такта): приказ отдаёт игрок, и он
 * хочет мир. Сдвиг отношений — только при взятом мире, как у такта: там матрицу двигают лишь выигранные
 * наступления (`front.ts`, `clashes`).
 */

const D = WAR.domain;

/** Почему приказ нельзя отдать — вид отказа, словами его называет экран. */
export type OffensiveBlock =
  | { readonly kind: 'noRealm' }
  | { readonly kind: 'ownWorld' }
  | { readonly kind: 'notAtWar' }
  | { readonly kind: 'notOnFront' }
  | { readonly kind: 'noTheater' }
  | { readonly kind: 'cooldown'; readonly readyDay: number }
  | { readonly kind: 'noFund'; readonly cost: number; readonly fund: number };

export interface OffensivePlan {
  readonly sector: FrontSector;
  readonly forces: SectorForces;
  /** Цена приказа из военного фонда державы. */
  readonly cost: number;
}

export type OffensiveCheck =
  | ({ readonly ok: true } & OffensivePlan)
  | { readonly ok: false; readonly block: OffensiveBlock; readonly forces?: SectorForces };

/** Весь военный фонд державы роты — по всем направлениям. */
export function realmWarFund(war: WarState): number {
  let total = 0;
  for (const r of fundsOf(war, PLAYER_ACTOR_ID)) total += r.amount;
  return total;
}

/**
 * Взять `amount` из военного фонда державы долями по направлениям — тем же правилом, что сушит фонд
 * фракции при нехватке (`economy.ts::drain`): последнее направление добирает остаток округления.
 */
function takeFromRealmFund(war: WarState, amount: number): WarState {
  const rows = fundsOf(war, PLAYER_ACTOR_ID);
  const total = realmWarFund(war);
  if (total <= 0 || amount <= 0) return war;
  const want = Math.min(amount, total);
  let next = war;
  let taken = 0;
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k] as { against: string; amount: number };
    const cut = k === rows.length - 1 ? want - taken : Math.round((want * r.amount) / total);
    taken += cut;
    next = withFund(next, PLAYER_ACTOR_ID, r.against, r.amount - cut);
  }
  return next;
}

/**
 * Цена приказа (шаг 90): `domain.offensiveCostPerMech` за каждую машину армии державы на направлении против
 * `against` — то есть за тех, кто пойдёт в бой. До шага 90 цена была тактом итога державы (шаг 80): она росла с
 * державой (партия 2026-10-07: 1.1 → 4.5 → 10.8 млн), а шанс приказа от размера державы не рос (`notes.md` §10zu
 * п. 5). Пустое направление стоит ноль, но приказ туда и так не пройдёт (`noTheater`).
 */
export function offensiveCost(war: WarState, against: string): number {
  return theaterOf(war, PLAYER_ACTOR_ID, against) * D.offensiveCostPerMech;
}

/**
 * Можно ли приказать наступать на мир `system` — и если да, каким участком, с какими силами и за
 * какую цену. Одна функция на команду и экран: число на кнопке — то, по которому пойдёт бой.
 * Силы отдаются и при отказе по откату или фонду: экран показывает их заранее.
 */
export function planOffensive(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  system: number,
  day: number,
): OffensiveCheck {
  if (!isPlayerRealm(deltas)) return { ok: false, block: { kind: 'noRealm' } };
  const defender = ownerOf(deltas, system);
  // Свой мир — не «войны нет» (шаг 78): проба получила на него «мириться не с кем».
  if (defender === PLAYER_ACTOR_ID) return { ok: false, block: { kind: 'ownWorld' } };
  if (!atWarWithPlayer(war, rep, defender, day)) return { ok: false, block: { kind: 'notAtWar' } };

  const sectors = frontSectors(war, rep, deltas, day);
  const sector = sectors.find((s) => s.system === system && s.attacker === PLAYER_ACTOR_ID && s.defender === defender);
  if (sector === undefined) return { ok: false, block: { kind: 'notOnFront' } };
  const forces = sectorForces(war, worldSeed, deltas, sector, frontShares(frontWeights(sectors)));

  // Армия должна стоять НА ЭТОМ направлении, а не где-то: в первую декаду после объявления войны
  // полки ещё в резерве, и сила на участке — по полу готовности театра (проба: шанс 9–16 % вместо
  // 60–74 % после логистики), а списать потери было бы не с чего.
  if (theaterOf(war, PLAYER_ACTOR_ID, defender) <= 0) return { ok: false, block: { kind: 'noTheater' }, forces };

  const last = playerWarOf(war, defender)?.lastOffensive;
  if (last !== undefined && day < last + WAR.front.tickDays) {
    return { ok: false, block: { kind: 'cooldown', readyDay: last + WAR.front.tickDays }, forces };
  }

  const cost = offensiveCost(war, defender);
  const fund = realmWarFund(war);
  if (fund < cost) return { ok: false, block: { kind: 'noFund', cost, fund }, forces };
  return { ok: true, sector, forces, cost };
}

export interface OffensiveResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  readonly reputation: ReputationState;
  readonly fought: FrontBattleResult;
  /** Разорение взятого мира; `null` — наступление отбито. */
  readonly ruined: number | null;
}

/**
 * Исполнить приказ по готовому плану. `rng` — поток `camp.war`, как у захвата по исходу контракта.
 * `company` — звено роты, идущее с армией (шаг 86, `orderLance`); пусто — приказ как прежде.
 */
export function applyOffensive(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  plan: OffensivePlan,
  day: number,
  rng: Rng,
  company: readonly BattleParticipant[] = [],
): OffensiveResult {
  const { sector, forces, cost } = plan;
  const fought = resolveFrontBattle(sector, forces, war, worldSeed, deltas, day, 'order', company);

  let next = takeFromRealmFund(war, cost);
  next = spendFrontFund(next, sector.defender, PLAYER_ACTOR_ID, WAR.front.attemptCost);
  next = withTheaterLoss(next, PLAYER_ACTOR_ID, sector.defender, fought.attackerLost);
  next = withTheaterLoss(next, sector.defender, PLAYER_ACTOR_ID, fought.defenderLost);
  next = notePlayerFight(next, PLAYER_ACTOR_ID, sector.defender, day);
  next = notePlayerLosses(war, next, PLAYER_ACTOR_ID, sector.defender, fought.attackerSize, fought.defenderSize);
  const rec = playerWarOf(next, sector.defender);
  if (rec !== undefined) next = withPlayerWar(next, sector.defender, { ...rec, lastOffensive: day });

  if (!fought.won) return { war: next, deltas, reputation: rep, fought, ruined: null };

  const applied = applySystemCapture(next, deltas, worldSeed, sector.system, PLAYER_ACTOR_ID, sector.defender, rng, day);
  next = notePlayerCapture(applied.war, PLAYER_ACTOR_ID, sector.defender, day, GALAXY.id(sector.system));
  const reputation = withRelation(
    rep,
    PLAYER_ACTOR_ID,
    sector.defender,
    relationOf(rep, PLAYER_ACTOR_ID, sector.defender) - WAR.front.relationPerMove,
  );
  return { war: next, deltas: applied.deltas, reputation, fought, ruined: applied.move.ruined };
}

/** Участки, на которые держава может наступать против фракции, — для экрана. */
export function offensiveTargets(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  day: number,
  factionId: string,
): readonly number[] {
  return frontSectors(war, rep, deltas, day)
    .filter((s) => s.attacker === PLAYER_ACTOR_ID && s.defender === factionId)
    .map((s) => s.system);
}

export interface FoeOffensiveResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  readonly reputation: ReputationState;
  /** Бои с державой при любом исходе — те же, что у такта фронта; гарнизон разбирает вызывающий. */
  readonly clashes: readonly FrontClash[];
  /** Взятые миры державы. */
  readonly moves: readonly FrontMove[];
}

/**
 * НАСТУПЛЕНИЕ ИИ ПО ЦЕЛИ (шаг 91; зеркало приказа армии державы).
 *
 * **Зачем.** Такт фронта делает 4–7 наступлений на всю карту, и участок державы в два-три мира выпадает раз в годы:
 * войны, объявленные державе, миров у неё не отнимали (замер шага 90 — 0 на четырёх сидах за 10 лет). Цель у
 * фракции была (`PlayerWar.foeGoal`, шаг 83), но выдавал её только мир, когда держава устала.
 *
 * **Правило.** Фракция-политик в войне с державой, у которой есть театр против державы, раз в
 * `resistance.foeOrderDecades` декад наступает на мир своей цели или на свой бывший мир (`formerOwner`), граничащий с
 * ней и взятый не в этой войне, кроме столицы державы, — участок с лучшим шансом, если он не ниже порога стойки державы
 * (`realm.stanceMinOdds`): армия, оборона и гарнизон державы отпугивают удар. Бывшие миры — потому что войну чаще объявляет держава, и цели у
 * фракции тогда нет (замер шага 91: враг воевал с державой по 140–195 декад и не отбил ни мира). Бой —
 * тот же `resolveFrontBattle`, что у такта и приказа державы, со своей меткой сида; против армии, обороны мира
 * (`realmDefence`) и гарнизона роты (`garrisonOf`). Цена — та же, что у наступления такта (`front.attemptCost`, при
 * захвате и `captureCost`), потери — с театров обеих сторон, усталость — `notePlayerLosses`, взятое — в счёт войны.
 * Дани вместо захвата нет: фракция воюет за свои миры.
 *
 * **Броски.** Поток `camp.war` не тратится: разорение взятого мира бросается из сида мира, дня и участка — мир без
 * державы побитово прежний, порядок бросков фронта не сдвигается.
 */
export function foeOffensives(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
  garrisonOf?: GarrisonSource,
  realmDefence?: (system: number) => number,
): FoeOffensiveResult {
  let next = war;
  let nextDeltas = deltas;
  let nextRep = rep;
  const clashes: FrontClash[] = [];
  const moves: FrontMove[] = [];
  let sectors: FrontSector[] | null = null;
  for (const id of Object.keys(war.playerWars ?? {}).sort()) {
    const rec = playerWarOf(next, id);
    if (rec === undefined || !politicalActor(id)) continue;
    const goal = rec.foeGoal ?? [];
    const last = rec.lastFoeOffensive;
    // Война, объявленная самой фракцией (у неё есть цель), идёт темпом стойки державы (шаг 92): раз в 27 декад фракция
    // не успевала ударить, пока держава подводила полки, и все её войны кончались победой державы.
    const every = rec.foeGoal !== undefined && WAR.resistance.declaredOrderDecades > 0 ? WAR.resistance.declaredOrderDecades : WAR.resistance.foeOrderDecades;
    if (last !== undefined && day < last + every * WAR.front.tickDays) continue;
    if (theaterOf(next, id, PLAYER_ACTOR_ID) <= 0) continue;
    sectors ??= frontSectors(next, nextRep, nextDeltas, day);
    const shares = frontShares(frontWeights(sectors));
    const capital = domainCapitalIndex(nextDeltas);
    let best: { sector: FrontSector; forces: SectorForces } | null = null;
    for (const sector of sectors) {
      if (sector.attacker !== id || sector.defender !== PLAYER_ACTOR_ID) continue;
      if (sector.system === capital || ownerOf(nextDeltas, sector.system) !== PLAYER_ACTOR_ID) continue;
      const sid = GALAXY.id(sector.system);
      // Взятое державой в этой войне решит мир (`peaceOutcome` возвращает лишнее): отбивать его наступлением — перебрасывать
      // одни и те же миры туда-сюда (замер шага 91: 37 потерь, из них 21 — взятые в той же войне).
      if (!goal.includes(sid) && (nextDeltas[sid]?.formerOwner !== id || rec.taken?.includes(sid) === true)) continue;
      const forces = sectorForces(next, worldSeed, nextDeltas, sector, shares, realmDefence?.(sector.system) ?? 1);
      if (best === null || forces.odds > best.forces.odds) best = { sector, forces };
    }
    // Порог шанса — тот же, что у стойки «наступать» державы (`realm.stanceMinOdds`): на мир, который держава держит армией,
    // обороной и гарнизоном, фракция не лезет (замер шага 91: без порога она била и при шансе 0.1).
    if (best === null || best.forces.odds < WAR.realm.stanceMinOdds) continue;
    const { sector, forces } = best;
    const garrison = garrisonOf?.(sector.system, nextDeltas);
    const fought = resolveFrontBattle(sector, forces, next, worldSeed, nextDeltas, day, 'foeOrder', [], garrison);
    const before = next;
    next = spendFrontFund(next, id, PLAYER_ACTOR_ID, WAR.front.attemptCost + (fought.won ? WAR.front.captureCost : 0));
    next = spendFrontFund(next, PLAYER_ACTOR_ID, id, WAR.front.attemptCost);
    next = withTheaterLoss(next, id, PLAYER_ACTOR_ID, fought.attackerLost);
    next = withTheaterLoss(next, PLAYER_ACTOR_ID, id, fought.defenderLost);
    next = notePlayerLosses(before, next, id, PLAYER_ACTOR_ID, fought.attackerSize, fought.defenderSize);
    next = withPlayerWar(next, id, { ...(playerWarOf(next, id) as PlayerWar), lastFoeOffensive: day });
    const line = {
      systemId: GALAXY.id(sector.system),
      attacker: id,
      defender: PLAYER_ACTOR_ID,
      odds: Math.round(forces.odds * 1000) / 1000,
      attackerSize: fought.attackerSize,
      defenderSize: fought.defenderSize,
      attackerLost: fought.attackerLost,
      defenderLost: fought.defenderLost,
    };
    const withGarrison = fought.garrison === undefined ? {} : { garrison: fought.garrison };
    if (!fought.won) {
      clashes.push({ ...line, outcome: 'repelled', ...withGarrison });
      continue;
    }
    const applied = applySystemCapture(next, nextDeltas, worldSeed, sector.system, id, PLAYER_ACTOR_ID, new Rng(foeSeed(worldSeed, line.systemId, id, day)), day);
    next = notePlayerCapture(applied.war, id, PLAYER_ACTOR_ID, day, line.systemId);
    nextDeltas = applied.deltas;
    nextRep = withRelation(nextRep, PLAYER_ACTOR_ID, id, relationOf(nextRep, PLAYER_ACTOR_ID, id) - WAR.front.relationPerMove);
    clashes.push({ ...line, outcome: 'captured', ...withGarrison });
    moves.push({ ...applied.move, ...line });
  }
  return { war: next, deltas: nextDeltas, reputation: nextRep, clashes, moves };
}

/** Сид разорения мира, взятого наступлением фракции: мир, участок, день — тем же хэшем, что сид боя. */
function foeSeed(worldSeed: number, systemId: string, attacker: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x2545f491;
  const text = `foeOrder|${systemId}|${attacker}|${day}`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
