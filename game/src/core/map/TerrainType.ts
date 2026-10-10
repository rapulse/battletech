/**
 * Типы рельефа. Игровая модель — wiki/design/combat/terrain.md.
 *
 * Рельеф отвечает за то, что находится В клетке. Высота клетки и признаки рёбер —
 * отдельные слои (elevation, edges), сочетания получаются композицией:
 * глубокое озеро = Water + elevation −3, лесистый холм = HeavyWoods + elevation +2.
 *
 * Здесь только опознание типа: сам перечень и порядок. Числа живут в
 * `game/data/terrain.json` и приезжают через `core/data/` — этот файл не импортирует
 * ничего, иначе получился бы цикл «данные → рельеф → данные».
 */
export enum TerrainType {
  Plain = 0,
  Road = 1,
  Rough = 2,
  LightWoods = 3,
  HeavyWoods = 4,
  Rubble = 5,
  Swamp = 6,
  Water = 7,
  Building = 8,
}

/**
 * Имена типов в порядке перечисления. Порядок в JSON обязан совпадать с этим списком;
 * несовпадение останавливает загрузку данных (см. `core/data/tables.ts`).
 */
export const TERRAIN_IDS = [
  'plain',
  'road',
  'rough',
  'lightWoods',
  'heavyWoods',
  'rubble',
  'swamp',
  'water',
  'building',
] as const;

export type TerrainId = (typeof TERRAIN_IDS)[number];

export const TERRAIN_COUNT = TERRAIN_IDS.length;

export interface TerrainInfo {
  readonly id: TerrainType;
  /** Ключ локализации; человекочитаемое имя приходит из словаря, не отсюда. */
  readonly key: string;
  /** Базовая стоимость входа в MP. Для воды — только основа, глубина добавляется отдельно. */
  readonly enterCost: number;
  /** Высота объекта ПОВЕРХ уровня клетки. Нужна только для линии видимости. */
  readonly objHeight: number;
  /** Модификатор к попаданию по цели, находящейся в клетке. */
  readonly toHitMod: number;
  /** Тепло за ход пребывания. Отрицательное — дополнительное рассеивание. */
  readonly heatPerTurn: number;
  /** Требуется бросок пилотирования при беге через клетку. */
  readonly pilotingOnRun: boolean;
  /** Жёсткое препятствие: перекрывает линию видимости, а не даёт укрытие. */
  readonly hardCover: boolean;
  /** Проходимо шагом в принципе (у воды зависит ещё и от глубины). */
  readonly walkable: boolean;
  /**
   * Гекс этого рельефа перед целью (Total Warfare p.102, Partial Cover) прячет
   * её ноги: твёрдый гребень, развалины, стена здания. Лес и дым сюда не входят —
   * они мешают наводке (toHitMod), но ног не прячут (game_core.md, шаг 9c).
   */
  readonly partialCover: boolean;
}
