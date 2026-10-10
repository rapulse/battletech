import { Rng } from '../../rng/index.js';
import { dayOf } from '../clock.js';
import { factionKind, factionPairKey } from '../contracts/relations.js';
import { FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import type { GalaxyDeltas } from '../galaxy/delta.js';
import { relationOf, withRelation, type ReputationState } from '../reputation/state.js';
import { PLAYER_ACTOR_ID } from './actors.js';
import { signPact } from './diplomacy.js';
import { isPlayerRealm } from './domain.js';
import { withPlan, type WarState, type WorldEventRecord } from './economy.js';
import { EVENTS, type EventAction, type EventCondition, type EventSide, type WorldEventDef } from './eventSchema.js';
import { ownerArray } from './front.js';
import { WAR } from './schema.js';

/**
 * События мира (шаг 84) — канонические вехи эпохи как данные (`data/events.json`).
 *
 * **Событие — политика, отдающая те же команды** (проект державы §6): отношение пары, договор,
 * замысел наступления, перемирие Тукайида для пары, приглашение державы роты. Своих правил у
 * события нет, и после срабатывания мир живёт по общим: вражда, поднятая Войной Отказа, тает и
 * растёт той же матрицей, замысел «Бульдога» кончается по тем же срокам, что любой другой.
 *
 * **Условия, а не расписание.** День внутри окна выбирается броском из сида мира и id события (на
 * границе декады), дальше событие ждёт, пока выполнятся условия; окно кончилось — отменено молча
 * (решение пользователя 2026-10-01). «Бульдог» не бьёт по Ягуарам, которых уже съели Новые Коты.
 *
 * Бросок — не из потока `camp.war`: день события и цель замысла — свойство мира и события, а не
 * того, сколько бросков сделал фронт до них.
 */

const TICK = WAR.front.tickDays;

/** Сработавшее событие — для событий ядра и сводки. */
export interface FiredEvent {
  readonly id: string;
  readonly realm: boolean;
}

export interface EventTickResult {
  readonly war: WarState;
  readonly reputation: ReputationState;
  readonly fired: readonly FiredEvent[];
}

/** Первый и последний день окна события. */
export function eventWindow(def: WorldEventDef): { readonly from: number; readonly until: number } {
  const next = def.until.month === 12 ? { year: def.until.year + 1, month: 1 } : { year: def.until.year, month: def.until.month + 1 };
  return {
    from: dayOf({ year: def.from.year, month: def.from.month, day: 1 }),
    until: dayOf({ ...next, day: 1 }) - 1,
  };
}

/** Сид события: мир и id, как у торговли (`diplomacy.ts::tradeSeed`) и боя фронта. */
function eventSeed(worldSeed: number, id: string): number {
  let h = (worldSeed >>> 0) ^ 0x2545f491;
  const text = `event|${id}`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * С какого дня событие готово сработать: начало окна плюс бросок целого числа декад, не дальше
 * конца окна. Первый бросок потока события — всегда этот.
 */
export function eventDueDay(def: WorldEventDef, rng: Rng): number {
  const w = eventWindow(def);
  const decades = Math.floor((w.until - w.from) / TICK);
  return w.from + rng.int(0, decades) * TICK;
}

/** Мир в одном проходе: владельцы, число миров и общие границы. */
interface WorldView {
  readonly own: readonly string[];
  readonly worlds: ReadonlyMap<string, number>;
  readonly realm: boolean;
}

function viewOf(deltas: GalaxyDeltas): WorldView {
  const own = ownerArray(deltas);
  const worlds = new Map<string, number>();
  for (const o of own) worlds.set(o, (worlds.get(o) ?? 0) + 1);
  return { own, worlds, realm: isPlayerRealm(deltas) };
}

/** Миры `against`, соседние с мирами `by`, — и сколько миров `by` касается каждого. */
function frontier(view: WorldView, by: string, against: string): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < GALAXY.count; i++) {
    if (view.own[i] !== against) continue;
    let n = 0;
    for (const j of GALAXY.neighbors(i)) if (view.own[j] === by) n++;
    if (n > 0) out.set(i, n);
  }
  return out;
}

function bordered(view: WorldView, a: string, b: string): boolean {
  for (let i = 0; i < GALAXY.count; i++) {
    if (view.own[i] !== a) continue;
    for (const j of GALAXY.neighbors(i)) if (view.own[j] === b) return true;
  }
  return false;
}

/** Стороны действия, живые сегодня: держат хоть один мир. Порядок — по id. */
function sideIds(view: WorldView, side: EventSide): string[] {
  const out = new Set<string>();
  for (const s of side) {
    if (s === '@realm') {
      if (view.realm) out.add(PLAYER_ACTOR_ID);
    } else if (s === '@house' || s === '@clan') {
      const kind = s === '@house' ? 'house' : 'clan';
      for (const f of FACTION_LIST) if (f.kind === kind) out.add(f.id);
    } else {
      out.add(s);
    }
  }
  return [...out].filter((id) => (view.worlds.get(id) ?? 0) > 0).sort();
}

/** Пары `a × b` разных сторон, без повторов, по возрастанию ключа. */
function pairsOf(view: WorldView, a: EventSide, b: EventSide, border: boolean): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const x of sideIds(view, a)) {
    for (const y of sideIds(view, b)) {
      if (x === y) continue;
      const key = factionPairKey(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      if (border && !bordered(view, x, y)) continue;
      out.push([x, y]);
    }
  }
  return out.sort((p, q) => (factionPairKey(...p) < factionPairKey(...q) ? -1 : 1));
}

function holds(view: WorldView, c: EventCondition): boolean {
  if (c.kind === 'worlds') return (view.worlds.get(c.faction) ?? 0) >= c.min;
  return bordered(view, c.a, c.b);
}

interface Applied {
  war: WarState;
  rep: ReputationState;
  realm: boolean;
  invite?: WorldEventRecord['invite'];
}

function apply(acc: Applied, view: WorldView, action: EventAction, day: number, rng: Rng): void {
  const touch = (x: string, y: string): void => {
    if (x === PLAYER_ACTOR_ID || y === PLAYER_ACTOR_ID) acc.realm = true;
  };
  switch (action.kind) {
    case 'relation':
      for (const [x, y] of pairsOf(view, action.a, action.b, action.border)) {
        const now = relationOf(acc.rep, x, y);
        const next = action.atMost !== undefined ? Math.min(now, action.atMost) : Math.max(now, action.atLeast as number);
        acc.rep = withRelation(acc.rep, x, y, next);
        touch(x, y);
      }
      return;
    case 'truce':
      for (const [x, y] of pairsOf(view, action.a, action.b, action.border)) {
        const signed = signPact(acc.war, acc.rep, x, y, 'truce', day);
        acc.war = signed.war;
        acc.rep = signed.reputation;
        touch(x, y);
      }
      return;
    case 'liftTukayyid': {
      const lifted = new Set(acc.war.truceLifted);
      for (const [x, y] of pairsOf(view, action.a, action.b, action.border)) {
        const clan = (factionKind(x) === 'clan') !== (factionKind(y) === 'clan');
        if (!clan) continue;
        lifted.add(factionPairKey(x, y));
        touch(x, y);
      }
      acc.war = { ...acc.war, truceLifted: [...lifted].sort() };
      return;
    }
    case 'plan':
      for (const by of sideIds(view, action.by)) {
        for (const against of sideIds(view, action.against)) {
          if (by === against) continue;
          const near = frontier(view, by, against);
          if (near.size === 0) continue;
          // Цель — мир у общей границы, взвешенно по числу соседних миров наступающего: там, где
          // граница гуще, и удар естественнее. Порядок перебора — индекс каталога.
          let total = 0;
          for (const n of near.values()) total += n;
          let roll = rng.next() * total;
          let target = -1;
          for (const [i, n] of near) {
            target = i;
            roll -= n;
            if (roll <= 0) break;
          }
          acc.war = withPlan(acc.war, by, {
            against,
            target: GALAXY.id(target),
            fromDay: day,
            untilDay: day + action.decades * TICK,
            taken: 0,
          });
          touch(by, against);
          // Один замысел на фракцию: первая цель по id и есть главный удар.
          break;
        }
      }
      return;
    case 'invite': {
      if (!view.realm || !bordered(view, PLAYER_ACTOR_ID, action.against)) return;
      const allies = sideIds(view, action.allies).filter(
        (id) => id !== PLAYER_ACTOR_ID && id !== action.against && bordered(view, id, action.against),
      );
      if (allies.length === 0) return;
      acc.invite = { against: action.against, allies };
      acc.realm = true;
      return;
    }
  }
}

/**
 * Такт событий (шаг 84): своя задача очереди суток сразу после такта фронта, раз в декаду.
 * Каждое ещё не сработавшее событие проверяет окно, свой день и условия; сработавшее отдаёт
 * команды и встаёт в снимок с отметкой «карточка не прочитана».
 */
export function eventTick(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
): EventTickResult {
  let view: WorldView | null = null;
  let nextWar = war;
  let nextRep = rep;
  const fired: FiredEvent[] = [];
  for (const def of EVENTS.events) {
    if (nextWar.events[def.id] !== undefined) continue;
    const rng = new Rng(eventSeed(worldSeed, def.id));
    const due = eventDueDay(def, rng);
    if (day < due || day > eventWindow(def).until) continue;
    view ??= viewOf(deltas);
    if (!def.when.every((c) => holds(view as WorldView, c))) continue;

    const acc: Applied = { war: nextWar, rep: nextRep, realm: false };
    for (const action of def.do) apply(acc, view, action, day, rng);
    const record: WorldEventRecord = {
      day,
      pending: true,
      realm: acc.realm,
      ...(acc.invite === undefined ? {} : { invite: acc.invite }),
    };
    nextWar = { ...acc.war, events: { ...acc.war.events, [def.id]: record } };
    nextRep = acc.rep;
    fired.push({ id: def.id, realm: acc.realm });
    // Карта изменилась отношениями и договорами, но не владельцами — вид остаётся верным.
  }
  return { war: nextWar, reputation: nextRep, fired };
}

/** Непрочитанные карточки — по дню, потом по id. */
export function pendingEvents(war: WarState): readonly string[] {
  return Object.keys(war.events)
    .filter((id) => war.events[id]?.pending === true)
    .sort((a, b) => (war.events[a]?.day as number) - (war.events[b]?.day as number) || (a < b ? -1 : 1));
}

/** Описание события по id — для команды ответа и для экрана. */
export function eventDef(id: string): WorldEventDef | undefined {
  return EVENTS.events.find((e) => e.id === id);
}

/** Числа приглашения из данных: что даёт согласие и что стоит отказ. */
export function inviteTerms(id: string): { readonly accept: number; readonly decline: number } | undefined {
  const a = eventDef(id)?.do.find((x) => x.kind === 'invite');
  return a === undefined || a.kind !== 'invite' ? undefined : { accept: a.acceptStanding, decline: a.declineStanding };
}
