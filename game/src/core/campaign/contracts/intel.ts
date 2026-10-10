import { Rng } from '../../rng/index.js';
import { REPUTATION } from '../reputation/schema.js';
import type { Contract } from './board.js';
import { PIRATE_FACTION } from './pirates.js';
import { CONTRACTS, type MissionType } from './schema.js';

/**
 * ДОСТОВЕРНОСТЬ РАЗВЕДДАННЫХ (шаг 57).
 *
 * До этого шага сводка нанимателя была ИДЕАЛЬНОЙ: в предложении написано
 * «2 машины до 55 т» — ровно две машины до 55 т и выходило. Наниматель знал
 * чужой гарнизон с точностью до тонны, а команда `Survey` на бой не влияла
 * никак.
 *
 * Модуль отвечает за две вещи и держит их рядом нарочно:
 *
 * 1. `intelOf` — насколько сводке можно верить. Считается при рождении
 *    предложения и ложится В КОНТРАКТ: разведать систему после подписи поздно.
 * 2. `actualForce` — что выйдет на поле на самом деле. Разыгрывается НА ВЫЛЕТЕ
 *    по сиду вылета, и **нигде больше**: цена и читаемая опасность считаются по
 *    объявленным числам, иначе гонорар выдал бы сюрприз до подписи (требование
 *    пользователя 2026-09-17).
 *
 * Живёт отдельным файлом, а не в `board.ts`, чтобы состав на вылете
 * (`opfor.ts`) не тянул за собой всю биржу: `Contract` здесь — только тип.
 */

/** Потолок тоннажа кратен пяти и не выходит за 20…100 т — шкала самих шасси. */
export function roundTons(tons: number): number {
  const step = CONTRACTS.intel.tonsStep;
  return clamp(Math.round(tons / step) * step, 20, 100);
}

/**
 * ВЕРОЯТНОСТНОЕ ОКРУГЛЕНИЕ: дробная часть — это шанс сдвинуться на единицу, а
 * не то, что выбрасывают (решение пользователя 2026-09-21).
 *
 * Зачем оно тут. Поправка разведки непрерывна, а машины целые, и обычный
 * `Math.round` при высокой достоверности съедал её НАСМЕРТЬ: поправка в 0.1
 * машины давала ровно ноль всегда, а не «изредка одну». Механика задумана
 * вероятностной, но округление приделывало к ней порог, которого нет в
 * правиле: до 2026-09-21 число машин не сдвигалось ни разу при достоверности
 * выше 0.75, а тоннаж — выше 0.88. Замер до правки: 0.95 → 0 % и 0 %, 0.75 →
 * 0 % и 30 %, 0.62 → 12 % и 49 %.
 *
 * Здесь та же поправка 0.1 даёт 10 % шанс сдвинуть на машину. Среднее от этого
 * не меняется (округление несмещённое), меняется только то, что «мало»
 * перестало значить «никогда»: 0.95 → 3.4 % машин и 7.3 % тоннажа.
 */
function stochasticRound(value: number, rng: Rng): number {
  const down = Math.floor(value);
  return rng.next() < value - down ? down + 1 : down;
}

/** То же на сетке тоннажа: потолок обязан остаться кратным пяти. */
function stochasticTons(tons: number, rng: Rng): number {
  const step = CONTRACTS.intel.tonsStep;
  return clamp(stochasticRound(tons / step, rng) * step, 20, 100);
}

/** Края сетки тоннажа — ими считается полоса, которую видит игрок. */
function floorTons(tons: number): number {
  const step = CONTRACTS.intel.tonsStep;
  return clamp(Math.floor(tons / step) * step, 20, 100);
}

function ceilTons(tons: number): number {
  const step = CONTRACTS.intel.tonsStep;
  return clamp(Math.ceil(tons / step) * step, 20, 100);
}

/**
 * ДОСТОВЕРНОСТЬ РАЗВЕДДАННЫХ работы, 0..1 (шаг 57).
 *
 * До этого шага сводка нанимателя была ИДЕАЛЬНОЙ: написано «2 машины до 55 т» —
 * ровно две и выходило. Наниматель знал чужой гарнизон с точностью до тонны, а
 * команда `Survey` не влияла на бой вовсе.
 *
 * Считается при рождении предложения и ложится В КОНТРАКТ: подписанное не
 * переигрывается, а разведать систему после подписи уже поздно. Сам разброс
 * отсюда НЕ берётся — его разыгрывает вылет (`opfor.ts::actualForce`), и это
 * главное правило механики: цена считается по объявленным числам, иначе
 * гонорар выдал бы сюрприз до подписи.
 */
export function intelOf(opts: {
  readonly mission: MissionType;
  readonly target: string;
  readonly tension: number;
  readonly standing: number;
  readonly hpg: boolean;
  readonly surveyed: boolean;
}): number {
  const q = CONTRACTS.intel;
  let value = q.base + q.missionShift[opts.mission];
  if (opts.hpg) value += q.hpgBonus;
  if (opts.surveyed) value += q.surveyedBonus;
  if (opts.target === PIRATE_FACTION) value -= q.pirateTargetPenalty;
  value -= q.tensionPenalty * clamp(opts.tension, 0, 1);
  // Отношение с нанимателем −100..100 нормируется в −1..1: доверенному отряду
  // отдают сводку как есть, чужому — что не жалко.
  value += q.standingWeight * clamp(opts.standing / REPUTATION.axes.standingMax, -1, 1);
  return Math.round(clamp(value, q.min, q.max) * 100) / 100;
}

/** Сколько машин и какого веса ВЫШЛО на поле — с поправкой на ошибку разведки. */
export interface ActualForce {
  readonly units: number;
  readonly tonnageCap: number;
}

/**
 * Треугольный шум −1..1 с пиком в нуле: сумма двух равномерных минус единица.
 *
 * Треугольный, а не равномерный, намеренно: чаще всего сводка сходится, реже
 * ошибается на машину, и только изредка — на всю полосу. Равномерный сделал бы
 * край полосы таким же обычным, как точное попадание, и «достоверность 70 %»
 * читалась бы как «каждый третий контракт — засада».
 */
function intelNoise(rng: Rng): number {
  return rng.next() + rng.next() - 1;
}

/**
 * ФАКТИЧЕСКИЙ состав против объявленного (шаг 57).
 *
 * **Разброс разыгрывается ЗДЕСЬ, на вылете, и нигде больше.** Цена контракта,
 * читаемая до боя опасность и всё, что игрок видит на бирже, считаются по
 * объявленным числам (`contract.opforUnits`, `contract.opforTons`). Иначе
 * гонорар выдал бы сюрприз до подписи: дороже обычного — значит выйдет больше
 * машин, и никакой неизвестности не осталось бы (требование пользователя
 * 2026-09-17).
 *
 * Разброс СИММЕТРИЧЕН: разведка ошибается в обе стороны, и «в гарнизоне
 * оказалось меньше, чем обещали» — такой же законный исход, как засада. Сдвинь
 * середину в худшую сторону — и работа с плохой сводкой стала бы систематически
 * недоплаченной, потому что цена о разбросе не знает по построению.
 *
 * Чистая функция от `(контракт, сид вылета)`: сид лежит в сохранении, и разбор
 * боя, пересобирающий брифинг, обязан получить тот же состав.
 */
export function actualForce(contract: Contract, seed: number): ActualForce {
  const declaredUnits = contract.opforUnits;
  const declaredTons = contract.opforTons;
  const q = CONTRACTS.intel;
  const miss = 1 - clamp(contract.intel, 0, 1);
  if (miss <= 0) return { units: declaredUnits, tonnageCap: declaredTons };

  // Свой поток: броски состава (`buildForce`) не должны сдвигаться от того,
  // ошиблась разведка или нет, — иначе один и тот же сид давал бы разные
  // машины при одинаковом числе и весе.
  const rng = new Rng((seed ^ INTEL_STREAM) >>> 0);
  // Порядок бросков важен и закреплён: сначала шум (две выдачи ГПСЧ), потом
  // бросок вероятностного округления. Функция обязана остаться чистой от сида —
  // разбор боя пересобирает брифинг и получает тот же состав.
  const units = clamp(
    stochasticRound(declaredUnits + intelNoise(rng) * q.unitsSpread * miss, rng),
    1,
    CONTRACTS.opfor.maxUnits,
  );
  const tonnageCap = stochasticTons(declaredTons * (1 + intelNoise(rng) * q.tonsSpread * miss), rng);
  return { units, tonnageCap };
}

/** Чьё поле у этого типа работы (шаг 73a, `missions.*.field`). */
export function missionField(mission: MissionType): 'enemy' | 'own' {
  return CONTRACTS.missions[mission].field;
}

/**
 * Сколько машин противника в этом вылете — засада (шаг 73a).
 *
 * Засадной может оказаться только машина СВЕРХ объявленного числа: разведка её
 * не увидела, потому что она стояла тихо. И только на поле противника
 * (`missions.*.field`) — на своей земле наниматель знает, где прятаться. Каждая
 * лишняя бросает `intel.ambushChance` своим потоком, после бросков состава,
 * поэтому состав по сиду не сдвигается. Чистая функция от `(контракт, сид)`:
 * разбор боя пересоберёт тот же брифинг.
 */
export function ambushCount(contract: Contract, seed: number): number {
  if (missionField(contract.mission) !== 'enemy') return 0;
  const extra = actualForce(contract, seed).units - contract.opforUnits;
  if (extra <= 0) return 0;
  const rng = new Rng((seed ^ AMBUSH_STREAM) >>> 0);
  let n = 0;
  for (let i = 0; i < extra; i++) if (rng.next() < CONTRACTS.intel.ambushChance) n++;
  return n;
}

/**
 * Расхождение сводки с фактом по ЧИСЛУ машин (шаг 61): что обещала карточка контракта и
 * сколько вышло на поле. Данные, а не фраза — слова подбирает экран.
 */
export interface IntelSurprise {
  readonly declared: number;
  readonly actual: number;
}

/**
 * Ошиблась ли разведка ИМЕННО В ЭТОМ вылете. `null` — число машин сошлось.
 *
 * Считается той же `actualForce`, из которой `buildOpfor` собирает состав, поэтому число
 * здесь — то самое, что стоит на поле. Показ этого до вылета убил бы разведку как механику
 * (игрок узнал бы факт заранее), а после — нужен: без него цель «вывести из строя долю
 * состава» тихо выросла бы вместе с составом (§10p).
 */
export function intelSurprise(contract: Contract, seed: number): IntelSurprise | null {
  const actual = actualForce(contract, seed).units;
  return actual === contract.opforUnits ? null : { declared: contract.opforUnits, actual };
}

/**
 * Полоса, в которой фактический состав может оказаться при такой достоверности.
 *
 * Крайние точки треугольного шума, то есть самый неудачный и самый удачный
 * жребий. Показывается игроку ДО подписи: он обязан знать, чем рискует, даже
 * если не знает, чем кончится (требование пользователя 2026-09-17).
 */
export function intelBand(contract: Contract): {
  readonly units: readonly [number, number];
  readonly tons: readonly [number, number];
} {
  const q = CONTRACTS.intel;
  const miss = 1 - clamp(contract.intel, 0, 1);
  const units = contract.opforUnits;
  const tons = contract.opforTons;
  const du = q.unitsSpread * miss;
  const dt = q.tonsSpread * miss;
  // Края считаются ВНИЗ и ВВЕРХ, а не тем же округлением, что факт: с
  // вероятностным округлением достижимо и `floor` самого неудачного жребия, и
  // `ceil` самого удачного. Считать края `round`, как раньше, значило бы
  // обещать полосу уже той, из которой выводится состав.
  return {
    units: [
      clamp(Math.floor(units - du), 1, CONTRACTS.opfor.maxUnits),
      clamp(Math.ceil(units + du), 1, CONTRACTS.opfor.maxUnits),
    ],
    tons: [floorTons(tons * (1 - dt)), ceilTons(tons * (1 + dt))],
  };
}

/**
 * Шанс, что факт разойдётся со сводкой хотя бы одним из двух чисел, 0..1.
 *
 * Нужен ЭКРАНУ, а не правилу: полоса «может быть 3–5» после вероятностного
 * округления есть почти у любой работы, и без этого числа достоверность 95 % и
 * 50 % выглядели бы на карточке одинаково. Сам состав считается не отсюда —
 * его разыгрывает `actualForce`.
 *
 * Считается точно, а не перебором: вероятность сдвига на шаг при поправке
 * `a × |шум|` — это `E[min(a·|шум|, 1)]`, и у треугольного шума она берётся
 * в лоб (`stepChance`). Клампы состава (не меньше машины, тоннаж 20…100)
 * здесь не учитываются — на краях шкалы число чуть завышено.
 */
export function intelMissChance(contract: Contract): number {
  const q = CONTRACTS.intel;
  const miss = 1 - clamp(contract.intel, 0, 1);
  if (miss <= 0) return 0;
  const units = stepChance(q.unitsSpread * miss);
  const tons = stepChance((contract.opforTons * q.tonsSpread * miss) / q.tonsStep);
  return 1 - (1 - units) * (1 - tons);
}

/**
 * `E[min(a·|шум|, 1)]` для треугольного шума: `a/3`, пока полоса не шире шага,
 * и `1 − c + c²/3` при `c = 1/a` дальше. При `a ≥ 1` сдвиг уже неизбежен на
 * части бросков, поэтому вторая ветка и не сводится к первой.
 */
function stepChance(a: number): number {
  if (a <= 0) return 0;
  if (a <= 1) return a / 3;
  const c = 1 / a;
  return 1 - c + (c * c) / 3;
}

/** Смещение потока шума разведки: любое постоянное, лишь бы не совпадало с сидом состава. */
const INTEL_STREAM = 0x5eed_1e11;
const AMBUSH_STREAM = 0x0a3b_05e7;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

