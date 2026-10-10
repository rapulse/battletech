import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, withDelta, type GalaxyDeltas, type SystemDeltaPatch } from '../galaxy/delta.js';
import { worldProfile } from '../galaxy/profile.js';
import { Rng } from '../../rng/Rng.js';
import { bonusOf, NO_BONUSES, type RealmBonuses } from '../realm/bonus.js';
import { isPlayerActor } from './actors.js';
import { domainWorldIndexes, worldContributionAt } from './economy.js';
import { BUILDING_KINDS, WAR, type BuildingKind } from './schema.js';

/**
 * ПОСТРОЙКИ МИРА РОТЫ (шаг 87; проект державы §4 A).
 *
 * Мощность мира — очки стройки за декаду; на мире одна стройка за раз, срок = трудоёмкость ÷ очки. Деньги
 * списываются при постановке, содержание — доля цены за декаду из итога державы до доли войны. По ступени
 * каждого вида на мир.
 *
 * Постройки живут в дельте мира (`buildings`, `building`, `buildProgress`) и действуют, только пока мир роты:
 * у фракций построек нет — четыре из шести работают с тем, чего у фракций нет (машины роты, гарнизон,
 * лояльность, лавка), а оборону и производство им уже дают фокус, мощность и развитие (решение пользователя
 * 2026-10-01). Мир, ушедший от роты, теряет недострой, а готовые постройки уцелевают броском и «спят» до
 * возврата. Мир без державы побитово прежний: записей нет.
 */

const B = WAR.buildings;

export { BUILDING_KINDS, type BuildingKind };

function idOf(system: number | string): string {
  return typeof system === 'number' ? GALAXY.id(system) : system;
}

/** Готовые постройки на мире — и действующие, и спящие (мир чужой). */
export function builtOn(deltas: GalaxyDeltas, system: number | string): readonly BuildingKind[] {
  return deltas[idOf(system)]?.buildings ?? [];
}

/** Действующие постройки: только у мира роты. */
export function activeBuildings(deltas: GalaxyDeltas, system: number | string): readonly BuildingKind[] {
  const built = builtOn(deltas, system);
  if (built.length === 0) return built;
  return isPlayerActor(ownerOf(deltas, system)) ? built : [];
}

export function hasBuilding(deltas: GalaxyDeltas, system: number | string, kind: BuildingKind): boolean {
  return activeBuildings(deltas, system).includes(kind);
}

export function buildingCost(kind: BuildingKind): number {
  return B.kinds[kind].cost;
}

export function buildingWork(kind: BuildingKind): number {
  return B.kinds[kind].work;
}

/** Содержание постройки за декаду. */
export function buildingUpkeep(kind: BuildingKind): number {
  return Math.round(B.kinds[kind].cost * B.upkeepShare);
}

/** Сколько вернёт отмена стройки. */
export function buildingRefund(kind: BuildingKind): number {
  return Math.round(B.kinds[kind].cost * B.cancelRefund);
}

/**
 * Очки стройки мира за декаду: мощность (с лояльностью), но не меньше пола; сверху — бонус губернатора сектора
 * (шаг 88, навык tech).
 */
export function buildPoints(worldSeed: number, deltas: GalaxyDeltas, i: number, bonuses: RealmBonuses = NO_BONUSES): number {
  const port = hasBuilding(deltas, i, 'spaceport') ? B.spaceportPoints : 0;
  return Math.max(B.minPoints, worldContributionAt(worldSeed, deltas, i).capacity) + bonusOf(bonuses, GALAXY.id(i)).points + port;
}

/** Цена ступени развития мира роты: общая цена, с космопортом — со скидкой (2026-10-04). */
export function developCostAt(deltas: GalaxyDeltas, system: number | string): number {
  const cut = hasBuilding(deltas, system, 'spaceport') ? B.spaceportDevelopCut : 0;
  return Math.round(WAR.development.stepCost * (1 - cut));
}

/** Сколько декад до готовности при нынешних очках мира. */
export function buildEtaDecades(
  worldSeed: number,
  deltas: GalaxyDeltas,
  i: number,
  kind: BuildingKind,
  progress = 0,
  bonuses: RealmBonuses = NO_BONUSES,
): number {
  return Math.max(1, Math.ceil((buildingWork(kind) - progress) / buildPoints(worldSeed, deltas, i, bonuses)));
}

/** Идущая стройка мира или `undefined`. */
export function constructionOf(
  deltas: GalaxyDeltas,
  system: number | string,
): { readonly kind: BuildingKind; readonly progress: number } | undefined {
  const d = deltas[idOf(system)];
  return d?.building === undefined ? undefined : { kind: d.building, progress: d.buildProgress ?? 0 };
}

/** Может ли завод стоять на мире: военная промышленность не ниже порога. */
export function factoryAllowed(worldSeed: number, deltas: GalaxyDeltas, i: number): boolean {
  return worldProfile(worldSeed, deltas, i).industryMilitary >= B.factoryMilitary;
}

/** Почему постройку нельзя поставить (без денег — их проверяет команда), или `null`. */
export type BuildBlocker = 'notOwned' | 'alreadyBuilt' | 'buildBusy' | 'buildNeedsIndustry';

export function buildBlocker(
  worldSeed: number,
  deltas: GalaxyDeltas,
  i: number,
  kind: BuildingKind,
): BuildBlocker | null {
  if (!isPlayerActor(ownerOf(deltas, i))) return 'notOwned';
  if (builtOn(deltas, i).includes(kind)) return 'alreadyBuilt';
  if (constructionOf(deltas, i) !== undefined) return 'buildBusy';
  if (kind === 'factory' && !factoryAllowed(worldSeed, deltas, i)) return 'buildNeedsIndustry';
  return null;
}

/** Правка дельты: поставить стройку. */
export function startPatch(kind: BuildingKind): SystemDeltaPatch {
  return { building: kind, buildProgress: 0 };
}

export const CONSTRUCTION_CLEARED: SystemDeltaPatch = Object.freeze({ building: undefined, buildProgress: undefined });

function withBuilt(built: readonly BuildingKind[], kind: BuildingKind): readonly BuildingKind[] {
  return BUILDING_KINDS.filter((k) => k === kind || built.includes(k));
}

/**
 * Такт стройки — раз в декаду, в такте экономики державы. Каждый мир роты со стройкой получает свои очки;
 * набравшая трудоёмкость стройка становится постройкой.
 */
export function buildTick(
  worldSeed: number,
  deltas: GalaxyDeltas,
  bonuses: RealmBonuses = NO_BONUSES,
): { readonly deltas: GalaxyDeltas; readonly done: readonly { readonly systemId: string; readonly kind: BuildingKind }[] } {
  let next = deltas;
  const done: { systemId: string; kind: BuildingKind }[] = [];
  for (const i of domainWorldIndexes(deltas)) {
    const c = constructionOf(deltas, i);
    if (c === undefined) continue;
    const id = GALAXY.id(i);
    const progress = c.progress + buildPoints(worldSeed, deltas, i, bonuses);
    if (progress >= buildingWork(c.kind)) {
      next = withDelta(next, id, { ...CONSTRUCTION_CLEARED, buildings: withBuilt(builtOn(next, id), c.kind) });
      done.push({ systemId: id, kind: c.kind });
    } else {
      next = withDelta(next, id, { buildProgress: progress });
    }
  }
  return { deltas: next, done };
}

/** Содержание всех действующих построек державы за декаду. */
export function domainBuildingsUpkeep(deltas: GalaxyDeltas): number {
  let sum = 0;
  for (const i of domainWorldIndexes(deltas)) {
    for (const k of activeBuildings(deltas, i)) sum += buildingUpkeep(k);
  }
  return sum;
}

/** Сид сноса построек: от мира и дня, как сид боя участка, — ни одного броска ГПСЧ кампании он не сдвигает. */
function lossSeed(worldSeed: number, systemId: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x5bd1e995;
  const text = `${systemId}|${day}|buildings-lost`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Мир ушёл от роты (решение пользователя 2026-10-01): недострой пропадает, каждая готовая постройка уцелевает
 * с шансом `surviveLoss` и спит, пока мир чужой. Броски — по видам в порядке `BUILDING_KINDS`.
 */
export function buildingsLostPatch(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
): { readonly patch: SystemDeltaPatch; readonly lost: readonly BuildingKind[]; readonly kept: readonly BuildingKind[] } {
  const built = builtOn(deltas, systemId);
  const rng = new Rng(lossSeed(worldSeed, systemId, day));
  const kept: BuildingKind[] = [];
  const lost: BuildingKind[] = [];
  for (const k of built) (rng.next() < B.surviveLoss ? kept : lost).push(k);
  return {
    patch: { ...CONSTRUCTION_CLEARED, buildings: kept.length > 0 ? kept : undefined },
    lost,
    kept,
  };
}

// --- эффекты ---------------------------------------------------------------------------------

/** Орбитальная оборона: множитель обороны мира на фронте (перемножается с фокусом). */
export function buildingDefence(deltas: GalaxyDeltas, system: number): number {
  return hasBuilding(deltas, system, 'defence') ? B.orbitalDefence : 1;
}

/** Предел гарнизона мира: звено без казарм, рота с ними. */
export function garrisonCapOf(deltas: GalaxyDeltas, systemId: string): number {
  return hasBuilding(deltas, systemId, 'barracks') ? B.garrisonCapBarracks : B.garrisonCap;
}

/** Мест склада на мире (машины без пилота); без склада — ноль. */
export function depotCapOf(deltas: GalaxyDeltas, systemId: string): number {
  return hasBuilding(deltas, systemId, 'depot') ? B.depotSlots : 0;
}

/** Стапелей наземного цеха на мире; без цеха — ноль. */
export function workshopBaysAt(deltas: GalaxyDeltas, systemId: string): number {
  return hasBuilding(deltas, systemId, 'workshop') ? B.workshopBays : 0;
}

/** Прибавка казарм к лояльности мира за декаду. */
export function barracksLoyaltyOf(deltas: GalaxyDeltas, systemId: string): number {
  return hasBuilding(deltas, systemId, 'barracks') ? B.barracksLoyalty : 0;
}

/** Цена автонайма пилота гарнизону мира: по цене поиска, с казармами — её доля. */
export function garrisonHireFee(deltas: GalaxyDeltas, systemId: string, searchFee: number): number {
  return hasBuilding(deltas, systemId, 'barracks') ? Math.round(searchFee * B.barracksHireFee) : searchFee;
}

/** Лавка мира роты: космопорт поднимает класс на ступень, завод даёт признак завода и цену машин. */
export interface RealmMarket {
  readonly classUp: boolean;
  readonly factory: boolean;
  /** Ступеней развития сверх общего потолка (космопорт, `galaxy/profile.ts::spaceportBoostOf`): класс лавки их видит. */
  readonly developMax?: number;
}

export function realmMarketOf(deltas: GalaxyDeltas, systemId: string): RealmMarket | undefined {
  const active = activeBuildings(deltas, systemId);
  const classUp = active.includes('spaceport');
  const factory = active.includes('factory');
  const developMax = classUp ? B.spaceportDevelopMax : 0;
  return classUp || factory ? { classUp, factory, ...(developMax > 0 ? { developMax } : {}) } : undefined;
}

/** Действующих заводов у державы. */
export function factoryCount(deltas: GalaxyDeltas): number {
  let n = 0;
  for (const i of domainWorldIndexes(deltas)) if (hasBuilding(deltas, i, 'factory')) n++;
  return n;
}

/** Множитель цены полка державы от заводов: `1 − cut × заводов`, не ниже пола. */
export function armyPriceFactor(deltas: GalaxyDeltas): number {
  return Math.max(B.factoryArmyFloor, 1 - B.factoryArmyCut * factoryCount(deltas));
}

// --- потеря мира: что снесено и что спит ---------------------------------------------------------

/** Постройки и стройки миров роты на момент — чтобы после передачи миров сказать журналу, что пропало. */
export type RealmBuildSnapshot = ReadonlyMap<
  string,
  { readonly built: readonly BuildingKind[]; readonly building: BuildingKind | undefined }
>;

export function realmBuildSnapshot(deltas: GalaxyDeltas): RealmBuildSnapshot {
  const out = new Map<string, { built: readonly BuildingKind[]; building: BuildingKind | undefined }>();
  for (const i of domainWorldIndexes(deltas)) {
    const d = deltas[GALAXY.id(i)];
    if (d?.buildings === undefined && d?.building === undefined) continue;
    out.set(GALAXY.id(i), { built: d.buildings ?? [], building: d.building });
  }
  return out;
}

export interface BuildingsLost {
  readonly systemId: string;
  readonly lost: readonly BuildingKind[];
  readonly kept: readonly BuildingKind[];
  /** Недострой, пропавший с миром. */
  readonly construction?: BuildingKind;
}

/** Миры снимка, ушедшие от роты: снесённые и уцелевшие (спящие) постройки, пропавший недострой. */
export function buildingsLostSince(before: RealmBuildSnapshot, deltas: GalaxyDeltas): readonly BuildingsLost[] {
  const out: BuildingsLost[] = [];
  for (const [systemId, was] of before) {
    if (isPlayerActor(ownerOf(deltas, systemId))) continue;
    const kept = builtOn(deltas, systemId);
    out.push({
      systemId,
      lost: was.built.filter((k) => !kept.includes(k)),
      kept,
      ...(was.building === undefined ? {} : { construction: was.building }),
    });
  }
  return out;
}
