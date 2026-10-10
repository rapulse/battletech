import { factionKind } from '../contracts/relations.js';
import { FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { liveEnmity, relationOf, standingOf, withRelation, withStanding, type ReputationState } from '../reputation/state.js';
import { PLAYER_ACTOR_ID, isPlayerActor } from './actors.js';
import { boundOrTruced, signPact, type DiplomacyMove } from './diplomacy.js';
import { domainBorder, domainWorlds, pactPrice } from './domain.js';
import { boundByProtectorate, domainCapitalIndex, economyOf, pactHolds, pactOf, theaterOf, withEconomy, withPact, withTheater, type WarState } from './economy.js';
import { WAR } from './schema.js';
import { borderForce, bordersOf, growthOf, politicalActor, threatOf, type Borders } from './threat.js';

/**
 * ВОЙНА И МИР РОТЫ (шаг 76).
 *
 * У фракций между собой нет состояния «война объявлена»: война — свойство пары,
 * вражда не ниже порога фронта плюс общая граница. Держава роты в эту модель не
 * вписывалась: для таблицы вражды она «наёмник», к Домам 0.10 при пороге 0.4, а
 * вражду вниз двигают только стычки фронта, которых без фронта нет. Проба шага:
 * держава с полевой армией два года без единого участка.
 *
 * Поэтому у пар «рота — фракция» появилась явная запись войны — с какого дня и
 * какой счёт, — а начало и конец стали решениями: объявление (рота сама или
 * сосед, чьё отношение к роте упало до `aiDeclareStanding`) и мир по счёту
 * (`peaceTerms`). Правила фракций между собой не меняются.
 *
 * ЦЕЛЬ, УСТАЛОСТЬ, МИР ДОГОВОРОМ (шаг 81; образец — Stellaris). До шага мир шёл только по счёту:
 * перевес — даром, и не было ни цели, ни цены времени. Отсюда два крайних случая пробы 2026-09-28:
 * снежный ком (17 миров за 5 лет до шага 3b) и тупик малой державы — война, из которой не выкупиться
 * (мир вничью 175.5 млн при 44 в кассе), а после шага 79 война без мира не кончалась вовсе.
 * Теперь рота объявляет цель (`WarGoal`), стороны устают от потерь и времени, уставшая фракция
 * сама предлагает мир на цели роты, уставшей роте мир дешевле, а на пределе усталости любой стороны
 * мир заключается сам, «как есть» (`exhaustedSide`, исполняет такт фронта в `execute.ts`).
 */

const P = WAR.playerWar;
const R = WAR.resistance;

/**
 * Цель войны роты (шаг 81), заявляется при объявлении. `worlds` — пограничные миры врага перейдут
 * роте; `tribute` — те же миры станут её данниками на стандартный срок; `humiliation` — волна по сети
 * отношений. Выдаёт цель только мир по предложению фракции (`peaceTerms` → `free`, `offered`).
 */
export type WarGoal =
  | { readonly kind: 'worlds' | 'tribute'; readonly systems: readonly string[] }
  | { readonly kind: 'humiliation' };

/** Война роты с одной фракцией: с какого дня, сколько миров взяла рота и сколько фракция. */
export interface PlayerWar {
  readonly since: number;
  readonly won: number;
  readonly lost: number;
  /** До какого дня действует предложение мира на цели роты от фракции. */
  readonly offerUntil?: number;
  /** День последнего приказа армии роты против этой фракции (проект державы, шаг 3). */
  readonly lastOffensive?: number;
  /** Цель роты (шаг 81). Нет поля — цели нет: войну объявила фракция или рота без цели. */
  readonly goal?: WarGoal;
  /** Войну объявила рота (шаг 81): перемирие после мира длиннее на `declarerTruceDays`. */
  readonly byRealm?: true;
  /** Усталость роты и фракции, 0–1 (шаг 81). Нет поля — ноль. */
  readonly fatigue?: number;
  readonly foeFatigue?: number;
  /** Миры, взятые ротой у фракции в этой войне, по порядку взятия (шаг 81): из них отдаётся лишнее. */
  readonly taken?: readonly string[];
  /**
   * Цель фракции (шаг 83): миры державы, которые она требует, — у войны, объявленной по угрозе.
   * Выдаёт её мир, когда держава проигрывает (`realmYields`). Нет поля — фракция ничего не требует.
   */
  readonly foeGoal?: readonly string[];
  /** День последнего наступления фракции на мир её цели (шаг 91, `offensive.ts::foeOffensives`). */
  readonly lastFoeOffensive?: number;
}

export type PlayerWars = Readonly<Record<string, PlayerWar>>;

/**
 * Как кончилась война роты без команды мира (шаг 79): договор, подчинение, падение державы или —
 * у пиратов и кланов, с которыми мира нет, — потеря общей границы. Мир командой пишет `peaceMade`.
 */
export type PlayerWarEnd = 'pact' | 'vassal' | 'realmFallen' | 'noBorder';

export interface PlayerWarEnded {
  readonly factionId: string;
  readonly how: PlayerWarEnd;
}

export function playerWarOf(war: WarState, factionId: string): PlayerWar | undefined {
  return war.playerWars?.[factionId];
}

/** Записать или снять войну роты. Карта разрежённая: без войн поля нет вовсе. */
export function withPlayerWar(war: WarState, factionId: string, record: PlayerWar | undefined): WarState {
  const wars: Record<string, PlayerWar> = { ...(war.playerWars ?? {}) };
  if (record === undefined) delete wars[factionId];
  else wars[factionId] = record;
  const { playerWars: _old, ...rest } = war;
  return Object.keys(wars).length === 0 ? rest : { ...rest, playerWars: wars };
}

/**
 * Воюет ли держава роты с фракцией: запись войны есть или вражда пары не ниже
 * порога фронта без договора и подчинения (пираты и кланы — враги от рождения).
 */
export function atWarWithPlayer(war: WarState, rep: ReputationState, factionId: string, day: number): boolean {
  if (playerWarOf(war, factionId) !== undefined) return true;
  return (
    liveEnmity(rep, PLAYER_ACTOR_ID, factionId) >= WAR.front.minEnmity &&
    !boundOrTruced(war, PLAYER_ACTOR_ID, factionId, day)
  );
}

/** Бой фронта с участием роты заводит запись войны, если её не было (враги от рождения). */
export function notePlayerFight(war: WarState, attacker: string, defender: string, day: number): WarState {
  const other = isPlayerActor(attacker) ? defender : isPlayerActor(defender) ? attacker : undefined;
  if (other === undefined || playerWarOf(war, other) !== undefined) return war;
  return withPlayerWar(war, other, { since: day, won: 0, lost: 0 });
}

/** Взятый мир — в счёт войны роты: рота взяла или у роты взяли. Взятое ротой помнится списком (шаг 81). */
export function notePlayerCapture(
  war: WarState,
  attacker: string,
  defender: string,
  day: number,
  systemId: string,
): WarState {
  const noted = notePlayerFight(war, attacker, defender, day);
  const ours = isPlayerActor(attacker);
  if (!ours && !isPlayerActor(defender)) return noted;
  const other = ours ? defender : attacker;
  const rec = playerWarOf(noted, other) as PlayerWar;
  const scored = ours ? { ...rec, won: rec.won + 1, taken: [...(rec.taken ?? []), systemId] } : { ...rec, lost: rec.lost + 1 };
  // Потеря мира утомляет потерявшего (отладка 2026-10-03, `playerWar.fatiguePerWorld`); вольница не устаёт — мира с ней нет.
  if (factionKind(other) === 'pirates') return withPlayerWar(noted, other, scored);
  const w = P.fatiguePerWorld;
  return withPlayerWar(
    noted,
    other,
    withFatigue(scored, (rec.fatigue ?? 0) + (ours ? 0 : w), (rec.foeFatigue ?? 0) + (ours ? w : 0)),
  );
}

/** Усталость хранится разрежённо и с точностью до 1e-4: ноль — нет поля, выше 1 не растёт. */
function withFatigue(rec: PlayerWar, fatigue: number, foeFatigue: number): PlayerWar {
  const { fatigue: _f, foeFatigue: _ff, ...rest } = rec;
  const norm = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e4) / 1e4;
  const a = norm(fatigue);
  const b = norm(foeFatigue);
  return { ...rest, ...(a > 0 ? { fatigue: a } : {}), ...(b > 0 ? { foeFatigue: b } : {}) };
}

/**
 * Усталость от потерь (шаг 81): каждая сторона боя с ротой устаёт на `fatigueLossWeight` × долю своей
 * армии на этом направлении, выбитую в бою. `before` и `after` — война до и после списания потерь
 * (`withTheaterLoss`): выбитое — убыль театра, машины ополчения, которых фронт не считает, усталости
 * не дают. Армия направления — больший из театра и стороны в бою (`attackerSize`, `defenderSize`):
 * сторона фракции не меньше `front.forceMin` за счёт ополчения, а театр против роты бывает в одну
 * машину, и доля «от театра» засчитывала её потерю как выбитую армию — +0.5 за бой, мир на пределе
 * через два боя (замер шага 81, сид 2: Марик, театр 1 при стороне 8). С пиратами мира нет, и они не
 * устают.
 */
export function notePlayerLosses(
  before: WarState,
  after: WarState,
  attacker: string,
  defender: string,
  attackerSize: number,
  defenderSize: number,
): WarState {
  const foe = isPlayerActor(attacker) ? defender : isPlayerActor(defender) ? attacker : undefined;
  if (foe === undefined || factionKind(foe) === 'pirates') return after;
  const rec = playerWarOf(after, foe);
  if (rec === undefined) return after;
  const share = (from: string, against: string, size: number): number => {
    const had = theaterOf(before, from, against);
    const army = Math.max(had, size);
    return army > 0 ? (had - theaterOf(after, from, against)) / army : 0;
  };
  const ours = isPlayerActor(attacker);
  return withPlayerWar(
    after,
    foe,
    withFatigue(
      rec,
      (rec.fatigue ?? 0) + P.fatigueLossWeight * share(PLAYER_ACTOR_ID, foe, ours ? attackerSize : defenderSize),
      (rec.foeFatigue ?? 0) + P.fatigueLossWeight * share(foe, PLAYER_ACTOR_ID, ours ? defenderSize : attackerSize),
    ),
  );
}

/** Чья усталость дошла до предела (шаг 81) — тогда мир заключается сам, «как есть». Рота первой. */
export function exhaustedSide(war: WarState, factionId: string): 'realm' | 'foe' | undefined {
  const rec = playerWarOf(war, factionId);
  if (rec === undefined || factionKind(factionId) === 'pirates') return undefined;
  if ((rec.fatigue ?? 0) >= 1) return 'realm';
  if ((rec.foeFatigue ?? 0) >= 1) return 'foe';
  return undefined;
}

/**
 * Годится ли цель войны против фракции (шаг 81): у `worlds` и `tribute` — от одного до `goalWorldsMax`
 * разных миров этой фракции на границе державы, не столиц (столицу не жалуют и не уступают нигде в
 * игре). У `humiliation` миров нет.
 */
export function warGoalValid(deltas: GalaxyDeltas, factionId: string, goal: WarGoal): boolean {
  if (goal.kind === 'humiliation') return true;
  const n = goal.systems.length;
  if (n < 1 || n > P.goalWorldsMax || new Set(goal.systems).size !== n) return false;
  const border = new Set(domainBorder(deltas).find((b) => b.owner === factionId)?.systems ?? []);
  return goal.systems.every((id) => {
    const i = GALAXY.index(id);
    return i >= 0 && border.has(i) && !GALAXY.hasFlag(i, 'capital');
  });
}

/**
 * Объявить войну паре «рота — фракция»: отношение пары — не выше `warRelation`
 * (фронт в ту же декаду), запись войны с сегодняшнего дня. Отношение фракции к
 * самой роте — дело того, кто объявил: у роты его роняет команда.
 */
export function declarePlayerWar(
  war: WarState,
  rep: ReputationState,
  factionId: string,
  day: number,
  byRealm?: { readonly goal?: WarGoal },
  foeGoal?: readonly string[],
): { war: WarState; reputation: ReputationState } {
  const relation = Math.min(relationOf(rep, PLAYER_ACTOR_ID, factionId), P.warRelation);
  const fresh: PlayerWar =
    byRealm === undefined
      ? { since: day, won: 0, lost: 0, ...(foeGoal === undefined || foeGoal.length === 0 ? {} : { foeGoal }) }
      : { since: day, won: 0, lost: 0, byRealm: true, ...(byRealm.goal === undefined ? {} : { goal: byRealm.goal }) };
  return {
    war: withPlayerWar(war, factionId, playerWarOf(war, factionId) ?? fresh),
    reputation: withRelation(rep, PLAYER_ACTOR_ID, factionId, relation),
  };
}

/**
 * Цель войны фракции против державы (шаг 83): до `goalWorldsMax` миров державы у границы фракции, не
 * столица державы и не столица по каталогу; сперва миры, бывшие фракции по канону, дальше по каталогу.
 * «Взятые последними» не годятся: запись войны со списком взятого после мира снимается.
 */
export function aiWarGoal(deltas: GalaxyDeltas, factionId: string): readonly string[] {
  const capital = domainCapitalIndex(deltas);
  const near = domainWorlds(deltas).filter(
    (i) =>
      i !== capital &&
      !GALAXY.hasFlag(i, 'capital') &&
      GALAXY.neighbors(i).some((j) => ownerOf(deltas, j) === factionId),
  );
  const theirs = (i: number): number => (GALAXY.ownerId(i) === factionId ? 0 : 1);
  return near
    .sort((a, b) => theirs(a) - theirs(b) || a - b)
    .slice(0, P.goalWorldsMax)
    .map((i) => GALAXY.id(i));
}

/** Условия мира, которые фракция выставляет роте. Экран показывает их до нажатия. */
export type PeaceTerms =
  | { readonly kind: 'notAtWar' }
  | { readonly kind: 'tooEarly'; readonly readyDay: number }
  | { readonly kind: 'noPolitics' }
  /** `yields` — мир на цели фракции (шаг 83): держава проигрывает и платит мирами, а не деньгами. */
  | { readonly kind: 'free'; readonly offered: boolean; readonly yields?: true }
  | { readonly kind: 'pay'; readonly cost: number; readonly cede?: string };

/**
 * Условия мира по счёту войны (перевес = взято ротой − взято фракцией): рано —
 * отказ; предложение фракции — даром и на цели роты (`offered`); перевес роты —
 * даром, «как есть»; ничья — отступные ценой договора; отставание — × (1 + отставание),
 * а с `cedeFrom` миров — на выбор отступные или пограничный мир роты. Усталость роты
 * от `fatigueThreshold` снижает отступные линейно до нуля к пределу (шаг 81). У вольницы
 * политики нет — мира с ней нет. Что при мире перейдёт из рук в руки — `peaceOutcome`.
 */
export function peaceTerms(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  factionId: string,
  day: number,
): PeaceTerms {
  const rec = playerWarOf(war, factionId);
  if (rec === undefined) return { kind: 'notAtWar' };
  if (factionKind(factionId) === 'pirates') return { kind: 'noPolitics' };
  if (rec.offerUntil !== undefined && rec.offerUntil >= day) return { kind: 'free', offered: true };
  if (day < rec.since + P.minWarDays) return { kind: 'tooEarly', readyDay: rec.since + P.minWarDays };
  if (realmYields(rec)) return { kind: 'free', offered: false, yields: true };
  const balance = rec.won - rec.lost;
  // Держава, потерявшая все миры, воевать за них уже не может — и платить не из чего.
  if (balance >= 1 || domainWorlds(deltas).length === 0) return { kind: 'free', offered: false };
  const relief = Math.min(1, Math.max(0, ((rec.fatigue ?? 0) - P.fatigueThreshold) / (1 - P.fatigueThreshold)));
  const cost = Math.round(pactPrice(worldSeed, deltas) * (1 - balance) * (1 - relief));
  if (cost <= 0) return { kind: 'free', offered: false };
  const cede = -balance >= P.cedeFrom ? cedableWorld(deltas, factionId) : undefined;
  return cede === undefined ? { kind: 'pay', cost } : { kind: 'pay', cost, cede };
}

/** Пограничный мир роты, который фракция примет вместо отступных: первый по каталогу, не столица. */
function cedableWorld(deltas: GalaxyDeltas, factionId: string): string | undefined {
  const capital = domainCapitalIndex(deltas);
  for (const i of domainWorlds(deltas)) {
    if (i === capital) continue;
    if (GALAXY.neighbors(i).some((j) => ownerOf(deltas, j) === factionId)) return GALAXY.id(i);
  }
  return undefined;
}

/**
 * Проигрывает ли держава войну, где у фракции есть цель (шаг 83), — зеркало предложения мира фракцией
 * (шаг 81): держава устала от `fatigueThreshold` и сильнее фракции или дошла до предела усталости.
 * Тогда мир выдаёт цель фракции.
 */
export function realmYields(rec: PlayerWar): boolean {
  if (rec.foeGoal === undefined) return false;
  const fatigue = rec.fatigue ?? 0;
  return fatigue >= 1 || (fatigue >= P.fatigueThreshold && fatigue > (rec.foeFatigue ?? 0));
}

/** Что мир перенесёт из рук в руки (шаг 81) — одно число на экран и команду. */
export interface PeaceOutcome {
  /** Миры цели «миры», которые фракция отдаст роте. */
  readonly gained: readonly string[];
  /** Миры цели «дань», которые станут данниками роты. */
  readonly tributaries: readonly string[];
  /** Цель «унижение» выдаётся. */
  readonly humiliation: boolean;
  /** Взятое ротой сверх цели, что уйдёт назад фракции. */
  readonly returned: readonly string[];
  /** Миры цели фракции, которые держава отдаст (шаг 83). */
  readonly ceded: readonly string[];
}

/**
 * Исход мира (шаг 81). `offered` — мир по предложению фракции: он выдаёт цель роты (миры цели, ещё
 * принадлежащие фракции, дань с них или унижение). При любом мире взятое сверх цели остаётся за ротой,
 * пока его держит счёт: `max(0, взято − отнято − миров цели у роты после мира)`; лишнее уходит назад
 * фракции, начиная с последних взятых. Столица державы назад не уходит — мир не рушит державу. Взятое
 * фракцией у роты остаётся за ней: у фракции цели нет.
 */
export function peaceOutcome(war: WarState, deltas: GalaxyDeltas, factionId: string, offered: boolean): PeaceOutcome {
  const rec = playerWarOf(war, factionId);
  if (rec === undefined) return { gained: [], tributaries: [], humiliation: false, returned: [], ceded: [] };
  const goal = rec.goal;
  const owner = (id: string): string => ownerOf(deltas, GALAXY.require(id));
  const goalWorlds = goal?.kind === 'worlds' ? goal.systems : [];
  const gained = offered ? goalWorlds.filter((id) => owner(id) === factionId) : [];
  const tributaries = offered && goal?.kind === 'tribute' ? goal.systems.filter((id) => owner(id) === factionId) : [];
  const goalHeld = goalWorlds.filter((id) => owner(id) === PLAYER_ACTOR_ID).length + gained.length;
  const keep = Math.max(0, rec.won - rec.lost - goalHeld);
  const capital = domainCapitalIndex(deltas);
  // Цель фракции (шаг 83): её миры, ещё державины, кроме столицы, — когда держава проигрывает.
  const ceded = realmYields(rec)
    ? (rec.foeGoal ?? []).filter((id) => owner(id) === PLAYER_ACTOR_ID && GALAXY.require(id) !== capital)
    : [];
  const excess = [...new Set(rec.taken ?? [])].filter(
    (id) =>
      owner(id) === PLAYER_ACTOR_ID && !goalWorlds.includes(id) && !ceded.includes(id) && GALAXY.require(id) !== capital,
  );
  return {
    gained,
    tributaries,
    humiliation: offered && goal?.kind === 'humiliation',
    returned: excess.slice(keep),
    ceded,
  };
}

/**
 * Сколько суток продлится перемирие, если заключить мир сейчас: `truceBaseDays`, надбавка за счёт роты и — если
 * войну объявила рота — `declarerTruceDays`, не больше `truceMaxDays` (шаги 81, 90).
 */
export function truceDaysAfterPeace(war: WarState, factionId: string): number {
  const rec = playerWarOf(war, factionId);
  // Шаг 90 (`notes.md` §10zu п. 7): база `truceBaseDays` вместо срока договора и потолок `truceMaxDays`. Счёт `won`
  // — взятые миры и победы работы державы против врага (`execute.ts`, п. 6б), то есть всё, что держава у него взяла.
  return Math.min(
    P.truceMaxDays,
    P.truceBaseDays + (rec?.won ?? 0) * P.truceDaysPerWorld + (rec?.byRealm === true ? P.declarerTruceDays : 0),
  );
}

/**
 * Мир: перемирие `truceDaysAfterPeace` (база, надбавка за счёт роты и за объявление, потолок — шаг 90); запись
 * войны снята, сосед `demands.afterTruceDays` суток после перемирия не требует дани. Отношение пары до
 * `peaceRelation` больше не поднимается скачком (шаг 81): договор даёт свою прибавку, дальше вражда
 * тает тактом перемирия (`thawTruces`).
 *
 * Надбавка к перемирию (проект державы, шаг 3b; образец — долгое перемирие Stellaris): с приказом
 * армии держава брала миры в темпе игрока, а мир при перевесе даётся даром, и цикл «взять → мир →
 * перемирие → снова» ограничивался одним годом перемирия (замер: до 17 миров за 5 лет на одном сиде).
 * Теперь чем больше взято, тем дольше нельзя вернуться за следующим — то, что держава взяла, она
 * успевает освоить, а сосед — отстроиться. Шаг 90 сократил это до года самое большее: 900–1800 суток с
 * пятью соседями сразу запирали рост державы на годы (`notes.md` §10zu п. 7).
 */
export function applyPlayerPeace(
  war: WarState,
  rep: ReputationState,
  factionId: string,
  day: number,
): { war: WarState; reputation: ReputationState; truceUntil: number } {
  const truceUntil = day + truceDaysAfterPeace(war, factionId);
  const base = signPact(war, rep, PLAYER_ACTOR_ID, factionId, 'truce', day);
  const settled = withPlayerWar(withPact(base.war, PLAYER_ACTOR_ID, factionId, { kind: 'truce', untilDay: truceUntil }), factionId, undefined);
  // Тишина требований после перемирия (шаг 90): сосед не требует дани ещё `demands.afterTruceDays` суток.
  const demands = settled.demands ?? { last: {} };
  return {
    war: {
      ...settled,
      demands: { ...demands, quiet: { ...(demands.quiet ?? {}), [factionId]: truceUntil + WAR.demands.afterTruceDays } },
    },
    reputation: base.reputation,
    truceUntil,
  };
}

/**
 * ПАМЯТЬ О ВОЙНЕ (шаг 81). Пока у пары «рота — фракция» идёт перемирие и войны нет, отношение пары
 * прибавляет `thawPerDecade` за такт, до `peaceRelation`. До шага 81 мир поднимал его к
 * `peaceRelation` сразу: вражда стиралась в день мира, сколько бы ни длилась война. Своего
 * затухания у матрицы нет (`front.ts`: «тяги к базовой линии нет»), поэтому тает она здесь.
 */
function thawTruces(war: WarState, rep: ReputationState, day: number): ReputationState {
  let next = rep;
  for (const f of FACTION_LIST) {
    if (playerWarOf(war, f.id) !== undefined || !pactHolds(war, PLAYER_ACTOR_ID, f.id, 'truce', day)) continue;
    const r = relationOf(next, PLAYER_ACTOR_ID, f.id);
    if (r < P.peaceRelation) next = withRelation(next, PLAYER_ACTOR_ID, f.id, Math.min(P.peaceRelation, r + P.thawPerDecade));
  }
  return next;
}

/**
 * ВОЙНА ДЕРЖИТ ОТНОШЕНИЯ (шаг 79). Пока запись войны есть, отношение пары «рота — фракция» — не выше
 * `warRelation` (вражда не ниже порога фронта, участки не пропадают), а отношение фракции к роте — не
 * выше `declareStanding`. До шага 79 оба таяли посреди войны: затухание тянуло −25 к нулю (проба:
 * −16 через 80 суток, и Курита, воюя с державой, предлагала роте гарнизон), а сеть отношений
 * поднимала пару выше порога фронта, и война кончалась сама. Зовётся тактом войны роты и после
 * затухания (`commands/execute.ts::applyDecayTask`) — затухание само про войну не знает.
 */
export function holdPlayerWars(war: WarState, rep: ReputationState): ReputationState {
  let next = rep;
  for (const id of Object.keys(war.playerWars ?? {}).sort()) {
    if (relationOf(next, PLAYER_ACTOR_ID, id) > P.warRelation) next = withRelation(next, PLAYER_ACTOR_ID, id, P.warRelation);
    const standing = standingOf(next, id);
    if (standing > P.declareStanding) next = withStanding(next, id, P.declareStanding - standing);
  }
  return next;
}

/**
 * Такт войны роты — в такте фронта сразу после дипломатии фракций, до списка
 * участков: объявленная сегодня война даёт фронт в ту же декаду.
 *
 * 1. Нет державы — войн нет: записи снимаются (`realmFallen`).
 * 2. Запись снимается только тем, что войну кончает: договором или подчинением (шаг 79). Вражда,
 *    оттаявшая ниже порога фронта, войну больше не кончает — до шага 79 так война исчезала молча, и
 *    надбавка к перемирию за взятые миры обходилась повторным объявлением в тот же день. У пиратов и
 *    кланов, с которыми мира нет или он не нужен, запись живёт, пока есть общая граница.
 *    Оставшиеся войны держат отношения (`holdPlayerWars`).
 * 3. Растущая держава тревожит соседей (шаг 91, `realmAlarm`): отношение к роте падает от угрозы. Сосед, чьё
 *    отношение к роте упало до `aiDeclareStanding`, объявляет войну. Сосед, которому держава угрожает (шаг 83,
 *    `threat.ts`) и который сильнее её на границе, — тоже. Враждебные и встревоженные соседи объявляют войну
 *    коалицией — каждый свою, в один такт (шаг 91). У войны, объявленной политиком, всегда есть цель — вернуть
 *    миры (`aiWarGoal`; по отношению — с шага 91). По отношению объявляет только сосед, не слабее державы на границе
 *    (`resistance.standingWarForce`, шаг 92), и объявивший с целью сразу выводит к границе войско (`musterAgainstRealm`).
 * 4. Время войны утомляет обе стороны: +`fatiguePerDecade` за такт (шаг 81; потери — `notePlayerLosses`).
 * 5. Уставшая фракция — усталость от `fatigueThreshold` и выше, чем у роты, — предлагает мир на цели
 *    роты (шаг 81; до него мир «как есть» предлагался при перевесе роты от двух миров). Общедержавная
 *    готовность армии признаком не служит: она проседает и от чужих войн.
 * 6. Перемирия роты тают (`thawTruces`). Мир на пределе усталости — не здесь, а в конце такта фронта
 *    (`execute.ts`): мир переносит миры, а это дело команды, не такта.
 */
export function playerWarTick(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  day: number,
): { war: WarState; reputation: ReputationState; moves: DiplomacyMove[]; ended: PlayerWarEnded[] } {
  const moves: DiplomacyMove[] = [];
  const ended: PlayerWarEnded[] = [];
  if (domainWorlds(deltas).length === 0) {
    if (war.playerWars === undefined) return { war, reputation: rep, moves, ended };
    for (const id of Object.keys(war.playerWars).sort()) ended.push({ factionId: id, how: 'realmFallen' });
    const { playerWars: _cleared, ...rest } = war;
    return { war: rest, reputation: rep, moves, ended };
  }

  let nextWar = war;
  let nextRep = rep;
  const border = new Set(domainBorder(deltas).map((b) => b.owner));
  for (const id of Object.keys(war.playerWars ?? {}).sort()) {
    const kind = factionKind(id);
    const how: PlayerWarEnd | undefined = boundByProtectorate(nextWar, PLAYER_ACTOR_ID, id)
      ? 'vassal'
      : boundOrTruced(nextWar, PLAYER_ACTOR_ID, id, day)
        ? 'pact'
        : (kind === 'pirates' || kind === 'clan') && !border.has(id)
          ? 'noBorder'
          : undefined;
    if (how === undefined) continue;
    nextWar = withPlayerWar(nextWar, id, undefined);
    ended.push({ factionId: id, how });
  }

  // ТРЕВОГА (шаг 91) — до объявлений: отношение, упавшее в этот такт, объявляет войну в этот же.
  const borders = bordersOf(deltas);
  const growth = growthOf(nextWar);
  for (const { owner } of domainBorder(deltas)) {
    const drop = realmAlarm(nextWar, borders, growth, owner);
    if (drop > 0) nextRep = withStanding(nextRep, owner, -drop);
  }

  for (const { owner } of domainBorder(deltas)) {
    if (atWarWithPlayer(nextWar, nextRep, owner, day)) continue;
    if (boundOrTruced(nextWar, PLAYER_ACTOR_ID, owner, day)) continue;
    if (standingOf(nextRep, owner) > P.aiDeclareStanding) continue;
    // Слабый сосед по отношению войну не объявляет — копит обиду (шаг 92): Таурианцы объявляли при силе 53 против 225 и
    // проигрывали всухую, держава росла на чужих безнадёжных войнах.
    if (
      R.standingWarForce > 0 &&
      politicalActor(owner) &&
      borderForce(nextWar, borders, owner, PLAYER_ACTOR_ID) < R.standingWarForce * borderForce(nextWar, borders, PLAYER_ACTOR_ID, owner)
    ) {
      continue;
    }
    // Цель — вернуть миры (шаг 91): без неё фракция не наступает (`offensive.ts::foeOffensives`) и мир не выдаёт ей ничего.
    const goal = politicalActor(owner) ? aiWarGoal(deltas, owner) : undefined;
    const declared = declarePlayerWar(nextWar, nextRep, owner, day, undefined, goal);
    nextWar = goal === undefined ? declared.war : musterAgainstRealm(declared.war, borders, owner);
    nextRep = declared.reputation;
    moves.push({ kind: 'war', over: owner, under: PLAYER_ACTOR_ID });
  }

  // ОБЪЯВЛЕНИЕ ПО УГРОЗЕ (шаг 83): сосед, которому держава угрожает не меньше `aiDeclareThreat` и который
  // сильнее её на общей границе, объявляет войну с целью вернуть миры. Не под договором любого рода и не
  // под перемирием. Грубый отсев до обхода каталога — как в `worldDiplomacy`.
  if ((growth.get(PLAYER_ACTOR_ID) ?? 0) * WAR.diplomacy.powerMax >= P.aiDeclareThreat) {
    for (const { owner } of domainBorder(deltas)) {
      if (!politicalActor(owner) || atWarWithPlayer(nextWar, nextRep, owner, day)) continue;
      if (boundOrTruced(nextWar, PLAYER_ACTOR_ID, owner, day) || pactOf(nextWar, PLAYER_ACTOR_ID, owner) !== undefined) continue;
      if (threatOf(nextWar, borders, growth, owner, PLAYER_ACTOR_ID) < P.aiDeclareThreat) continue;
      if (borderForce(nextWar, borders, owner, PLAYER_ACTOR_ID) <= borderForce(nextWar, borders, PLAYER_ACTOR_ID, owner)) continue;
      const declared = declarePlayerWar(nextWar, nextRep, owner, day, undefined, aiWarGoal(deltas, owner));
      nextWar = musterAgainstRealm(declared.war, borders, owner);
      nextRep = declared.reputation;
      moves.push({ kind: 'war', over: owner, under: PLAYER_ACTOR_ID });
    }
  }

  // КОАЛИЦИЯ (шаг 91): враждебные и встревоженные соседи объявляют войну в один такт, каждый свою.
  for (const c of coalitionAgainstRealm(nextWar, nextRep, deltas, borders, growth, day, moves)) {
    const declared = declarePlayerWar(nextWar, nextRep, c.owner, day, undefined, aiWarGoal(deltas, c.owner));
    nextWar = musterAgainstRealm(declared.war, borders, c.owner);
    nextRep = declared.reputation;
    moves.push({ kind: 'war', over: c.owner, under: PLAYER_ACTOR_ID, ...(c.leader === undefined ? {} : { leader: c.leader }) });
  }

  for (const id of Object.keys(nextWar.playerWars ?? {}).sort()) {
    const rec = playerWarOf(nextWar, id) as PlayerWar;
    if (factionKind(id) === 'pirates' || rec.since >= day) continue;
    nextWar = withPlayerWar(
      nextWar,
      id,
      withFatigue(rec, (rec.fatigue ?? 0) + P.fatiguePerDecade, (rec.foeFatigue ?? 0) + P.fatiguePerDecade),
    );
  }

  for (const id of Object.keys(nextWar.playerWars ?? {}).sort()) {
    const rec = playerWarOf(nextWar, id) as PlayerWar;
    if (rec.offerUntil !== undefined && rec.offerUntil >= day) continue;
    // Срок предложения снимается, прочее в записи остаётся — в том числе день последнего приказа
    // армии (шаг 3): без него такт ИИ обнулял бы откат приказа каждую декаду.
    const { offerUntil: _offer, ...cleared } = rec;
    // Устала от порога И сильнее роты: время утомляет обе стороны поровну, и без второго условия
    // держава получала цель войны, не сделав ни выстрела (замер шага 81: сид 1, 0 боёв, цель через
    // 60 декад). Разницу дают только потери — то есть бои.
    const foe = rec.foeFatigue ?? 0;
    const losing = foe >= P.fatigueThreshold && foe > (rec.fatigue ?? 0);
    if (factionKind(id) === 'pirates' || day < rec.since + P.minWarDays || !losing) {
      if (rec.offerUntil !== undefined) nextWar = withPlayerWar(nextWar, id, cleared);
      continue;
    }
    nextWar = withPlayerWar(nextWar, id, { ...cleared, offerUntil: day + P.offerDays });
    moves.push({ kind: 'peaceOffer', over: id, under: PLAYER_ACTOR_ID });
  }
  return { war: nextWar, reputation: thawTruces(nextWar, holdPlayerWars(nextWar, nextRep), day), moves, ended };
}

/**
 * ТРЕВОГА СОСЕДА (шаг 91): на сколько отношение соседа к роте падает за декаду от угрозы державы (`threat.ts::threatOf`)
 * — `resistance.alarmStanding` × угроза от `alarmMin`, не больше `alarmStandingMax`. Ноль у соседа без политики, под
 * договором любого рода или подчинением и в войне с державой (война держит отношение сама, `holdPlayerWars`).
 *
 * Зачем (зонд шага 91): угроза от державы до шага двигала только объявление войны, а для соседа-Дома, который почти
 * всегда сильнее державы на границе, она на полу — и отношение к роте от роста не падало вовсе. Матрицу фракций
 * угроза двигает с шага 83 (`diplomacy.ts::worldDiplomacy`); пару с державой — здесь, отношением соседа к роте, по
 * которому объявление войны и шло всегда (`aiDeclareStanding`).
 */
export function realmAlarm(war: WarState, borders: Borders, growth: ReadonlyMap<string, number>, owner: string): number {
  if (!politicalActor(owner) || playerWarOf(war, owner) !== undefined) return 0;
  if (pactOf(war, PLAYER_ACTOR_ID, owner) !== undefined || boundByProtectorate(war, PLAYER_ACTOR_ID, owner)) return 0;
  const threat = threatOf(war, borders, growth, owner, PLAYER_ACTOR_ID);
  if (threat < R.alarmMin) return 0;
  return Math.min(R.alarmStandingMax, R.alarmStanding * threat);
}

/**
 * КОАЛИЦИЯ ПРОТИВ ДЕРЖАВЫ (шаг 91; ответ на вопрос 2 — одновременные войны). Кандидаты — соседи-политики без войны,
 * перемирия, договора и подчинения с державой, с отношением к роте не выше `resistance.coalitionStanding` и угрозой
 * от державы не ниже `coalitionThreat`. Они объявляют войну, если их не меньше `coalitionMin` или державе в этот такт
 * уже объявили войну (`moves`), и если вместе с объявившими они сильнее державы на своих границах (`borderForce`, та
 * же мера, что у объявления по угрозе). Порядок — по id; ведущий — первый объявивший или первый кандидат.
 */
function coalitionAgainstRealm(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  borders: Borders,
  growth: ReadonlyMap<string, number>,
  day: number,
  moves: readonly DiplomacyMove[],
): readonly { readonly owner: string; readonly leader?: string }[] {
  const declared = moves.filter((m) => m.kind === 'war' && politicalActor(m.over)).map((m) => m.over);
  const candidates: string[] = [];
  for (const { owner } of domainBorder(deltas)) {
    if (!politicalActor(owner) || atWarWithPlayer(war, rep, owner, day)) continue;
    if (boundOrTruced(war, PLAYER_ACTOR_ID, owner, day) || pactOf(war, PLAYER_ACTOR_ID, owner) !== undefined) continue;
    if (standingOf(rep, owner) > R.coalitionStanding) continue;
    if (threatOf(war, borders, growth, owner, PLAYER_ACTOR_ID) < R.coalitionThreat) continue;
    candidates.push(owner);
  }
  if (candidates.length === 0 || (candidates.length < R.coalitionMin && declared.length === 0)) return [];
  let theirs = 0;
  let ours = 0;
  for (const m of [...declared, ...candidates]) {
    theirs += borderForce(war, borders, m, PLAYER_ACTOR_ID);
    ours += borderForce(war, borders, PLAYER_ACTOR_ID, m);
  }
  if (theirs <= ours) return [];
  const leader = declared[0] ?? (candidates[0] as string);
  return candidates.map((owner) => (owner === leader ? { owner } : { owner, leader }));
}

/**
 * ОБЪЯВИВШИЙ ВОЙНУ ПРИХОДИТ С ВОЙСКОМ (шаг 92). Из резерва фракции на направление против державы сразу
 * уходит `resistance.declareMuster` × сила державы на этой границе (`borderForce`), сколько есть в резерве. Без этого театр
 * фракции в день объявления — ноль, наступать нечем, а держава подводит полки за 1–3 декады (зонд шага 92: шанс ИИ в
 * первую декаду 0.47–0.58, дальше 0.1–0.33).
 */
function musterAgainstRealm(war: WarState, borders: Borders, owner: string): WarState {
  if (R.declareMuster <= 0) return war;
  const want = Math.round(R.declareMuster * borderForce(war, borders, PLAYER_ACTOR_ID, owner));
  const reserve = economyOf(war, owner).army;
  const move = Math.min(reserve, Math.max(0, want - theaterOf(war, owner, PLAYER_ACTOR_ID)));
  if (move <= 0) return war;
  return withEconomy(withTheater(war, owner, PLAYER_ACTOR_ID, theaterOf(war, owner, PLAYER_ACTOR_ID) + move), owner, { army: reserve - move });
}
