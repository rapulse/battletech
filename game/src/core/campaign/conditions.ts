import { PILOTS, type StateCondition } from '../data/index.js';
import { baseSkill } from '../model/Pilot.js';
import { tributeOf } from './galaxy/delta.js';
import { recordQuality } from './mech/MechRecord.js';
import { playerRank } from './rivals/rating.js';
import type { CampaignState } from './state.js';
import { PLAYER_ACTOR_ID } from './war/actors.js';
import { domainWorlds } from './war/domain.js';
import { vassalsOf } from './war/economy.js';
import { WAR } from './war/schema.js';
import { realmTitle } from './realm/titles.js';

/**
 * Условия, выводимые из состояния роты (шаги 69, 70).
 *
 * Одна функция на вид условия, и её зовут и достижения, и главы кампании: веха
 * «Union» и значок «Union» не могут разойтись, потому что это одна проверка.
 * Только чтение — состояние здесь не меняется.
 */

function contractsWon(state: CampaignState): number {
  let won = 0;
  for (const d of Object.values(state.deltas)) won += d.foughtWon ?? 0;
  return won;
}

function worldsFought(state: CampaignState): number {
  let n = 0;
  for (const d of Object.values(state.deltas)) if ((d.fought ?? 0) > 0) n += 1;
  return n;
}

/**
 * Дипломатические шаги роты, которые действуют сейчас: договоры с соседями и
 * миры, платящие роте дань. Истёкшие не в счёт — срок проверяется так же, как
 * его проверяют доход и война (`pactHolds`, `tributeOf`), а не тактом снятия.
 */
function diplomacyCount(state: CampaignState): number {
  let n = 0;
  for (const [pair, pact] of Object.entries(state.war.pacts)) {
    if (pact.untilDay > state.day && pair.split('|').includes(PLAYER_ACTOR_ID)) n += 1;
  }
  for (const id of Object.keys(state.deltas)) {
    if (tributeOf(state.deltas, id, state.day) === PLAYER_ACTOR_ID) n += 1;
  }
  return n;
}

export function stateConditionMet(c: StateCondition, state: CampaignState): boolean {
  const company = state.company;
  switch (c.type) {
    case 'contractsWon':
      return contractsWon(state) >= c.min;
    case 'cbills':
      return company.cbills >= c.min;
    case 'dropship':
      return c.ships.includes(company.dropship);
    case 'fleetSize':
      return company.mechs.length >= c.min;
    case 'mechBattles':
      return company.mechs.some((m) => m.battles >= c.min);
    case 'fame':
      return state.reputation.fame >= c.min;
    case 'totalKills':
      return state.achievements.kills >= c.min;
    case 'worldsFought':
      return worldsFought(state) >= c.min;
    case 'pilotSkill':
      return company.pilots.some((p) => PILOTS.skills.some((s) => baseSkill(p, s.id) >= c.min));
    case 'masterQuality':
      return company.mechs.some((m) => {
        const q = recordQuality(m);
        return q.reactor === 'master' || q.frame === 'master';
      });
    case 'ratingRank':
      return playerRank(state) <= c.max;
    case 'worlds':
      return domainWorlds(state.deltas).length >= c.min;
    case 'diplomacy':
      return diplomacyCount(state) >= c.min;
    case 'vassals':
      return vassalsOf(state.war, PLAYER_ACTOR_ID).length >= c.min;
    case 'realmTitle': {
      const need = WAR.realm.titles.findIndex((t) => t.id === c.id);
      const have = realmTitle(state.deltas);
      return need >= 0 && have !== null && WAR.realm.titles.indexOf(have) >= need;
    }
  }
}
