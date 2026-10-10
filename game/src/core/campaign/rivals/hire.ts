import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { PLAYER_ACTOR_ID } from '../war/actors.js';
import { domainWorlds } from '../war/domain.js';
import type { WarState } from '../war/economy.js';
import { playerWarOf } from '../war/playerWar.js';
import { WAR } from '../war/schema.js';
import { RIVALS } from './schema.js';
import type { Regiment } from './types.js';

/**
 * НАЁМ ВЕЛИКОГО ПОЛКА ДЕРЖАВОЙ РОТЫ (шаг 89, проект державы §4 G; решения пользователя 2026-10-02).
 *
 * Держава нанимает канонический полк MRBC на срок против врага, с которым у неё запись войны: полк сразу встаёт на
 * её мир, ближайший к врагу, и берёт подряды тем же кодом, что у фракций (`regiments.ts`), только против врага
 * найма и без гонорара — он оплачен наймом. Это сток кассы с понятной отдачей: выигранный подряд кладёт державе
 * в фонд против врага, а фонд двигает напор её участков (`front.ts::pushOf`).
 *
 * Полк не нанимается против Дома, которому верен (`great.loyalTo`): Гончие Келла не пойдут на Штайнер ни за
 * какие деньги. Драгуны и Синяя Звезда верности не имеют.
 */

const H = RIVALS.regiment.hire;

/** Почему полк нанять нельзя. Нет причины — можно (деньги проверяет команда). */
export type HireBlocker = 'noRealm' | 'notAtWar' | 'regimentHired' | 'regimentLoyal' | 'noStation';

/** Цена найма: машин полка сейчас × ставка × срок — из кассы роты разом. */
export function greatHirePrice(r: Regiment): number {
  return r.mechs * H.pricePerMechDecade * H.termDecades;
}

/** Дом, которому полк верен по канону, или `undefined`. */
export function regimentLoyalTo(regimentId: string): string | undefined {
  return RIVALS.registry.find((u) => u.id === regimentId)?.great?.loyalTo;
}

/**
 * Где встаёт нанятый полк: мир державы, ближайший в прыжках к любому миру врага; при равенстве — тот, у кого
 * больше соседей врага, затем меньший индекс каталога. Нет пути — `null`.
 */
export function hireStation(deltas: GalaxyDeltas, against: string): number | null {
  const mine = domainWorlds(deltas);
  if (mine.length === 0) return null;
  const depth = new Int16Array(GALAXY.count).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < GALAXY.count; i++) {
    if (ownerOf(deltas, i) !== against) continue;
    depth[i] = 0;
    frontier.push(i);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (depth[j] !== -1) continue;
        depth[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  let best: number | null = null;
  let bestDepth = Infinity;
  let bestFoes = -1;
  for (const i of mine) {
    const d = depth[i] as number;
    if (d < 0) continue;
    let foes = 0;
    for (const j of GALAXY.neighbors(i)) if (ownerOf(deltas, j) === against) foes++;
    if (d < bestDepth || (d === bestDepth && foes > bestFoes)) {
      best = i;
      bestDepth = d;
      bestFoes = foes;
    }
  }
  return best;
}

export function hireBlocker(
  war: WarState,
  deltas: GalaxyDeltas,
  regiment: Regiment,
  against: string,
): HireBlocker | null {
  if (domainWorlds(deltas).length === 0) return 'noRealm';
  if (regiment.hire !== undefined) return 'regimentHired';
  if (playerWarOf(war, against) === undefined) return 'notAtWar';
  if (regimentLoyalTo(regiment.id) === against) return 'regimentLoyal';
  if (hireStation(deltas, against) === null) return 'noStation';
  return null;
}

/** Полк после найма: на мире державы, наниматель — держава, срок — `termDecades` декад от `day`. */
export function hiredRegiment(r: Regiment, against: string, station: number, day: number): Regiment {
  return {
    ...r,
    systemId: GALAXY.id(station),
    employer: PLAYER_ACTOR_ID,
    hire: { against, until: day + H.termDecades * WAR.front.tickDays },
  };
}

/** Почему найм кончился: срок, мир с врагом, мир стоянки потерян. */
export type HireEnd = 'term' | 'peace' | 'lost';

/** Кончился ли найм к этому дню (такт полков). */
export function hireEndOf(r: Regiment, war: WarState, deltas: GalaxyDeltas, day: number): HireEnd | undefined {
  if (r.hire === undefined) return undefined;
  if (ownerOf(deltas, GALAXY.require(r.systemId)) !== PLAYER_ACTOR_ID) return 'lost';
  if (playerWarOf(war, r.hire.against) === undefined) return 'peace';
  if (day >= r.hire.until) return 'term';
  return undefined;
}
