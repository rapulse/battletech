import { COMBAT } from '../data/tables.js';
import { hexToOffset, type Hex } from '../hex/index.js';
import type { BattleState } from '../model/BattleState.js';
import { skillLevel } from '../model/Pilot.js';
import type { MechUnit, Side } from '../model/MechUnit.js';

/**
 * Мораль стороны и решение выйти из боя (шаг 43).
 *
 * **Почему это правило вообще есть.** До него у стороны не было выхода из боя
 * вовсе: бот дрался до последней машины при любом раскладе, и три разных типа
 * контракта (`hold`, `cripple`, `destroy`) играли одинаково — «вывести из строя
 * 65 % из двух машин» на практике означало «убить обеих». Асимметрия при этом
 * была налицо: уйти с поля мог только игрок (`contractResultOf` → `withdrawn`).
 *
 * **Три вещи, которые здесь соблюдаются буквально:**
 *
 * 1. **Правило чистое.** Ни одного броска: одинаковое состояние даёт одинаковое
 *    решение. Мораль — свойство ПОЛОЖЕНИЯ, а не удачи, и лотерея здесь читалась
 *    бы игроком как жульничество игры, ровно как лотерея в срыве исполнения.
 * 2. **Проверяется раз в ход**, в начале фазы движения стороны, а не после
 *    каждого попадания: «дёргать» мораль каждым событием значило бы получать
 *    разное решение внутри одного хода.
 * 3. **Морали нет у роты игрока** (`data/combat.json` → morale). Решение уйти с
 *    поля принимает игрок, и отбирать его нельзя. Это правило соблюдает не сама
 *    функция, а тот, кто её зовёт (`sim/bot.ts::chooseSideAction`): функция
 *    честно ответит про любую сторону, и на этом стоят тесты.
 *
 * Все числа — в данных. Это ручка калибровки, её место в
 * `wiki/overview/corridors.md`, как у всех прочих.
 */

/** Из чего сложилось решение. Нужен и тесту, и журналу: «почему ушли». */
export interface MoraleReading {
  /** Доля машин стороны, выбывших из строя. */
  readonly lossShare: number;
  /** Доля потерянной целости (броня + структура) у тех, кто ещё на поле. */
  readonly damageShare: number;
  /** Насколько противник численно перевешивает, 0..1. */
  readonly outnumbered: number;
  /** Выбита ли самая крепкая машина стороны. */
  readonly commanderLost: boolean;
  /** Среднее Хладнокровие уцелевших пилотов. */
  readonly composure: number;
  /** Сумма давления: сколько набралось поводов уйти. */
  readonly pressure: number;
  /** Порог с поправкой на Хладнокровие: сколько сторона готова вытерпеть. */
  readonly resolve: number;
  /** Решение: давление дошло до стойкости. */
  readonly broken: boolean;
}

/** Машина, которая ещё дерётся. То же определение, что у `BattleState.active`. */
function onField(u: MechUnit): boolean {
  return !u.destroyed && !u.withdrawn && u.pilot.status === 'active';
}

/** Целость машины: броня плюс структура по всем зонам. */
function integrity(u: MechUnit): { now: number; max: number } {
  let now = 0;
  let max = 0;
  for (const z of u.zones) {
    now += z.armor + z.structure;
    max += z.maxArmor + z.maxStructure;
  }
  return { now, max };
}

/**
 * Самая крепкая машина стороны — та, что в звене за командирскую.
 *
 * Меряется паспортной целостью, а не тоннажем и не ценой: бой знает про машину
 * ровно это, а цена — понятие кампании, и тянуть её в боевое ядро ради одного
 * слагаемого нельзя (`core/` не импортирует `core/campaign/`). Ничьи
 * разрешаются по id — детерминизм обхода (game_core.md §4.7).
 */
function commanderOf(units: readonly MechUnit[]): MechUnit | undefined {
  let best: MechUnit | undefined;
  let bestMax = -1;
  for (const u of units) {
    const { max } = integrity(u);
    if (max > bestMax || (max === bestMax && best !== undefined && u.id < best.id)) {
      best = u;
      bestMax = max;
    }
  }
  return best;
}

/**
 * Читает положение стороны и говорит, хочет ли она выйти из боя.
 *
 * Знаменатели — по СОСТАВУ, а не по остатку: доля потерь считается от того,
 * сколько машин сторона вывела в бой, иначе «половина звена» выполнялась бы
 * бесконечным делением пополам, ровно как в задаче `cripple`.
 */
export function moraleReadingOf(
  units: readonly MechUnit[],
  side: Side,
  turn: number,
): MoraleReading {
  const cfg = COMBAT.morale;

  // Огневые точки (шаг 73c) в мораль не входят: ни свои — расчёт турели не
  // отряд и с поля не уходит, — ни чужие: давит строй машин, а не бетон.
  const mechs = units.filter((u) => u.frame !== 'emplacement');
  const mine = mechs.filter((u) => u.side === side);
  const standing = mine.filter(onField);
  const enemyStanding = mechs.filter((u) => u.side !== side && onField(u)).length;

  const lossShare = mine.length === 0 ? 0 : 1 - standing.length / mine.length;

  let now = 0;
  let max = 0;
  for (const u of standing) {
    const i = integrity(u);
    now += i.now;
    max += i.max;
  }
  const damageShare = max === 0 ? 0 : 1 - now / max;

  // Перевес считается от ЧУЖОГО числа: двое против четверых и один против двоих
  // — одно и то же положение, и мерить его надо долей, а не разностью.
  const outnumbered =
    enemyStanding === 0 ? 0 : Math.max(0, (enemyStanding - standing.length) / enemyStanding);

  const commander = commanderOf(mine);
  const commanderLost = commander !== undefined && !onField(commander);

  let composureSum = 0;
  for (const u of standing) composureSum += skillLevel(u.pilot, 'composure');
  const composure = standing.length === 0 ? cfg.composureMid : composureSum / standing.length;

  const pressure =
    lossShare * cfg.lossWeight +
    damageShare * cfg.damageWeight +
    outnumbered * cfg.outnumberedWeight +
    (commanderLost ? cfg.commanderWeight : 0);

  // Хладнокровие держит строй: пилот, который не срывает исполнение под огнём,
  // не бросает и поле. Навык уже читается правилом исполнения — второй шкалы
  // «боевого духа» ради одного слагаемого заводить незачем.
  const resolve = cfg.threshold + (composure - cfg.composureMid) * cfg.composureWeight;

  const broken =
    cfg.enabled &&
    standing.length > 0 &&
    mine.length >= cfg.minUnits &&
    turn >= cfg.checkFromTurn &&
    pressure >= resolve;

  return { lossShare, damageShare, outnumbered, commanderLost, composure, pressure, resolve, broken };
}

/**
 * То же по состоянию боя.
 *
 * Списочная форма выше нужна быстрому расчёту (`bridge/fastResolve.ts`), где
 * `BattleState` не заводится вовсе: правило морали обязано остаться ОДНИМ на
 * две точности ровно по той же причине, что и правило исхода (`objective.ts`),
 * — иначе отход стал бы случаться в полном бою и не случаться в быстром, и
 * калибровка сравнивала бы разные игры.
 */
export function moraleReading(state: BattleState, side: Side): MoraleReading {
  return moraleReadingOf(state.units, side, state.turn);
}

/** Короткий ответ того же правила: уходит ли сторона. */
export function moraleBreak(state: BattleState, side: Side): boolean {
  if (state.isWithdrawing(side)) return false;
  return moraleReading(state, side).broken;
}


/** Край карты, к которому сторона отходит. */
export type MapEdge = 'west' | 'east' | 'north' | 'south';

/**
 * Свой край карты (шаг 43): тот, к которому сторона ближе всего ВЫСАДИЛАСЬ.
 *
 * Считается по расстановке, а не по текущим позициям, и это не мелочь: к концу
 * боя сторону обычно прижимают, и «ближайший край сейчас» нередко оказывается
 * вражеским. Отход к вражескому краю — это не отход, а прорыв, и разбор не
 * смог бы отличить его от гибели.
 *
 * Ничьи разрешаются в явном порядке — запад, восток, север, юг: детерминизм
 * обхода важнее того, какой из двух равноудалённых краёв «правильнее»
 * (game_core.md §4.7).
 */
export function homeEdgeOf(state: BattleState, side: Side): MapEdge {
  const centre = state.deploymentCentre(side);
  if (centre === null) return 'west';
  const { col, row } = hexToOffset({ q: Math.round(centre.q), r: Math.round(centre.r) });

  const distances: readonly (readonly [MapEdge, number])[] = [
    ['west', col],
    ['east', state.map.w - 1 - col],
    ['north', row],
    ['south', state.map.h - 1 - row],
  ];

  let best: MapEdge = 'west';
  let bestDistance = Infinity;
  for (const [edge, d] of distances) {
    if (d < bestDistance) {
      bestDistance = d;
      best = edge;
    }
  }
  return best;
}

/** Сколько клеток машине осталось до своего края карты. */
export function distanceToEdge(state: BattleState, edge: MapEdge, hex: Hex): number {
  const { col, row } = hexToOffset(hex);
  switch (edge) {
    case 'west':
      return col;
    case 'east':
      return state.map.w - 1 - col;
    case 'north':
      return row;
    case 'south':
      return state.map.h - 1 - row;
  }
}

/**
 * Ушла ли машина с поля: дошла до полосы своего края (`morale.exitBand`).
 *
 * Полоса, а не ровно крайний ряд: крайний ряд бывает и водой, и обрывом, и
 * машина упиралась бы в непроходимую клетку, оставаясь на поле до потолка
 * ходов.
 */
export function atHomeEdge(state: BattleState, unit: MechUnit): boolean {
  return inExitBand(state, unit.side, unit.hex);
}

/**
 * Лежит ли клетка в зоне выхода стороны. Тот же вопрос, что у `atHomeEdge`, но про
 * клетку, а не про машину: зону подсвечивает карта (шаг 65), и считать её должно ядро,
 * а не показ — иначе подсвеченное и то, что действительно спасает машину, разошлись бы.
 */
export function inExitBand(state: BattleState, side: Side, hex: Hex): boolean {
  return distanceToEdge(state, homeEdgeOf(state, side), hex) <= COMBAT.morale.exitBand;
}

/** Кто из стороны успеет уйти, если она выходит из боя прямо сейчас (шаг 65). */
export interface ExitReading {
  /** Стоят в зоне выхода: уйдут целыми. */
  readonly inZone: readonly MechUnit[];
  /** Не в зоне: останутся на поле и будут потеряны. */
  readonly stranded: readonly MechUnit[];
}

/**
 * Разбор для предупреждения игроку перед немедленным выходом: сколько машин в зоне, а
 * сколько нет. Считаются только машины в строю — выбывшие потеряны и так.
 */
export function exitReading(state: BattleState, side: Side): ExitReading {
  const standing = state.active.filter((u) => u.side === side);
  return {
    inZone: standing.filter((u) => atHomeEdge(state, u)),
    stranded: standing.filter((u) => !atHomeEdge(state, u)),
  };
}
