import type { RepairWork } from './clock.js';
import { CampaignRejectReason } from './commands/types.js';
import type { CampaignState } from './state.js';
import { WAR, workshopBaysAt } from './war/index.js';

/**
 * ГДЕ ВСТАНЕТ РАБОТА ПО МАШИНЕ — стапель корабля или наземного цеха мира (шаг 87), — и хватает ли там места.
 *
 * Стапель занимает МАШИНА, а не работа: «пропускная способность цеха — сколько
 * машин на стапелях одновременно» (`часть2-pipeline.md`, шаг 13, п. 1). Машина,
 * уже стоящая на стапеле, нового места не требует — иначе четыре стапеля
 * означали бы четыре работы на всю роту, то есть один ремонт зоны на машину за
 * простой, и парк разваливался бы быстрее, чем чинится. Она и остаётся там, где стоит.
 *
 * Машина на мире (гарнизон, склад) чинится только цехом этого мира (решение пользователя 2026-10-01); машина
 * корабля, стоящего в системе мира с цехом, встаёт в цех, пока там есть место, иначе — на стапель корабля.
 * Работа в цехе по ремонту (`WORKSHOP_WORKS`) дешевле и быстрее; начатая доходит до конца и после отлёта.
 */
export interface BaySite {
  readonly workshop: string | undefined;
}

export function baySite(state: CampaignState, recordId: string): BaySite | CampaignRejectReason {
  const ship = new Set<string>();
  const shops = new Map<string, Set<string>>();
  for (const e of state.queue) {
    if (e.task.kind !== 'repairJob') continue;
    if (e.task.recordId === recordId) return { workshop: e.task.workshop };
    if (e.task.workshop === undefined) ship.add(e.task.recordId);
    else {
      let set = shops.get(e.task.workshop);
      if (set === undefined) shops.set(e.task.workshop, (set = new Set<string>()));
      set.add(e.task.recordId);
    }
  }
  const shopRoom = (systemId: string): boolean =>
    (shops.get(systemId)?.size ?? 0) < workshopBaysAt(state.deltas, systemId);

  const post = state.garrison.posts[recordId];
  if (post !== undefined) {
    if (post.arrives > state.day) return CampaignRejectReason.MechStationed;
    if (workshopBaysAt(state.deltas, post.systemId) === 0) return CampaignRejectReason.NoWorkshop;
    return shopRoom(post.systemId) ? { workshop: post.systemId } : CampaignRejectReason.NoBay;
  }
  if (state.travel === null && shopRoom(state.systemId)) return { workshop: state.systemId };
  return ship.size < state.company.bays ? { workshop: undefined } : CampaignRejectReason.NoBay;
}

/** Работы ремонта, которые цех делает дешевле и быстрее (шаг 87): починка, а не покупка и не переделка. */
export const WORKSHOP_WORKS: ReadonlySet<RepairWork> = new Set<RepairWork>(['repairZone', 'restoreWorn', 'replacePart']);

/** Цена и срок работы на этом месте. */
export function atSite(site: BaySite, work: RepairWork, cost: number, days: number): { cost: number; days: number } {
  if (site.workshop === undefined || !WORKSHOP_WORKS.has(work)) return { cost, days };
  return { cost: Math.round(cost * WAR.buildings.workshopCost), days: days * WAR.buildings.workshopDays };
}
