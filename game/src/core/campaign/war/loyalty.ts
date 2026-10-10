import { GALAXY } from '../galaxy/catalog.js';
import { developmentOf, ownerOf, tributeOf, withDelta, type GalaxyDeltas, type SystemDeltaPatch } from '../galaxy/delta.js';
import { standingOf, type ReputationState } from '../reputation/state.js';
import { bonusOf, NO_BONUSES, type RealmBonuses } from '../realm/bonus.js';
import { barracksLoyaltyOf } from './buildings.js';
import { domainWorlds } from './domain.js';
import { boundByProtectorate, economyOf, pactHolds, theatersOf, totalArmy, withEconomy, withTheater, type WarState } from './economy.js';
import { PLAYER_ACTOR_ID } from './actors.js';
import { playerWarOf } from './playerWar.js';
import { WAR } from './schema.js';
import { politicalActor } from './threat.js';

/**
 * ЛОЯЛЬНОСТЬ МИРА РОТЫ (шаг 85; `notes.md` §10zg п. 12).
 *
 * Проба державы взяла у Куриты 17 миров, и каждый платил полный доход с первого дня. Теперь у мира роты
 * есть лояльность 0..100: старт по способу получения, рост со временем, падение от дани, разорения и войны
 * с прежним владельцем. Она множит доход и мощность мира (`economy.ts::loyaltyFactor`), а ниже порога мир
 * восстаёт: на его бирже — работа роты «подавить восстание» (`contracts/board.ts`), и без победы за
 * `loyalty.revoltDecades` декад мир отходит прежнему владельцу.
 *
 * Поля живут в дельте мира и есть ровно у миров роты: миры фракций правила не видят, их хэш тот же.
 * Бросков нет — такт детерминирован и порядок ГПСЧ не сдвигает.
 */

/** Как рота получила мир: силой, деньгами, леном или по миру (цель войны). */
export type LoyaltyOrigin = 'force' | 'bought' | 'grant' | 'peace';

export function startLoyalty(origin: LoyaltyOrigin): number {
  const L = WAR.loyalty;
  switch (origin) {
    case 'force':
      return L.startForce;
    case 'bought':
      return L.startBought;
    case 'grant':
      return L.startGrant;
    case 'peace':
      return L.startPeace;
  }
}

/** Правка дельты мира, перешедшего роте: стартовая лояльность и прежний владелец. */
export function acquiredPatch(origin: LoyaltyOrigin, from: string): SystemDeltaPatch {
  return { loyalty: startLoyalty(origin), formerOwner: from, revoltSince: undefined };
}

/** Правка дельты мира, ушедшего от роты: лояльность больше не его свойство. */
export const LOYALTY_CLEARED: SystemDeltaPatch = Object.freeze({
  loyalty: undefined,
  formerOwner: undefined,
  revoltSince: undefined,
});

function clampLoyalty(v: number): number {
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

/** Восстал ли мир. */
export function inRevolt(deltas: GalaxyDeltas, id: string): boolean {
  return deltas[id]?.revoltSince !== undefined;
}

/** Последний день восстания: с него мир отходит прежнему владельцу. */
export function revoltDeadline(since: number): number {
  return since + WAR.loyalty.revoltDecades * WAR.front.tickDays;
}

/** Кому отходит восставший мир: прежнему владельцу, а без записи — владельцу по канону. */
export function secessionTarget(deltas: GalaxyDeltas, i: number): string {
  return deltas[GALAXY.id(i)]?.formerOwner ?? GALAXY.ownerId(i);
}

/**
 * Изменение лояльности за декаду. Война с прежним владельцем — запись войны роты с ним
 * (`playerWarOf`), а не вражда «от рождения»: у пиратского мира её нет, пока на границе не дерутся.
 */
export function loyaltyDrift(
  deltas: GalaxyDeltas,
  war: WarState,
  rep: ReputationState,
  id: string,
  day: number,
  bonuses: RealmBonuses = NO_BONUSES,
): number {
  // Казармы (шаг 87), губернатор сектора (шаг 88) и благосостояние (шаг 91) прибавляют к дрейфу в любом случае — и в
  // войну с прежним владельцем, и под данью, и под подстрекательством.
  return baseDrift(deltas, war, rep, id, day) + barracksLoyaltyOf(deltas, id) + bonusOf(bonuses, id).loyalty + welfareOf(deltas, id);
}

/**
 * Благосостояние (шаг 91, ответ на вопрос 4 — меры против восстаний, а не только подавление): `resistance.welfarePerStep`
 * к дрейфу лояльности за каждую ступень развития мира выше канона. Развитие ниже канона ничего не отнимает.
 */
export function welfareOf(deltas: GalaxyDeltas, id: string): number {
  return Math.max(0, developmentOf(deltas, id)) * WAR.resistance.welfarePerStep;
}

/** Почему лояльность мира падает: война с прежним владельцем, его подстрекательство — или не падает. */
export type LoyaltyPressure = 'war' | 'incite' | null;

/**
 * Что давит на лояльность мира (шаги 90, 91). Только у мира, граничащего с прежним владельцем: глубокий тыл державы не
 * чувствует ни войны, ни подстрекательства (шаг 90, `notes.md` §10zu п. 8).
 *
 * ПОДСТРЕКАТЕЛЬСТВО (шаг 91, ответ на вопрос 3): прежний владелец без войны с державой тянет мир назад, если он ведёт
 * политику, с державой нет торгового договора и подчинения, а его отношение к роте не выше `resistance.inciteStanding`.
 * Перемирие подстрекательства не гасит: это не дружба, прежний владелец ждёт своего часа (замер шага 91 — послевоенное
 * перемирие гасило его почти целиком). До шага мир, удержанный до мира, рос к 100 и больше не тревожил: восстаний за
 * 10 лет — 0–1 на сид (зонд шага 91). Меры против — казармы, губернатор, титул и благосостояние (`loyaltyDrift`).
 * Торговый договор гасит подстрекательство, но заключить его с подстрекателем нельзя (договор — от отношения +20,
 * `reputation.json → diplomacy.minStanding`): он действует, только если подписан раньше, пока отношение было добрым.
 */
export function loyaltyPressure(
  deltas: GalaxyDeltas,
  war: WarState,
  rep: ReputationState,
  id: string,
  day: number,
): LoyaltyPressure {
  const former = deltas[id]?.formerOwner;
  if (former === undefined || !GALAXY.neighbors(GALAXY.require(id)).some((j) => ownerOf(deltas, j) === former)) return null;
  if (playerWarOf(war, former) !== undefined) return 'war';
  if (!politicalActor(former) || standingOf(rep, former) > WAR.resistance.inciteStanding) return null;
  if (pactHolds(war, PLAYER_ACTOR_ID, former, 'trade', day) || boundByProtectorate(war, PLAYER_ACTOR_ID, former)) return null;
  return 'incite';
}

function baseDrift(deltas: GalaxyDeltas, war: WarState, rep: ReputationState, id: string, day: number): number {
  const L = WAR.loyalty;
  const pressure = loyaltyPressure(deltas, war, rep, id, day);
  if (pressure === 'war') return -L.warDecay;
  if (tributeOf(deltas, id, day) !== undefined) return 0;
  if (pressure === 'incite') return -WAR.resistance.inciteDecay;
  return L.growth * (1 - Math.min(1, Math.max(0, deltas[id]?.ruined ?? 0)));
}

export interface LoyaltyTick {
  readonly deltas: GalaxyDeltas;
  /** Миры, восставшие на этой декаде. */
  readonly revolts: readonly string[];
  /** Миры, чьё восстание не подавлено в срок: кому они отходят. Передачу делает вызывающий. */
  readonly seceded: readonly { readonly systemId: string; readonly to: string }[];
}

/**
 * Такт лояльности — раз в декаду, в конце такта фронта (`commands/execute.ts`), когда войны декады уже
 * решены. Мир без поля (снимок теста, где владельца поставили руками) правила не видит.
 */
export function loyaltyTick(
  deltas: GalaxyDeltas,
  war: WarState,
  rep: ReputationState,
  day: number,
  bonuses: RealmBonuses = NO_BONUSES,
): LoyaltyTick {
  const L = WAR.loyalty;
  let next = deltas;
  const revolts: string[] = [];
  const seceded: { systemId: string; to: string }[] = [];
  for (const i of domainWorlds(deltas)) {
    const id = GALAXY.id(i);
    const d = deltas[id];
    if (d?.loyalty === undefined) continue;
    if (d.revoltSince !== undefined && day >= revoltDeadline(d.revoltSince)) {
      seceded.push({ systemId: id, to: secessionTarget(deltas, i) });
      continue;
    }
    const loyalty = clampLoyalty(d.loyalty + loyaltyDrift(deltas, war, rep, id, day, bonuses));
    const revolt = d.revoltSince === undefined && loyalty < L.revoltBelow;
    if (revolt) revolts.push(id);
    if (loyalty !== d.loyalty || revolt) {
      next = withDelta(next, id, revolt ? { loyalty, revoltSince: day } : { loyalty });
    }
  }
  return { deltas: next, revolts, seceded };
}

/**
 * Победа роты в контракте на своём мире: `loyalty.win` сверху, а у работы «подавить восстание» —
 * ещё `loyalty.revoltWin` и конец восстания.
 */
export function withLoyaltyWin(deltas: GalaxyDeltas, id: string, revolt: boolean): GalaxyDeltas {
  const d = deltas[id];
  if (d?.loyalty === undefined) return deltas;
  const L = WAR.loyalty;
  const suppressed = revolt && d.revoltSince !== undefined;
  const loyalty = clampLoyalty(d.loyalty + L.win + (suppressed ? L.revoltWin : 0));
  return withDelta(deltas, id, suppressed ? { loyalty, revoltSince: undefined } : { loyalty });
}

/**
 * АРМИЯ ПОДАВЛЯЕТ ВОССТАНИЕ (шаг 90, `notes.md` §10zu п. 8). Восстание, которое рота не подавила, в последнюю декаду
 * срока (следующий такт лояльности отдал бы мир) подавляет армия державы, если в ней не меньше
 * `loyalty.armyQuellMechs` машин, — ценой `loyalty.armyQuellLoss` машин (сперва резерв, затем театры по порядку
 * ключей, как роспуск) и с той же прибавкой, что победа роты над восстанием. Зовётся тактом фронта до такта лояльности.
 */
export function armyQuellRevolts(
  deltas: GalaxyDeltas,
  war: WarState,
  day: number,
): { readonly deltas: GalaxyDeltas; readonly war: WarState; readonly quelled: readonly string[] } {
  const L = WAR.loyalty;
  let nextDeltas = deltas;
  let nextWar = war;
  const quelled: string[] = [];
  for (const i of domainWorlds(deltas)) {
    const id = GALAXY.id(i);
    const since = deltas[id]?.revoltSince;
    if (since === undefined || day + WAR.front.tickDays < revoltDeadline(since)) continue;
    if (totalArmy(nextWar, PLAYER_ACTOR_ID) < L.armyQuellMechs) continue;
    let left = L.armyQuellLoss;
    const reserve = economyOf(nextWar, PLAYER_ACTOR_ID).army;
    const fromReserve = Math.min(left, reserve);
    nextWar = withEconomy(nextWar, PLAYER_ACTOR_ID, { army: reserve - fromReserve });
    left -= fromReserve;
    for (const t of theatersOf(nextWar, PLAYER_ACTOR_ID)) {
      if (left <= 0) break;
      const take = Math.min(left, t.mechs);
      nextWar = withTheater(nextWar, PLAYER_ACTOR_ID, t.against, t.mechs - take);
      left -= take;
    }
    nextDeltas = withLoyaltyWin(nextDeltas, id, true);
    quelled.push(id);
  }
  return { deltas: nextDeltas, war: nextWar, quelled };
}
