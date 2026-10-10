import type { BattleParticipant } from '../bridge/toBattle.js';
import { GALAXY } from '../galaxy/catalog.js';
import { shipboardMechs } from '../company/garrison.js';
import { isWreck, type MechRecord } from '../mech/MechRecord.js';
import type { CampaignState } from '../state.js';

/**
 * Звено роты в приказе армии державы (шаг 86, проект державы §5.2).
 *
 * Рота, стоящая в системе в прыжке от цели (или в самой системе цели), идёт в любой приказ на этот
 * мир сама — решение пользователя 2026-10-01: флага в команде нет, чтобы не идти — улететь. Идут ВСЕ
 * исправные машины: цела в торсе и голове, есть пилот в строю, машина не стоит в работе стапеля
 * (тот же критерий, что у звена на экране контракта, `campaign.deployable`).
 *
 * Не идёт никто, если рота в перелёте или связана контрактом: взятая работа — обязательство перед
 * нанимателем, а машины вылета уже на поле.
 *
 * Список — в порядке ангара: он же порядок брифа столкновения и, значит, часть воспроизводимости.
 */
export function orderLance(state: CampaignState, target: number): readonly BattleParticipant[] {
  if (state.travel !== null || state.contract !== null) return [];
  const here = GALAXY.index(state.systemId);
  if (here < 0) return [];
  if (here !== target && !GALAXY.neighbors(target).includes(here)) return [];
  // Гарнизон в приказ не идёт (шаг 86b, решение пользователя 2026-10-01 п. 4): он стоит на своём мире.
  return fitLance(state, shipboardMechs(state.company, state.garrison));
}

/**
 * Годные к бою машины из списка, с пилотами: цела в торсе и голове, пилот в строю, машина не в работе
 * стапеля. Общий критерий звена в приказе (шаг 86) и гарнизона в бою (шаг 86b); порядок — порядок списка.
 */
export function fitLance(state: CampaignState, records: readonly MechRecord[]): readonly BattleParticipant[] {
  const busy = new Set<string>();
  for (const e of state.queue) if (e.task.kind === 'repairJob') busy.add(e.task.recordId);
  const pilots = new Map(state.company.pilots.filter((p) => p.status === 'active').map((p) => [p.id, p]));
  const lance: BattleParticipant[] = [];
  for (const record of records) {
    if (record.pilotId === null || isWreck(record) || busy.has(record.id)) continue;
    const pilot = pilots.get(record.pilotId);
    if (pilot !== undefined) lance.push({ record, pilot });
  }
  return lance;
}
