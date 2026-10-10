import type { BattleState } from '../../model/BattleState.js';
import { DESTROY_ALL, type BattleObjective } from '../../model/Objective.js';
import { judgeObjective, progressOf } from '../../rules/objective.js';
import type { MechUnit, Side, UnitId } from '../../model/MechUnit.js';
import type { MechCondition, MechRecord } from '../mech/MechRecord.js';

/**
 * Мост «бой → кампания» (шаг 12, решение 2 из §2).
 *
 * `BattleOutcome` — чистые данные: финальное состояние каждой машины обеих сторон и то, что
 * бой рассказал о её действиях (`UnitCombatTally`). Разбор (`core/campaign/debrief/`) читает
 * их и решает, что достаётся отряду; сам мост ничего не решает и ничего не мутирует.
 */

/**
 * Что бой рассказал об одном юните сверх его финального состояния.
 *
 * Считает не `core/`, а вызывающий (`sim/autoBattle.ts`) — эти числа собираются из потока
 * `BattleEvent`, у которого уже есть `unitId` на нужных событиях (`shot`, `pilotingCheck`,
 * `unitDestroyed`), и это бухгалтерия слоя над ядром, а не новое боевое правило. Запись,
 * которой источник не заполнил сводку, читается как нулевая — так `buildOutcome` не падает,
 * если вызван без неё.
 */
export interface UnitCombatTally {
  /** Успешных попаданий этим юнитом. Xp-событие `hit`. */
  readonly hits: number;
  /** Пройденных бросков пилотирования. Xp-событие `pilotingPassed`. */
  readonly pilotingPassed: number;
  /** Вражеских машин, добитых последним попаданием этого юнита. Xp-событие `kill`. */
  readonly kills: number;
  /**
   * КОГО добил этот юнит — id боевых юнитов (`battleUnitId`), по одному на
   * добивание (шаг 69). Нужно одному достижению, «Давиду против Голиафа»:
   * `kills` говорит сколько, но не кого.
   *
   * Необязательное: быстрый расчёт (`fastResolve.ts`) его не ведёт, а боевые
   * достижения с него и не открываются.
   */
  readonly victims?: readonly string[];
  /** Ходов, чью инициативу выиграла сторона этого юнита. Xp-событие `initiativeWon`. */
  readonly initiativeWins: number;
  /**
   * Действий, исполненных без срыва под давлением. Xp-событие `heldUnderPressure`.
   *
   * «Под давлением» — это вероятность срыва не ниже порога
   * (`pilots.json → progression.pressureFrom`), а не любое действие: Хладнокровие
   * растёт там, где оно работало, иначе это был бы второй счётчик выстрелов.
   */
  readonly composureHeld: number;
  /** Ходов, проведённых при тепле на пороге аварийного отключения и выше. Вход в износ реактора. */
  readonly overheatTurns: number;
}

export const EMPTY_TALLY: UnitCombatTally = {
  hits: 0,
  pilotingPassed: 0,
  kills: 0,
  initiativeWins: 0,
  composureHeld: 0,
  overheatTurns: 0,
};

export interface UnitOutcome extends UnitCombatTally {
  /** Id записи без префикса стороны — см. `battleUnitId`/`recordIdOf` в `toBattle.ts`. */
  readonly recordId: string;
  readonly side: Side;
  /** Финальное состояние юнита: зоны, ячейки, боезапас, пилот. */
  readonly unit: MechUnit;
}

export interface BattleOutcome {
  readonly winner: Side | 'draw';
  /**
   * Держит ли рота поле после боя — решение 3 из §7 `часть2-pipeline.md`: удержанное поле
   * оставляет остовы выбывших своих машин отряду, потерянное — нет. Конвенция проекта: рота
   * всегда воюет стороной `player` (`sim/scenario.ts`), поэтому `heldField = winner === 'player'`.
   */
  readonly heldField: boolean;
  /**
   * Был ли вообще ОГНЕВОЙ КОНТАКТ — сделал ли хоть кто-нибудь хоть один
   * выстрел (шаг 35).
   *
   * Нужно ровно для одного правила: аванс возвращается, если рота отвела звено,
   * НЕ ВСТУПИВ в бой. До этого шага отход не платил и не штрафовал вовсе, и это
   * был чистый эксплойт — подписать контракт, забрать 25-35 % аванса,
   * высадиться и отвести звено на первом ходу (questions.md п. 1).
   *
   * Необязательное: старые сохранения и брифинги, собранные до шага, читаются
   * как «контакт был», то есть по прежнему правилу.
   */
  readonly engaged?: boolean;
  /**
   * Сколько машин противника УШЛО с поля своим ходом (шаг 43).
   *
   * Нужно разбору и только ему: игрок обязан узнать словами, почему список
   * трофеев короче списка противника. Само правило трофеев этого числа не
   * читает — ушедшая машина не выведена из строя, и `collectTrophies` её не
   * увидит по своему обычному условию.
   *
   * Необязательное: брифинги и сохранения, собранные до шага, читаются как ноль
   * — то есть по прежнему правилу.
   */
  readonly enemyWithdrew?: number;
  readonly units: readonly UnitOutcome[];
}

/**
 * Обратное к `battleUnitId` из `toBattle.ts`: `"player:M-1"` → `"M-1"`.
 *
 * Сторона читается прямо с юнита (`unit.side`), а не разбором строки — так `buildOutcome`
 * остаётся годным и для боёв, собранных не мостом (`sim/scenario.ts::makeBattle`, где id вроде
 * `"Копьё-1"` без префикса вовсе): префикс просто не находится, и id идёт как есть.
 */
function recordIdOf(unit: MechUnit): string {
  const prefix = `${unit.side}:`;
  return unit.id.startsWith(prefix) ? unit.id.slice(prefix.length) : unit.id;
}

export function buildOutcome(
  state: BattleState,
  tallies?: ReadonlyMap<UnitId, UnitCombatTally>,
): BattleOutcome {
  return outcomeOf(state.units, tallies, {
    objective: state.objective,
    roundsCompleted: Math.max(0, state.turn - 1),
  });
}

/**
 * Задача боя и число завершённых ходов — то, что нужно правилу исхода сверх
 * самих машин. Необязательны: бой без задачи судится правилом Части 1.
 */
export interface OutcomeTask {
  readonly objective: BattleObjective;
  readonly roundsCompleted: number;
}

/**
 * Итог боя по финальному списку юнитов.
 *
 * Вынесено из `buildOutcome` шагом 18: у быстрого расчёта
 * (`fastResolve.ts`) `BattleState` не заводится вовсе — карты нет, фаз нет,
 * есть только машины и то, что с ними стало. Правило «кто победил» при этом
 * обязано остаться ОДНИМ: сторона считается живой, пока у неё есть машина не
 * выведенная из строя и с пилотом в строю (`BattleState.active`), и разойдись
 * эти два определения — полный и быстрый расчёт присуждали бы победу по разным
 * правилам, а вся калибровка шага 18 сравнивает как раз доли побед.
 */
export function outcomeOf(
  units: readonly MechUnit[],
  tallies?: ReadonlyMap<UnitId, UnitCombatTally>,
  task?: OutcomeTask,
): BattleOutcome {
  const progress = progressOf(units, task?.roundsCompleted ?? 0);
  // Бой, дошедший до этой точки, ЗАКОНЧЕН: `judgeObjective` вернёт `null`
  // только если ни одна сторона не выбита и задача не выполнена, — а это ровно
  // ничья по потолку ходов (организованный отход, `contractResultOf`).
  const winner: Side | 'draw' =
    judgeObjective(task?.objective ?? DESTROY_ALL, progress) ?? 'draw';

  const out: UnitOutcome[] = units.map((unit) => {
    const tally = tallies?.get(unit.id) ?? EMPTY_TALLY;
    return { recordId: recordIdOf(unit), side: unit.side, unit, ...tally };
  });

  // ПОЛЕ УДЕРЖАНО = ЗАДАЧА ВЫПОЛНЕНА, и это решение, а не совпадение (шаг 19b).
  //
  // До задач боя два условия совпадали сами собой: победить можно было, только
  // выбив противника целиком. С задачами они расходятся — оборона кончается по
  // сроку, рейд по числу подбитых, и противник при этом ещё на поле. Пробовали
  // строгое правило «поле держит тот, у кого противника не осталось»: замер
  // показал, что оно молча отменяет трофеи у рейда и разведки — то есть у
  // единственных двух типов, чья задача В ПРИНЦИПЕ выполняется при живом
  // противнике, — и втрое увеличивает потери машин, потому что свои остовы
  // перестают возвращаться с выигранного боя. Это была бы вторая,
  // никем не заказанная правка экономики внутри шага про условия победы.
  //
  // Решение 3 §7 пайплайна («трофей только с удержанного поля») от этого не
  // страдает: оно про ОТХОД и ничью, а не про выигранный бой.
  // Огневой контакт: открыл ли хоть кто-нибудь огонь (шаг 35). `shotsSeen` —
  // счётчик выстрелов за бой, он уже ведётся ради опознания по вспышке, и
  // заводить второй такой же ради одного правила незачем.
  const engaged = units.some((u) => u.shotsSeen > 0);
  const enemyWithdrew = units.filter((u) => u.side === 'opfor' && u.withdrawn).length;

  return { winner, heldField: winner === 'player', engaged, enemyWithdrew, units: out };
}

/**
 * Сложить финальное состояние юнита обратно в запись.
 *
 * Зеркало наложения условия в `recordToUnit`: зоны, разрушенные ячейки и боезапас лежат в
 * `MechUnit` уже в нужном виде, считать заново нечего. Пилот, потерянный навсегда, отвязывается
 * от машины — она возвращается в отряд (или в лом, шаг 13), но вести её больше некому.
 */
export function unitToRecord(unit: MechUnit, record: MechRecord): MechRecord {
  const condition: MechCondition = {
    zones: unit.zones.map((z) => ({ armor: z.armor, structure: z.structure, destroyed: z.destroyed })),
    destroyedSlots: unit.slots.map((zoneSlots) =>
      zoneSlots.reduce<number[]>((acc, s, i) => {
        if (s.destroyed) acc.push(i);
        return acc;
      }, []),
    ),
    ammo: unit.mounts.map((m) => m.ammo),
    destroyedMounts: unit.mounts.map((m) => m.destroyed),
  };

  return {
    ...record,
    condition,
    pilotId: unit.pilot.status === 'lost' ? null : record.pilotId,
  };
}
