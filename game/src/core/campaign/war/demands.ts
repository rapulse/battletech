import { Rng } from '../../rng/index.js';
import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, tributeOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { withStanding, type ReputationState } from '../reputation/state.js';
import { PLAYER_ACTOR_ID } from './actors.js';
import { boundOrTruced } from './diplomacy.js';
import { domainBorder } from './domain.js';
import { raidStrike } from './development.js';
import { domainCapitalIndex, pactOf, worldContributionAt, type DemandCard, type WarState } from './economy.js';
import { pendingEvents } from './events.js';
import { inRevolt } from './loyalty.js';
import { atWarWithPlayer, playerWarOf } from './playerWar.js';
import { WAR } from './schema.js';
import { bordersOf, borderForce, growthOf, politicalActor, threatOf, type Borders } from './threat.js';

/**
 * ТРЕБОВАНИЯ СОСЕДЕЙ (шаг 89, проект державы §4 H; решения пользователя 2026-10-02).
 *
 * Сильный сосед, которому держава роты не угрожает, требует дань с её пограничного мира: «плати — или будем
 * говорить иначе». До шага сила на границе уже решала объявление войны по угрозе (шаг 83), но держава, которая
 * не растёт, от сильного соседа ничего не слышала — давления без войны не было.
 *
 * Условие — только пороги, без бросков, поток `camp.war` не сдвигается (бросок есть только у отказа — свой сид):
 * - сосед ведёт политику (`threat.ts::politicalActor`), с державой нет войны, договора любого рода,
 *   перемирия и подчинения;
 * - держава ему не угрожает (угроза ниже `playerWar.aiDeclareThreat` — иначе он объявляет войну, шаг 83);
 * - он сильнее на общей границе не меньше чем в `demands.forceRatio` раз (`borderForce`, та же мера);
 * - откат пары прошёл, и у державы есть пограничный с ним мир не столица и не данник.
 *
 * Требование — карточка: прокрутка стоит, пока игрок не ответит командой `answerDemand`. Принять — мир платит
 * соседу дань стандартного срока тем же полем, что лен и дань фракций (`tribute`, `tributeUntil`), отношение
 * соседа к роте растёт; отказ — набег на мир или отношение вниз (`answerDemand`), а войну по отношению объявит правило
 * `playerWar.ts::playerWarTick`. Своих правил войны у требования нет.
 */

const DM = WAR.demands;
const TICK = WAR.front.tickDays;

/**
 * Во сколько раз сосед сильнее державы на их общей границе: армия × доля границы с обеих сторон
 * (`threat.ts::borderForce`). Ноль — у соседа на этой границе ничего нет; бесконечность — у державы ничего.
 */
export function demandForceRatio(war: WarState, b: Borders, from: string): number {
  const theirs = borderForce(war, b, from, PLAYER_ACTOR_ID);
  const ours = borderForce(war, b, PLAYER_ACTOR_ID, from);
  if (theirs <= 0) return 0;
  return ours <= 0 ? Infinity : theirs / ours;
}

/**
 * Мир, с которого сосед потребует дань: мир державы рядом с его мирами `systems` (`domainBorder`), не столица, не
 * данник; самый доходный, затем меньший индекс. Не мир в восстании и не мир, взятый у фракции, с которой держава ещё
 * воюет (отладка 2026-10-03): под данью лояльность не растёт, и свежий захват после мира стоял бы на месте полтора
 * года, — во всех трёх войнах отладочной игры требование ложилось именно на такой мир.
 */
export function demandWorld(
  worldSeed: number,
  war: WarState,
  deltas: GalaxyDeltas,
  systems: readonly number[],
  day: number,
): number | null {
  const capital = domainCapitalIndex(deltas);
  const mine = new Set<number>();
  for (const j of systems) {
    for (const i of GALAXY.neighbors(j)) {
      if (ownerOf(deltas, i) !== PLAYER_ACTOR_ID || i === capital) continue;
      const id = GALAXY.id(i);
      if (tributeOf(deltas, id, day) !== undefined || inRevolt(deltas, id)) continue;
      const former = deltas[id]?.formerOwner;
      if (former !== undefined && playerWarOf(war, former) !== undefined) continue;
      mine.add(i);
    }
  }
  let best: number | null = null;
  let bestIncome = -Infinity;
  for (const i of [...mine].sort((x, y) => x - y)) {
    const income = worldContributionAt(worldSeed, deltas, i).income;
    if (income > bestIncome) {
      best = i;
      bestIncome = income;
    }
  }
  return best;
}

/** Свободен ли сосед от войны, договора, перемирия и подчинения с державой. */
function atPeaceWith(war: WarState, rep: ReputationState, from: string, day: number): boolean {
  return (
    !atWarWithPlayer(war, rep, from, day) &&
    !boundOrTruced(war, PLAYER_ACTOR_ID, from, day) &&
    pactOf(war, PLAYER_ACTOR_ID, from) === undefined
  );
}

/**
 * Такт требований: конец такта фронта, раз в декаду. Открытая карточка — новых нет. Соседи — по id, первый
 * подошедший предъявляет требование, и в декаду оно одно.
 */
export function demandTick(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
): { readonly war: WarState; readonly card?: DemandCard } {
  if (war.demands?.pending !== undefined) return { war };
  const border = domainBorder(deltas);
  if (border.length === 0) return { war };
  let borders: Borders | null = null;
  let growth: ReadonlyMap<string, number> | null = null;
  for (const { owner, systems } of border) {
    if (!politicalActor(owner) || !atPeaceWith(war, rep, owner, day)) continue;
    const last = war.demands?.last[owner];
    if (last !== undefined && day < last + DM.cooldownDecades * TICK) continue;
    // Тишина после перемирия (шаг 90): мир с державой не кончается требованием в день конца перемирия.
    const quiet = war.demands?.quiet?.[owner];
    if (quiet !== undefined && day < quiet) continue;
    borders ??= bordersOf(deltas);
    growth ??= growthOf(war);
    if (threatOf(war, borders, growth, owner, PLAYER_ACTOR_ID) >= WAR.playerWar.aiDeclareThreat) continue;
    if (demandForceRatio(war, borders, owner) < DM.forceRatio) continue;
    const world = demandWorld(worldSeed, war, deltas, systems, day);
    if (world === null) continue;
    const card: DemandCard = { from: owner, systemId: GALAXY.id(world), day };
    return {
      war: { ...war, demands: { ...war.demands, pending: card, last: { ...(war.demands?.last ?? {}), [owner]: day } } },
      card,
    };
  }
  return { war };
}

/** Открытая карточка требования, если есть. */
export function pendingDemand(war: WarState): DemandCard | undefined {
  return war.demands?.pending;
}

/**
 * Открыта ли карточка, на которую игрок обязан ответить: событие мира (шаг 84) или требование соседа (шаг 89).
 * Пока открыта — прокрутка времени стоит.
 */
export function cardOpen(war: WarState): boolean {
  return pendingEvents(war).length > 0 || war.demands?.pending !== undefined;
}

export type DemandOutcome = 'accepted' | 'refused' | 'lapsed';

/** Чем сосед ответил на отказ: набегом на мир или холодом — отношение вниз. */
export type RefusalPunishment =
  | { readonly kind: 'raid'; readonly ruined: number; readonly sacked: boolean }
  | { readonly kind: 'standing'; readonly delta: number };

/** Сид броска «чем ответить на отказ»: свой, из мира и дня, чтобы не сдвинуть ни одного броска потоков кампании. */
function refusalSeed(worldSeed: number, systemId: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x5bd1e995;
  const text = `${systemId}|${day}|refusal`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Ответ на требование. Карточка снимается в любом случае. Мир ушёл от державы или с соседом уже война либо
 * договор — требование теряет смысл (`lapsed`), без последствий. Принять — дань стандартного срока с мира и
 * отношение вверх.
 *
 * ОТКАЗ НЕ ДАРОМ (решение пользователя 2026-10-07): сосед, вдвое сильнее на границе, отвечает одним из двух —
 * с шансом `demands.refuseRaidChance` набегом на этот мир (тот же удар, что у вольницы, `raidStrike`: разорение
 * и, с шансом, ступень развития), иначе отношение вниз на `refuseStanding`. До правки отказ стоил −15 отношения,
 * и война по `aiDeclareStanding` (−50) у нейтрального соседа наступала только к четвёртому отказу — через годы.
 */
export function answerDemand(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  day: number,
  accept: boolean,
  worldSeed: number,
): {
  war: WarState;
  reputation: ReputationState;
  deltas: GalaxyDeltas;
  card: DemandCard;
  outcome: DemandOutcome;
  punishment?: RefusalPunishment;
} {
  const d = war.demands as NonNullable<WarState['demands']>;
  const card = d.pending as DemandCard;
  const nextWar: WarState = { ...war, demands: { last: d.last } };
  const live =
    ownerOf(deltas, GALAXY.require(card.systemId)) === PLAYER_ACTOR_ID &&
    tributeOf(deltas, card.systemId, day) === undefined &&
    atPeaceWith(war, rep, card.from, day);
  if (!live) return { war: nextWar, reputation: rep, deltas, card, outcome: 'lapsed' };
  if (!accept) {
    const rng = new Rng(refusalSeed(worldSeed, card.systemId, day));
    if (rng.next() < DM.refuseRaidChance) {
      const i = GALAXY.require(card.systemId);
      const strike = raidStrike(nextWar, deltas, worldSeed, i, PLAYER_ACTOR_ID, rng);
      // Мир уже сожжён дотла — жечь нечего, сосед отвечает холодом.
      if (strike !== null) {
        return {
          war: strike.war,
          reputation: rep,
          deltas: strike.deltas,
          card,
          outcome: 'refused',
          punishment: { kind: 'raid', ruined: strike.ruined, sacked: strike.sacked },
        };
      }
    }
    return {
      war: nextWar,
      reputation: withStanding(rep, card.from, DM.refuseStanding),
      deltas,
      card,
      outcome: 'refused',
      punishment: { kind: 'standing', delta: DM.refuseStanding },
    };
  }
  return {
    war: nextWar,
    reputation: withStanding(rep, card.from, DM.acceptStanding),
    deltas: withDelta(deltas, card.systemId, {
      tribute: card.from,
      tributeUntil: day + WAR.diplomacy.tributeDecades * TICK,
    }),
    card,
    outcome: 'accepted',
  };
}
