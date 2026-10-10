import {
  DIRECTION_COUNT,
  Direction,
  distance,
  hexToOffset,
  key as hexKey,
  neighbor,
  offsetToHex,
  type Hex,
} from '../hex/index.js';
import { biome, DEFAULT_BIOME, terrainInfo } from '../data/tables.js';
import type { BiomeDef } from '../data/schema.js';
import { RngSet, type Rng } from '../rng/index.js';
import { EDGE_BRIDGE, EDGE_CLIFF } from './edges.js';
import { HexMap, MAX_ELEVATION, MIN_ELEVATION } from './HexMap.js';
import { moveCost, MoveMode } from './movement.js';
import { ValueNoise } from './noise.js';
import { TERRAIN_IDS, TerrainType, type TerrainId } from './TerrainType.js';
import { los } from './los.js';

/**
 * Процедурная генерация боевых карт (шаг 9a).
 *
 * Карта строится ПОЛЯМИ, а не рисованием объектов: три когерентных поля —
 * высота, влажность, каменистость — и таблица биома, которая переводит пару
 * (полоса высоты × полоса влажности) в тип рельефа. Ни одного нового типа
 * рельефа и ни одного нового правила генератор не заводит: всё, что видно на
 * карте, собрано из девяти существующих типов, уровня и признаков рёбер.
 *
 * Две независимые шкалы — макро и тактическая, — потому что это единственный
 * способ не превратить карту 100×100 в размытое пятно: число крупных форм
 * привязано к размеру карты, а размер рощи и ширина гребня — к абсолютным
 * гексам и от размера карты не зависят вовсе (проверяется замером).
 */

/**
 * Версия генератора. Входит в описатель карты и сверяется при загрузке:
 * без этого первое же улучшение генератора молча перепишет все сохранённые бои.
 * Поднимать при ЛЮБОЙ правке, меняющей вид карты на том же сиде.
 */
export const GENERATOR_VERSION = 1;

/** Именованные размеры карт. Числа — предмет замера, а не догма (шаг 9a, часть E). */
export const MAP_SIZES = {
  /** Эталон правил, golden-хэш, быстрый батч. */
  duel: 15,
  /** Полноценный бой копьё на копьё. */
  lance: 24,
  /** Несколько копий, фланги. */
  company: 40,
  /** Место, где разведка становится профессией. */
  operational: 64,
  /** Проверка производительности, не игровой режим. */
  ceiling: 100,
} as const;

export type MapSizeName = keyof typeof MAP_SIZES;

/**
 * Полное описание карты. Карта — функция от описателя и ничего больше:
 * тот же описатель обязан дать побайтово те же буферы.
 */
export interface MapDescriptor {
  readonly generatorVersion: number;
  readonly seed: number;
  /** Ширина в клетках сетки (колонки). */
  readonly width: number;
  /** Высота в клетках сетки (ряды). */
  readonly height: number;
  readonly biome: string;
  /** Множитель плотности растительности поверх биома, 0…1. Ручка интерфейса. */
  readonly forestDensity: number;
  /** Множитель изрезанности рельефа поверх биома, 0…1. Ручка интерфейса. */
  readonly roughness: number;
  readonly rivers: boolean;
  readonly lakes: boolean;
  readonly roads: boolean;
  /** Компактное пятно развалин (шаг 9c) — ручка интерфейса, как у реки/озёр/дорог. */
  readonly ruins: boolean;
}

/** Стартовая зона: связная группа проходимых клеток по числу машин стороны. */
export interface StartZone {
  readonly hexes: readonly Hex[];
  /** Куда сторона смотрит в начале боя: на центр карты. */
  readonly facing: Direction;
}

/**
 * Числа, которыми меряется карта (шаг 9a, часть E). Считаются генератором и
 * возвращаются наружу, чтобы замер не пересчитывал то, что уже посчитано, и не
 * получил второй источник истины.
 */
export interface MapMetrics {
  /** Доля клеток с укрытием ≥1. Ориентир на умеренном биоме — 25–45 %. */
  readonly coverShare: number;
  /**
   * Средний размер связного массива ЗАМЕТНОГО рельефа — леса, пересечёнки,
   * развалин, болота, воды. Ориентир 2–5 гексов на карте любого размера.
   *
   * Равнина в счёт не идёт намеренно: она заполняет фон и связывается в один
   * массив на пол-карты, из-за чего среднее перестаёт отвечать на вопрос
   * «какого размера роща» и начинает отвечать на «сколько на карте равнины».
   */
  readonly avgPatchSize: number;
  /**
   * Медианный размер того же массива — и вот он-то и есть тактическая шкала.
   *
   * Среднее на большой карте тянут вверх редкие сросшиеся массивы: при
   * постоянной доле занятых клеток вероятность, что цепочка протянется через
   * всю карту, растёт вместе с площадью. Из-за этого среднее ползёт 2.8 → 4.3
   * от 15×15 к 64×64, хотя частота шума абсолютная и генератор не менялся.
   * Медиана к таким выбросам нечувствительна и остаётся ровной — по ней и
   * проверяется независимость шкалы от размера карты (часть E).
   */
  readonly medianPatchSize: number;
  /** Доля клеток, из которых видно дальше 10 гексов: есть ли место снайперу. */
  readonly longSightShare: number;
  readonly waterShare: number;
  /** Клеток, недостижимых шагом из первой стартовой зоны. Обязан быть 0. */
  readonly unreachable: number;
  /** Стоимость пути между стартовыми зонами в MP. */
  readonly startPathCost: number | null;
  /** Сколько раз генератор чинил связность. Чинит, а не перегенерирует. */
  readonly repairs: number;
}

export interface GeneratedMap {
  readonly map: HexMap;
  readonly descriptor: MapDescriptor;
  readonly starts: readonly StartZone[];
  /**
   * Показатели карты. Считаются ЛЕНИВО, при первом обращении.
   *
   * Замер стоит примерно столько же, сколько вся остальная генерация — в нём
   * две заливки по стоимости хода и полсотни трассировок видимости. Батч-прогон
   * их не читает ни разу, и на 1400 боях это была шестая часть времени карты,
   * потраченная впустую. Интерфейсу они нужны, и он платит за них один раз.
   */
  readonly metrics: MapMetrics;
}

/** Заполняет умолчания. Единственное место, где они записаны. */
export function describeMap(partial: Partial<MapDescriptor> & { seed: number }): MapDescriptor {
  const size = partial.width ?? partial.height ?? MAP_SIZES.duel;
  return {
    generatorVersion: GENERATOR_VERSION,
    seed: partial.seed,
    width: partial.width ?? size,
    height: partial.height ?? size,
    biome: partial.biome ?? DEFAULT_BIOME,
    forestDensity: partial.forestDensity ?? 0.5,
    roughness: partial.roughness ?? 0.5,
    rivers: partial.rivers ?? true,
    lakes: partial.lakes ?? true,
    roads: partial.roads ?? true,
    ruins: partial.ruins ?? true,
  };
}

/**
 * Несовпадение версии — явная ошибка, а не молчаливо другая карта.
 * Вызывается при загрузке сохранения; в свежей генерации версия всегда своя.
 */
export function assertGeneratorVersion(d: MapDescriptor): void {
  if (d.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(
      `Карта собрана генератором версии ${d.generatorVersion}, текущая версия ${GENERATOR_VERSION}. ` +
        'Тот же сид дал бы другую карту, поэтому загрузка остановлена.',
    );
  }
}

// --- Поля --------------------------------------------------------------------

/**
 * Тактическая частота шума. Привязана к АБСОЛЮТНЫМ гексам и не зависит от
 * размера карты: одна ячейка решётки ≈ 2.2 гекса, и связный массив одного типа
 * выходит в 2–5 гексов — это размер рощи и ширина гребня, то есть то, что робот
 * видит на дистанции выстрела. Если сделать её долей от размера карты, роща на
 * 100×100 станет массивом в двадцать гексов, и замер это ловит (часть E).
 *
 * Число подобрано замером, а не на глаз: при 0.28 средний массив выходил 16–42
 * гекса на всех биомах — карта читалась как две-три сплошные зоны.
 */
const TACTICAL_FREQ = 0.45;

interface Fields {
  /** Непрерывная высота 0…1 до квантования. Нужна рекам: они текут по градиенту. */
  readonly height: Float64Array;
  readonly moisture: Float64Array;
  readonly stone: Float64Array;
  /** Отдельное поле выбора рельефа: связное, поэтому лес выходит массивами. */
  readonly pick: Float64Array;
}

function buildFields(d: MapDescriptor, b: BiomeDef, rng: Rng): Fields {
  const n = d.width * d.height;
  const height = new Float64Array(n);
  const moisture = new Float64Array(n);
  const stone = new Float64Array(n);
  const pick = new Float64Array(n);

  // Каждое поле — свой экземпляр шума, а не одно поле со сдвигом координат:
  // сдвиг оставляет поля скоррелированными, и «влажно там, где высоко»
  // становится законом карты, а не совпадением.
  const macro = new ValueNoise(rng);
  const detail = new ValueNoise(rng);
  const ridge = new ValueNoise(rng);
  const wet = new ValueNoise(rng);
  const rocky = new ValueNoise(rng);
  const chooser = new ValueNoise(rng);

  // Макро-частота: число крупных форм почти постоянно, а их размер растёт
  // вместе с картой. Диагональ, а не сторона: карта может быть не квадратной.
  const diagonal = Math.hypot(d.width, d.height);
  const macroFreq = b.elevation.macroForms / diagonal;

  for (let row = 0; row < d.height; row++) {
    for (let col = 0; col < d.width; col++) {
      const i = row * d.width + col;
      // Считаем по МИРОВЫМ координатам центра гекса, а не по (col, row):
      // в odd-r нечётные ряды смещены на полклетки, и шум по индексам сетки
      // даёт заметную «лесенку» на границах массивов.
      const x = col + (row & 1) * 0.5;
      const y = row * 0.866;

      const macroH = macro.fractal2D(x * macroFreq, y * macroFreq, 2, 0.5, 2);
      const detailH = detail.fractal2D(x * TACTICAL_FREQ, y * TACTICAL_FREQ, 3, 0.5, 2);
      const ridgeH = ridge.ridged2D(x * macroFreq * 1.6, y * macroFreq * 1.6, 3, 0.5, 2);

      const smoothH = macroH * 0.68 + detailH * 0.32;
      height[i] = smoothH * (1 - b.elevation.ridged) + ridgeH * b.elevation.ridged;

      const m = wet.fractal2D(x * TACTICAL_FREQ * 0.7, y * TACTICAL_FREQ * 0.7, 3, 0.5, 2);
      moisture[i] = clamp01(b.moisture.mean + (m - 0.5) * 2 * b.moisture.spread);

      stone[i] = rocky.fractal2D(x * TACTICAL_FREQ, y * TACTICAL_FREQ, 2, 0.5, 2);
      pick[i] = chooser.fractal2D(x * TACTICAL_FREQ, y * TACTICAL_FREQ, 2, 0.5, 2);
    }
  }

  return { height, moisture, stone, pick };
}

// --- Высоты ------------------------------------------------------------------

/**
 * Доли уровней над нулём: чем выше, тем реже. Без этого равнина и вершина
 * занимают одинаковую площадь, и рельеф читается как шахматка, а не как рельеф.
 */
const LEVEL_SHARES = [0.46, 0.27, 0.15, 0.08, 0.04] as const;

/**
 * Квантование высоты. НЕ округление шума: прямое округление даёт рябь —
 * одиночные клетки на уровень выше соседей, из которых нельзя построить
 * читаемый рельеф. Пороги берутся по квантилям фактического поля, поэтому доля
 * низин и распределение уровней не зависят ни от сида, ни от статистики шума.
 */
function quantise(d: MapDescriptor, b: BiomeDef, field: Float64Array): Int8Array {
  const n = d.width * d.height;
  const sorted = Float64Array.from(field).sort();
  const quantile = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))]!;

  const low = b.elevation.lowlandShare;
  const amplitude = Math.max(0, Math.min(MAX_ELEVATION, b.elevation.amplitude));

  // Низины: нижняя треть их доли — чаша под озеро, остальное — просто ложбина.
  const deepEdge = quantile(low * 0.32);
  const lowEdge = quantile(low);

  const bands: number[] = [];
  let acc = low;
  const shares = LEVEL_SHARES.slice(0, amplitude + 1);
  const total = shares.reduce((s, v) => s + v, 0);
  for (const share of shares) {
    acc += ((1 - low) * share) / total;
    bands.push(quantile(Math.min(1, acc)));
  }

  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const v = field[i]!;
    if (v < deepEdge) {
      out[i] = -2;
      continue;
    }
    if (v < lowEdge) {
      out[i] = -1;
      continue;
    }
    let level = amplitude;
    for (let k = 0; k < bands.length; k++) {
      if (v < bands[k]!) {
        level = k;
        break;
      }
    }
    out[i] = clampLevel(level);
  }
  return out;
}

/**
 * Срезает одиночные клетки: если по клетке нельзя пройти, не меняя уровень
 * дважды, это не рельеф, а шум. Клетка, у которой НИ ОДИН сосед не на её
 * уровне, получает уровень большинства соседей.
 */
function despeckle(d: MapDescriptor, level: Int8Array, passes = 2): void {
  for (let pass = 0; pass < passes; pass++) {
    const before = Int8Array.from(level);
    for (let row = 0; row < d.height; row++) {
      for (let col = 0; col < d.width; col++) {
        const i = row * d.width + col;
        const own = before[i]!;
        const counts = new Map<number, number>();
        let same = 0;
        for (const nb of gridNeighbours(d, col, row)) {
          const v = before[nb]!;
          if (v === own) same++;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        if (same > 0) continue;
        let best = own;
        let bestCount = 0;
        // Порядок обхода детерминирован: ключи сортируются, а не берутся из Map.
        for (const key of [...counts.keys()].sort((a, z) => a - z)) {
          const c = counts.get(key)!;
          if (c > bestCount) {
            bestCount = c;
            best = key;
          }
        }
        level[i] = best;
      }
    }
  }
}

// --- Рельеф ------------------------------------------------------------------

type Band = 'low' | 'mid' | 'high';
type WetBand = 'dry' | 'normal' | 'wet';

function heightBand(level: number): Band {
  if (level <= 0) return 'low';
  if (level === 1) return 'mid';
  return 'high';
}

function moistureBand(m: number): WetBand {
  if (m < 0.38) return 'dry';
  if (m < 0.62) return 'normal';
  return 'wet';
}

const FOREST: ReadonlySet<TerrainId> = new Set<TerrainId>(['lightWoods', 'heavyWoods']);
const STONY: ReadonlySet<TerrainId> = new Set<TerrainId>(['rough', 'rubble']);

/**
 * Тип рельефа в клетке.
 *
 * Выбор идёт по СВЯЗНОМУ полю `pick`, а не броском ГПСЧ на клетку. Это ровно то,
 * что даёт рощи по 2–5 гексов вместо соли с перцем: соседние клетки получают
 * близкое значение поля и попадают в один и тот же интервал весов. Размер
 * массива задаётся частотой поля, она абсолютная — поэтому и не зависит от
 * размера карты.
 */
function pickTerrain(
  b: BiomeDef,
  d: MapDescriptor,
  level: number,
  moisture: number,
  stone: number,
  pick: number,
): TerrainType {
  const row = b.terrain[heightBand(level)];
  const cell = row[moistureBand(moisture)];

  // Ручки интерфейса гнут веса биома, а не подменяют таблицу: 0.5 — «как в
  // биоме», 0 и 1 — вдвое реже и вдвое чаще.
  const forestK = 0.5 + d.forestDensity;
  const stoneK = (0.5 + d.roughness) * (0.6 + stone * 0.8);

  let total = 0;
  const weights: number[] = [];
  for (const [id, w] of cell) {
    const k = FOREST.has(id) ? forestK : STONY.has(id) ? stoneK : 1;
    const weight = w * k;
    weights.push(weight);
    total += weight;
  }
  if (total <= 0) return TerrainType.Plain;

  let acc = 0;
  const target = pick * total;
  for (let i = 0; i < cell.length; i++) {
    acc += weights[i]!;
    if (target < acc) return terrainByName(cell[i]![0]);
  }
  return terrainByName(cell[cell.length - 1]![0]);
}

function terrainByName(id: TerrainId): TerrainType {
  return TERRAIN_IDS.indexOf(id) as TerrainType;
}

// --- Генерация ---------------------------------------------------------------

export function generateMap(descriptor: MapDescriptor): GeneratedMap {
  const d = describeMap(descriptor);
  const b = biome(d.biome);

  // Свои потоки на каждый этап: добавленный бросок в гидрологии не должен
  // сдвигать рельеф — иначе улучшение рек перерисует все карты целиком.
  const rngs = new RngSet(d.seed);
  const fields = buildFields(d, b, rngs.stream('mapGen'));

  const map = new HexMap(d.width, d.height);
  const level = quantise(d, b, fields.height);
  despeckle(d, level);

  // 1. Уровень и рельеф из полей.
  for (let row = 0; row < d.height; row++) {
    for (let col = 0; col < d.width; col++) {
      const i = row * d.width + col;
      const cell = offsetToHex(col, row);
      map.setElevation(cell, level[i]!);
      map.setTerrain(
        cell,
        pickTerrain(b, d, level[i]!, fields.moisture[i]!, fields.stone[i]!, fields.pick[i]!),
      );
    }
  }

  // 2. Вода в чашах, затем реки по градиенту, затем дороги и мосты.
  if (d.lakes) fillLakes(d, b, map, fields, level);
  if (d.rivers) carveRivers(d, b, map, fields, rngs.stream('mapGen'));

  // 3. Обрывы: перепад ≥2 закрывается всегда и автоматически, иначе робот
  //    «взбегает» по отвесу. Ставится ПОСЛЕ воды: озеро меняет уровень.
  markCliffs(map);

  // 4. Стартовые зоны — обязанность генератора, а не сценария.
  const starts = placeStarts(d, map);

  // 4b. Развалины — редкое компактное пятно, не на каждой карте. ПОСЛЕ стартов,
  //     чтобы было от чего их отодвигать, и ДО дорог/связности — тот же
  //     регламент безопасности, что у всего остального рельефа.
  if (d.ruins) scatterRuins(d, b, map, starts, rngs.stream('mapGen'));

  // 5. Дороги — ДО проверки связности, а не после.
  //    Насыпь через воду выравнивает уровень клетки и тем самым может создать
  //    ступень в два уровня рядом с собой. Пока дороги строились последними,
  //    эта ступень отсекала клетку уже после починки, и замер показывал
  //    «недостижимо 1» при «починок 0» — то есть починка даже не пробовала.
  if (d.roads && b.settlement.roads > 0) buildRoads(map, starts);

  // 6. Связность проверяется, а не подразумевается. Недостижимое ЧИНИТСЯ:
  //    перегенерация по неудаче не убирает ошибку, а делает её редкой.
  const repairs = ensureConnectivity(map, starts);

  let cached: MapMetrics | null = null;
  return {
    map,
    descriptor: d,
    starts,
    get metrics(): MapMetrics {
      cached ??= measure(map, starts, repairs);
      return cached;
    },
  };
}

// --- Гидрология --------------------------------------------------------------

/** Озёра — низины поля высот. Глубина берётся из уровня, отдельного правила нет. */
function fillLakes(
  d: MapDescriptor,
  b: BiomeDef,
  map: HexMap,
  fields: Fields,
  level: Int8Array,
): void {
  if (b.hydrology.lakeShare <= 0) return;
  const n = d.width * d.height;
  const sorted = Float64Array.from(fields.height).sort();
  const edge = sorted[Math.min(n - 1, Math.floor(b.hydrology.lakeShare * n))]!;

  for (let row = 0; row < d.height; row++) {
    for (let col = 0; col < d.width; col++) {
      const i = row * d.width + col;
      if (fields.height[i]! > edge) continue;
      const cell = offsetToHex(col, row);
      map.setTerrain(cell, TerrainType.Water);
      // Глубина не идёт ниже −2: с головой вода непроходима шагом, а озеро,
      // которое нельзя обойти и нельзя перейти, режет карту надвое.
      map.setElevation(cell, level[i]! <= -2 ? -2 : -1);
    }
  }
}

/**
 * Реки — спуск по градиенту НЕПРЕРЫВНОГО поля высот, а не квантованного уровня:
 * на четырёх уровнях спуск по уровню сразу упирается в плато и река встаёт.
 *
 * Ложится на КЛЕТКУ (`TerrainType.Water` + метка `river`), а не на ребро между
 * клетками (шаг 9c). Уровень клетки при этом не трогается: истоки рек — самые
 * высокие точки поля (см. ниже), и увести такую клетку в отрицательный уровень
 * означало бы вырыть обрыв прямо у истока и разорвать связность карты. Река
 * поэтому мелкая (глубина 0) там, где течёт по возвышенности, и настоящей
 * глубины набирает только там, где рельеф и так уже низкий — как в жизни.
 *
 * Река обязана течь вниз и обязана куда-то впадать. Река в гору или река,
 * обрывающаяся посреди поля, — ошибка, а не стилизация.
 */
function carveRivers(
  d: MapDescriptor,
  b: BiomeDef,
  map: HexMap,
  fields: Fields,
  rng: Rng,
): void {
  const count = b.hydrology.rivers;
  if (count <= 0) return;

  const index = (h: Hex): number => {
    const { col, row } = hexToOffset(h);
    return row * d.width + col;
  };

  // Истоки: самые высокие клетки с высокой влажностью. Перебор в явном порядке,
  // ГПСЧ выбирает только между равноценными кандидатами.
  const springs: { hex: Hex; score: number }[] = [];
  for (let row = 1; row < d.height - 1; row++) {
    for (let col = 1; col < d.width - 1; col++) {
      const i = row * d.width + col;
      const cell = offsetToHex(col, row);
      if (map.getTerrain(cell) === TerrainType.Water) continue;
      springs.push({ hex: cell, score: fields.height[i]! * 0.7 + fields.moisture[i]! * 0.3 });
    }
  }
  springs.sort((a, z) => z.score - a.score || a.hex.q - z.hex.q || a.hex.r - z.hex.r);

  const used = new Set<number>();
  let made = 0;

  for (const spring of springs.slice(0, Math.max(8, springs.length >> 4))) {
    if (made >= count) break;
    if (used.has(hexKey(spring.hex))) continue;

    const path: { hex: Hex; dir: Direction }[] = [];
    let current = spring.hex;
    let guard = 0;
    let reachedWater = false;

    while (guard++ < d.width * d.height) {
      let bestDir: Direction | null = null;
      let bestHeight = fields.height[index(current)]!;

      for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
        const to = neighbor(current, dir as Direction);
        if (!map.contains(to)) {
          // Дошли до края карты — река вытекает за карту, это законный исход.
          bestDir = dir as Direction;
          bestHeight = -Infinity;
          break;
        }
        const h = fields.height[index(to)]!;
        if (h < bestHeight) {
          bestHeight = h;
          bestDir = dir as Direction;
        }
      }

      if (bestDir === null) break; // Локальный минимум на суше: озеро без стока.

      const to = neighbor(current, bestDir);
      if (!map.contains(to)) {
        // Утекла за карту — законный исход, но ребра наружу не существует:
        // оно принадлежит клетке, которой нет. Река просто кончается кромкой.
        reachedWater = true;
        break;
      }
      path.push({ hex: current, dir: bestDir });
      if (map.getTerrain(to) === TerrainType.Water) {
        reachedWater = true;
        break;
      }
      current = to;
      if (used.has(hexKey(current))) {
        reachedWater = true; // Влилась в уже проложенную реку.
        break;
      }
    }

    // Ручей в три гекса рекой не считается: он ничего не решает и только шумит.
    if (!reachedWater || path.length < 4) continue;

    for (const step of path) {
      map.setTerrain(step.hex, TerrainType.Water);
      map.setRiver(step.hex, true);
      used.add(hexKey(step.hex));
    }
    made++;
  }

  // ГПСЧ гидрологии израсходован: поток обязан быть затронут, даже если рек не
  // вышло, иначе включение рек сдвигает все последующие броски.
  rng.next();
}

// --- Обрывы ------------------------------------------------------------------

/**
 * Перепад ≥2 — это скала. Ставится всегда и автоматически.
 *
 * Река с шага 9c не трогает уровень (см. `carveRivers`), поэтому больше не может
 * лечь на одно ребро с обрывом — снимать признак реки с обрыва здесь больше
 * незачем.
 */
function markCliffs(map: HexMap): void {
  for (const cell of map.cells()) {
    for (let dir = 0; dir < 3; dir++) {
      const d = dir as Direction;
      const to = neighbor(cell, d);
      if (!map.contains(to)) continue;
      if (Math.abs(map.getElevation(to) - map.getElevation(cell)) < 2) continue;
      map.addEdge(cell, d, EDGE_CLIFF);
    }
  }
}

// --- Стартовые зоны ----------------------------------------------------------

/** Сколько клеток в стартовой зоне. Копьё из четырёх машин плюс запас. */
const START_ZONE_SIZE = 6;

/**
 * Две зоны, симметричные относительно центра карты.
 *
 * Карта асимметрична сознательно (шаг 9a, вопрос 3), но СТАРТЫ обязаны быть
 * зеркальны: перекос стартового угла на демонстрационной карте стоил 6–8 п.п.
 * победной доли и два месяца никем не замечался. Симметрия зон — самая дешёвая
 * половина честности, вторая половина меряется числом (часть E).
 */
function placeStarts(d: MapDescriptor, map: HexMap): StartZone[] {
  const centreCol = (d.width - 1) / 2;
  const centreRow = (d.height - 1) / 2;
  const inset = Math.max(1, Math.round(Math.min(d.width, d.height) * 0.12));

  const a = { col: inset, row: d.height - 1 - inset };
  const b = { col: d.width - 1 - inset, row: inset };

  const centre = offsetToHex(Math.round(centreCol), Math.round(centreRow));

  return [a, b].map((anchor) => {
    const hexes = growZone(map, offsetToHex(anchor.col, anchor.row), START_ZONE_SIZE);
    const origin = hexes[0] ?? centre;
    return { hexes, facing: facingTowards(origin, centre) };
  });
}

// --- Развалины -----------------------------------------------------------------

/**
 * Развалины — редкое компактное пятно (заброшенное поселение или поле боя), не
 * диффузная скальная россыпь: та уже задаётся весами `terrain.*` через тип
 * `rubble` для пустыни/вулкана/луны и здесь не участвует (`biomes.json` →
 * `ruins.chance: 0` у них). Оба вида — один и тот же `TerrainType.Rubble` с
 * одними и теми же правилами (частичное укрытие, бросок пилотирования на
 * бегу); отличаются только тем, КАК клетка попала на карту и как её рисует
 * показ (`HexMap.ruins` — метка только для этого, правила её не читают).
 *
 * Появляется не на каждой карте (`ruins.chance`), и не ближе стартовых зон:
 * найти руины в бою должно быть тактическим решением, а не гарантией.
 */
function scatterRuins(
  d: MapDescriptor,
  b: BiomeDef,
  map: HexMap,
  starts: readonly StartZone[],
  rng: Rng,
): void {
  const cfg = b.ruins;
  if (cfg.chance <= 0 || rng.next() >= cfg.chance) {
    // ГПСЧ карты обязан быть затронут даже без единого пятна — тот же принцип,
    // что у рек: включение фичи не должно сдвигать все последующие броски.
    return;
  }

  const startSet = new Set<number>();
  for (const zone of starts) for (const h of zone.hexes) startSet.add(hexKey(h));

  const patchCount = 1 + (cfg.maxPatches > 1 && rng.next() < 0.4 ? 1 : 0);
  const used = new Set<number>();

  for (let i = 0; i < Math.min(patchCount, cfg.maxPatches); i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const col = 2 + Math.floor(rng.next() * Math.max(1, d.width - 4));
      const row = 2 + Math.floor(rng.next() * Math.max(1, d.height - 4));
      const anchor = offsetToHex(col, row);
      if (!map.contains(anchor) || startSet.has(hexKey(anchor))) continue;
      if (map.getTerrain(anchor) === TerrainType.Water) continue;

      const patch = growZone(map, anchor, cfg.patchSize);
      if (patch.length < 2) continue;
      if (
        patch.some(
          (h) =>
            startSet.has(hexKey(h)) ||
            used.has(hexKey(h)) ||
            map.getTerrain(h) === TerrainType.Water,
        )
      ) {
        continue;
      }

      for (const h of patch) {
        map.setTerrain(h, TerrainType.Rubble);
        map.setRuins(h, true);
        used.add(hexKey(h));
      }
      break;
    }
  }
}

/** Связная группа проходимых клеток вокруг якоря. Волной, в явном порядке. */
function growZone(map: HexMap, anchor: Hex, size: number): Hex[] {
  const start = nearestWalkable(map, anchor);
  const out: Hex[] = [];
  const seen = new Set<number>([hexKey(start)]);
  let frontier: Hex[] = [start];

  while (out.length < size && frontier.length > 0) {
    frontier.sort((x, y) => x.q - y.q || x.r - y.r);
    const next: Hex[] = [];
    for (const cell of frontier) {
      if (out.length >= size) break;
      out.push(cell);
      for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
        const to = neighbor(cell, dir as Direction);
        if (!map.contains(to) || seen.has(hexKey(to))) continue;
        seen.add(hexKey(to));
        if (!walkableCell(map, to)) continue;
        next.push(to);
      }
    }
    frontier = next;
  }
  return out;
}

function walkableCell(map: HexMap, h: Hex): boolean {
  if (!map.contains(h)) return false;
  if (!terrainInfo(map.getTerrain(h)).walkable) return false;
  return map.getDepth(h) <= 2;
}

/** Ближайшая проходимая клетка. Расширяющимся кольцом, в явном порядке. */
function nearestWalkable(map: HexMap, from: Hex): Hex {
  return findSpawn(map, from, new Set());
}

/**
 * Место под машину: ближайшая проходимая и незанятая клетка.
 *
 * Нужна расстановке сценария. На процедурной карте клетка с фиксированными
 * координатами может оказаться под водой или на скале — и машина, молча не
 * поставленная в бой, была бы худшим из возможных исходов.
 */
export function findSpawn(map: HexMap, from: Hex, taken: ReadonlySet<number>): Hex {
  const free = (h: Hex): boolean => walkableCell(map, h) && !taken.has(hexKey(h));
  if (free(from)) return from;
  for (let radius = 1; radius < 12; radius++) {
    const ring: Hex[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const h = { q: from.q + dq, r: from.r + dr };
        if (distance(from, h) !== radius) continue;
        ring.push(h);
      }
    }
    ring.sort((a, b) => a.q - b.q || a.r - b.r);
    for (const h of ring) if (free(h)) return h;
  }
  return from;
}

function facingTowards(from: Hex, to: Hex): Direction {
  let best: Direction = Direction.NE;
  let bestDist = Infinity;
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const probe = neighbor(from, dir as Direction);
    const dist = distance(probe, to);
    if (dist < bestDist) {
      bestDist = dist;
      best = dir as Direction;
    }
  }
  return best;
}

// --- Связность ---------------------------------------------------------------

/** Поиск по стоимости хода без учёта фасинга: дорогам и заливке фасинг не нужен. */
interface WalkNode {
  readonly hex: Hex;
  readonly cost: number;
  readonly from: WalkNode | null;
  readonly viaDir: Direction | null;
}

function walkFlood(map: HexMap, starts: readonly Hex[]): Map<number, WalkNode> {
  const best = new Map<number, WalkNode>();
  let frontier: WalkNode[] = [];

  for (const s of starts) {
    if (!map.contains(s)) continue;
    const node: WalkNode = { hex: s, cost: 0, from: null, viaDir: null };
    best.set(hexKey(s), node);
    frontier.push(node);
  }

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.hex.q - b.hex.q || a.hex.r - b.hex.r);
    const next: WalkNode[] = [];
    for (const current of frontier) {
      if (best.get(hexKey(current.hex)) !== current) continue;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const dir = d as Direction;
        const to = neighbor(current.hex, dir);
        if (!map.contains(to)) continue;
        // ШАГОМ, а не прыжком: не у всех машин есть прыжковые двигатели, и
        // карта, где без них не пройти, нечестна к тем, кто за это заплатил
        // тоннами.
        const step = moveCost(map, current.hex, to, dir, MoveMode.Walk);
        if (!step.ok) continue;
        const cost = current.cost + step.step.mp;
        const known = best.get(hexKey(to));
        if (known !== undefined && known.cost <= cost) continue;
        const node: WalkNode = { hex: to, cost, from: current, viaDir: dir };
        best.set(hexKey(to), node);
        next.push(node);
      }
    }
    frontier = next;
  }

  return best;
}

/**
 * Чинит недостижимое, а не перегенерирует карту.
 *
 * Перегенерация по неудаче — способ спрятать ошибку: она останется, просто
 * станет редкой. Починка адресная: на границе достижимого и недостижимого
 * снимается обрыв и срезается ступень до одного уровня — получается пологий
 * спуск ровно там, где он нужен.
 */
function ensureConnectivity(map: HexMap, starts: readonly StartZone[]): number {
  const origin = starts[0]?.hexes ?? [];
  if (origin.length === 0) return 0;

  let repairs = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    const reached = walkFlood(map, origin);

    // Недостижимые проходимые клетки, в явном порядке обхода.
    const stranded: Hex[] = [];
    for (const cell of map.cells()) {
      if (!walkableCell(map, cell)) continue;
      if (reached.has(hexKey(cell))) continue;
      stranded.push(cell);
    }
    if (stranded.length === 0) return repairs;

    // Чиним ВСЮ границу за проход: по одной клетке за заход отсечённая долина
    // в полсотни гексов не чинится за отведённое число попыток и уезжает в
    // замер как «недостижимо 0.04» — то есть как редкая, а потому невидимая
    // ошибка. Именно этого перегенерация по неудаче и не лечит.
    let carved = false;
    for (const cell of stranded) {
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const dir = d as Direction;
        const to = neighbor(cell, dir);
        if (!map.contains(to) || !reached.has(hexKey(to))) continue;

        map.setEdge(cell, dir, map.getEdge(cell, dir) & ~EDGE_CLIFF);
        const here = map.getElevation(cell);
        const there = map.getElevation(to);
        if (Math.abs(here - there) > 1) {
          map.setElevation(cell, clampLevel(there + Math.sign(here - there)));
        }
        repairs++;
        carved = true;
        break;
      }
    }
    // Ни одна отсечённая клетка не касается достижимой: чинить нечем, и
    // молчать об этом нельзя — число уедет в метрики как есть.
    if (!carved) return repairs;
  }
  return repairs;
}

// --- Дороги ------------------------------------------------------------------

/**
 * Дорога прокладывается ТЕМ ЖЕ поиском по стоимости хода, которым ходит робот.
 * Дорога, проложенная своим алгоритмом, регулярно оказывается там, куда робот
 * всё равно не пойдёт.
 */
function buildRoads(map: HexMap, starts: readonly StartZone[]): void {
  const from = starts[0]?.hexes[0];
  const to = starts[1]?.hexes[0];
  if (from === undefined || to === undefined) return;

  const reached = walkFlood(map, [from]);
  let node: WalkNode | null = reached.get(hexKey(to)) ?? null;

  while (node !== null) {
    const cell: Hex = node.hex;
    const isRiver = map.getRiver(cell);

    if (isRiver) {
      // Река — не пруд: дорога идёт по мосту НАД ней (ниже), а не осушает
      // клетку в полотно. Терраформировать её сюда нельзя.
    } else if (map.getTerrain(cell) === TerrainType.Water) {
      // Насыпь через озеро: дорога кладёт ровное полотно поверх брода. Уровень
      // берётся у соседа по дороге, а не обнуляется: обнуление рядом с низиной
      // рождает ступень в два уровня и режет карту там, где её только что
      // связали.
      const parentLevel = node.from === null ? 0 : map.getElevation(node.from.hex);
      map.setTerrain(cell, TerrainType.Road);
      map.setElevation(cell, clampLevel(Math.max(parentLevel - 1, Math.min(parentLevel, 0))));
    } else if (terrainInfo(map.getTerrain(cell)).walkable) {
      map.setTerrain(cell, TerrainType.Road);
      // Дорога могла лечь на пятно развалин — метка теперь врёт, клетка Road.
      map.setRuins(cell, false);
    }

    // Мост ставится там, где дорога пересекает реку: единственная дешёвая
    // переправа, за которую дерутся, и узел карты.
    const parent: WalkNode | null = node.from;
    if (parent !== null && node.viaDir !== null && isRiver) {
      map.addEdge(parent.hex, node.viaDir, EDGE_BRIDGE);
    }
    node = parent;
  }
}

// --- Замер -------------------------------------------------------------------

function measure(map: HexMap, starts: readonly StartZone[], repairs: number): MapMetrics {
  const cells = [...map.cells()];
  let cover = 0;
  let water = 0;
  let longSight = 0;

  for (const cell of cells) {
    const t = map.getTerrain(cell);
    if (terrainInfo(t).toHitMod > 0) cover++;
    if (t === TerrainType.Water) water++;
  }

  // Дальний обзор: смотрим из клетки в четыре стороны на 12 гексов. Полный
  // перебор пар был бы O(n²) и на 100×100 стоил бы больше самой генерации.
  const probes: Hex[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(cells.length) / 8));
  for (let i = 0; i < cells.length; i += step) probes.push(cells[i]!);

  // Клетки, у которых НИ ОДИН луч в 12 гексов не помещается в карту, в счёт не
  // идут: иначе показатель меряет размер карты, а не её просматриваемость, и на
  // 15×15 выходит 20 % там, где на 64×64 — 67 % при одинаковом рельефе.
  let probed = 0;
  for (const cell of probes) {
    if (!walkableCell(map, cell)) continue;
    let sees = false;
    let fits = false;
    for (let d = 0; d < DIRECTION_COUNT; d++) {
      let target = cell;
      for (let k = 0; k < 12; k++) target = neighbor(target, d as Direction);
      if (!map.contains(target)) continue;
      fits = true;
      if (!los(map, cell, target).blocked) {
        sees = true;
        break;
      }
    }
    if (!fits) continue;
    probed++;
    if (sees) longSight++;
  }

  const origin = starts[0]?.hexes ?? [];
  const reached = origin.length > 0 ? walkFlood(map, origin) : new Map<number, WalkNode>();
  let unreachable = 0;
  for (const cell of cells) {
    if (!walkableCell(map, cell)) continue;
    if (!reached.has(hexKey(cell))) unreachable++;
  }

  const target = starts[1]?.hexes[0];
  const startPathCost = target === undefined ? null : (reached.get(hexKey(target))?.cost ?? null);

  return {
    coverShare: cover / cells.length,
    ...patchScale(map, cells),
    longSightShare: probed === 0 ? 0 : longSight / probed,
    waterShare: water / cells.length,
    unreachable,
    startPathCost,
    repairs,
  };
}

/** Размеры связных массивов заметного рельефа: среднее и медиана. */
function patchScale(
  map: HexMap,
  cells: readonly Hex[],
): { avgPatchSize: number; medianPatchSize: number } {
  const seen = new Set<number>();
  const sizes: number[] = [];

  for (const cell of cells) {
    if (seen.has(hexKey(cell))) continue;
    const type = map.getTerrain(cell);
    if (type === TerrainType.Plain || type === TerrainType.Road) continue;
    let size = 0;
    // Массив, упирающийся в кромку карты, обрезан ею, а не рельефом. Считать
    // его наравне с целыми — значит занижать шкалу тем сильнее, чем меньше
    // карта, и получить рост «массив 3.8 → 5.3» там, где генератор не менялся.
    let touchesBorder = false;
    const queue: Hex[] = [cell];
    seen.add(hexKey(cell));

    while (queue.length > 0) {
      const current = queue.pop()!;
      size++;
      for (let d = 0; d < DIRECTION_COUNT; d++) {
        const to = neighbor(current, d as Direction);
        if (!map.contains(to)) {
          touchesBorder = true;
          continue;
        }
        if (seen.has(hexKey(to))) continue;
        if (map.getTerrain(to) !== type) continue;
        seen.add(hexKey(to));
        queue.push(to);
      }
    }
    if (touchesBorder) continue;
    sizes.push(size);
  }

  if (sizes.length === 0) return { avgPatchSize: 0, medianPatchSize: 0 };
  sizes.sort((a, b) => a - b);
  const total = sizes.reduce((acc, v) => acc + v, 0);
  return {
    avgPatchSize: total / sizes.length,
    medianPatchSize: sizes[sizes.length >> 1]!,
  };
}

// --- Мелочи ------------------------------------------------------------------

function clampLevel(level: number): number {
  return Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, Math.round(level)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function* gridNeighbours(d: MapDescriptor, col: number, row: number): Generator<number> {
  const cell = offsetToHex(col, row);
  for (let dir = 0; dir < DIRECTION_COUNT; dir++) {
    const nb = hexToOffset(neighbor(cell, dir as Direction));
    if (nb.col < 0 || nb.col >= d.width || nb.row < 0 || nb.row >= d.height) continue;
    yield nb.row * d.width + nb.col;
  }
}
