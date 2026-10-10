import { FACTION_LIST } from '../galaxy/catalog.js';
import { MISSION_TYPES, type MissionType } from '../contracts/schema.js';
import { REPUTATION, type ReputationOutcome } from './schema.js';
import {
  relationOf,
  roundAxis,
  standingOf,
  withFame,
  withReliability,
  withStanding,
  type ReputationState,
} from './state.js';

/**
 * Начисление репутации (шаг 20, часть B).
 *
 * **Считается здесь, применяется одним местом** — `commands/execute.ts` при
 * закрытии контракта. Как только репутация начнёт меняться в двух местах, она
 * разойдётся с журналом, и игрок увидит числа, которых не объяснит ни одно
 * событие (ловушка 2 плана шага 20).
 *
 * Этот модуль состояния не мутирует и в `CampaignState` не заглядывает: на
 * входе исход и репутация, на выходе — СПИСОК изменений. Ровно поэтому карточка
 * контракта может показать последствия ДО подписи (часть D): она зовёт ту же
 * функцию с придуманным исходом и ничего не сдвигает.
 */

/** Одно изменение отношения: кому, насколько и почему. Из него же собирается событие журнала. */
export interface StandingChange {
  readonly factionId: string;
  readonly delta: number;
  /**
   * Почему изменилось. `direct` — отряд воевал ЗА или ПРОТИВ этой фракции;
   * `network` — прибавка разошлась по политической сети от чужой стороны.
   */
  readonly reason: ReputationReason;
}

export type ReputationReason = 'employer' | 'target' | 'network';

/** Всё, что даёт один закрытый контракт: отношения, известность, надёжность. */
export interface ReputationDeltas {
  readonly outcome: ReputationOutcome;
  readonly standing: readonly StandingChange[];
  readonly fame: number;
  readonly reliability: number;
}

/**
 * Уровень контракта, 0..1: место типа миссии в порядке `MISSION_TYPES`.
 *
 * Порядок списка — от гарнизона к штурму — и есть шкала тяжести: он же задаёт
 * растущие пороги вражды, силу противника и оплату в `data/contracts.json`.
 * Второй таблицы «вес типа миссии» здесь не заводится: она была бы копией
 * первой и однажды разошлась бы с ней.
 */
export function missionLevel(mission: MissionType): number {
  const i = MISSION_TYPES.indexOf(mission);
  return MISSION_TYPES.length <= 1 ? 0 : i / (MISSION_TYPES.length - 1);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/**
 * Сколько отношения даёт выполненный искупительный контракт (2026-09-14).
 *
 * Плата за такую работу — не деньги, а отношение нанимателя, и растёт она со
 * сложностью: обычная прибавка уровня миссии, умноженная на
 * `atonement.standingFactor`. Экран контрактов показывает это число вместо
 * гонорара; начисление идёт через `contractReputation` с тем же множителем.
 */
export function atonementGain(mission: MissionType): number {
  const row = REPUTATION.contract.won;
  return roundAxis(lerp(row.employerMin, row.employerMax, missionLevel(mission)) * REPUTATION.atonement.standingFactor);
}

/**
 * Изменения от одного контракта, включая расход по политической сети.
 *
 * `Δотношение(C) = Δотношение(B) × отношение(C, B) × k` — одна формула поверх
 * матрицы, без частных случаев. Ударили по Куритам — Дэвионы потеплели, союзники
 * Куритов похолодели, и вся политическая паутина работает сама.
 *
 * Сеть считается от ОБЕИХ прямых сторон и складывается: контракт Куриты против
 * Дэвиона — это одновременно услуга одному и удар по другому, и Штайнер (союзник
 * Дэвиона, враг Куриты) обязан получить обе прибавки, а не первую попавшуюся.
 */
export function contractReputation(
  rep: ReputationState,
  outcome: ReputationOutcome,
  mission: MissionType,
  employer: string,
  target: string,
  /** Искупительный контракт: прибавка нанимателю умножается на `atonement.standingFactor`. */
  atonement = false,
): ReputationDeltas {
  const row = REPUTATION.contract[outcome];
  const level = missionLevel(mission);
  const employerDelta = lerp(row.employerMin, row.employerMax, level);

  const direct = new Map<string, { delta: number; reason: ReputationReason }>();
  const add = (factionId: string, delta: number, reason: ReputationReason): void => {
    if (delta === 0) return;
    const prev = direct.get(factionId);
    direct.set(factionId, { delta: (prev?.delta ?? 0) + delta, reason: prev?.reason ?? reason });
  };

  // Множитель искупления — только на ПРИБАВКУ: провал и разрыв искупительной
  // работы стоят столько же, сколько обычной, иначе разрыв стал бы наказанием вдвойне.
  add(
    employer,
    atonement && employerDelta > 0 ? employerDelta * REPUTATION.atonement.standingFactor : employerDelta,
    'employer',
  );
  add(target, lerp(row.targetMin, row.targetMax, level), 'target');

  // Сеть считается от прямых прибавок и НЕ расходится дальше: второй круг
  // означал бы, что удар по Куритам через двух посредников возвращается в самих
  // Куритов. Одна волна — это и есть «враг моего врага», а не цепная реакция.
  const spread = new Map<string, number>();
  for (const [factionId, hit] of direct) {
    for (const f of FACTION_LIST) {
      if (f.id === factionId || direct.has(f.id)) continue;
      const via = hit.delta * relationOf(rep, f.id, factionId) * REPUTATION.network.k;
      spread.set(f.id, (spread.get(f.id) ?? 0) + via);
    }
  }

  const standing: StandingChange[] = [];
  for (const [factionId, hit] of direct) {
    const delta = roundAxis(hit.delta);
    if (delta !== 0) standing.push({ factionId, delta, reason: hit.reason });
  }
  // Порядок обхода фракций берётся из реестра, а не из объекта: он входит в
  // события, а через них — в журнал игрока (game_core.md §4.7).
  for (const f of FACTION_LIST) {
    const via = spread.get(f.id);
    if (via === undefined) continue;
    const delta = roundAxis(via);
    if (Math.abs(delta) < REPUTATION.network.minSpread) continue;
    standing.push({ factionId: f.id, delta, reason: 'network' });
  }

  return {
    outcome,
    standing,
    fame: roundAxis(row.fame * (1 + level)),
    reliability: row.reliability,
  };
}

/**
 * Что делает с репутацией ДИПЛОМАТИЧЕСКИЙ шаг роты (шаг 26, часть C).
 *
 * Та же сеть, что у контракта, и это не экономия строк, а требование: «договор
 * с Куритой роняет отношение с Дэвионом» обязано считаться той же формулой
 * `Δотношение(C) = Δотношение(B) × отношение(C, B) × k`, что и «удар по Куритам
 * радует Дэвионов». Заведи здесь вторую формулу — и через год две политические
 * сети разошлись бы, а игрок увидел бы, что за одинаковые по смыслу поступки
 * мир отвечает по-разному.
 *
 * Прямая сторона одна, в отличие от контракта: у соглашения нет «цели», есть
 * партнёр. Волна расходится от него одного.
 */
export function diplomacyReputation(
  rep: ReputationState,
  partner: string,
  delta: number,
): readonly StandingChange[] {
  if (delta === 0) return [];
  const out: StandingChange[] = [{ factionId: partner, delta: roundAxis(delta), reason: 'employer' }];
  for (const f of FACTION_LIST) {
    if (f.id === partner) continue;
    const via = roundAxis(delta * relationOf(rep, f.id, partner) * REPUTATION.network.k);
    if (Math.abs(via) < REPUTATION.network.minSpread) continue;
    out.push({ factionId: f.id, delta: via, reason: 'network' });
  }
  return out;
}

/**
 * Наложить посчитанное на состояние.
 *
 * Отдельной функцией от расчёта намеренно: предпросмотр карточки контракта
 * зовёт `contractReputation` и на этом останавливается, а команда — обе. Так
 * «показать последствия до подписи» физически не может ничего изменить.
 */
export function applyReputation(rep: ReputationState, deltas: ReputationDeltas): ReputationState {
  let next = rep;
  for (const change of deltas.standing) next = withStanding(next, change.factionId, change.delta);
  if (deltas.fame !== 0) next = withFame(next, deltas.fame);
  if (deltas.reliability !== 0) next = withReliability(next, deltas.reliability);
  return next;
}

/**
 * Насколько отношение изменится ФАКТИЧЕСКИ, с учётом упора в край шкалы.
 *
 * Нужно карточке контракта: обещать «−15 Дэвиону», когда у Дэвиона уже −100, —
 * это врать игроку о последствиях выбора, ради честности которого весь шаг и
 * затеян.
 */
export function effectiveStanding(rep: ReputationState, change: StandingChange): number {
  const before = standingOf(rep, change.factionId);
  const after = withStanding(rep, change.factionId, change.delta);
  return roundAxis(standingOf(after, change.factionId) - before);
}
