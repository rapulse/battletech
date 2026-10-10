import {
  describeMap,
  generateMap,
  placeUnits,
  type GeneratedMap,
  type MapDescriptor,
} from '../core/map/index.js';
import { refreshContacts } from '../core/commands/index.js';
import { BattleState, makeUnit, Phase, WeightClass, type MechUnit, type Side } from '../core/model/index.js';
import {
  makePilot,
  generateAssembly,
  assemblyToChassisDef,
  weightClassOf,
  type AssemblyRole,
} from '../core/rules/index.js';
import { Rng, RngSet } from '../core/rng/index.js';
import { CHASSIS_CATALOG_LIST, registerDynamicChassis } from '../core/data/tables.js';

/**
 * Сборка боя из сида. Один и тот же сценарий питает браузерную демонстрацию,
 * автобой и батч-прогон баланса — иначе «в симуляции одно, в игре другое».
 */

export interface UnitSpec {
  readonly id: string;
  readonly side: Side;
  readonly chassis: string;
  readonly col: number;
  readonly row: number;
  /** Средний уровень навыков пилота. */
  readonly tier: number;
  readonly origin?: string;
}

export interface ScenarioOptions {
  /** Сид карты: рельеф, биом, старты. Ничего боевого от него не зависит. */
  readonly seed: number;
  /**
   * Сид боя: инициатива, попадания, зоны, криты, пилотирование, свои броски
   * бота (`sim/bot.ts`). Не задан — берётся `seed`, то есть карта и бой
   * связаны, как было до шага 9c (нужно батч-прогону и golden-replay: там
   * сид один и должен полностью определять и карту, и бой).
   *
   * Раздельность нужна интерфейсу: перезапуск боя на той же карте с новым
   * `battleSeed` даёт другую партию (другие броски, другой выбор бота у
   * равноценных клеток), не трогая рельеф — иначе на одном сиде карты
   * автоход всегда воспроизводит один и тот же бой один в один (тот же
   * `masterSeed` → те же именованные потоки ГПСЧ, `core/rng/Rng.ts`).
   */
  readonly battleSeed?: number;
  readonly width?: number;
  readonly height?: number;
  readonly units?: readonly UnitSpec[];
  /**
   * Настройки генератора карты: биом, плотность леса, реки, дороги.
   * Умолчания — умеренный биом, он же эталон замера (шаг 9a, часть E).
   */
  readonly map?: Partial<MapDescriptor>;
  /**
   * Обменять стартовые зоны между сторонами.
   *
   * Пришло на смену `swapStarts`: пока карта была демонстрационной, углы
   * зеркалились правкой координат в описании машин. Теперь стартовые зоны
   * возвращает генератор, и меняться должны они — иначе обмен координат
   * приземляет обе стороны в одну и ту же зону, и батч мерит не перевес угла,
   * а собственную ошибку.
   */
  readonly swapZones?: boolean;
}

/**
 * Зеркальное копьё против копья — эталон для замера правил.
 *
 * Стороны обязаны быть одинаковыми, иначе прогон меряет перевес сценария, а не
 * механику: первый же батч показал 191:9 просто потому, что у одной стороны было
 * на 40 тонн больше. Несимметричные расклады — отдельные сценарии.
 */
export const LANCE_VS_LANCE: readonly UnitSpec[] = [
  { id: 'Копьё-1', side: 'player', chassis: 'IS-H55-R3F2', col: 3, row: 12, tier: 5 },
  { id: 'Копьё-2', side: 'player', chassis: 'IS-H35-R3F1', col: 5, row: 13, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H55-R3F2', col: 11, row: 2, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: 'IS-H35-R3F1', col: 9, row: 1, tier: 4 },
];

/**
 * Клановый эталон — зеркальная пара клан-против-клана, тот же принцип, что и
 * `LANCE_VS_LANCE`, только на клановой техбазе.
 *
 * Кланский перекос — лор, а не ошибка баланса, и его не чинят (decisions.md,
 * 2026-08-26): кланские машины сильнее сферных, и воевать они будут в
 * основном друг с другом. Отсюда следствие для замера — баланс правил
 * проверяется ВНУТРИ техбазы, а прогон «сфера против клана» меряет разницу
 * техбаз, а не правила, и для настройки правил бесполезен.
 *
 * Шасси не хранятся в `chassis.json` руками (там только три учебных сферных):
 * во избежание ручной арифметики брони/структуры (она выводится уравнением
 * массы, а не подбирается — decisions.md, 2026-08-25) машины строятся тем же
 * генератором, что и каталог, но с ФИКСИРОВАННЫМ локальным ГПСЧ и явной ролью
 * `brawler` — той же, что фактически несут `IS-H35-R3F1`/`IS-H55-R3F2`
 * (АС10 + пара средних стволов). Один раз при загрузке модуля, а не на
 * каждый сид: эталон обязан быть одной и той же машиной каждый бой, как и
 * сферный.
 */
const clanReferenceRng = new Rng(80080);

function referenceChassis(catalogCode: string, role: AssemblyRole): string {
  const def = assemblyToChassisDef(generateAssembly({ chassisCode: catalogCode, role }, clanReferenceRng));
  registerDynamicChassis(def);
  return def.id;
}

const CLAN_LIGHT = referenceChassis('CL-H35-R3F1', 'brawler');
const CLAN_MEDIUM = referenceChassis('CL-H55-R3F2', 'brawler');

export const LANCE_VS_LANCE_CLAN: readonly UnitSpec[] = [
  { id: 'Звезда-1', side: 'player', chassis: CLAN_MEDIUM, col: 3, row: 12, tier: 5 },
  { id: 'Звезда-2', side: 'player', chassis: CLAN_LIGHT, col: 5, row: 13, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: CLAN_MEDIUM, col: 11, row: 2, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: CLAN_LIGHT, col: 9, row: 1, tier: 4 },
];

/**
 * Кланы против сферы: 3 клановые машины против 5 сферных.
 *
 * Не замер правил (для этого — `LANCE_VS_LANCE` и `LANCE_VS_LANCE_CLAN`
 * порознь), а замер того, компенсирует ли перевес числом кланское
 * технологическое превосходство — решение пользователя, 2026-08-26. Если
 * перекос остаётся и на пяти сферных, следующий шаг — шесть (тоже решение
 * пользователя, применяется отдельным сценарием при замере, не здесь).
 *
 * Замер на 900 сидов: 602:297 (1 ничья) в пользу клановой стороны — 5 сферных
 * не компенсируют. См. `CLAN_VS_SPHERE_6`.
 */
export const CLAN_VS_SPHERE: readonly UnitSpec[] = [
  { id: 'Звезда-1', side: 'player', chassis: CLAN_MEDIUM, col: 3, row: 12, tier: 5 },
  { id: 'Звезда-2', side: 'player', chassis: CLAN_LIGHT, col: 5, row: 13, tier: 4 },
  { id: 'Звезда-3', side: 'player', chassis: CLAN_MEDIUM, col: 4, row: 11, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H55-R3F2', col: 11, row: 2, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: 'IS-H35-R3F1', col: 9, row: 1, tier: 4 },
  { id: 'Цель-C', side: 'opfor', chassis: 'IS-H55-R3F2', col: 10, row: 3, tier: 4 },
  { id: 'Цель-D', side: 'opfor', chassis: 'IS-H35-R3F1', col: 8, row: 2, tier: 3 },
  { id: 'Цель-E', side: 'opfor', chassis: 'IS-H55-R3F2', col: 9, row: 3, tier: 3 },
];

/**
 * Эскалация `CLAN_VS_SPHERE` до шести сферных машин — пять перекос не
 * компенсировали (602:297 на 900 сидов). Решение пользователя, 2026-08-26.
 */
export const CLAN_VS_SPHERE_6: readonly UnitSpec[] = [
  ...CLAN_VS_SPHERE,
  { id: 'Цель-F', side: 'opfor', chassis: 'IS-H35-R3F1', col: 10, row: 4, tier: 4 },
];

/**
 * Размер карты разведсценария. Отдельная константа, а не число в CLI: карта и
 * расстановка ниже осмысленны только вместе.
 */
export const RECON_MAP_SIZE = 30;

/**
 * Разведка: то же зеркальное копьё, но карта 30×30 и стороны в противоположных
 * углах — 37 гексов между ними при `detection.sensorRange` 20.
 *
 * Зачем отдельный сценарий. На учебной карте 15×15 стороны стоят в 14 гексах
 * друг от друга, сенсорный круг накрывает её целиком, и контакт держится с
 * первого хода: замер шага 8 дал «контакт с хода 1.0» без единого отклонения
 * на 1400 боях, а `new_contacts_opened` — ровный ноль. Ветки «идём вслепую» и
 * «идём к последнему известному месту» (часть D) там недостижимы не потому,
 * что не работают, а потому, что нечего искать. Здесь бой начинается вслепую,
 * контакт добывается ходом — и часть D наконец меряется, а не только тестами.
 *
 * Стороны и машины те же, что в `LANCE_VS_LANCE`: сценарий меряет разведку, а
 * не сборку, и сравнивать его с эталоном должно быть можно.
 */
export const RECON_LANCE: readonly UnitSpec[] = [
  { id: 'Копьё-1', side: 'player', chassis: 'IS-H55-R3F2', col: 3, row: 27, tier: 5 },
  { id: 'Копьё-2', side: 'player', chassis: 'IS-H35-R3F1', col: 5, row: 28, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H55-R3F2', col: 26, row: 2, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: 'IS-H35-R3F1', col: 24, row: 1, tier: 4 },
];

/** Несимметричный расклад для демонстрации: тяжёлый и средний против среднего и лёгкого. */
export const ASYMMETRIC: readonly UnitSpec[] = [
  { id: 'Копьё-1', side: 'player', chassis: 'IS-H55-R3F2', col: 3, row: 12, tier: 5 },
  { id: 'Копьё-2', side: 'player', chassis: 'IS-H35-R3F1', col: 5, row: 13, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H75-R3F3', col: 11, row: 2, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: 'IS-H55-R3F2', col: 9, row: 1, tier: 3 },
];

/**
 * Сшибка накоротке: стороны стартуют в пределах дальности лёгкого оружия.
 *
 * Нужна и для игры (бой начинается сразу, без пяти ходов сближения), и для
 * сквозной проверки в браузере: без неё тест не может выстрелить на первом ходу.
 */
export const SKIRMISH: readonly UnitSpec[] = [
  { id: 'Копьё-1', side: 'player', chassis: 'IS-H55-R3F2', col: 6, row: 9, tier: 5 },
  { id: 'Копьё-2', side: 'player', chassis: 'IS-H35-R3F1', col: 7, row: 10, tier: 4 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H55-R3F2', col: 7, row: 5, tier: 5 },
  { id: 'Цель-B', side: 'opfor', chassis: 'IS-H35-R3F1', col: 8, row: 6, tier: 4 },
];

/** Дуэль: чистый замер правил без взаимного прикрытия. */
export const DUEL: readonly UnitSpec[] = [
  { id: 'Копьё-1', side: 'player', chassis: 'IS-H55-R3F2', col: 3, row: 12, tier: 5 },
  { id: 'Цель-A', side: 'opfor', chassis: 'IS-H55-R3F2', col: 11, row: 2, tier: 5 },
];

/**
 * Смешанный состав крупного отряда: от лёгкой машины до штурмовой.
 *
 * Порядок — по убыванию тоннажа, и он же порядок раздачи: восьмёрка получает
 * первые восемь строк, двенадцатка — первые двенадцать по кругу. Пилоты
 * середняки: замер крупного боя меряет масштаб, а не выучку.
 */
const BIG_FORCE_MIX: readonly { readonly tons: number; readonly tier: number }[] = [
  { tons: 100, tier: 4 },
  { tons: 75, tier: 5 },
  { tons: 55, tier: 4 },
  { tons: 35, tier: 3 },
  { tons: 80, tier: 4 },
  { tons: 65, tier: 4 },
  { tons: 45, tier: 4 },
  { tons: 25, tier: 3 },
  { tons: 90, tier: 4 },
  { tons: 70, tier: 5 },
  { tons: 50, tier: 3 },
  { tons: 30, tier: 3 },
];

/**
 * Зеркальный крупный бой: `perSide` машин с каждой стороны на поле `size`.
 *
 * Нужен шагу 44: до него замер тактики умел ровно копьё на копьё
 * (`LANCE_VS_LANCE`), и утверждать что-либо про бой двенадцати на двенадцать
 * было нечем — а масштаб меняет и длину боя, и цену хода бота.
 *
 * Зеркальность обязательна по той же причине, что и у `LANCE_VS_LANCE`:
 * несимметричный расклад померил бы перевес сценария вместо правил. Стороны
 * стоят блоками в противоположных углах — сближение входит в замер, потому что
 * на большом поле оно и есть половина боя.
 */
export function mirroredForce(perSide: number, size: number, seed = 44): UnitSpec[] {
  if (perSide < 1) throw new RangeError(`Пустая сторона: ${perSide}`);
  const cols = Math.ceil(Math.sqrt(perSide));
  const span = (cols - 1) * 2;
  if (size < span + 6) {
    throw new RangeError(`Поле ${size}×${size} мало для ${perSide} машин на сторону`);
  }

  // Машины строятся тем же генератором, что и каталог, и регистрируются под
  // собственными именами — как в `makeRandomScenario` и клановых эталонах:
  // в `chassis.json` лежат три учебных корпуса, и составить из них роту из
  // двенадцати разных машин нельзя.
  const rng = new Rng(seed);
  const pool = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === 'is');
  const out: UnitSpec[] = [];
  for (let n = 0; n < perSide; n++) {
    const spec = BIG_FORCE_MIX[n % BIG_FORCE_MIX.length] as { tons: number; tier: number };
    const byTons = pool.filter((c) => c.tonnage === spec.tons);
    const entry = rng.pick(byTons.length > 0 ? byTons : pool);
    const def = assemblyToChassisDef(generateAssembly({ chassisCode: entry.code }, rng));
    // Обе стороны берут ОДНУ И ТУ ЖЕ сборку: зеркальность здесь обязательна по
    // той же причине, что у `LANCE_VS_LANCE`.
    const id = `Рота-${size}-${n + 1}~${def.id}`;
    registerDynamicChassis({ ...def, id });

    const dx = (n % cols) * 2;
    const dy = Math.floor(n / cols) * 2;
    out.push({
      id: `Копьё-${n + 1}`,
      side: 'player',
      chassis: id,
      col: 2 + dx,
      row: size - 3 - dy,
      tier: spec.tier,
    });
    out.push({
      id: `Цель-${n + 1}`,
      side: 'opfor',
      chassis: id,
      col: size - 3 - dx,
      row: 2 + dy,
      tier: spec.tier,
    });
  }
  return out;
}

/**
 * Обмен стартовыми углами между сторонами.
 *
 * Демонстрационная карта несимметрична, и юго-западный угол объективно лучше:
 * прогон на 500 боёв дал 265:220, а после обмена углами — 234:256. Перекос шёл
 * за углом, а не за стороной. Чтобы батч мерил правила, а не рельеф, половина
 * прогона идёт с обменянными углами.
 */
export function swapStarts(units: readonly UnitSpec[]): UnitSpec[] {
  const sides = [...new Set(units.map((u) => u.side))].sort();
  if (sides.length !== 2) return [...units];
  const [a, b] = sides as [string, string];

  const bySide = (side: string): UnitSpec[] => units.filter((u) => u.side === side);
  const left = bySide(a);
  const right = bySide(b);

  const swap = (from: readonly UnitSpec[], to: readonly UnitSpec[]): UnitSpec[] =>
    from.map((u, i) => {
      const other = to[Math.min(i, to.length - 1)];
      return other === undefined ? u : { ...u, col: other.col, row: other.row };
    });

  return [...swap(left, right), ...swap(right, left)];
}

/** Сценарии по имени: используется выбором через адресную строку и симулятором. */
export const SCENARIOS: Readonly<Record<string, readonly UnitSpec[]>> = {
  lance: LANCE_VS_LANCE,
  recon: RECON_LANCE,
  lanceClan: LANCE_VS_LANCE_CLAN,
  clanVsSphere: CLAN_VS_SPHERE,
  clanVsSphere6: CLAN_VS_SPHERE_6,
  asym: ASYMMETRIC,
  skirmish: SKIRMISH,
  duel: DUEL,
};

export function scenarioByName(name: string | null): readonly UnitSpec[] {
  return (name !== null ? SCENARIOS[name] : undefined) ?? ASYMMETRIC;
}

/**
 * Карта боя из тех же параметров, что и сам бой. Отдельно от `makeBattle`,
 * потому что слою показа она нужна и до расстановки — чтобы нарисовать
 * подложку и показать метрики генерации.
 */
export function makeMap(opts: ScenarioOptions): GeneratedMap {
  return generateMap(
    describeMap({
      seed: opts.seed,
      width: opts.width ?? 15,
      height: opts.height ?? 15,
      ...(opts.map ?? {}),
    }),
  );
}

export function makeBattle(opts: ScenarioOptions): BattleState {
  const rng = new RngSet(opts.battleSeed ?? opts.seed);
  const generated = makeMap(opts);
  const map = generated.map;
  const state = new BattleState(map, rng);
  state.mapDescriptor = generated.descriptor;

  const specs = opts.units ?? LANCE_VS_LANCE;
  const pilotRng = rng.stream('campaign');

  // Расстановка идёт по стартовым зонам ГЕНЕРАТОРА, а не по координатам из
  // описания сценария: координаты писались под демонстрационную карту 15×15 и
  // на процедурной регулярно приходятся на воду или на скалу. Генератор же
  // обязан вернуть зоны, из каждой из которых есть путь шагом в каждую другую.
  //
  // Координаты в `UnitSpec` при этом не мусор: они задают ПОРЯДОК внутри зоны
  // (кто встанет ближе к её началу) и остаются запасным местом, если зон нет.
  //
  // Сама расстановка вынесена в `core/map/spawn.ts` (шаг 12): мост кампании
  // переиспользует её, не копируя.
  const zoneOrder: readonly [Side, Side] =
    opts.swapZones === true ? ['opfor', 'player'] : ['player', 'opfor'];
  const placements = placeUnits(map, generated, specs, zoneOrder);

  for (const spec of specs) {
    const pilot = makePilot(pilotRng, {
      id: `${spec.id}-пилот`,
      callsign: spec.id,
      tier: spec.tier,
      ...(spec.origin !== undefined ? { origin: spec.origin } : {}),
    });

    const placement = placements.get(spec.id);
    if (placement === undefined) throw new Error(`Нет расстановки для ${spec.id}`);

    const unit: MechUnit = makeUnit({
      id: spec.id,
      side: spec.side,
      chassis: spec.chassis,
      pilot,
      hex: placement.hex,
      // Куда смотреть, решает зона: генератор разворачивает стороны на центр
      // карты. Захардкоженный румб на процедурной карте регулярно оказывался
      // «лицом в край».
      facing: placement.facing,
    });

    state.addUnit(unit);
  }

  state.phase = Phase.Initiative;
  // Знание — часть состояния боя, и его надо завести до первого хода: иначе
  // стороны входят в бой с пустой таблицей контактов и не видят никого.
  refreshContacts(state);
  return state;
}

/**
 * Процедурная генерация случайного копья против копья из 850 шасси каталога (шаг 4).
 */
export function makeRandomScenario(seed: number): ScenarioOptions {
  const rng = new Rng(seed);
  const isCatalog = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === 'is');
  const clanCatalog = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === 'clan');

  const pool = rng.next() < 0.8 ? isCatalog : clanCatalog;

  const targetWeights: WeightClass[] = [
    WeightClass.Light,
    WeightClass.Medium,
    WeightClass.Medium,
    WeightClass.Heavy,
  ];

  const playerPositions = [
    { col: 3, row: 12 },
    { col: 5, row: 13 },
    { col: 4, row: 11 },
    { col: 6, row: 12 },
  ];

  const opforPositions = [
    { col: 11, row: 2 },
    { col: 9, row: 1 },
    { col: 10, row: 3 },
    { col: 8, row: 2 },
  ];

  const units: UnitSpec[] = [];

  for (let i = 0; i < 4; i++) {
    const wc = targetWeights[i]!;
    const wcPool = pool.filter((c) => {
      // Класс — из ядра (шаг 49). Штурмовые идут в тяжёлый слот копья: так
      // эталонный сценарий собирался и до четвёртого класса, и состав замера
      // не поехал вместе с разбивкой.
      const cls = weightClassOf(c.tonnage);
      const entryWc =
        cls === 'light' ? WeightClass.Light : cls === 'medium' ? WeightClass.Medium : WeightClass.Heavy;
      return entryWc === wc;
    });

    const playerEntry = rng.pick(wcPool.length > 0 ? wcPool : pool);
    const opforEntry = rng.pick(wcPool.length > 0 ? wcPool : pool);

    // Каждая сборка регистрируется под уникальным именем. Двум сторонам легко
    // выпадает одно шасси, а генератор навешивает на него РАЗНУЮ комплектацию:
    // под общим именем вторая запись затирала бы первую, и обе машины уходили
    // бы в бой с одной сборкой — замер мерил бы не то, что показывает журнал.
    const playerDef = assemblyToChassisDef(
      generateAssembly({ chassisCode: playerEntry.code }, rng),
    );
    const playerId = `${playerDef.id}~s${seed}p${i}`;
    registerDynamicChassis({ ...playerDef, id: playerId });

    const opforDef = assemblyToChassisDef(
      generateAssembly({ chassisCode: opforEntry.code }, rng),
    );
    const opforId = `${opforDef.id}~s${seed}o${i}`;
    registerDynamicChassis({ ...opforDef, id: opforId });

    const tierP = rng.int(3, 5);
    const tierO = rng.int(3, 5);

    units.push({
      id: `Копьё-${i + 1}`,
      side: 'player',
      chassis: playerId,
      col: playerPositions[i]!.col,
      row: playerPositions[i]!.row,
      tier: tierP,
    });

    units.push({
      id: `Цель-${String.fromCharCode(65 + i)}`,
      side: 'opfor',
      chassis: opforId,
      col: opforPositions[i]!.col,
      row: opforPositions[i]!.row,
      tier: tierO,
    });
  }

  return { seed, units };
}
