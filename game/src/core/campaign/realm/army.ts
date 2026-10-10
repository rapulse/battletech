import { GALAXY } from '../galaxy/catalog.js';
import type { GalaxyDeltas } from '../galaxy/delta.js';
import { PLAYER_ACTOR_ID } from '../war/actors.js';
import { hasBuilding } from '../war/buildings.js';
import { domainWorlds } from '../war/domain.js';
import { armyTarget, totalArmy, type WarState } from '../war/economy.js';
import { WAR } from '../war/schema.js';
import { sectorMap, type RealmState } from './sectors.js';
import { titleBonusOf } from './titles.js';

/**
 * ПОТОЛОК АРМИИ ДЕРЖАВЫ (шаг 90, решение пользователя 2026-10-07; `notes.md` §10zu п. 5).
 *
 * До шага 90 потолок был тем же `armyTarget` от мощности миров, что у фракций: лен с фокусом «крепость» давал
 * 19–20 машин против эталона соседа 56–109 на границе, и армия не брала ни одного мира. Теперь сверх мощности:
 * - призыв — `domain.armyPerWorld` машин за каждый мир державы, и бедный мир тоже даёт солдат;
 * - казармы (`buildings.barracksArmy`), завод (`buildings.factoryArmy`) и учебный лагерь (`buildings.drillArmy`, ступень 8)
 *   на мире — постройки растят армию;
 * - всё вместе множится на прибавку достигнутых титулов (`realm.titles → army`).
 * У фракций потолок прежний — правило только державы роты.
 */
export interface RealmArmyCap {
  /** От мощности миров — как у фракций. */
  readonly capacity: number;
  /** Призыв за миры. */
  readonly draft: number;
  /** Казармы, заводы и учебные лагеря. */
  readonly buildings: number;
  /** Доля прибавки титулов. */
  readonly title: number;
  /** Итог: (мощность + призыв + постройки) × (1 + титул), вниз до целого. */
  readonly total: number;
}

export function realmArmyCap(deltas: GalaxyDeltas, capacity: number): RealmArmyCap {
  const worlds = domainWorlds(deltas);
  const B = WAR.buildings;
  let buildings = 0;
  for (const i of worlds) {
    if (hasBuilding(deltas, i, 'barracks')) buildings += B.barracksArmy;
    if (hasBuilding(deltas, i, 'factory')) buildings += B.factoryArmy;
    if (hasBuilding(deltas, i, 'drill')) buildings += B.drillArmy;
  }
  const base = armyTarget(capacity);
  const draft = worlds.length * WAR.domain.armyPerWorld;
  const title = titleBonusOf(worlds.length).army;
  return { capacity: base, draft, buildings, title, total: Math.floor((base + draft + buildings) * (1 + title)) };
}

/**
 * СОДЕРЖАНИЕ АРМИИ ДЕРЖАВЫ (шаг 90, ступень 8; решения пользователя 2026-10-07/08). Каждая машина армии — резерв и
 * театры — стоит `domain.armyUpkeep` за декаду. Казармы и учебный лагерь на мирах снимают долю содержания
 * (`buildings.barracksUpkeepCut`, `drillUpkeepCut`), в секторе с губернатором — в `sectorUpkeepFactor` раз больше;
 * вместе не ниже `armyUpkeepFloor`. Кадрированный резерв проверен и снят: путал игрока и делал армию почти бесплатной.
 * Одна функция на такт домена, экран, губернатора и бота.
 */
export interface RealmArmyUpkeep {
  readonly mechs: number;
  /** Множитель содержания от построек, от `armyUpkeepFloor` до 1. */
  readonly factor: number;
  readonly total: number;
}

export function realmArmyUpkeep(war: WarState, deltas: GalaxyDeltas, realm: RealmState): RealmArmyUpkeep {
  const B = WAR.buildings;
  const mechs = totalArmy(war, PLAYER_ACTOR_ID);
  const governed = realm.sectors.length === 0 ? null : sectorMap(deltas, realm);
  let cut = 0;
  for (const i of domainWorlds(deltas)) {
    const k = governed?.has(GALAXY.id(i)) === true ? B.sectorUpkeepFactor : 1;
    if (hasBuilding(deltas, i, 'barracks')) cut += B.barracksUpkeepCut * k;
    if (hasBuilding(deltas, i, 'drill')) cut += B.drillUpkeepCut * k;
  }
  const factor = Math.max(B.armyUpkeepFloor, 1 - cut);
  return { mechs, factor, total: Math.round(mechs * WAR.domain.armyUpkeep * factor) };
}
