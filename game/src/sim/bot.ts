import { weapon } from '../core/data/tables.js';
import { enumerateLegalCommands, type Command } from '../core/commands/index.js';
import { distance, offsetToHex, type Hex } from '../core/hex/index.js';
import { cellCover, MoveMode } from '../core/map/index.js';
import {
  availableMounts,
  ContactLevel,
  HitZone,
  unitDissipation,
  Phase,
  zoneState,
  type BattleState,
  type MechUnit,
  type MountState,
  type Side,
  type UnitId,
  WeightClass,
} from '../core/model/index.js';
import { COMBAT } from '../core/data/tables.js';
import {
  botchOdds,
  distanceToEdge,
  heatLimits,
  isOverheated,
  hitProbability,
  homeEdgeOf,
  moraleBreak,
  pilotBotNoise,
  toHitBreakdown,
} from '../core/rules/index.js';
import type { Rng } from '../core/rng/index.js';

/**
 * Тактический бот на функции оценки (wiki/design/ai.md).
 *
 * Два правила, которые здесь соблюдаются буквально:
 *   1. Бот ходит теми же командами, что и игрок — через `enumerateLegalCommands`.
 *      Без этого у ИИ заводится вторая копия правил, и две копии расходятся.
 *   2. Сложность задаётся **навыком пилота**, а не бонусами к броскам и не
 *      подглядыванием. Низкая Тактика — больше шума в оценке, то есть чаще
 *      выбирается не лучший вариант. Это и есть «низкий навык выбирает не
 *      оптимальный маршрут» из постановки задачи.
 */

/** Личность — вектор весов. Манера боя задаётся данными, а не отдельным кодом. */
export interface BotPersonality {
  readonly key: string;
  /** Насколько ценит возможность ударить. */
  readonly aggression: number;
  /** Насколько боится ответного огня. */
  readonly caution: number;
  /** Тяга к возвышенности. */
  readonly height: number;
  /** Нелюбовь к броскам пилотирования по дороге. */
  readonly risk: number;
  /** Тяга сокращать дистанцию, когда стрелять пока не по кому. */
  readonly approach: number;
  /**
   * Тепловая дисциплина: во сколько раз бот переоценивает цену нагрева.
   * Осторожный держит запас и стреляет не всем, агрессивный жжёт до порога.
   * Здесь личность впервые видна в бою, а не в таблице.
   */
  readonly heatDiscipline: number;
  /**
   * Строй (шаг 8, часть C): цена отрыва от центроида живых союзников сверх
   * поводка (`COMBAT.ai.formationBaseLeash` + MP ходьбы). Агрессивный готов
   * идти вперёд один, осторожный держится к своим.
   */
  readonly cohesion: number;
  /**
   * Тяга встать в укрытие САМО ПО СЕБЕ, отдельно от того, что укрытие уже
   * снижает ожидаемый входящий урон по известным целям (часть общей формулы
   * `expectedIncoming`). Без отдельного слагаемого укрытие не считается,
   * пока противник не опознан, — а прятаться разумно и вслепую.
   */
  readonly cover: number;
  /**
   * Жадность до контакта, когда своих целей не видно вовсе (шаг 8, часть D):
   * насколько охотно машина идёт к последнему известному месту чужой (или к
   * центру карты, если и его не было) вместо того, чтобы держать позицию.
   * Отдельно от `approach` — тот управляет сближением с уже видимым врагом,
   * а это решение принимается вслепую, и разведчик с ним не одно и то же.
   */
  readonly scoutGreed: number;
}

export const PERSONALITIES: Readonly<Record<string, BotPersonality>> = {
  balanced: { key: 'balanced', aggression: 1.0, caution: 0.8, height: 0.6, risk: 1.5, approach: 0.8, heatDiscipline: 1.0, cohesion: 1.0, cover: 0.5, scoutGreed: 0.8 },
  aggressive: { key: 'aggressive', aggression: 1.4, caution: 0.35, height: 0.3, risk: 0.8, approach: 1.4, heatDiscipline: 0.5, cohesion: 0.4, cover: 0.2, scoutGreed: 1.2 },
  cautious: { key: 'cautious', aggression: 0.7, caution: 1.3, height: 1.0, risk: 2.5, approach: 0.4, heatDiscipline: 1.8, cohesion: 1.5, cover: 1.0, scoutGreed: 0.3 },
  sniper: { key: 'sniper', aggression: 1.1, caution: 1.0, height: 1.4, risk: 2.0, approach: 0.2, heatDiscipline: 1.3, cohesion: 1.2, cover: 0.8, scoutGreed: 0.3 },
};

export function personality(key: string): BotPersonality {
  return PERSONALITIES[key] ?? PERSONALITIES['balanced']!;
}

/**
 * Ожидаемый урон одного выстрела с учётом шанса попасть и шанса сорвать.
 *
 * `botch` и список установок передаются снаружи: они не зависят от позиции, а
 * функция вызывается сотни раз на один ход. Пересчёт внутри цикла был бы самой
 * дорогой строкой всего батч-прогона.
 */
function expectedDamage(
  state: BattleState,
  attacker: MechUnit,
  target: MechUnit,
  botch: number,
  mounts: readonly MountState[],
): number {
  let best = 0;

  for (const mount of mounts) {
    const bd = toHitBreakdown(
      state.map, attacker, target, mount.weapon, mount.zone,
      state.contact(attacker.side, target.id),
      state.units,
    );
    if (bd.impossible) continue;
    const w = weapon(mount.weapon);
    const value = hitProbability(bd.target) * (1 - botch) * w.damage * w.shots;
    if (value > best) best = value;
  }
  return best;
}

/**
 * Дальность, которую машина стремится держать: средневзвешенное по урону от
 * `short`-дальности стволов — границы, ДО которой действует лучшая точность
 * (без штрафа за дистанцию; `combat.json` → `toHit.rangeMedium`/`rangeLong`
 * добавляют промах уже за средней и дальней). Каждый ствол «тянет» результат
 * к своей `short`-дальности с силой, равной его урону за залп: мощное орудие
 * решает почти в одиночку, слабое довеском погоды не делает (шаг 9g — было
 * `min(long)`, и один слабый ствол на 3 урона утягивал всю дистанцию к своей
 * дальности, начисто игнорируя основное орудие на 10).
 *
 * ```
 * range = Σ(урон_i × short_i) / Σ(урон_i)
 * ```
 *
 * Без оружия — 0, старое поведение «идти на врага» сохраняется: разоружённой
 * машине терять от сближения нечего, а укрытие и строй уже решают за неё,
 * стоит ли жаться к своим или отступать.
 */
export function weaponEffectiveRange(mounts: readonly MountState[]): number {
  let damageSum = 0;
  let weightedRange = 0;
  for (const mount of mounts) {
    const w = weapon(mount.weapon);
    const dmg = w.damage * w.shots;
    damageSum += dmg;
    weightedRange += dmg * w.short;
  }
  return damageSum === 0 ? 0 : weightedRange / damageSum;
}

/** Оценка положения: что я смогу сделать оттуда и что сделают со мной. */
interface Threat {
  readonly unit: MechUnit;
  /** Что сторона бота знает об этой машине. Свои — всегда «опознан». */
  readonly contact: ContactLevel;
  readonly botch: number;
  readonly mounts: readonly MountState[];
}

function threatOf(unit: MechUnit, contact: ContactLevel = ContactLevel.Identified): Threat {
  return {
    unit,
    contact,
    botch: botchOdds(unit.pilot, {
      overheated: isOverheated(unit),
      damageTakenThisTurn: unit.damageThisTurn,
      fellThisTurn: unit.fellThisTurn,
    }).chance,
    mounts: availableMounts(unit),
  };
}

/**
 * Во сколько раз опасна неопознанная машина известного класса — относительно
 * своей собственной. Бот не знает её вооружения и оценивает противника **по
 * себе**: это единственная честная догадка, которая не требует подглядывать в
 * чужой лист и сама подстраивается под сценарий.
 *
 * Числа — грубая поправка на тоннаж; для засветки, у которой класс неизвестен,
 * берётся единица. Тонкость здесь не нужна: оценка неопознанного и обязана
 * быть грубой.
 */
const UNKNOWN_THREAT_BY_CLASS: Readonly<Record<WeightClass, number>> = {
  [WeightClass.Light]: 0.7,
  [WeightClass.Medium]: 1.0,
  [WeightClass.Heavy]: 1.4,
  [WeightClass.Assault]: 1.4,
};

/**
 * Сколько урона бот ждёт от противника по себе.
 *
 * Опознанный считается как есть — его лист известен. Силуэт и засветка
 * считаются собственным вооружением бота с чужой позиции: место известно
 * (иначе контакта бы не было), а начинка — нет. Без этого бот подглядывал бы
 * в чужой лист сквозь холм и лес, и вся разведка оставалась бы украшением.
 */
function expectedIncoming(
  state: BattleState,
  enemy: Threat,
  self: Threat,
  victim: MechUnit,
): number {
  if (enemy.contact >= ContactLevel.Identified) {
    return expectedDamage(state, enemy.unit, victim, enemy.botch, enemy.mounts);
  }
  const factor =
    enemy.contact >= ContactLevel.Silhouette
      ? UNKNOWN_THREAT_BY_CLASS[enemy.unit.weightClass]
      : 1;
  return expectedDamage(state, enemy.unit, victim, self.botch, self.mounts) * factor;
}

/**
 * Центроид живых союзников (без самой машины). `null` — союзников не осталось.
 *
 * Не «ближайший союзник»: тот позволил бы звену без штрафа разъехаться двумя
 * парами в разные стороны — каждая держится своего соседа, а строй в целом
 * расползается. Центроид едет со звеном, а не тянет назад того, кто продвинулся
 * вместе со всеми (шаг 8, часть C — решение пользователя, 2026-08-26).
 */
export function allyCentroid(allies: readonly MechUnit[]): Hex | null {
  if (allies.length === 0) return null;
  let q = 0;
  let r = 0;
  for (const a of allies) {
    q += a.hex.q;
    r += a.hex.r;
  }
  return { q: q / allies.length, r: r / allies.length };
}

/**
 * Поводок машины: сколько гексов от центроида звена она держит без штрафа.
 * Растёт с MP ходьбы, а не с весовым классом — подвижность здесь свойство
 * машины (decisions.md, 2026-08-25), и роль сборки на MechUnit не хранится
 * (проверено при планировании шага 8): скаут с высоким MP отходит дальше,
 * тяжёлый тихоход держится плотнее, независимо от того, как их называли на
 * сборке.
 */
export function formationLeash(unit: MechUnit): number {
  return COMBAT.ai.formationBaseLeash + unit.walkMP * COMBAT.ai.formationLeashPerWalkMp;
}

function scorePosition(
  state: BattleState,
  hypothetical: MechUnit,
  self: Threat,
  enemies: readonly Threat[],
  allies: readonly MechUnit[],
  p: BotPersonality,
  riskCount: number,
  moveHeat: number,
  rallyPoint: Hex,
  effectiveRange: number,
): number {
  let offense = 0;
  let exposure = 0;
  let nearest = Infinity;

  for (const enemy of enemies) {
    offense = Math.max(
      offense,
      expectedDamage(state, hypothetical, enemy.unit, self.botch, self.mounts),
    );
    exposure += expectedIncoming(state, enemy, self, hypothetical);
    nearest = Math.min(nearest, distance(hypothetical.hex, enemy.unit.hex));
  }

  const elevation = state.map.getElevation(hypothetical.hex);

  // Не знаем никого — идём к точке сбора: к последнему известному месту чужой
  // машины, если сторона хоть раз кого-то видела (шаг 8, часть D), иначе — к
  // центру карты (шаг 7). Встречный бой выигрывает тот, кто добыл контакт, и
  // стоять на месте не решение: без этого правила стороны, разведённые дальше
  // дальности сенсоров, просто не встретятся (замер шага 7: 300/300 ничьих).
  // Вес — `scoutGreed`, не `approach`: сближение с уже видимым врагом и поход
  // за контактом вслепую — разные по духу решения.
  //
  // Видим врага — тянет сблизиться, только пока не достигнута `effectiveRange`
  // (шаг 9f/9g, см. `weaponEffectiveRange`): штраф считается от избытка
  // дистанции НАД ней, а не от самой дистанции. До шага 9f тянуло бесконечно,
  // до упора: `offense` (ожидаемый урон) на дистанции лучшей точности уже не
  // растёт, а `closing` продолжал требовать вплотную — роботы сходились в
  // упор и кружили друг у друга под ногами вместо тактического маневрирования.
  // Дальше сближение решает не эта строка, а реальный выигрыш в попадании
  // (`offense`) против роста входящего урона (`exposure`).
  const closing = Number.isFinite(nearest)
    ? -Math.max(0, nearest - effectiveRange) * p.approach
    : -distance(hypothetical.hex, rallyPoint) * p.scoutGreed;

  // Строй: штраф растёт только сверх поводка, а не с первого же гекса —
  // иначе звено сбивается в кучу, где один залп накрывает всех (шаг8-план,
  // «Осторожно»). Центроид считается по союзникам ДО хода — свои, что уже
  // сходили в этом ходу, стоят там, где встали; кто ещё не ходил — на старом
  // месте. Тот же порядок допущений, что уже действует для expectedIncoming.
  const centroid = allyCentroid(allies);
  const strayDistance = centroid === null ? 0 : distance(hypothetical.hex, centroid);
  const cohesionPenalty = Math.max(0, strayDistance - formationLeash(hypothetical)) * p.cohesion;

  // Укрытие клетки САМО ПО СЕБЕ — отдельным слагаемым, а не только сквозь
  // ожидаемый входящий урон: тот считается лишь по уже обнаруженным врагам,
  // и вслепую (enemies пуст или все — засветка) укрытие никак не влияло бы
  // на выбор позиции без этой строки (шаг8-план, часть C).
  const coverBonus = cellCover(state.map, hypothetical.hex) * p.cover;

  // Тепло от самого движения (бег/прыжок) — той же ценой, что и тепло от
  // выстрела: переиспользует `heatCost`, а не собственную кривую, иначе цена
  // нагрева разошлась бы между двумя фазами хода без единой причины.
  const moveHeatPenalty = heatCost(hypothetical, moveHeat, p.heatDiscipline);

  return (
    offense * p.aggression -
    exposure * p.caution +
    elevation * p.height -
    riskCount * p.risk +
    closing -
    cohesionPenalty +
    coverBonus -
    moveHeatPenalty
  );
}

/**
 * Притяжение к объектам задачи боя (шаг 73d): поправка к оценке клетки.
 *
 * Атакующий — сторона, у противника которой есть целые объекты-цели, известные
 * ей: тянет подойти к ближайшему на дальность своего оружия. Обороняющийся — у
 * кого объекты свои: тянет держаться не дальше `ai.objectiveGuard` от
 * ближайшего. Без задачи с объектами поправка нулевая, и бот ходит как раньше.
 */
function objectivePull(state: BattleState, unit: MechUnit, effectiveRange: number): (at: Hex) => number {
  const kind = state.objective.kind;
  if (kind !== 'destroyTargets' && kind !== 'protectTargets') return () => 0;
  const alive = state.units.filter((u) => u.objectiveTarget && !u.destroyed);
  const theirs = alive.filter(
    (u) => u.side !== unit.side && state.contact(unit.side, u.id) > ContactLevel.None,
  );
  const ours = alive.filter((u) => u.side === unit.side);
  const weight = COMBAT.ai.objectivePull;
  const nearest = (list: readonly MechUnit[], at: Hex): number =>
    list.reduce((best, u) => Math.min(best, distance(at, u.hex)), Infinity);
  return (at) => {
    let score = 0;
    if (theirs.length > 0) score -= Math.max(0, nearest(theirs, at) - effectiveRange) * weight;
    if (ours.length > 0) score -= Math.max(0, nearest(ours, at) - COMBAT.ai.objectiveGuard) * weight;
    return score;
  };
}

/**
 * Центр карты — цель наступления вслепую.
 *
 * Единственная точка, известная обеим сторонам без всякой разведки: она не
 * зависит от того, где стоит противник, и потому не даёт боту подглядывать.
 *
 * Середина по колонке и строке, а не клетка с индексом `w·h/2`: клетки хранятся
 * по строкам, и при чётной ширине такой индекс — первая клетка средней строки,
 * то есть левый край. Все карты кампании чётные (24, 40, 64), и до этой правки
 * обе стороны вслепую шли к левому краю: рота из левого нижнего угла — вдоль
 * края вверх, противник из правого верхнего — через середину по диагонали.
 */
export function mapCentre(state: BattleState): Hex {
  return offsetToHex(Math.floor(state.map.w / 2), Math.floor(state.map.h / 2));
}

/** Как выглядел бы юнит, встав в конце маршрута. Состояние не меняется. */
function afterMove(unit: MechUnit, command: Extract<Command, { kind: 'move' }>): MechUnit {
  const path = command.path;
  const destination = path[path.length - 1];
  if (destination === undefined) return unit;
  return {
    ...unit,
    hex: destination,
    hexesMoved: path.length - 1,
    moveMode: command.mode,
  };
}

/**
 * Шум в оценке. Пропорционален разбросу оценок, а не абсолютной величине: иначе
 * при близких вариантах шум ничего не менял бы, а при далёких переворачивал выбор.
 *
 * `spreadFloor` — ниже какой оценки варианты в разброс не идут. Выстрел, который
 * глушит реактор, стоит целого залпа, и его глубокий минус растягивал шум на всех:
 * хороший выстрел тонул в шуме, и холодная машина выбирала «хватит». С порогом
 * отключения, равным отводу (2026-09-14), такой вариант есть почти в каждой
 * позиции, и перекос стал виден в замере. Варианты хуже «хватит» выбора между
 * разумными не меняют — их глубина и не должна его менять.
 */
function pickWithNoise<T>(
  rng: Rng,
  items: readonly T[],
  scores: readonly number[],
  noise: number,
  spreadFloor = -Infinity,
): T {
  if (items.length === 0) throw new RangeError('Пустой список вариантов');
  let min = Infinity;
  let max = -Infinity;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  const spread = max - Math.max(min, spreadFloor);

  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < items.length; i++) {
    const jitter = spread > 0 ? (rng.next() * 2 - 1) * noise * spread : 0;
    const value = (scores[i] ?? 0) + jitter;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }
  return items[bestIndex] as T;
}

export interface BotOptions {
  readonly personality?: string;
}

/**
 * ГПСЧ бота передаётся снаружи и НЕ входит в состояние боя.
 *
 * Размышления игрока — не состояние партии. Когда бот бросал из общего набора
 * потоков, реплей по журналу команд расходился: команды воспроизводились, а поток
 * ИИ оставался нетронутым, и хэш не сходился. Бот — это игрок, а не правило.
 */

/**
 * Насколько дорого отходящей машине задержаться на поле лишний гекс.
 *
 * Заведомо больше любого слагаемого обычной оценки: сторона УЖЕ решила уходить,
 * и торговаться с этим решением каждый ход значило бы, что решения не было.
 * Осторожность при этом остаётся в силе — уходить тоже можно по-разному, и
 * маршрут под чужими стволами хуже маршрута в обход.
 */
const RETREAT_URGENCY = 8;

/**
 * Оценка позиции для ОТХОДЯЩЕЙ машины (шаг 43).
 *
 * Отдельная функция, а не слагаемое в `scorePosition`: у отхода другая цель, и
 * смешивать её с обычной оценкой значило бы получить машину, которая на каждом
 * ходу заново решает, драться ей или уходить.
 */
function scoreRetreat(
  state: BattleState,
  hypothetical: MechUnit,
  self: Threat,
  enemies: readonly Threat[],
  p: BotPersonality,
  riskCount: number,
  moveHeat: number,
  edge: ReturnType<typeof homeEdgeOf>,
): number {
  let exposure = 0;
  for (const enemy of enemies) exposure += expectedIncoming(state, enemy, self, hypothetical);

  return (
    -distanceToEdge(state, edge, hypothetical.hex) * RETREAT_URGENCY -
    exposure * p.caution -
    riskCount * p.risk -
    heatCost(hypothetical, moveHeat, p.heatDiscipline)
  );
}

/**
 * Решение СТОРОНЫ на этот ход: выйти из боя или продолжать (шаг 43).
 *
 * Спрашивается один раз за ход, в начале фазы движения, и обеими точками, где
 * бот вообще ходит, — циклом автобоя (`sim/autoBattle.ts`) и экраном
 * (`ui/state/battle.svelte.ts`). Второй копии условия «пора уходить» в проекте
 * нет и быть не должно.
 *
 * **Мораль есть у той стороны, которую ведёт БОТ, — и только у неё.** Это и есть
 * «мораль не трогает решение игрока» из плана шага 43, дочитанное до конца:
 * отбирать решение не у кого там, где решает не человек. В отыгранном бою
 * (`ui/state/battle.svelte.ts`) сторона игрока мораль не проверяет — её ведёт
 * человек; в автобое и в быстром расчёте бот ведёт обе стороны, и обе её
 * проверяют. Иначе симметричный стенд `pnpm sim` перестал бы быть симметричным:
 * одна сторона уходила бы из безнадёжного боя, а вторая дралась бы до
 * последней машины, и ориентир «стороны 50/50» мерил бы не правила, а эту
 * разницу.
 *
 * Кого спрашивать — решает вызывающий, а не эта функция и не правило
 * (`rules/morale.ts`): правило честно считает мораль любой стороны, и на этом
 * стоят тесты.
 */
export function chooseSideAction(state: BattleState, side: Side): Command | null {
  if (state.phase !== Phase.Movement) return null;
  if (!moraleBreak(state, side)) return null;
  return { kind: 'withdrawSide', side };
}

/** Ход в фазе движения. Возвращает `endPhase`, если стоять лучше, чем идти. */
export function chooseMove(
  state: BattleState,
  unitId: UnitId,
  rng: Rng,
  opts: BotOptions = {},
): Command {
  const unit = state.requireUnit(unitId);
  const p = personality(opts.personality ?? 'balanced');
  // Бот видит ровно то, что видит его сторона (шаг 7). Машина, о которой нет
  // даже засветки, для него не существует: ни целью, ни угрозой, ни поводом
  // держать дистанцию.
  //
  // Раньше здесь стоял ранний выход `if (enemies.length === 0) return
  // endPhase`, и вся ветка «не знаем никого — идём к центру карты» в
  // scorePosition была физически недостижима — слепая сторона просто стояла
  // на месте. Найдено при планировании шага 8 (Bug 2), исправлено здесь: без
  // контакта список пуст, но перебор и оценка позиций всё равно идут.
  const enemies = state.units
    .filter((u) => u.side !== unit.side && !u.destroyed)
    .map((u) => threatOf(u, state.contact(unit.side, u.id)))
    .filter((t) => t.contact > ContactLevel.None);

  const self = threatOf(unit);
  // Не зависит от кандидата (то же вооружение на любой клетке) — считается
  // один раз на юнита, а не внутри `scorePosition`, которая зовётся сотни раз.
  const effectiveRange = weaponEffectiveRange(self.mounts);
  // Живые союзники БЕЗ самой машины — центр строя, к которому меряется отрыв.
  // Установки и спящая засада (шаги 73a, 73c) в строй не входят: к турели
  // звено не жмётся, а засада не выдаёт себя тем, что к ней стягиваются свои.
  const squadmates = state.units.filter(
    (u) => u.side === unit.side && u.id !== unit.id && !u.destroyed && u.frame === 'mech' && !u.dormant,
  );

  // Точка сбора вслепую: ближайшее из мест, где сторона последний раз видела
  // чужую машину (шаг 8, часть D); ни разу не видели — центр карты (шаг 7).
  // Считается один раз на юнита, а не на каждый гипотетический ход: цель не
  // зависит от кандидата.
  let rallyPoint: Hex = mapCentre(state);
  let rallyDistance = Infinity;
  for (const [id, m] of state.lastKnownContacts(unit.side)) {
    // Память о выбывшей машине никуда не ведёт: идти к месту, где стояла та,
    // которой больше нет, — не разведка, а прогулка к обломкам. Выбытие в этой
    // игре публично (машина уходит из боя целиком), скрытым знанием оно не
    // является, и проверка инвариант шага 7 не нарушает.
    const remembered = state.getUnit(id);
    if (remembered !== undefined && remembered.destroyed) continue;
    const d = distance(unit.hex, m.hex);
    if (d < rallyDistance) {
      rallyDistance = d;
      rallyPoint = m.hex;
    }
  }

  const pull = objectivePull(state, unit, effectiveRange);

  const legals = enumerateLegalCommands(state, unitId);
  const moves = legals.filter(
    (c): c is Extract<Command, { kind: 'move' }> => c.kind === 'move',
  );

  // Сторона объявила отход (шаг 43) — цель хода меняется целиком: не «где мне
  // выгоднее драться», а «как быстрее и дешевле дойти до своего края».
  const retreatEdge = state.isWithdrawing(unit.side) ? homeEdgeOf(state, unit.side) : null;
  const scoreOf = (
    hypo: MechUnit,
    riskCount: number,
    moveHeat: number,
  ): number =>
    retreatEdge === null
      ? scorePosition(
          state, hypo, self, enemies, squadmates, p, riskCount, moveHeat, rallyPoint, effectiveRange,
        ) + pull(hypo.hex)
      : scoreRetreat(state, hypo, self, enemies, p, riskCount, moveHeat, retreatEdge);

  const candidates: Command[] = [{ kind: 'endPhase' }];
  const scores: number[] = [scoreOf(unit, 0, 0)];

  for (const move of moves) {
    // Бег и прыжок ухудшают собственную стрельбу — оценка это уже учитывает
    // через модификатор движения в toHitBreakdown.
    const hypo = afterMove(unit, move);
    const riskCount = move.mode === MoveMode.Run ? 1 : 0;
    // Тепло от самого движения (execute.ts считает так же на конце хода):
    // бег — фиксированная цена, прыжок — по числу пройденных гексов.
    const moveHeat =
      move.mode === MoveMode.Run
        ? COMBAT.heat.runHeat
        : move.mode === MoveMode.Jump
          ? COMBAT.heat.jumpHeatPerHex * hypo.hexesMoved
          : 0;
    candidates.push(move);
    scores.push(scoreOf(hypo, riskCount, moveHeat));
  }

  if (legals.some((c) => c.kind === 'eject')) {
    // Уходят, когда бой уже проигран этой машиной: торс почти вскрыт И либо
    // стрелять нечем, либо своих меньше, чем чужих. Одного «мало структуры»
    // недостаточно — иначе бот выпрыгивает из подбитого, но ещё кусачего меха
    // и бой рассыпается; одного «нечем стрелять» тоже — у целого меха с пустым
    // магазином нет причин бросать машину.
    const torso = zoneState(unit, HitZone.Torso);
    const torsoLeft = torso.maxStructure > 0 ? torso.structure / torso.maxStructure : 0;
    const allies = state.units.filter((u) => u.side === unit.side && !u.destroyed).length;

    const dying = torsoLeft <= 0.5 || unit.pilot.injuries >= 4;
    const hopeless = self.mounts.length === 0 || allies < enemies.length;

    if (dying && hopeless) {
      candidates.push({ kind: 'eject', unitId });
      // Сравнивается с оценкой позиции: у добитой машины она уже близка к нулю
      // или отрицательна. Осторожность решает, тянет пилот до конца или уходит.
      scores.push(3.0 * p.caution - 2.0 * p.aggression);
    }
  }

  return pickWithNoise(rng, candidates, scores, pilotBotNoise(unit.pilot));
}

/** Выстрел в фазе стрельбы. Одна установка за ход — как и у игрока. */
/**
 * Сколько единиц урона стоит одна единица тепла.
 *
 * Курс обмена между двумя шкалами, и он обязан быть записан числом, а не
 * подразумеваться: цена тепла складывается с ожидаемым уроном в одной сумме,
 * поэтому любое изменение тепловой шкалы молча меняет осторожность бота. Так и
 * случилось при переводе шкалы в единое с конструктором измерение (шаг 46):
 * тепло стало вдвое крупнее, урон остался прежним, и бот начал придерживать
 * залп — доля полных залпов упала с 22.0 % до 19.6 % при неизменных правилах.
 *
 * Половина была в точности прежним поведением в удвоенной шкале. Шаг 51 вернул
 * тепло к канону (вдвое меньше), и курс вернулся к единице. Крутить вверх —
 * бот бережёт машину и стреляет реже, вниз — жжёт до порога.
 */
const HEAT_TO_DAMAGE = 1.0;

/**
 * Цена тепла от одного выстрела, в тех же единицах, что и ожидаемый урон.
 *
 * Считается не «сколько градусов», а «чего это будет стоить». Пока до порога
 * далеко, лишние три единицы не стоят почти ничего; у самого порога они стоят
 * пропущенного хода, то есть всего залпа целиком. Именно это и делает залп
 * решением: первый ствол почти бесплатен, четвёртый может обойтись в ход.
 */
function heatCost(unit: MechUnit, weaponHeat: number, discipline: number): number {
  if (weaponHeat <= 0) return 0;
  const threshold = heatLimits(unit).shutdownAt;
  const after = unit.heat + weaponHeat;

  // Пересечь порог — значит простоять ход обесточенным, то есть отдать целый
  // залп. Считается по номиналу оружия: полная оценка позиции внутри цикла
  // выбора была бы самой дорогой строкой батч-прогона.
  if (after >= threshold) {
    const volley = unit.mounts.reduce(
      (acc, m) =>
        m.destroyed || zoneState(unit, m.zone).destroyed
          ? acc
          : acc + weapon(m.weapon).damage * weapon(m.weapon).shots,
      0,
    );
    return (volley * 0.5 + weaponHeat * HEAT_TO_DAMAGE) * discipline;
  }

  // Ниже порога платится только за тепло, которое переживёт этот ход. То, что
  // радиаторы снимут к концу хода, бесплатно — иначе бот не решается выстрелить
  // из ППК даже с холодной машины: номинальная цена десяти единиц перевешивает
  // ожидаемый урон, хотя семь из них уйдут в ту же фазу тепла.
  const lingering = Math.max(0, after - unitDissipation(unit));
  return lingering * HEAT_TO_DAMAGE * (lingering / threshold) * discipline;
}

export function chooseAttack(
  state: BattleState,
  unitId: UnitId,
  rng: Rng,
  opts: BotOptions = {},
): Command {
  const unit = state.requireUnit(unitId);
  const options = enumerateLegalCommands(state, unitId).filter(
    (c): c is Extract<Command, { kind: 'attack' }> => c.kind === 'attack',
  );
  if (options.length === 0) return { kind: 'endPhase' };

  const p = personality(opts.personality ?? 'balanced');

  const scores = options.map((c) => {
    const target = state.requireUnit(c.targetId);
    const mount = unit.mounts[c.mountIndex];
    if (mount === undefined) return -Infinity;
    const bd = toHitBreakdown(
      state.map, unit, target, mount.weapon, mount.zone,
      state.contact(unit.side, target.id),
      state.units,
    );
    if (bd.impossible) return -Infinity;
    const w = weapon(mount.weapon);

    // Добивание ценится выше: снятый с поля робот больше не стреляет в ответ.
    // Но знать, что цель на последнем издыхании, можно только опознав её —
    // по силуэту повреждений не разглядеть (шаг 7).
    const identified = state.contact(unit.side, target.id) >= ContactLevel.Identified;
    const remaining = target.zones.reduce((acc, z) => acc + z.armor + z.structure, 0);
    const finisher = identified && w.damage * w.shots >= remaining ? 2 : 1;

    // Объект-цель (шаг 73d) в ответ не стреляет, и без веса бот бил бы его последним.
    const objective = target.objectiveTarget ? COMBAT.ai.objectiveWeight : 1;
    return (
      hitProbability(bd.target) * w.damage * w.shots * finisher * objective -
      heatCost(unit, w.heat, p.heatDiscipline)
    );
  });

  // «Хватит» — полноценный вариант выбора, а не выход из цикла. Без него залп
  // становится обязательным: бот вываливает всё, что достаёт, каждый ход и
  // глохнет, а замер показывает, что виноваты правила.
  const candidates: Command[] = [...options, { kind: 'endPhase' }];
  const withStop = [...scores, 0];

  return pickWithNoise(rng, candidates, withStop, pilotBotNoise(unit.pilot), 0);
}

/** Действие бота в текущей фазе. */
export function chooseAction(
  state: BattleState,
  unitId: UnitId,
  rng: Rng,
  opts: BotOptions = {},
): Command {
  if (state.phase === Phase.Movement) return chooseMove(state, unitId, rng, opts);
  if (state.phase === Phase.Attack) return chooseAttack(state, unitId, rng, opts);
  return { kind: 'endPhase' };
}
