import type { BattleEvent } from '../core/commands/index.js';
import { PILOTS } from '../core/data/tables.js';
import type { BattleState, UnitId } from '../core/model/index.js';
import { isOverheated } from '../core/rules/heat.js';
import type { UnitCombatTally } from '../core/campaign/bridge/fromBattle.js';

/**
 * Сводка боя по юниту для послебоевого разбора кампании.
 *
 * Жила внутри `autoBattle.ts`, пока считать её было некому, кроме автобоя.
 * Шаг 17 вывел бой на экран, и разбор понадобился ровно тот же: повреждения,
 * опыт и износ реактора после боя, отыгранного руками, обязаны считаться теми
 * же правилами, что и после автобоя. Вторая копия этого счёта разошлась бы с
 * первой на первом же новом событии — и разошлась бы молча, потому что оба
 * счёта дают правдоподобные числа.
 *
 * Почему это слой `sim/`, а не ядро: `BattleEvent` уже несёт `unitId` на нужных
 * событиях, и здесь не заводится ни одного нового боевого правила — только
 * бухгалтерия поверх уже случившегося (`core/campaign/bridge/fromBattle.ts`).
 */

/** Изменяемый двойник `UnitCombatTally`: тот же набор полей, но не `readonly`, для сбора по ходу боя. */
export interface MutableTally {
  hits: number;
  pilotingPassed: number;
  kills: number;
  victims: UnitId[];
  initiativeWins: number;
  composureHeld: number;
  overheatTurns: number;
}

export function emptyTally(): MutableTally {
  return { hits: 0, pilotingPassed: 0, kills: 0, victims: [], initiativeWins: 0, composureHeld: 0, overheatTurns: 0 };
}

/**
 * Копилка сводок на один бой.
 *
 * Класс, а не пара свободных функций с двумя мапами наружу: `lastHitBy` — это
 * состояние счёта между вызовами (кто попал по цели последним), и оставлять его
 * на попечение вызывающего значило бы, что каждый новый вызывающий заводит его
 * заново и однажды забудет.
 */
export class BattleTally {
  private readonly tallies = new Map<UnitId, MutableTally>();
  /** Кто попал по цели последним: из этого выводится, кому записать добивание. */
  private readonly lastHitBy = new Map<UnitId, UnitId>();

  private at(id: UnitId): MutableTally {
    let t = this.tallies.get(id);
    if (t === undefined) {
      t = emptyTally();
      this.tallies.set(id, t);
    }
    return t;
  }

  /**
   * Разобрать события одной команды.
   *
   * `state` нужен одному событию — инициативе: она называет сторону, а сводка
   * ведётся по машинам, и кто на поле сейчас, знает только состояние боя.
   * Необязателен, чтобы старые вызовы (тесты, разбор записанного журнала)
   * читались как «инициативу не считаем», а не падали.
   *
   * Добивание приписывается тому, чей выстрел попал по цели последним перед её
   * `unitDestroyed`.
   */
  collect(events: readonly BattleEvent[], state?: BattleState): void {
    for (const e of events) {
      switch (e.kind) {
        case 'shot':
          // Добивание — по любому долетевшему урону, опыт попадания — по
          // первой ракете пачки (шаг 66c): у неё шансы прежнего одного броска
          // на залп, а «долетела хоть одна из двадцати» почти всегда да.
          // У некластерного ствола оба условия — одно и то же `hit`.
          if (e.hit) this.lastHitBy.set(e.targetId, e.unitId);
          if (e.clusterTotal === undefined ? e.hit : e.intentHit && !e.botched) {
            this.at(e.unitId).hits += 1;
          }
          // ДЕЙСТВИЕ ПОД ДАВЛЕНИЕМ. Считается по САМОМУ действию, а не по его
          // успеху: срыв (`botched`) отменяет уже удавшийся выстрел, и пилот,
          // державшийся при четверти шансов сорваться, сделал свою работу
          // независимо от того, попал он или нет.
          if (!e.botched && e.botchChance >= PILOTS.progression.pressureFrom) {
            this.at(e.unitId).composureHeld += 1;
          }
          break;
        // Инициатива — свойство СТОРОНЫ, а опыт достаётся людям: выигранный ход
        // записывается каждому, кто в этот момент ещё на поле. Ход бросает
        // ядро (`initiative.ts`), и лучший модификатор Тактики в звене решает
        // за всех — поэтому и растёт Тактика у всех, а не у одного.
        //
        // Считается только бросок перед движением. С 2026-09-15 инициатива
        // бросается и перед стрельбой, но награда за ход осталась одна: второй
        // бросок удвоил бы опыт Тактики, не сделав бой вдвое труднее.
        case 'initiative': {
          if (e.phase !== 'movement') break;
          const winner = e.order[e.order.length - 1];
          if (winner === undefined || state === undefined) break;
          for (const u of state.active) if (u.side === winner) this.at(u.id).initiativeWins += 1;
          break;
        }
        case 'pilotingCheck':
          if (e.passed) this.at(e.unitId).pilotingPassed += 1;
          break;
        case 'unitDestroyed': {
          // Выбитая огневая точка (шаг 73c) — не добивание машины: опыт за неё
          // пилот получает попаданиями, а в счёт выбитых и в достижения она не идёт.
          if (state?.getUnit(e.unitId)?.frame === 'emplacement') break;
          const killer = this.lastHitBy.get(e.unitId);
          if (killer !== undefined) {
            const t = this.at(killer);
            t.kills += 1;
            t.victims.push(e.unitId);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Отметить ход, проведённый при тепле на пороге аварийного отключения и выше.
   *
   * Считается не по событиям, а замером состояния в конце хода: перегрев — это
   * НЕ событие, а положение, в котором машина простояла ход. Вход в износ
   * реактора послебоевого разбора (`core/campaign/mech/wear.ts`).
   */
  sampleHeat(state: BattleState): void {
    for (const u of state.active) {
      if (isOverheated(u)) this.at(u.id).overheatTurns += 1;
    }
  }

  /** Готовая сводка для `buildOutcome`. */
  get map(): ReadonlyMap<UnitId, UnitCombatTally> {
    return this.tallies;
  }
}
