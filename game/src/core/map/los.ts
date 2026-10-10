import { compare, distance, key as hexKey, neighbor, DIRECTION_COUNT, type Direction, type Hex } from '../hex/index.js';
import { round } from '../hex/HexMetrics.js';
import { EDGE_RULES, OVERLAYS, terrainInfo } from '../data/tables.js';
import { EDGE_GATE, EDGE_WALL } from './edges.js';
import { OVERLAY_FIRE, OVERLAY_ICE, OVERLAY_SMOKE } from './HexMap.js';
import type { HexMap } from './HexMap.js';

/**
 * Линия видимости (game_core.md §4.3, wiki/design/combat/terrain.md).
 *
 * Возвращает отчёт, а не boolean: правилам боя нужен не факт видимости, а
 * модификатор к попаданию, число промежуточных лесов, наличие частичного укрытия
 * и разница уровней. Считать это дважды — в видимости и в стрельбе — значит завести
 * две расходящиеся копии одной геометрии.
 */
export interface LosResult {
  /** Линия перекрыта: стрелять нельзя вовсе. */
  readonly blocked: boolean;
  /** Расстояние в гексах. */
  readonly range: number;
  /** Промежуточные редкие леса (не перекрывшие линию). */
  readonly lightWoods: number;
  /** Промежуточные густые леса. */
  readonly heavyWoods: number;
  /** Цель прикрыта до пояса: +к попаданию, нижние зоны недоступны. */
  readonly partialCover: boolean;
  /** Разница уровней: стрелок минус цель. Положительная — стрелок выше. */
  readonly levelAdvantage: number;
  /** Суммарный модификатор к целевому числу от промежуточного рельефа. */
  readonly coverMod: number;
  /**
   * Модификатор от клетки, в которой стоит САМА цель: лес, развалины, дым.
   *
   * Считается отдельно от `coverMod` и не участвует в перекрытии линии: стоять
   * в лесу — не то же самое, что стрелять сквозь лес, и журнал обязан их
   * различать. До шага 7 своя клетка цели не учитывалась вовсе, и спрятаться
   * в лесу было нельзя — только за лесом.
   */
  readonly targetCover: number;
}

/** Уровень глаз: стоящий робот на уровень выше клетки, упавший — вровень. */
export const EYE_STANDING = 1;
export const EYE_PRONE = 0;

/**
 * Порог перекрытия лесом. Редкий лес — 1 очко, густой — 2; линия перекрывается
 * с трёх очков. Отсюда ровно правила из terrain.md: три редких леса перекрывают,
 * два густых перекрывают, один густой — нет.
 */
const WOODS_BLOCK_POINTS = 3;

/**
 * Смещение, разводящее две трассировки по разные стороны от точной границы гекса.
 *
 * Когда линия идёт ровно по ребру, «правильного» гекса нет — их два. Две трассировки
 * с противоположным смещением дают обоих кандидатов; выбор между ними делает правило
 * ничьей ниже.
 */
const EPS = 1e-6;

function rawTrace(a: Hex, b: Hex, n: number, eps: number): Hex[] {
  const out: Hex[] = new Array<Hex>(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out[i] = round(a.q + eps + (b.q - a.q) * t, a.r + eps + (b.r - a.r) * t);
  }
  return out;
}

/**
 * Кандидаты на каждом шаге линии: один гекс, либо два, если линия идёт по границе.
 *
 * Строится в каноническом порядке и разворачивается — та же защита от
 * несимметричности, что и в `line()` (см. HexLine.ts).
 */
function candidates(a: Hex, b: Hex, n: number): Hex[][] {
  const flip = compare(a, b) > 0;
  const p = flip ? b : a;
  const q = flip ? a : b;

  const plus = rawTrace(p, q, n, EPS);
  const minus = rawTrace(p, q, n, -EPS);
  if (flip) {
    plus.reverse();
    minus.reverse();
  }

  const out: Hex[][] = new Array<Hex[]>(n + 1);
  for (let i = 0; i <= n; i++) {
    const x = plus[i]!;
    const y = minus[i]!;
    out[i] = hexKey(x) === hexKey(y) ? [x] : compare(x, y) <= 0 ? [x, y] : [y, x];
  }
  return out;
}

/** Во что обходится линии один промежуточный гекс. */
interface Obstruction {
  readonly hard: boolean;
  readonly light: number;
  readonly heavy: number;
  /** Очки перекрытия: лес редкий 1, густой 2, дым 2, пожар 1. Линия закрывается с трёх. */
  readonly points: number;
  readonly mod: number;
  readonly height: number;
}

const CLEAR: Obstruction = { hard: false, light: 0, heavy: 0, points: 0, mod: 0, height: -Infinity };

/**
 * Вклад динамического слоя клетки: дым, пожар, лёд.
 *
 * Оверлей — это маска, и слоёв на клетке может быть несколько; берётся сумма
 * по всем поднятым битам, а высота — максимум. До шага 7 оверлеи хранились,
 * копировались и рисовались, но ни одно правило их не читало: дым не прятал.
 */
function overlayAt(map: HexMap, h: Hex): { height: number; mod: number; points: number } {
  const flags = map.getOverlay(h);
  if (flags === 0) return { height: 0, mod: 0, points: 0 };

  let height = 0;
  let mod = 0;
  let points = 0;
  const add = (o: { objHeight: number; toHitMod: number; blockPoints: number }): void => {
    height = Math.max(height, o.objHeight);
    mod += o.toHitMod;
    points += o.blockPoints;
  };
  if ((flags & OVERLAY_SMOKE) !== 0) add(OVERLAYS.smoke);
  if ((flags & OVERLAY_FIRE) !== 0) add(OVERLAYS.fire);
  if ((flags & OVERLAY_ICE) !== 0) add(OVERLAYS.ice);
  return { height, mod, points };
}

/**
 * Укрытие клетки самой по себе: рельеф + оверлей, без выбора конкретного
 * стрелка. То же слагаемое, что `los()` кладёт в `targetCover`, — вынесено
 * отдельной функцией, чтобы бот мог спросить «насколько эта клетка укрыта»,
 * не выбирая врага, которого он, возможно, ещё не видит (шаг 8, часть C).
 */
export function cellCover(map: HexMap, h: Hex): number {
  return terrainInfo(map.getTerrain(h)).toHitMod + overlayAt(map, h).mod;
}

function obstructionAt(map: HexMap, h: Hex, lineHeight: number): Obstruction {
  if (!map.contains(h)) return CLEAR;
  const info = terrainInfo(map.getTerrain(h));
  const over = overlayAt(map, h);
  const objHeight = Math.max(map.getObjHeight(h), over.height);
  const height = map.getElevation(h) + objHeight;
  if (height < lineHeight) return { ...CLEAR, height };

  // Здание и стена перекрывают, а не укрывают. Голая скала выше линии — тоже:
  // сквозь холм не стреляют, поэтому объект нулевой высоты блокирует жёстко.
  // Дым над голой равниной скалой не считается — он поднял objHeight сам.
  if (info.hardCover || objHeight === 0) {
    return { hard: true, light: 0, heavy: 0, points: 0, mod: 0, height };
  }

  // Мягкое препятствие: лес. Различаем по вкладу в попадание из таблицы данных,
  // а не по перечислению типов — новый вид леса подключится сам.
  const woodsHere = map.getObjHeight(h) > 0 && info.toHitMod > 0;
  const heavy = woodsHere && info.toHitMod >= 2 ? 1 : 0;
  const light = woodsHere && heavy === 0 ? 1 : 0;
  const points = light + heavy * 2 + over.points;
  return { hard: false, light, heavy, points, mod: info.toHitMod + over.mod, height };
}

/** Ничья на границе: берётся гекс, который мешает меньше. Симметрично по построению. */
function betterOf(a: Obstruction, b: Obstruction): Obstruction {
  if (a.hard !== b.hard) return a.hard ? b : a;
  if (a.mod !== b.mod) return a.mod < b.mod ? a : b;
  return a.height <= b.height ? a : b;
}

/**
 * Стена или ворота между двумя соседними клетками перекрывают линию до своей
 * высоты (`terrain.json` → edges.wallHeight). Высота одна на все стены: держать
 * байт высоты на каждом ребре ради редкого случая дороже, чем он стоит.
 *
 * Ребро принадлежит паре клеток, поэтому проверка симметрична сама по себе.
 */
function wallBlocks(map: HexMap, a: Hex, b: Hex, lineHeight: number): boolean {
  if (!map.contains(a) || !map.contains(b)) return false;
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const n = neighbor(a, dir as Direction);
    if (n.q !== b.q || n.r !== b.r) continue;
    if ((map.getEdge(a, dir as Direction) & (EDGE_WALL | EDGE_GATE)) === 0) return false;
    const top = Math.max(map.getElevation(a), map.getElevation(b)) + EDGE_RULES.wallHeight;
    return top >= lineHeight;
  }
  return false;
}

/**
 * Пересекает ли линия стену на переходе от шага i к шагу i+1.
 *
 * Кандидатов на шаге может быть два (линия идёт по границе), и правило ничьей
 * то же, что и для клеток: **выбирает стреляющий**. Стена перекрывает, только
 * если перекрыты ВСЕ соседние пары кандидатов; хватило одной щели — линия
 * прошла. Свойство пары множеств, а не направления взгляда, — значит симметрия
 * получается сама.
 */
function wallBetween(map: HexMap, from: readonly Hex[], to: readonly Hex[], lineHeight: number): boolean {
  let pairs = 0;
  for (const a of from) {
    for (const b of to) {
      if (a.q === b.q && a.r === b.r) continue;
      let adjacent = false;
      for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
        const n = neighbor(a, dir as Direction);
        if (n.q === b.q && n.r === b.r) {
          adjacent = true;
          break;
        }
      }
      if (!adjacent) continue;
      pairs += 1;
      if (!wallBlocks(map, a, b, lineHeight)) return false;
    }
  }
  return pairs > 0;
}

export interface LosOptions {
  /** Уровень глаз стрелка над своей клеткой. */
  readonly fromEye?: number;
  /** Уровень «глаз» цели над своей клеткой: во что целятся. */
  readonly toEye?: number;
}

/** Расчёт без кэша. Прямой вызов нужен тестам; в бою используется `los()`. */
export function computeLos(map: HexMap, from: Hex, to: Hex, opts: LosOptions = {}): LosResult {
  const fromEye = opts.fromEye ?? EYE_STANDING;
  const toEye = opts.toEye ?? EYE_STANDING;

  const range = distance(from, to);
  const eyeFrom = map.getElevation(from) + fromEye;
  const eyeTo = map.getElevation(to) + toEye;
  const levelAdvantage = map.getElevation(from) - map.getElevation(to);

  // Клетка самой цели: лес, развалины, дым вокруг неё мешают наводке, но линию
  // не перекрывают — иначе робот прятался бы от выстрела внутри собственного
  // гекса. Считается всегда, в том числе на нулевой дистанции.
  const targetCover = cellCover(map, to);

  if (range === 0) {
    return {
      blocked: false, range: 0, lightWoods: 0, heavyWoods: 0,
      partialCover: false, levelAdvantage: 0, coverMod: 0, targetCover,
    };
  }

  const path = candidates(from, to, range);

  let hard = false;
  let light = 0;
  let heavy = 0;
  let points = 0;
  let coverMod = 0;
  let partialCover = false;

  for (let i = 1; i <= range; i++) {
    const t = i / range;
    const lineHeight = eyeFrom + (eyeTo - eyeFrom) * t;

    // Стена между предыдущим шагом и этим перекрывает линию раньше, чем начнёт
    // считаться сам гекс: она стоит МЕЖДУ клетками, а не в одной из них.
    if (wallBetween(map, path[i - 1]!, path[i]!, lineHeight)) {
      hard = true;
      break;
    }

    // Клетка цели дальше не считается: её вклад — targetCover, отдельной строкой.
    if (i === range) break;

    const step = path[i]!;
    let obs = obstructionAt(map, step[0]!, lineHeight);
    for (let j = 1; j < step.length; j++) {
      obs = betterOf(obs, obstructionAt(map, step[j]!, lineHeight));
    }

    if (obs.hard) {
      hard = true;
      break;
    }
    light += obs.light;
    heavy += obs.heavy;
    points += obs.points;
    coverMod += obs.mod;

    // Частичное укрытие (Partial Cover) по канону BattleTech (Total Warfare p. 102):
    // даётся ТОЛЬКО твёрдым рельефом (гребень/холм/развалины/здание на 1 уровень
    // выше цели перед ней) или водой глубины 1. Какой рельеф твёрдый — решает
    // данные (`terrain.json` → partialCover), а не перечисление типов здесь: лес и
    // дым мешают наводке (toHitMod), но ног не прячут — `partialCover: false` у них.
    if (i === range - 1) {
      for (const h of step) {
        if (!map.contains(h) || !map.contains(to)) continue;
        const hElev = map.getElevation(h);
        const toElev = map.getElevation(to);
        const solid = terrainInfo(map.getTerrain(h)).partialCover;
        const topH = solid ? hElev + map.getObjHeight(h) : hElev;
        if (topH >= toElev + 1 && topH <= lineHeight) {
          partialCover = true;
          break;
        }
      }
    }
  }

  // Цель в воде глубины 1 прикрыта водой до пояса
  if (!hard && map.contains(to) && map.getDepth(to) === 1) {
    partialCover = true;
  }

  const blocked = hard || points >= WOODS_BLOCK_POINTS;

  return {
    blocked, range, lightWoods: light, heavyWoods: heavy,
    partialCover, levelAdvantage, coverMod, targetCover,
  };
}

/**
 * Кэш видимости — требование, а не оптимизация «на потом» (game_core.md §4.3).
 *
 * Рельеф в бою почти не меняется, а батч-прогон на 10 000 боёв без кэша не
 * укладывается в разумное время. Кэш живёт при карте: разные карты не мешают друг
 * другу, а сборщик мусора убирает его вместе с картой.
 */
const caches = new WeakMap<HexMap, Map<number, LosResult>>();

function cacheKey(from: Hex, to: Hex, fromEye: number, toEye: number): number {
  const eyes = (fromEye === EYE_PRONE ? 0 : 1) * 2 + (toEye === EYE_PRONE ? 0 : 1);
  return (hexKey(from) * 4194304 + hexKey(to)) * 4 + eyes;
}

export function los(map: HexMap, from: Hex, to: Hex, opts: LosOptions = {}): LosResult {
  const fromEye = opts.fromEye ?? EYE_STANDING;
  const toEye = opts.toEye ?? EYE_STANDING;

  let cache = caches.get(map);
  if (cache === undefined) {
    cache = new Map<number, LosResult>();
    caches.set(map, cache);
  }
  const k = cacheKey(from, to, fromEye, toEye);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;

  const result = computeLos(map, from, to, { fromEye, toEye });
  cache.set(k, result);
  return result;
}

/** Сброс кэша: разрушено здание, изменился оверлей, изменился рельеф. */
export function invalidateLos(map: HexMap): void {
  caches.delete(map);
}

/** Размер кэша карты. Нужен тестам и профилировке, в правилах не используется. */
export function losCacheSize(map: HexMap): number {
  return caches.get(map)?.size ?? 0;
}
