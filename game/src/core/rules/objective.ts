import type { BattleState } from '../model/BattleState.js';
import type { MechUnit } from '../model/MechUnit.js';
import {
  type BattleObjective,
  type ObjectiveProgress,
  type ObjectiveVerdict,
} from '../model/Objective.js';

/**
 * Кто победил при этой задаче боя (шаг 19b).
 *
 * **Одно правило на два расчёта.** Его зовут и полный бой (`sim/autoBattle.ts`,
 * а через `buildOutcome` — и мост в кампанию), и быстрый расчёт
 * (`bridge/fastResolve.ts`). Разойдись они — доли побед двух точностей начали
 * бы расходиться не от приближения, а от разных правил, и вся калибровка шага
 * 18 потеряла бы смысл.
 *
 * **Правило одинаково для обеих сторон, кроме задачи.** Задача есть только у
 * роты: наниматель платит ей за оборону объекта или за рейд. У противника
 * задача всегда одна — выбить пришедших, — и это не упрощение, а то, как
 * контракт устроен. Поэтому `opfor` побеждает ровно тогда, когда у роты не
 * осталось машин в строю, при любой задаче.
 */

/**
 * Сколько машин противника надо вывести, чтобы задача `cripple` считалась
 * выполненной.
 *
 * Округление ВВЕРХ: половина от трёх — это две машины. Вниз дало бы «половину
 * звена из трёх» в одну машину, то есть задачу легче рейда на звено из двух.
 *
 * **Но доля никогда не значит «выбить всех» (шаг 56).** До него округление
 * вверх съедало разницу на малых составах: рейд (0.65) против двойки требовал
 * обе машины, то есть ровно того же, что штурм, — и такой была КАЖДАЯ ВТОРАЯ
 * долевая работа на бирже (51 из 134 в смотре ста предложений). Игрок читал
 * «вывести 65 % и уйти», а уходить было не от кого. Теперь квота не превышает
 * `всего − 1`: право уйти, не добивая последнего, — это и есть то, чем долевая
 * задача отличается от разгрома, и стоит оно ровно столько, сколько за него
 * платят (`missions[].payFactor`).
 *
 * Состав из одной машины сюда не попадает: долевые работы бирже разрешено
 * выдавать только от двух машин (`board.ts::drawUnits`).
 */
export function crippleQuota(share: number, opforTotal: number): number {
  const wanted = Math.max(1, Math.ceil(share * opforTotal));
  return Math.min(wanted, Math.max(1, opforTotal - 1));
}

/**
 * Сколько машин надо вывести по задаче `cripple` в этом бою.
 *
 * Число, записанное контрактом (`quota`), не растёт и не убывает вместе с составом на
 * поле: разведка ошибается, а условие остаётся тем, что игрок прочёл при подписи. Упирается
 * оно только в потолок «состав минус один». Без `quota` — доля от состава (`crippleQuota`).
 */
export function crippleNeed(
  objective: Extract<BattleObjective, { kind: 'cripple' }>,
  opforTotal: number,
): number {
  if (objective.quota === undefined) return crippleQuota(objective.share, opforTotal);
  // Вышло меньше, чем обещала сводка: записанное число не превращает долю в «выбить всех»
  // (то же право уйти, не добивая последнего, что и у `crippleQuota`, шаг 56).
  return Math.min(objective.quota, Math.max(1, opforTotal - 1));
}

export function judgeObjective(
  objective: BattleObjective,
  progress: ObjectiveProgress,
): ObjectiveVerdict {
  const { roundsCompleted, playerActive, opforActive, opforTotal } = progress;

  // Оборона объектов (шаг 73d): разрушены все свои объекты — поражение раньше
  // всего прочего, даже если рота цела и противник почти выбит.
  if (objective.kind === 'protectTargets' && progress.playerTargetsTotal > 0 && progress.playerTargets === 0) {
    return 'opfor';
  }

  // Рота выбита — контракт провален при любой задаче. Проверяется ПЕРВЫМ:
  // «продержаться десять ходов» не выполнено ротой, которой на десятом ходу
  // уже нет.
  if (playerActive === 0) return opforActive === 0 ? 'draw' : 'opfor';

  // Противник выбит целиком — победа при любой задаче: оборонять объект больше
  // не от кого, а рейд состоялся с запасом.
  if (opforActive === 0) return 'player';

  switch (objective.kind) {
    case 'destroy':
      return null;
    case 'hold':
      // Считаются ЗАВЕРШЁННЫЕ ходы: «продержаться три хода» выполнено в конце
      // третьего, а не в его начале. Иначе оборона выигрывалась бы на ход
      // раньше срока, а на коротких сроках это треть боя.
      return roundsCompleted >= objective.rounds ? 'player' : null;
    case 'cripple': {
      const out = opforTotal - opforActive;
      return out >= crippleNeed(objective, opforTotal) ? 'player' : null;
    }
    case 'destroyTargets':
      return progress.opforTargetsTotal > 0 && progress.opforTargets === 0 ? 'player' : null;
    case 'protectTargets':
      return roundsCompleted >= objective.rounds ? 'player' : null;
  }
}

/**
 * Машина в строю: цела, на поле и пилот в строю. То же определение, что у
 * `BattleState.active`.
 *
 * Ушедшая своим ходом (шаг 43) в строю НЕ числится, и это и делает отход
 * противника концом боя: когда с поля ушли все, `opforActive` обнуляется, и
 * правило исхода присуждает победу роте — при любой задаче, так же как если бы
 * противника выбили. Целой машину это не перестаёт делать: трофеем она не
 * станет (`debrief/index.ts::collectTrophies` спрашивает `destroyed`), а
 * репутационное «с превышением» её видит на поле (`salvage.ts`).
 */
function isActive(u: MechUnit): boolean {
  return !u.destroyed && !u.withdrawn && u.pilot.status === 'active';
}

/**
 * Положение дел по списку машин.
 *
 * `opforTotal` — сколько машин противника ВЫШЛО в бой, а не сколько их осталось:
 * доля для `cripple` считается от состава, а не от остатка, иначе задача
 * «вывести половину» выполнялась бы бесконечным делением пополам.
 */
export function progressOf(units: readonly MechUnit[], roundsCompleted: number): ObjectiveProgress {
  let playerActive = 0;
  let opforActive = 0;
  let opforTotal = 0;
  let playerTargets = 0;
  let opforTargets = 0;
  let playerTargetsTotal = 0;
  let opforTargetsTotal = 0;
  for (const u of units) {
    // Объект-цель (шаг 73d) считается отдельно: цел ли, а не «в строю» — пилота
    // у него нет, уйти с поля он не может.
    if (u.objectiveTarget) {
      if (u.side === 'player') {
        playerTargetsTotal += 1;
        if (!u.destroyed) playerTargets += 1;
      } else {
        opforTargetsTotal += 1;
        if (!u.destroyed) opforTargets += 1;
      }
    }
    // Огневые точки (шаг 73c) в задачу боя не входят: иначе ради победы пришлось
    // бы охотиться за бетоном, а «вывести половину» считалось бы и от турелей.
    if (u.frame === 'emplacement') continue;
    if (u.side === 'opfor') opforTotal += 1;
    if (!isActive(u)) continue;
    // Звено нанимателя (шаг 73b) поле за роту не держит: вышла из строя
    // последняя машина роты — бой для неё кончен, сколько бы союзников ни
    // стояло рядом. Контракт роты, и досматривать чужой бой без своих машин
    // незачем. Отход же роты уводит и союзников: `withdrawSide` — по стороне.
    if (u.side === 'player') {
      if (!u.ally) playerActive += 1;
    } else opforActive += 1;
  }
  return {
    roundsCompleted,
    playerActive,
    opforActive,
    opforTotal,
    playerTargets,
    opforTargets,
    playerTargetsTotal,
    opforTargetsTotal,
  };
}

/**
 * То же по состоянию боя.
 *
 * `state.turn` — ход, который ИДЁТ сейчас, поэтому завершённых на единицу
 * меньше. Ошибиться здесь на единицу значит выигрывать оборону на ход раньше
 * срока — на сроке в три хода это треть боя.
 */
export function judgeBattle(state: BattleState): ObjectiveVerdict {
  return judgeObjective(state.objective, progressOf(state.units, state.turn - 1));
}

/**
 * Кончен ли бой. Тот же ответ, что у `judgeBattle`, но словом «да/нет» — его
 * спрашивают цикл автобоя и экран.
 */
export function battleOver(state: BattleState): boolean {
  return judgeBattle(state) !== null;
}
