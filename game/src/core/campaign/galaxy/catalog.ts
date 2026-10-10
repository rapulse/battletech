import factionsJson from '../../../../data/galaxy/factions.json';
import galaxyJson from '../../../../data/galaxy/galaxy.json';
import systemsJson from '../../../../data/galaxy/systems.json';
import {
  factionsFileSchema,
  galaxyFileSchema,
  systemsFileSchema,
  SYSTEM_FLAG,
  STAR_CLASSES,
  type FactionDef,
  type GalaxyFile,
  type StarClass,
  type SystemFlag,
} from './schema.js';

/**
 * Каталог галактики — слой канона (решение 4 §2 `часть2-pipeline.md`).
 *
 * **Структура массивов, а не массив структур** — тот же приём, что у боевой
 * карты (`game_core.md` §4.1). Две тысячи систем здесь стоят десятки килобайт
 * типизированных массивов вместо двух тысяч объектов с восемью полями каждый,
 * а обход по индексу не тянет за собой ни одной аллокации.
 *
 * Каталог **не входит в сохранение**: он одинаков для всех кампаний. В
 * сохранении лежат только отличия от него (`delta.ts`) — и это то, ради чего
 * масштаб карты перестал быть архитектурным вопросом. Профиль системы
 * (население, промышленность, климат) не хранится и здесь: он выводится
 * (`profile.ts`).
 */

function fail(what: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(`Ошибка в данных галактики (${what}):\n${detail}`);
}

function parse<T>(what: string, schema: { parse: (v: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    return fail(what, err);
  }
}

const systemsFile = parse('data/galaxy/systems.json', systemsFileSchema, systemsJson);
const factionsFile = parse('data/galaxy/factions.json', factionsFileSchema, factionsJson);

/** Числа галактики: дальность и время прыжка, цены, пороги вывода профиля. */
export const GALAXY_RULES: GalaxyFile = parse('data/galaxy/galaxy.json', galaxyFileSchema, galaxyJson);

export const FACTION_LIST: readonly FactionDef[] = factionsFile.factions;
export const FACTIONS: ReadonlyMap<string, FactionDef> = new Map(FACTION_LIST.map((f) => [f.id, f]));

/**
 * Равномерная сетка для поиска по координатам.
 *
 * Матрица смежности 2000×2000 не строится и не будет строиться (ловушка 1
 * брифинга): четыре миллиона ячеек ради того, что считается по координатам за
 * микросекунды. Ячейка сетки равна радиусу поиска, поэтому ответ всегда лежит
 * в девяти соседних корзинах.
 *
 * (В брифинге сказано «27 корзин» — это число для трёхмерных координат. Карта
 * Внутренней Сферы плоская, `x`/`y` в световых годах, поэтому корзин девять.)
 */
export class SpatialGrid {
  private readonly cell: number;
  private readonly bins = new Map<number, number[]>();
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;

  constructor(xs: Float32Array, ys: Float32Array, cell: number) {
    this.cell = cell;
    this.xs = xs;
    this.ys = ys;
    for (let i = 0; i < xs.length; i++) {
      const key = this.key(xs[i] as number, ys[i] as number);
      const bin = this.bins.get(key);
      if (bin === undefined) this.bins.set(key, [i]);
      else bin.push(i);
    }
  }

  /**
   * Ключ корзины. Координаты умещаются в ±2000 св. лет, то есть в ±34 ячейки
   * при 60 св. лет — смещение на 4096 разводит отрицательные и положительные
   * без коллизий с запасом на порядок.
   */
  private key(x: number, y: number): number {
    const cx = Math.floor(x / this.cell) + 4096;
    const cy = Math.floor(y / this.cell) + 4096;
    return cx * 8192 + cy;
  }

  /** Индексы систем не дальше `radius` от системы `i`, кроме неё самой. */
  within(i: number, radius: number): number[] {
    const x = this.xs[i] as number;
    const y = this.ys[i] as number;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bin = this.bins.get((cx + dx + 4096) * 8192 + (cy + dy + 4096));
        if (bin === undefined) continue;
        for (const j of bin) {
          if (j === i) continue;
          if (Math.hypot((this.xs[j] as number) - x, (this.ys[j] as number) - y) <= radius) out.push(j);
        }
      }
    }
    out.sort((a, b) => a - b);
    return out;
  }
}

export class GalaxyCatalog {
  readonly count: number;
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Индекс спектрального класса в `STAR_CLASSES`. */
  readonly star: Uint8Array;
  /** Индекс владельца на 3053 год в `FACTION_LIST`. Текущего владельца (с учётом войны) даёт дельта (`delta.ts::ownerOf`, двигает `war/front.ts`). */
  readonly owner: Uint16Array;
  readonly flags: Uint8Array;
  readonly jumpRangeLy: number;

  private readonly byId: ReadonlyMap<string, number>;
  private readonly jumpGrid: SpatialGrid;
  private readonly neighborCache: (number[] | undefined)[];
  /**
   * Расстояние до ближайшей системы ДРУГОГО владельца, обрезанное порогом
   * `profile.borderRangeLy`. Свойство канона, а не кампании: считается один раз
   * при загрузке и одинаково для всех сидов мира.
   */
  readonly borderDistance: Float32Array;
  /** Индекс столицы каждой фракции (`FACTION_LIST`), −1 если столицы нет. */
  private readonly capitalOf: Int32Array;
  /** id фракции → её место в `FACTION_LIST`: тот же реестр, что у `owner`. */
  private readonly factionIndex: ReadonlyMap<string, number>;

  constructor() {
    const c = systemsFile.columns;
    this.count = c.id.length;
    for (const [name, col] of Object.entries(c)) {
      if (col.length !== this.count) {
        fail('data/galaxy/systems.json', new Error(`колонка «${name}»: ${col.length} значений, а систем ${this.count}`));
      }
    }

    this.ids = c.id;
    this.names = c.name;
    this.jumpRangeLy = systemsFile.jumpRangeLy;
    this.x = Float32Array.from(c.x);
    this.y = Float32Array.from(c.y);
    this.star = Uint8Array.from(c.star);
    this.flags = Uint8Array.from(c.flags);

    const byId = new Map<string, number>();
    for (let i = 0; i < this.count; i++) {
      const id = c.id[i] as string;
      if (byId.has(id)) fail('data/galaxy/systems.json', new Error(`повтор id системы: ${id}`));
      byId.set(id, i);
    }
    this.byId = byId;

    // Владелец — ССЫЛКА в реестр акторов, а не строка: неизвестная фракция
    // останавливает загрузку здесь, а не всплывает пустой картой через месяц.
    const factionIndex = new Map(FACTION_LIST.map((f, i) => [f.id, i]));
    this.factionIndex = factionIndex;
    this.owner = new Uint16Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const id = c.owner[i] as string;
      const idx = factionIndex.get(id);
      if (idx === undefined) {
        fail('data/galaxy/systems.json', new Error(`система «${c.id[i]}»: неизвестный владелец «${id}»`));
      }
      this.owner[i] = idx;
    }

    // Столица обязана существовать И принадлежать своей же фракции. Вторая
    // половина проверки не педантизм: зоны оккупации кланов делятся по хэшу id
    // (`tools/generate_galaxy.ts`), и делёж однажды уже унёс столицу Дымчатого
    // Ягуара Новой Кошке. Ошибка в данных, которую видно только глазами, —
    // это ошибка, которую не видно.
    for (const f of FACTION_LIST) {
      if (f.capital === undefined) continue;
      const at = byId.get(f.capital);
      if (at === undefined) {
        fail('data/galaxy/factions.json', new Error(`фракция «${f.id}»: столицы «${f.capital}» нет в каталоге`));
      }
      if (c.owner[at] !== f.id) {
        fail(
          'data/galaxy/factions.json',
          new Error(`фракция «${f.id}»: столица «${f.capital}» принадлежит «${c.owner[at]}»`),
        );
      }
    }

    this.capitalOf = new Int32Array(FACTION_LIST.length).fill(-1);
    FACTION_LIST.forEach((f, i) => {
      if (f.capital !== undefined) this.capitalOf[i] = byId.get(f.capital) as number;
    });

    this.jumpGrid = new SpatialGrid(this.x, this.y, this.jumpRangeLy);
    this.neighborCache = new Array<number[] | undefined>(this.count);

    const border = GALAXY_RULES.profile.borderRangeLy;
    const borderGrid = new SpatialGrid(this.x, this.y, border);
    this.borderDistance = new Float32Array(this.count).fill(border);
    for (let i = 0; i < this.count; i++) {
      let best = border;
      for (const j of borderGrid.within(i, border)) {
        if (this.owner[j] === this.owner[i]) continue;
        const d = Math.hypot((this.x[j] as number) - (this.x[i] as number), (this.y[j] as number) - (this.y[i] as number));
        if (d < best) best = d;
      }
      this.borderDistance[i] = best;
    }
  }

  /** Индекс системы по id. −1, если такой системы нет. */
  index(id: string): number {
    return this.byId.get(id) ?? -1;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Индекс системы по id или исключение: для мест, где отсутствие — ошибка правил, а не выбор игрока. */
  require(id: string): number {
    const i = this.byId.get(id);
    if (i === undefined) throw new RangeError(`Нет такой системы: ${id}`);
    return i;
  }

  id(i: number): string {
    return this.ids[i] as string;
  }

  name(i: number): string {
    return this.names[i] as string;
  }

  starOf(i: number): StarClass {
    return STAR_CLASSES[this.star[i] as number] as StarClass;
  }

  /** Владелец по КАНОНУ. Текущего владельца (с учётом войны) даёт `delta.ts`. */
  ownerId(i: number): string {
    return (FACTION_LIST[this.owner[i] as number] as FactionDef).id;
  }

  hasFlag(i: number, flag: SystemFlag): boolean {
    return ((this.flags[i] as number) & SYSTEM_FLAG[flag]) !== 0;
  }

  distance(a: number, b: number): number {
    return Math.hypot((this.x[a] as number) - (this.x[b] as number), (this.y[a] as number) - (this.y[b] as number));
  }

  /** Соседи в пределах одного прыжка. Считаются лениво и запоминаются: маршрут спрашивает их многократно. */
  neighbors(i: number): readonly number[] {
    const cached = this.neighborCache[i];
    if (cached !== undefined) return cached;
    const found = this.jumpGrid.within(i, this.jumpRangeLy);
    this.neighborCache[i] = found;
    return found;
  }

  /** Расстояние до столицы владельца системы. `Infinity`, если столицы у владельца нет. */
  distanceToCapital(i: number): number {
    const cap = this.capitalOf[this.owner[i] as number] as number;
    return cap < 0 ? Number.POSITIVE_INFINITY : this.distance(i, cap);
  }

  /**
   * Расстояние от системы до столицы ЗАДАННОЙ фракции, а не её собственного
   * владельца. `Infinity`, если столицы у фракции нет (пираты, независимые,
   * держава игрока).
   *
   * Нужно с шага 26: выбор «захват или дань» тянется к дани тем сильнее, чем
   * дальше взятый мир от столицы победителя. Это же и первый шов к логистике
   * фазы 4 — там расстояние станет ценой содержания, а здесь оно пока только
   * взвешивает решение.
   */
  distanceToCapitalOf(i: number, factionId: string): number {
    const at = this.factionIndex.get(factionId);
    if (at === undefined) return Number.POSITIVE_INFINITY;
    const cap = this.capitalOf[at] as number;
    return cap < 0 ? Number.POSITIVE_INFINITY : this.distance(i, cap);
  }
}

/** Единственный экземпляр каталога: он одинаков для всех кампаний и не меняется. */
export const GALAXY = new GalaxyCatalog();

/** Где рота стоит в первый день кампании (`data/galaxy/galaxy.json`). */
export const START_SYSTEM_ID = GALAXY_RULES.start.systemId;

if (!GALAXY.has(START_SYSTEM_ID)) {
  fail('data/galaxy/galaxy.json', new Error(`стартовой системы «${START_SYSTEM_ID}» нет в каталоге`));
}
