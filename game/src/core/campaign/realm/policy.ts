import type { CampaignCommand, CampaignEvent } from '../commands/types.js';
import { GALAXY } from '../galaxy/catalog.js';
import { developmentOf, focusOf, ownerOf, withDelta } from '../galaxy/delta.js';
import { developmentMaxAt, developmentStepMatters, worldProfile } from '../galaxy/profile.js';
import type { WorldFocus } from '../galaxy/schema.js';
import type { CampaignState } from '../state.js';
import { PLAYER_ACTOR_ID } from '../war/actors.js';
import {
  buildBlocker,
  buildingCost,
  buildingUpkeep,
  constructionOf,
  developCostAt,
  domainBuildingsUpkeep,
} from '../war/buildings.js';
import { domainTally } from '../war/domain.js';
import { realmArmyUpkeep } from './army.js';
import { worldContributionAt } from '../war/economy.js';
import { frontSectors } from '../war/front.js';
import { planOffensive } from '../war/offensive.js';
import { peaceTerms, playerWarOf } from '../war/playerWar.js';
import { WAR, type BuildingKind } from '../war/schema.js';
import { sectorLive, sectorWorlds, type Sector } from './sectors.js';

/**
 * ПОЛИТИКИ ДЕРЖАВЫ (шаг 88; проект державы §6): губернатор сектора и стойка фронта.
 *
 * **Правило проекта: автоматизм — это политика, которая отдаёт те же команды.** Здесь только решения: что и где.
 * Исполняет их `run` — внутренний диспетчер команд (`commands/execute.ts`), тот же, что за `execute` у игрока, со
 * всеми проверками, ценами и событиями. Так устроены бот контрактов (`sim/campaign/manager.ts`) и бот державы
 * (`sim/campaign/realmBot.ts`); второго набора правил нет. Бросков политика не делает: решения детерминированы
 * состоянием, а приказ стойки тратит поток `camp.war`, как ручной приказ.
 *
 * Политики действуют раз в декаду, в конце такта фронта (решение пользователя 2026-10-02, п. 8): сначала стойки
 * (по id врага), затем губернаторы (по id центра).
 */

const R = WAR.realm;

/** Кто отдал команду политики. */
export type PolicyActor =
  | { readonly kind: 'governor'; readonly centerId: string; readonly pilotId: string }
  | { readonly kind: 'stance'; readonly factionId: string; readonly stance: 'advance' | 'yield' };

/** Что сделала политика — для строки журнала. Сами команды пишут свои события, как у игрока. */
export type PolicyAct =
  | { readonly kind: 'build'; readonly systemId: string; readonly building: BuildingKind }
  | { readonly kind: 'develop'; readonly systemId: string }
  | { readonly kind: 'focus'; readonly systemId: string; readonly focus: WorldFocus }
  | { readonly kind: 'offensive'; readonly systemId: string }
  | { readonly kind: 'peace' };

export const POLICY_ACT_KINDS = ['build', 'develop', 'focus', 'offensive', 'peace'] as const;

/** Исполнить команду тем же путём, что у игрока: события при успехе, `null` при отказе. */
export type PolicyRun = (command: CampaignCommand) => readonly CampaignEvent[] | null;

function policyLine(by: PolicyActor, act: PolicyAct, events: readonly CampaignEvent[]): CampaignEvent[] {
  return [{ kind: 'realmPolicy', by, act }, ...events];
}

/** Стойки, затем губернаторы. Без стоек и секторов — ни одной команды и ни одного события. */
export function applyRealmPolicies(state: CampaignState, run: PolicyRun): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  for (const factionId of Object.keys(state.realm.stances).sort()) events.push(...stanceStep(state, run, factionId));
  const sectors = [...state.realm.sectors].sort((a, b) => (a.center < b.center ? -1 : a.center > b.center ? 1 : 0));
  for (const s of sectors) events.push(...governorStep(state, run, s));
  return events;
}

// ---------------------------------------------------------------------------------------------------------------
// Стойка фронта
// ---------------------------------------------------------------------------------------------------------------

/**
 * Участок для приказа стойки «наступать» — по образцу замысла фракции (`war/plans.ts`): цель войны (шаг 81), затем
 * ближайший к ней участок в радиусе главного удара `plans.radiusLy`, иначе — лучшее соотношение сил. Только участки,
 * где приказ разрешён (`planOffensive`) и шанс не ниже `realm.stanceMinOdds`. Цель, выбранная игроком
 * (`realm.targets`, шаг 93), важнее всех рангов, пока она участок фронта. `undefined` — приказывать некуда.
 */
export function stanceTarget(state: CampaignState, factionId: string): number | undefined {
  // Цель, выбранная игроком (шаг 93): пока она участок фронта против этого врага, стойка бьёт только её — и только
  // по тем же условиям (приказ разрешён, шанс не ниже порога); не проходит — стойка ждёт, а не бьёт в другое место.
  const chosen = state.realm.targets?.[factionId];
  if (chosen !== undefined) {
    const i = GALAXY.require(chosen);
    if (isFrontTarget(state, factionId, i)) {
      const check = planOffensive(state.war, state.reputation, state.deltas, state.worldSeed, i, state.day);
      return check.ok && check.forces.odds >= R.stanceMinOdds ? i : undefined;
    }
  }
  const goal = playerWarOf(state.war, factionId)?.goal;
  const goalSystems = goal === undefined || goal.kind === 'humiliation' ? [] : goal.systems.map((id) => GALAXY.require(id));
  let best: { system: number; key: readonly number[] } | undefined;
  for (const x of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
    if (x.attacker !== PLAYER_ACTOR_ID || x.defender !== factionId) continue;
    const check = planOffensive(state.war, state.reputation, state.deltas, state.worldSeed, x.system, state.day);
    if (!check.ok || check.forces.odds < R.stanceMinOdds) continue;
    const dist = goalSystems.length === 0 ? Infinity : Math.min(...goalSystems.map((g) => GALAXY.distance(g, x.system)));
    // Ранг: 0 — сама цель, 1 — в радиусе главного удара (ближе — лучше), 2 — остальные; дальше — шанс.
    const rank = goalSystems.includes(x.system) ? 0 : dist <= WAR.plans.radiusLy ? 1 : 2;
    const key = [rank, rank === 1 ? dist : 0, -check.forces.odds];
    if (best === undefined || lexLess(key, best.key)) best = { system: x.system, key };
  }
  return best?.system;
}

/** Участок фронта державы против этого врага — то, на что стойка и приказ вообще могут наступать. */
export function isFrontTarget(state: CampaignState, factionId: string, system: number): boolean {
  return frontSectors(state.war, state.reputation, state.deltas, state.day).some(
    (x) => x.attacker === PLAYER_ACTOR_ID && x.defender === factionId && x.system === system,
  );
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    if ((a[k] as number) !== (b[k] as number)) return (a[k] as number) < (b[k] as number);
  }
  return false;
}

function stanceStep(state: CampaignState, run: PolicyRun, factionId: string): CampaignEvent[] {
  const stance = state.realm.stances[factionId];
  if (stance === undefined || playerWarOf(state.war, factionId) === undefined) return [];
  const by: PolicyActor = { kind: 'stance', factionId, stance };
  if (stance === 'advance') {
    const target = stanceTarget(state, factionId);
    if (target === undefined) return [];
    const systemId = GALAXY.id(target);
    const ev = run({ kind: 'orderOffensive', systemId });
    return ev === null ? [] : policyLine(by, { kind: 'offensive', systemId }, ev);
  }
  // «Уступать» — мир, как только он даром: без отступных и без миров (не на цели фракции).
  const terms = peaceTerms(state.war, state.deltas, state.worldSeed, factionId, state.day);
  if (terms.kind !== 'free' || terms.yields === true) return [];
  const ev = run({ kind: 'makePeace', factionId });
  return ev === null ? [] : policyLine(by, { kind: 'peace' }, ev);
}

// ---------------------------------------------------------------------------------------------------------------
// Губернатор
// ---------------------------------------------------------------------------------------------------------------

/** Свободные деньги губернатора: касса сверх резерва игрока. */
function spare(state: CampaignState): number {
  return state.company.cbills - state.realm.reserve;
}

/** Итог державы за декаду после содержания миров, армии и построек — тот, что видит игрок в сводке. */
function realmNet(state: CampaignState): number {
  const t = domainTally(state.worldSeed, state.deltas);
  return t.income - t.upkeep - realmArmyUpkeep(state.war, state.deltas, state.realm).total - domainBuildingsUpkeep(state.deltas);
}

/** Мир у границы с фракцией, с которой идёт война. */
function borderAtWar(state: CampaignState, i: number): boolean {
  return GALAXY.neighbors(i).some((j) => {
    const owner = ownerOf(state.deltas, j);
    return owner !== PLAYER_ACTOR_ID && playerWarOf(state.war, owner) !== undefined;
  });
}

/** Прибавка итога мира (доход − содержание) от следующей ступени развития. */
function developmentGain(state: CampaignState, i: number): number {
  const id = GALAXY.id(i);
  const now = worldContributionAt(state.worldSeed, state.deltas, i);
  const up = worldContributionAt(
    state.worldSeed,
    withDelta(state.deltas, id, { development: developmentOf(state.deltas, id) + 1 }),
    i,
  );
  return up.income - up.upkeep - (now.income - now.upkeep);
}

/** Миры сектора, по которым губернатор отдаёт команды: без закреплённых игроком. */
export function governedWorlds(state: CampaignState, center: string): readonly number[] {
  const pinned = new Set(state.realm.pinned);
  return sectorWorlds(state.deltas, state.realm, center)
    .filter((id) => !pinned.has(id))
    .map((id) => GALAXY.require(id));
}

function governorStep(state: CampaignState, run: PolicyRun, sector: Sector): CampaignEvent[] {
  if (sector.governor === null || !sectorLive(state.deltas, sector)) return [];
  const by: PolicyActor = { kind: 'governor', centerId: sector.center, pilotId: sector.governor };
  const rule = R.priorities[sector.priority];
  const worlds = governedWorlds(state, sector.center);
  const events: CampaignEvent[] = [];

  // Стройка: каждый свободный мир — первая доступная постройка по порядку приоритета, если касса после цены не ниже
  // резерва, а итог державы с новым содержанием в плюсе (правило бота шага 87).
  for (const i of worlds) {
    if (constructionOf(state.deltas, i) !== undefined) continue;
    const kind = rule.buildings.find((k) => buildBlocker(state.worldSeed, state.deltas, i, k) === null);
    if (kind === undefined) continue;
    if (spare(state) < buildingCost(kind) || realmNet(state) - buildingUpkeep(kind) <= 0) continue;
    const systemId = GALAXY.id(i);
    const ev = run({ kind: 'startBuilding', systemId, building: kind });
    if (ev !== null) events.push(...policyLine(by, { kind: 'build', systemId, building: kind }, ev));
  }

  // Развитие: не больше ступени на сектор за декаду — мир с наибольшей прибавкой итога.
  if (rule.develop) {
    let best: { i: number; gain: number } | undefined;
    for (const i of worlds) {
      if (spare(state) < developCostAt(state.deltas, i)) continue;
      if (developmentOf(state.deltas, GALAXY.id(i)) >= developmentMaxAt(state.deltas, i)) continue;
      if (!developmentStepMatters(state.worldSeed, state.deltas, i)) continue;
      const gain = developmentGain(state, i);
      if (gain > 0 && (best === undefined || gain > best.gain)) best = { i, gain };
    }
    if (best !== undefined) {
      const systemId = GALAXY.id(best.i);
      const ev = run({ kind: 'developWorld', systemId });
      if (ev !== null) events.push(...policyLine(by, { kind: 'develop', systemId }, ev));
    }
  }

  // Фокус: раз на мир, как автоматика фракций, — только мир без фокуса в дельте и без идущей переделки; «Крепость» —
  // только у границы с войной. Не больше одной переделки на сектор за декаду.
  const focus = rule.focus;
  if (focus !== null && spare(state) >= WAR.focus.cost) {
    for (const i of worlds) {
      const id = GALAXY.id(i);
      const d = state.deltas[id];
      if (d?.focus !== undefined || d?.focusTo !== undefined) continue;
      if (focusOf(state.deltas, id, worldProfile(state.worldSeed, state.deltas, i).naturalFocus) === focus) continue;
      if (focus === 'fortress' && !borderAtWar(state, i)) continue;
      const ev = run({ kind: 'setWorldFocus', systemId: id, focus });
      if (ev === null) continue;
      events.push(...policyLine(by, { kind: 'focus', systemId: id, focus }, ev));
      break;
    }
  }
  return events;
}
