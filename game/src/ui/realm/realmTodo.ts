import type { RealmNeighbour, RealmWar, RealmWorld, SectorView } from '../state/campaign.svelte.js';
import { ALERT_SEVERE, worldAlerts, type WorldAlert } from './worldAlerts.js';

/**
 * «Требует решения» в Штабе державы (шаг 93): что игрок должен увидеть, не обходя миры по одному.
 * Строки — данными (вид плюс параметры), словами их называет панель. Тревоги мира — те же, что у
 * списка и карты (`worldAlerts`).
 */
export type TodoItem =
  | { readonly kind: 'world'; readonly alert: WorldAlert; readonly worldId: string; readonly name: string }
  | { readonly kind: 'vacant'; readonly center: string }
  | { readonly kind: 'slots'; readonly free: number }
  | { readonly kind: 'peace'; readonly factionId: string; readonly until: number }
  | { readonly kind: 'pact'; readonly factionId: string; readonly until: number }
  | { readonly kind: 'idle'; readonly count: number };

/** Договор «истекает скоро» — в ближайшие три декады: за это время его ещё можно продлить заранее. */
export const PACT_SOON_DAYS = 30;

export interface TodoInput {
  readonly day: number;
  readonly worlds: readonly RealmWorld[];
  readonly sectors: readonly SectorView[];
  readonly sectorLimit: number;
  readonly wars: readonly RealmWar[];
  readonly neighbours: readonly RealmNeighbour[];
  /** Миров, где ничего не строится, хотя построено не всё. */
  readonly idleWorlds: number;
}

export function realmTodo(input: TodoInput): TodoItem[] {
  const severe: TodoItem[] = [];
  const mild: TodoItem[] = [];
  for (const w of input.worlds) {
    for (const alert of worldAlerts(w)) {
      (ALERT_SEVERE[alert] ? severe : mild).push({ kind: 'world', alert, worldId: w.id, name: w.name });
    }
  }
  const out: TodoItem[] = [...severe];
  for (const war of input.wars) {
    if (war.offerUntil !== null) out.push({ kind: 'peace', factionId: war.factionId, until: war.offerUntil });
  }
  for (const s of input.sectors) if (s.governor === null) out.push({ kind: 'vacant', center: s.center });
  for (const n of input.neighbours) {
    if (n.pact !== null && n.pact.untilDay - input.day <= PACT_SOON_DAYS) {
      out.push({ kind: 'pact', factionId: n.factionId, until: n.pact.untilDay });
    }
  }
  const free = input.sectorLimit - input.sectors.length;
  if (free > 0) out.push({ kind: 'slots', free });
  out.push(...mild);
  if (input.idleWorlds > 0) out.push({ kind: 'idle', count: input.idleWorlds });
  return out;
}
