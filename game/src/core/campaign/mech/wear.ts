import { REPAIR } from '../../data/index.js';
import { shiftQuality, type QualityClass } from '../../model/QualityClass.js';
import type { Rng } from '../../rng/index.js';
import { recordQuality, withQuality, WEAR_NODES, type MechRecord, type WearNode } from './MechRecord.js';

/**
 * Износ — вторая лестница экономики, вниз (шаг 11).
 *
 * Без неё лестница «трофей → ремонт → класс выше» однонаправленная: отряд
 * подбирает машины, чинит их и неизбежно богатеет, а деньги перестают быть
 * решением уже к десятому контракту. Износ возвращает бою цену, которую нельзя
 * оплатить один раз и забыть.
 *
 * Деградация идёт СТУПЕНЯМИ, а не сползанием: узел копит износ, на пороге
 * теряет ступень класса, счётчик падает до `resetTo`. Так игрок видит событие
 * («реактор просел до восстановленного»), а не медленно уезжающие числа,
 * которые невозможно связать с решениями.
 */

/**
 * Что бой сделал с машиной. Заполняется послебоевым разбором шага 12 — здесь
 * только форма, чтобы шаги не тянули друг друга.
 */
export interface WearInput {
  /** Сколько очков структуры машина потеряла за бой. */
  readonly structureLost: number;
  /** Сколько ходов провела за порогом перегрева. */
  readonly overheatTurns: number;
  /** Критов реактора за бой. */
  readonly reactorHits: number;
  /** Зон, разрушенных за бой. */
  readonly destroyedZones: number;
}

export const NO_WEAR: WearInput = {
  structureLost: 0,
  overheatTurns: 0,
  reactorHits: 0,
  destroyedZones: 0,
};

export interface Degradation {
  readonly node: WearNode;
  readonly from: QualityClass;
  readonly to: QualityClass;
}

export interface WearResult {
  readonly record: MechRecord;
  /** Насколько вырос износ каждого узла за этот бой. */
  readonly added: Readonly<Record<WearNode, number>>;
  readonly degraded: readonly Degradation[];
}

/**
 * Сколько износа набрал узел.
 *
 * Разные узлы изнашиваются от разного, и это не украшение: реактор страдает от
 * жары и собственных критов, каркас — от пробитой структуры и оторванных зон.
 * Одинаковая формула на оба узла сделала бы класс каркаса и класс реактора
 * неразличимыми в кампании.
 */
function rawWear(node: WearNode, input: WearInput): number {
  const w = REPAIR.wear;
  if (node === 'reactor') {
    return (
      w.perBattle + w.perOverheatTurn * input.overheatTurns + w.perReactorHit * input.reactorHits
    );
  }
  return (
    w.perBattle +
    w.perStructurePoint * input.structureLost +
    w.perDestroyedZone * input.destroyedZones
  );
}

/**
 * Начислить износ за бой и, если узел перешагнул порог, понизить его класс.
 *
 * Бросок обязателен и идёт через поток `camp.wear`: одинаковые бои не должны
 * давать побитово одинаковый износ, иначе деградация превращается в счётчик
 * боёв. Разброс задан данными (`jitter`), а не зашит.
 */
export function applyWear(record: MechRecord, input: WearInput, rng: Rng): WearResult {
  const w = REPAIR.wear;
  const added = {} as Record<WearNode, number>;
  const degraded: Degradation[] = [];
  let next = record;

  for (const node of WEAR_NODES) {
    const jitter = 1 + (rng.next() * 2 - 1) * w.jitter;
    const gain = rawWear(node, input) * jitter;
    added[node] = gain;

    let value = next.wear[node] + gain;
    const from = recordQuality(next)[node];

    if (value >= w.threshold) {
      const to = shiftQuality(from, -1);
      if (to === from) {
        // Ниже восстановленного ступеней нет. Износ упирается в порог и там
        // стоит: машина осталась рабочей, просто хуже уже не станет.
        value = w.threshold;
      } else {
        next = withQuality(next, node, to);
        value = w.resetTo;
        degraded.push({ node, from, to });
      }
    }

    next = { ...next, wear: { ...next.wear, [node]: value } };
  }

  return { record: { ...next, battles: next.battles + 1 }, added, degraded };
}
