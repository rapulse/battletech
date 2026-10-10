import {
  execute,
  ok,
  type CampaignCommandResult,
  type CampaignEvent,
} from '../../core/campaign/commands/index.js';
import type { CampaignState } from '../../core/campaign/state.js';
import { WAR, bordersOf, demandForceRatio, pendingEvents } from '../../core/campaign/war/index.js';

/**
 * Прокрутка для ботов и замеров (шаг 84): карточка события мира останавливает время, пока на неё
 * не ответят (`answerEvent`). Игрок отвечает с экрана, бот — здесь: карточку закрывает, на
 * приглашение в коалицию отвечает `accept` (по умолчанию — отказ: замер мира не должен втягивать
 * державу в войну, которую бот не выбирал).
 *
 * Требование соседа (шаг 89) — такая же карточка. Бот отвечает очевидным для игрока правилом: платить, если
 * сосед на общей границе сильнее не меньше чем в `DEMAND_ACCEPT_RATIO` × порог требования (`demands.forceRatio`)
 * раз; иначе отказ — с соседом, который сильнее, но не подавляюще, держава готова поспорить.
 *
 * События прокруток склеиваются в одну ленту — для замера это одна прокрутка до `day`.
 */
export function advanceAnswering(state: CampaignState, day: number, accept = false): CampaignCommandResult {
  const events: CampaignEvent[] = [];
  for (;;) {
    for (const id of pendingEvents(state.war)) {
      const answered = execute(state, { kind: 'answerEvent', id, accept });
      if (!answered.ok) return answered;
      events.push(...answered.events);
    }
    const demand = state.war.demands?.pending;
    if (demand !== undefined) {
      const answered = execute(state, { kind: 'answerDemand', accept: acceptsDemand(state, demand.from) });
      if (!answered.ok) return answered;
      events.push(...answered.events);
    }
    if (state.day >= day) return ok(events);
    const advanced = execute(state, { kind: 'advanceTo', day });
    if (!advanced.ok) return advanced;
    events.push(...advanced.events);
  }
}

/** Во сколько раз сверх порога требования сосед должен быть сильнее, чтобы бот заплатил (шаг 89). */
export const DEMAND_ACCEPT_RATIO = 1.5;

/** Правило бота: заплатить соседу, который сильнее на общей границе не меньше `DEMAND_ACCEPT_RATIO` × порог. */
export function acceptsDemand(state: CampaignState, from: string): boolean {
  return demandForceRatio(state.war, bordersOf(state.deltas), from) >= WAR.demands.forceRatio * DEMAND_ACCEPT_RATIO;
}
