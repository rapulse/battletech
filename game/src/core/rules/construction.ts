import {
  CHASSIS_CATALOG,
  COMBAT,
  CONSTRUCTION,
  EQUIPMENT,
  QUALITY,
  WEAPONS,
  type ChassisCatalogEntry,
  type ChassisDef,
  type EquipmentDef,
  type WeaponDef,
} from '../data/index.js';
import type { ZoneId } from '../model/HitZone.js';
import {
  DEFAULT_QUALITY_CLASS,
  STANDARD_QUALITY,
  type MechQuality,
} from '../model/QualityClass.js';
import type { Rng } from '../rng/index.js';
import { hullReserveOf } from './heat.js';

/**
 * Сколько тиров существует. Считается по длине таблиц, а не задаётся числом:
 * шаг 7 сократил каркас с пяти ступеней до трёх, и всё, что знало число «5»
 * наизусть, пришлось бы искать вручную. Число тиров — свойство данных.
 */
export const REACTOR_TIER_COUNT = CONSTRUCTION.reactors.massPercent.is.length;
export const FRAME_TIER_COUNT = CONSTRUCTION.frames.massPercent.length;

/**
 * Тип локомоции: гуманоид и негуманоид (2026-09-10).
 *
 * Ось КОСМЕТИЧЕСКАЯ, и это решение, а не недоделка. Характеристики платформы
 * от локомоции не зависят ни одним числом: масса, ход, слоты, зоны, броня,
 * правила боя и цены считаются одинаково. Заведена она ради того, чтобы у
 * парка были разные силуэты, а не разные правила, — иначе пришлось бы удваивать
 * и таблицы, и замер баланса.
 *
 * Отличие ровно одно: какие тиры каркаса у локомоции существуют
 * (`frames.byLocomotion`). Гуманоид берёт всю шкалу, негуманоид — только
 * облегчённые: рук под орудия у него нет, силовая схема легче, зато теснее по
 * слотам. Реактор по локомоции не ограничен — он покупает подвижность, и
 * урезать его значило бы завести настоящее правило вместо косметики.
 */
export type Locomotion = 'H' | 'N';

/** Все локомоции — источник истины для перебора в генераторе каталога. */
export const LOCOMOTIONS: readonly Locomotion[] = ['H', 'N'];

/**
 * Тиры каркаса, доступные локомоции. Из данных, а не списком здесь.
 *
 * Читается и генератором каталога, и линейкой тиров в мехлабе: игроку нельзя
 * показывать кнопку тира, которого у его шасси не существует.
 */
export function frameTiersFor(locomotion: Locomotion): readonly number[] {
  return CONSTRUCTION.frames.byLocomotion[locomotion];
}

export type AssemblyRole =
  | 'brawler'
  | 'sniper'
  | 'missile_boat'
  | 'skirmisher'
  | 'scout'
  | 'juggernaut';

/** Все роли сборки — источник истины для случайного выбора, когда роль не задана. */
export const ASSEMBLY_ROLES: readonly AssemblyRole[] = [
  'brawler',
  'sniper',
  'missile_boat',
  'skirmisher',
  'scout',
  'juggernaut',
];

export interface MountedItem {
  readonly id: string;
  readonly kind: 'weapon' | 'equipment' | 'heatsink' | 'jump_jet' | 'ammo';
  readonly zone: ZoneId;
  readonly ammo?: number | null;
}

export interface MechAssembly {
  readonly chassisCode: string;
  readonly name?: string;
  /**
   * Класс исполнения реактора и каркаса.
   *
   * Поле СБОРКИ, а не платформы: платформ остаётся 850, умножать каталог на
   * четыре не надо — класс выбирается при сборке, как тоннаж брони. Отсутствие
   * поля означает серийный класс, и это единственное, что сохраняет
   * действительным весь замер баланса Части 1.
   */
  readonly quality?: MechQuality;
  readonly role: AssemblyRole;
  readonly techBase: 'is' | 'clan';
  readonly tonnage: number;
  readonly armorTons: number;
  /**
   * **ПОЛЕ ЗАРЕЗЕРВИРОВАНО И НИ ОДНИМ ПРАВИЛОМ НЕ ЧИТАЕТСЯ.**
   *
   * Броня раскладывается по зонам одной таблицей долей
   * (`assemblyToChassisDef` → `allocateByZone`, `data/construction.json` →
   * `zoneShares`), и перекос «в торс погуще, с ног снять» игроку пока
   * недоступен. Поле объявлено с шага 3 и переживает сохранение (`schema.ts`),
   * но заполнять его бессмысленно: значение будет молча проигнорировано.
   *
   * Чтобы оно заработало, нужны три вещи разом: чтение в `assemblyToChassisDef`
   * (только для брони — структура делится корпусом и перекосу не подлежит),
   * проверка в `validateAssembly` (сумма по зонам равна общему тоннажу, зона не
   * толще удвоенной структуры) и ползунки в мехлабе. Это заметная правка
   * баланса боя, а не удобство показа: живучесть машины зависит от того, где
   * броня стоит, и замер после неё придётся повторить.
   */
  readonly armorZoneAllocation?: Partial<Record<ZoneId, number>>;
  readonly items: readonly MountedItem[];
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly chassisCode: string;
  readonly totalMass: number;
  readonly maxMass: number;
  readonly freeMass: number;
  readonly slotsUsed: Record<ZoneId, number>;
  readonly slotsAvailable: Record<ZoneId, number>;
  readonly heatAlpha: number;
  readonly heatDissipation: number;
  /**
   * Отвод самого реактора, с поправкой класса исполнения. Остальное в
   * `heatDissipation` — навешенные охладители. Мехлаб показывает обе части:
   * игроку важно видеть, что даёт реактор, а что он купил тоннами.
   */
  readonly heatReactor: number;
  /** Запас корпуса по весовому классу (`combat.json → heat.hullReserve`). */
  readonly heatReserve: number;
  /** Предел: отвод + запас. Полный залп выше предела глушит реактор. */
  readonly heatLimit: number;
  /** Залп / предел: выше единицы — полный залп отключит реактор. */
  readonly heatRatio: number;
  readonly totalArmor: number;
  readonly maxArmor: number;
  readonly issues: readonly AssemblyIssue[];
}

/**
 * Виды замечаний валидатора сборки (шаг 52).
 *
 * Ядро отдаёт замечание ДАННЫМИ — видом и параметрами, а в слова его превращает
 * экран (`t('mechlab.issue.*')`), тем же правилом, что `RefitBlocker`. До шага 52
 * здесь собирались русские фразы: перевод игры означал бы правку правил
 * конструирования, а тесты искали в тексте подстроку «Перевес». Параметры —
 * id установок и зон и числа; назвать их словами — тоже дело экрана.
 */
export const ASSEMBLY_ISSUE_KINDS = [
  'unknownItem',
  'zoneNoWeapons',
  'weaponTooBig',
  'zoneDenied',
  'slotOverflow',
  'mixedHeatsinks',
  'tooManyJumpJets',
  'overweight',
  'armorOverMax',
  'ammoTypeUnknown',
  'ammoMissing',
] as const;

export type AssemblyIssueKind = (typeof ASSEMBLY_ISSUE_KINDS)[number];

export interface AssemblyIssue {
  readonly kind: AssemblyIssueKind;
  /** `item` — id установки, `items` — id через запятую, `zone` — id зоны, остальное — числа. */
  readonly params: Readonly<Record<string, string | number>>;
}

const ALL_ZONES: readonly ZoneId[] = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

// --- Уравнение массы ---------------------------------------------------------

/**
 * Платформа: всё, что следует из четвёрки (техбаза, тоннаж, тир реактора, тир
 * каркаса) ещё до навески. Это и есть уравнение массы шага 3:
 *
 *     тоннаж = реактор + каркас + броня + навеска
 *
 * Числа берутся ТОЛЬКО из `data/construction.json`. Здесь нет ни одной
 * зашитой константы сознательно: каталог шасси генерируется офлайн этой
 * же функцией, и разойдись таблицы — расхождение всплыло бы уже в бою.
 */
export interface Platform {
  readonly code: string;
  readonly techBase: TechBase;
  /** Гуманоид или негуманоид. На числа платформы не влияет — только на код. */
  readonly locomotion: Locomotion;
  readonly tonnage: number;
  readonly weightClass: WeightClassId;
  readonly reactorTier: number;
  readonly frameTier: number;
  readonly walkMP: number;
  readonly runMP: number;
  readonly baseHeatDiss: number;
  readonly reactorMass: number;
  readonly frameMass: number;
  /**
   * Масса систем управления: кабина плюс гироскоп с приводами (шаг 31).
   *
   * Отдельным полем, а не внутри `frameMass`, потому что считается иначе:
   * кабина фиксирована, гироскоп — доля тоннажа. Слитые в одно число, они
   * перестали бы объяснять, почему стотонник теряет на системах вчетверо
   * больше двадцатипятитонника.
   */
  readonly systemsMass: number;
  /** Суммарная структура и потолок брони — из них считается раскладка по зонам. */
  readonly totalStructure: number;
  readonly maxArmorPts: number;
  readonly defArmorMass: number;
  /** Свободная масса под навеску при броне по умолчанию. */
  readonly payloadMass: number;
  readonly frameSlotPenalty: number;
  readonly freeSlots: Readonly<Record<ZoneId, number>>;
  readonly freeSlotsTotal: number;
  /** Класс исполнения, с которым платформа посчитана. */
  readonly quality: MechQuality;
  /** Тепло за каждый крит реактора. Свойство машины, а не общая константа. */
  readonly reactorCritHeat: number;
}

export type TechBase = 'is' | 'clan';

/** Тоннаж округляется до четверти тонны: мельче игра не считает. */
function quarter(t: number): number {
  return Math.round(t * 4) / 4;
}

/**
 * Весовые классы робота (шаг 49): четыре, как в каноне BattleTech. Не путать с
 * классом десантного корабля (`dropshipClassSchema`) — слова те же, сущность другая.
 */
export const WEIGHT_CLASS_IDS = ['light', 'medium', 'heavy', 'assault'] as const;
export type WeightClassId = (typeof WEIGHT_CLASS_IDS)[number];

/**
 * Весовой класс по тоннажу: лёгкий 20–35, средний 40–55, тяжёлый 60–75,
 * штурмовой 80–100.
 *
 * ОДНА РАЗБИВКА НА ВСЁ (шаг 49). До него их было три: этот класс на трёх полосах
 * (20–40 / 45–65 / 70–100) вёл таблицу хода и подписи в бою, `roleBandOf` на
 * четырёх раздавал роли генератору, `ui/weightBand.ts` на тех же четырёх
 * подписывал вес и выбирал арт. Теперь ход реактора, роли, прыжковые двигатели,
 * цена на рынке, подписи и картинки читают один класс.
 *
 * Границы — единственное объявление в `construction.json → roles.classBands`
 * (имя ключа историческое). Копия у паковщика арта пришпилена тестом.
 */
export function weightClassOf(tonnage: number): WeightClassId {
  const [a, b, c] = CONSTRUCTION.roles.classBands as [number, number, number];
  if (tonnage <= a) return 'light';
  if (tonnage <= b) return 'medium';
  if (tonnage <= c) return 'heavy';
  return 'assault';
}

export function armorPointsPerTon(techBase: TechBase): number {
  return CONSTRUCTION.armor.pointsPerTon[techBase];
}

/**
 * Свободные слоты зоны: вместимость минус несъёмное минус штраф каркаса.
 * Штраф ложится на торс и руки — туда, где ставят навеску; голова и ноги заняты
 * кокпитом и приводами, отнимать там нечего.
 *
 * Дельта класса исполнения (`slotDelta`) кладётся ЦЕЛИКОМ в торс, а не
 * размазывается той же формулой, что штраф тира. Причина техническая и важная:
 * формула тира округляет в разные стороны (`ceil` для торса, `floor` для рук) и
 * на отрицательном значении дала бы не −2, а −3 слота, а на положительном
 * поехали бы уже посчитанные платформы каталога. Торс — и без того место, где
 * ставят навеску, так что просторный каркас честнее всего читается именно там.
 */
function freeSlotsFor(
  techBase: TechBase,
  frameTier: number,
  slotDelta: number,
): Record<ZoneId, number> {
  const { baseSlots, fixedSlots } = CONSTRUCTION.zones;
  const penalty = CONSTRUCTION.frames.slotPenalty[techBase][frameTier - 1] ?? 0;

  const torsoCut = Math.ceil(penalty * 0.5);
  const armCut = Math.floor(penalty * 0.25);

  return {
    head: baseSlots.head - fixedSlots.head,
    torso: Math.max(0, baseSlots.torso - fixedSlots.torso - torsoCut + slotDelta),
    leftArm: baseSlots.leftArm - fixedSlots.leftArm - armCut,
    rightArm: baseSlots.rightArm - fixedSlots.rightArm - armCut,
    leftLeg: baseSlots.leftLeg - fixedSlots.leftLeg,
    rightLeg: baseSlots.rightLeg - fixedSlots.rightLeg,
  };
}

/**
 * Собрать платформу по четвёрке входов. Бросает, если тир вне 1..5.
 *
 * Пятый вход — класс исполнения — НЕОБЯЗАТЕЛЕН и по умолчанию серийный. Так и
 * задумано: все платформы каталога, эталонные сценарии замера и весь
 * существующий батч-прогон продолжают считаться ровно как раньше, и сравнивать
 * шаг 11 с шагом 5 по-прежнему можно. Класс включается только там, где его
 * явно попросили.
 */
export function makePlatform(
  techBase: TechBase,
  tonnage: number,
  reactorTier: number,
  frameTier: number,
  quality: MechQuality = STANDARD_QUALITY,
  locomotion: Locomotion = 'H',
): Platform {
  if (
    reactorTier < 1 || reactorTier > REACTOR_TIER_COUNT ||
    frameTier < 1 || frameTier > FRAME_TIER_COUNT
  ) {
    throw new RangeError(
      `Тиры вне диапазона R1..R${REACTOR_TIER_COUNT} / F1..F${FRAME_TIER_COUNT}: R${reactorTier}F${frameTier}`,
    );
  }
  if (!frameTiersFor(locomotion).includes(frameTier)) {
    throw new RangeError(
      `Каркас F${frameTier} у локомоции ${locomotion} не существует ` +
        `(есть F${frameTiersFor(locomotion).join(', F')})`,
    );
  }

  const c = CONSTRUCTION;
  const weightClass = weightClassOf(tonnage);
  const qReactor = QUALITY[quality.reactor].reactor;
  const qFrame = QUALITY[quality.frame].frame;

  // Подвижность классом не покупается: она осталась платой за тир реактора и
  // только за него. Иначе класс съел бы вторую ось конструирования целиком.
  const walkMP = c.reactors.walkMP[weightClass][reactorTier - 1]!;
  const runMP = Math.floor(walkMP * c.reactors.runMultiplier);
  const baseHeatDiss = Math.max(
    1,
    c.reactors.baseDissipation[techBase] + qReactor.dissipationDelta,
  );

  const reactorMass = quarter(
    tonnage * c.reactors.massPercent[techBase][reactorTier - 1]! * qReactor.massFactor,
  );
  const frameMass = quarter(tonnage * c.frames.massPercent[frameTier - 1]! * qFrame.massFactor);

  // Кабина и гироскоп классом исполнения не улучшаются и тиром не покупаются:
  // это то, что стоит на любой машине одинаково хорошо. Класс отвечает за
  // реактор и каркас, и растягивать его на кабину значило бы завести третью
  // ось качества, которой в игре нет.
  const systemsMass = quarter(c.systems.cockpitMass + tonnage * c.systems.gyroMassPercent);

  // Структура класса складывается сама с собой, и это известно заранее: потолок
  // брони считается как удвоенная структура, поэтому мастерский каркас
  // поднимает и запас прочности, и потолок защиты. Меряется отдельно
  // (`pnpm qualitystat`), а не считается «как в таблице».
  const totalStructure = Math.round(tonnage * c.structure.perTon * qFrame.structureFactor);
  const maxArmorPts = totalStructure * c.armor.maxPerStructurePoint;

  const ptsPerTon = armorPointsPerTon(techBase);
  const hullMass = reactorMass + frameMass + systemsMass;

  /**
   * Штатная броня — доля потолка, НО не вся навеска до последней тонны
   * (шаг 53, 2026-09-16).
   *
   * Потолок брони равен удвоенной структуре и растёт вместе с
   * `structure.perTon`. У самой лёгкой машины на старшем реакторе (IS-H20-R5F1:
   * реактор берёт 55 % тоннажа) при 1.3 штатная броня съедала навеску до нуля —
   * платформа переставала существовать, вешать на неё было нечего. Порог
   * `minPayloadTons` — правило, а не заплатка под один случай: платформа обязана
   * поднимать хотя бы одно орудие. На вырожденных платформах он срезает штатную
   * броню, на нормальных не срабатывает вовсе.
   */
  const fullDefArmor =
    Math.round(((maxArmorPts * c.armor.defaultFillRatio) / ptsPerTon) * 2) / 2;
  const defArmorCeiling = Math.max(
    0,
    Math.round((tonnage - hullMass - c.armor.minPayloadTons) * 2) / 2,
  );
  const defArmorMass = Math.min(fullDefArmor, defArmorCeiling);

  const payloadMass = quarter(tonnage - (hullMass + defArmorMass));

  const freeSlots = freeSlotsFor(techBase, frameTier, qFrame.slotDelta);
  const prefix = techBase === 'clan' ? 'CL' : 'IS';

  return {
    code: `${prefix}-${locomotion}${tonnage}-R${reactorTier}F${frameTier}`,
    techBase,
    locomotion,
    tonnage,
    weightClass,
    reactorTier,
    frameTier,
    walkMP,
    runMP,
    baseHeatDiss,
    reactorMass,
    frameMass,
    systemsMass,
    totalStructure,
    maxArmorPts,
    defArmorMass,
    payloadMass,
    frameSlotPenalty: c.frames.slotPenalty[techBase][frameTier - 1]!,
    freeSlots,
    freeSlotsTotal: ALL_ZONES.reduce((n, z) => n + freeSlots[z], 0),
    quality,
    reactorCritHeat: qReactor.critHeatPerHit,
  };
}

/**
 * Суффикс класса для имени сборки.
 *
 * Пустой для серийного — иначе все 850 платформ каталога сменили бы имена, и
 * ни одна ссылка на шасси в данных и тестах не сошлась бы. Для остальных
 * классов суффикс обязателен: `registerDynamicChassis` держит ОДНУ глобальную
 * таблицу, и армейская сборка того же шасси иначе затёрла бы серийную (та же
 * ловушка, что обойдена суффиксом `~s{seed}p{i}` в `makeRandomScenario`).
 */
export function qualitySuffix(quality: MechQuality | undefined): string {
  const q = quality ?? STANDARD_QUALITY;
  if (q.reactor === DEFAULT_QUALITY_CLASS && q.frame === DEFAULT_QUALITY_CLASS) return '';
  return `~Q${q.reactor[0]}${q.frame[0]}`;
}

/**
 * Разложить очки (структуры или брони) по зонам одной таблицей долей.
 *
 * Доли — `data/construction.json` → `zoneShares`; правило раскладки и его история
 * (шаг 2 → пересмотр шагом 9e) расписаны там же в `$comment`/`$comment2`. Коротко:
 * торс не трогается ни при какой перебалансировке — в него уходит сквозной урон
 * из разрушенных конечностей, и его запас обязан оставаться самым большим. Руки
 * самые тонкие и отказывают первыми, унося оружие; голова гуще рук, но с шага 9e
 * заметно тоньше торса — редкость разрушения головы (2.4 на 1000 машин при старой
 * раскладке) оказалась избыточной по замеру батч-прогона.
 *
 * Остаток от округления уходит в торс: он и так самый крупный, и там ошибка в
 * очко ни на что не влияет.
 */
export function allocateByZone(total: number): Record<ZoneId, number> {
  const shares = CONSTRUCTION.zoneShares;
  const out = {} as Record<ZoneId, number>;
  let assigned = 0;

  for (const zone of ALL_ZONES) {
    if (zone === 'torso') continue;
    out[zone] = Math.round(total * shares[zone]);
    assigned += out[zone];
  }
  out.torso = total - assigned;
  return out;
}

export function getChassisCatalogEntry(code: string): ChassisCatalogEntry {
  const entry = CHASSIS_CATALOG.get(code);
  if (!entry) {
    throw new RangeError(`Неизвестное шасси в каталоге: ${code}`);
  }
  return entry;
}

/**
 * Валидация сборки меха на соответствие правилам MechLab (масса, слоты, БК, броня).
 */
/**
 * Можно ли ставить эту деталь в эту зону (шаг 31).
 *
 * Возвращает замечание (данными, см. `AssemblyIssue`) или `null`, если всё в порядке. Одна функция на
 * весь проект: её же спрашивает мехлаб, когда подсвечивает годные зоны, и
 * процедурный генератор, когда выбирает, куда смонтировать. Три копии этого
 * правила разошлись бы на первом же новом виде оружия.
 */
export function mountIssue(itemId: string, zone: ZoneId): AssemblyIssue | null {
  const rule = CONSTRUCTION.mountRules.byZone[zone];
  if (rule === undefined) return null;

  const w = WEAPONS.get(itemId);
  if (w !== undefined) {
    if (rule.allowWeaponSlots <= 0) {
      return { kind: 'zoneNoWeapons', params: { zone, item: w.id } };
    }
    if (w.slots > rule.allowWeaponSlots) {
      return { kind: 'weaponTooBig', params: { item: w.id, slots: w.slots, zone, max: rule.allowWeaponSlots } };
    }
    return null;
  }

  const eq = EQUIPMENT.get(itemId);
  if (eq !== undefined && rule.deny.includes(eq.category)) {
    return { kind: 'zoneDenied', params: { zone, item: eq.id } };
  }
  return null;
}

/** Годится ли зона под эту деталь. Обёртка над `mountIssue` для перебора зон. */
export function canMount(itemId: string, zone: ZoneId): boolean {
  return mountIssue(itemId, zone) === null;
}

export function validateAssembly(assembly: MechAssembly): ValidationReport {
  const issues: AssemblyIssue[] = [];
  const chassis = getChassisCatalogEntry(assembly.chassisCode);
  const platform = makePlatform(
    chassis.techBase,
    chassis.tonnage,
    chassis.reactorTier,
    chassis.frameTier,
    assembly.quality ?? STANDARD_QUALITY,
    chassis.locomotion,
  );

  const slotsAvailable: Record<ZoneId, number> = platform.freeSlots;

  const slotsUsed: Record<ZoneId, number> = {
    head: 0,
    torso: 0,
    leftArm: 0,
    rightArm: 0,
    leftLeg: 0,
    rightLeg: 0,
  };

  let itemsMass = 0;
  let heatAlpha = 0;
  let heatDissipation = platform.baseHeatDiss;
  let jumpJetsCount = 0;

  const weaponsOnBoard: WeaponDef[] = [];
  const ammoBoxes: EquipmentDef[] = [];

  for (const item of assembly.items) {
    const w = WEAPONS.get(item.id);
    const eq = EQUIPMENT.get(item.id);

    if (!w && !eq) {
      issues.push({ kind: 'unknownItem', params: { item: item.id, zone: item.zone } });
      continue;
    }

    if (w) {
      weaponsOnBoard.push(w);
      itemsMass += w.mass;
      slotsUsed[item.zone] += w.slots;
      heatAlpha += w.heat;
    } else if (eq) {
      itemsMass += eq.mass;
      slotsUsed[item.zone] += eq.slots;

      if (eq.category === 'heatsink') {
        heatDissipation += eq.heatDissipation ?? 1;
      } else if (eq.category === 'jump_jet') {
        jumpJetsCount += eq.jumpMP ?? 1;
      } else if (eq.category === 'ammo') {
        ammoBoxes.push(eq);
      }
    }
  }

  // Проверка допустимых категорий по зонам (шаг 31). Идёт ПЕРЕД проверкой
  // вместимости намеренно: «в ногу нельзя ставить оружие» — более
  // содержательный ответ, чем «в ноге не хватило ячеек», и игрок должен
  // получить именно его.
  for (const item of assembly.items) {
    const issue = mountIssue(item.id, item.zone);
    if (issue !== null) issues.push(issue);
  }

  // Проверка слотов по зонам
  for (const zone of ALL_ZONES) {
    if (slotsUsed[zone] > slotsAvailable[zone]) {
      issues.push({
        kind: 'slotOverflow',
        params: { zone, used: slotsUsed[zone], available: slotsAvailable[zone] },
      });
    }
  }

  // Охладители одного типа на машину (шаг 32, questions.md п. 7).
  //
  // Канон Total Warfare: одинарные и двойные теплообменники несовместимы по
  // контуру и на одном шасси не стоят. Правило не косметическое — без него
  // выгодной становится смесь «двойные, пока есть три ячейки подряд, дальше
  // одинарные», то есть выбор между ними исчезает: берут оба сразу.
  const sinkIds = new Set(
    assembly.items
      .filter((it) => EQUIPMENT.get(it.id)?.category === 'heatsink')
      .map((it) => it.id),
  );
  if (sinkIds.size > 1) {
    issues.push({ kind: 'mixedHeatsinks', params: { items: [...sinkIds].sort().join(',') } });
  }

  // Проверка прыжковых двигателей
  if (jumpJetsCount > platform.walkMP) {
    issues.push({ kind: 'tooManyJumpJets', params: { count: jumpJetsCount, max: platform.walkMP } });
  }

  // Уравнение массы: тоннаж = реактор + каркас + броня + навеска
  const totalMass =
    platform.reactorMass +
    platform.frameMass +
    platform.systemsMass +
    assembly.armorTons +
    itemsMass;
  const maxMass = platform.tonnage;
  const freeMass = Math.round((maxMass - totalMass) * 100) / 100;

  if (freeMass < -0.01) {
    issues.push({ kind: 'overweight', params: { mass: totalMass.toFixed(2), max: maxMass } });
  }

  // Проверка брони: потолок жёсткий, никаких допусков.
  const totalArmor = Math.round(assembly.armorTons * armorPointsPerTon(chassis.techBase));
  const maxArmor = platform.maxArmorPts;

  if (totalArmor > maxArmor) {
    issues.push({ kind: 'armorOverMax', params: { armor: totalArmor, max: maxArmor } });
  }

  // Проверка БК: у каждого орудия с боезапасом обязана быть пачка на борту.
  // Считать пачкой само орудие нельзя — оно несёт `ammo` как ёмкость магазина,
  // и такая проверка проходила бы всегда, то есть не проверяла бы ничего.
  for (const w of weaponsOnBoard) {
    if (w.ammo === null) continue;
    const ammoId = AMMO_FOR_WEAPON[w.id];
    if (ammoId === undefined) {
      issues.push({ kind: 'ammoTypeUnknown', params: { item: w.id } });
      continue;
    }
    if (!assembly.items.some((it) => it.id === ammoId)) {
      issues.push({ kind: 'ammoMissing', params: { item: w.id } });
    }
  }

  // Отношение считается ЗАЛП / ОТВОД, а не наоборот: «во сколько раз полный
  // залп горячее того, что машина отводит за ход» (`wiki/glossary.md`, сводка
  // машины). Обратный порядок выворачивал и число, и вердикт: холодная машина
  // (залп 14, отвод 16) показывалась как ×1.14 красным, а раскалённая (залп 20,
  // отвод 10) — как ×0.50 зелёным.
  //
  // Машина без оружия даёт 0, а не 1: залп не греет вовсе, и «на грани» —
  // неверное описание такой сборки.
  //
  // С 2026-09-15 знаменатель — ПРЕДЕЛ (отвод + запас корпуса): порог отключения
  // стоит на нём, и «×1.00» читается как «полный залп ровно в край».
  const heatReserve = hullReserveOf(platform.weightClass);
  const heatLimit = heatDissipation + heatReserve;
  const heatRatio =
    heatLimit === 0 ? heatAlpha : Math.round((heatAlpha / heatLimit) * 100) / 100;

  return {
    valid: issues.length === 0,
    chassisCode: chassis.code,
    totalMass,
    maxMass,
    freeMass,
    slotsUsed,
    slotsAvailable,
    heatAlpha,
    heatDissipation,
    heatReactor: platform.baseHeatDiss,
    heatReserve,
    heatLimit,
    heatRatio,
    totalArmor,
    maxArmor,
    issues,
  };
}

export interface GenerateAssemblyOptions {
  readonly chassisCode?: string;
  readonly tonnage?: number;
  readonly techBase?: 'is' | 'clan';
  readonly role?: AssemblyRole;
  readonly name?: string;
  /**
   * Класс исполнения. **Не задан — серийный, и никогда не случайный.**
   *
   * Это предохранитель, а не умолчание для удобства. Генератор не видит цены:
   * дай ему выбирать класс — он всегда возьмёт мастерский, и любой батч-прогон
   * превратится в замер мастерских против мастерских, а эталон баланса уедет
   * вместе с экономикой (`wiki/design/mechs/classification.md` §5, «Что этот
   * выбор ломает»). Класс назначает тот, кто знает бюджет: отряд игрока —
   * ремонтом, отряд противника — таблицей типа части (шаг 16).
   */
  readonly quality?: MechQuality;
  /**
   * Семейство вооружения (`construction.json → weapons.families`, шаг 71b):
   * подменяет пулы главного и вспомогательного калибра роли своими. Роль
   * по-прежнему решает прыжковые двигатели и приборы. Не задано — пулы роли и
   * навески, сборка байт в байт как без семейств.
   */
  readonly family?: string;
}

/**
 * Пулы оружия процедурной сборки — из `data/construction.json → weapons`.
 *
 * До шага 47 обе таблицы были константами прямо здесь. Это балансные ручки, и
 * место им в данных: `CLAUDE.md` и `corridors.md` требуют, чтобы всё, что
 * калибруется замером, лежало в JSON и крутилось без правки кода.
 *
 * **Пулемётов в пулах нет, и это решение, а не упущение** (шаг 30, решение
 * пользователя 2026-09-07). Пулемёт бьёт на ту же ближнюю дистанцию, что малый
 * лазер, наносит меньше урона и не греется вовсе — в игре без пехоты и техники
 * ему просто не по кому стрелять. Ребаланс отвергнут по причине сильнее
 * дисбаланса: сбалансированный пулемёт становится честно малополезным, и тогда
 * генератор начал бы штатно выдавать противнику заведомо слабое оружие. Плохой
 * противник хуже дисбаланса. Тем же решением и по той же причине из пулов
 * исключены IS-AC2 и IS-AC5 (шаг 47).
 *
 * Сами `is_mg`, `cl_mg` и пачка `ammo_mg` из каталогов НЕ удалены: удаление
 * идентификатора сломало бы сохранения и складские записи, где он уже лежит, а
 * платы за неиспользуемое определение никакой.
 */
function primaryTiers(role: AssemblyRole, tech: 'is' | 'clan'): readonly (readonly string[])[] {
  return tiersOf(CONSTRUCTION.weapons.primaryByRole[role]?.[tech] ?? []);
}

function tiersOf(tiers: readonly (string | readonly string[])[]): readonly (readonly string[])[] {
  return tiers.map((t) => (typeof t === 'string' ? [t] : t));
}

/** Семейство вооружения по имени; опечатка — ошибка вызова, а не молчаливые пулы роли. */
function weaponFamily(name: string): (typeof CONSTRUCTION.weapons.families)[string] {
  const f = CONSTRUCTION.weapons.families[name];
  if (f === undefined) throw new RangeError(`Неизвестное семейство вооружения: ${name}`);
  return f;
}


/**
 * Какой охладитель ставит ГЕНЕРАТОР. У игрока в мехлабе выбор остаётся полным.
 *
 * Сфера — только ОДИНАРНЫЙ (решение пользователя 2026-09-10). Выбор делается не
 * по теплу на тонну, а по теплу на ЯЧЕЙКУ, потому что у машины кончается объём,
 * а не вес:
 *
 * | | тонн | ячеек | очков | очков на тонну | очков на ЯЧЕЙКУ |
 * |---|---|---|---|---|---|
 * | IS-SHS | 1 | 1 | 1 | 1.0 | **1.00** |
 * | IS-DHS | 1 | 3 | 2 | 2.0 | 0.67 |
 * | CL-DHS | 1 | 2 | 2 | 2.0 | 1.00 |
 *
 * Двойной охладитель Сферы стоит три ячейки — почти четверть торса стотонника
 * за одну тонну, — и в НОГУ он не влезает вовсе: там свободных ячейки две.
 * Поэтому у сферных машин четыре ножные ячейки простаивали, а снайпер с двумя
 * ППК выходил с залпом в ×2.5 нормы отвода при сорока неистраченных тоннах.
 *
 * У клана двойной охладитель двухъячеечный: он и в ногу влезает, и по объёму не
 * хуже одинарного. Клану менять нечего.
 *
 * Смешивать типы валидатор не даёт (канон Total Warfare), поэтому выбор один на
 * всю машину — и делать его надо по дефицитной валюте, а не по весу.
 */
function generatorSinkId(tech: 'is' | 'clan'): string {
  return tech === 'clan' ? 'cl_dhs' : 'is_shs';
}

/**
 * Веса ролей для машины этого тоннажа — таблица `construction.json → roles`.
 *
 * Столбцы таблицы — весовые классы (`weightClassOf`). До шага 49 здесь жила
 * отдельная «полоса ролей» `roleBandOf` на тех же границах, что и сейчас: она
 * существовала только потому, что весовых классов в ядре было три, а
 * семидесятитонник и стотонник воюют по-разному.
 *
 * С шага 71b у противника роль решает только прыжковые двигатели и приборы —
 * оружие решает семейство по биому (`ForceFamilies`). Доктрины Домов, которые
 * раньше умножали эти веса, сняты шагом 71.
 */
export function roleWeightsFor(tonnage: number): Readonly<Record<AssemblyRole, number>> {
  const band = weightClassOf(tonnage);
  const table = CONSTRUCTION.roles.weightByClass;
  const out = {} as Record<AssemblyRole, number>;
  for (const role of ASSEMBLY_ROLES) out[role] = table[role]?.[band] ?? 1;
  return out;
}

/** Группа биома (`roles.biomeGroups`, шаг 71); неизвестный биом — без группы. */
export function biomeGroupOf(biome: string): string | undefined {
  for (const [group, list] of Object.entries(CONSTRUCTION.roles.biomeGroups)) {
    if (list.includes(biome)) return group;
  }
  return undefined;
}


/**
 * Веса семейств вооружения для машины на этом биоме (`roles.familyByBiome`,
 * шаг 71b); пусто — биом не задан, группы нет или таблица пуста, и машина
 * собирается по ролям.
 */
export function familyWeightsFor(tonnage: number, tech: 'is' | 'clan', biome?: string): Readonly<Record<string, number>> {
  const group = biome === undefined ? undefined : biomeGroupOf(biome);
  if (group === undefined) return {};
  return CONSTRUCTION.roles.familyByBiome[group]?.[`${tech}.${weightClassOf(tonnage)}`] ?? {};
}

/** Сколько машин семейства пускает состав из `count` машин (`roles.familyMaxShare`). */
export function familyCap(family: string, count: number): number {
  const share = CONSTRUCTION.roles.familyMaxShare[family];
  return share === undefined ? Infinity : Math.max(1, Math.floor(count * share));
}

/**
 * Жребий семейств вооружения на один состав (шаг 71b) — единственное место, где
 * он живёт: его зовут и сборка сил кампании (`opfor.ts::buildForce`), и турнир
 * `pnpm familystat`, чтобы турнир мерил ровно то, что выходит в игре.
 *
 * 1. **Специалисты звена** (`roles.familySpecialists`): состав от четырёх машин
 *    получает на каждые четыре столько-то машин заданного семейства — первыми,
 *    без жребия. Звено — это роли, а не четыре одинаково «средних» машины.
 * 2. Остальные тянут семейство по весам группы биома, техбазы и класса
 *    (`roles.familyByBiome`); семейство, упёршееся в потолок доли
 *    (`roles.familyMaxShare`), из жребия выпадает.
 *
 * Биом не задан или таблицы для группы нет — `next` отдаёт `undefined` и ГПСЧ не
 * трогает: машина собирается по ролям, как до шага.
 */
export class ForceFamilies {
  private readonly group: string | undefined;
  private readonly taken = new Map<string, number>();
  private readonly forced: string[] = [];

  constructor(
    private readonly count: number,
    private readonly tech: 'is' | 'clan',
    biome: string | undefined,
  ) {
    this.group = biome === undefined ? undefined : biomeGroupOf(biome);
    const spec = this.group === undefined ? undefined : CONSTRUCTION.roles.familySpecialists[this.group];
    if (spec !== undefined && count >= 4) {
      const lances = Math.floor(count / 4);
      for (const [family, perLance] of Object.entries(spec)) {
        for (let i = 0; i < perLance * lances; i++) this.forced.push(family);
      }
    }
  }

  next(tonnage: number, rng: Rng): string | undefined {
    if (this.group === undefined) return undefined;
    const weights = CONSTRUCTION.roles.familyByBiome[this.group]?.[`${this.tech}.${weightClassOf(tonnage)}`];
    if (weights === undefined) return undefined;
    let family = this.forced.shift();
    if (family === undefined) {
      const keys = Object.keys(weights).filter(
        (f) => (weights[f] ?? 0) > 0 && (this.taken.get(f) ?? 0) < familyCap(f, this.count),
      );
      if (keys.length === 0) return undefined;
      let roll = rng.next() * keys.reduce((sum, f) => sum + weights[f]!, 0);
      family = keys.find((f) => (roll -= weights[f]!) <= 0) ?? keys[keys.length - 1]!;
    }
    this.taken.set(family, (this.taken.get(family) ?? 0) + 1);
    return family;
  }
}

/** Жребий роли, взвешенный по весовому классу машины. */
export function pickWeightedRole(tonnage: number, rng: Rng): AssemblyRole {
  const weights = roleWeightsFor(tonnage);
  let total = 0;
  for (const role of ASSEMBLY_ROLES) total += weights[role];
  if (total <= 0) return rng.pick(ASSEMBLY_ROLES);
  let roll = rng.next() * total;
  for (const role of ASSEMBLY_ROLES) {
    roll -= weights[role];
    if (roll <= 0) return role;
  }
  return ASSEMBLY_ROLES[ASSEMBLY_ROLES.length - 1]!;
}

/**
 * Пул вспомогательного оружия по СВОБОДНОЙ НАВЕСКЕ, а не по тоннажу.
 *
 * Тоннаж обманывает: стотонник на реакторе R5 несёт 15 тонн навески, полтинник
 * на R1 — 25. По классу первому достался бы гаусс, который в него не влезает, а
 * второму — малый лазер, которым он не наполнится. Решает то, что машина
 * реально может поднять.
 */
function secondaryPool(freePayload: number, tech: 'is' | 'clan'): readonly string[] {
  const { payloadBands, secondaryByPayload } = CONSTRUCTION.weapons;
  const band =
    freePayload <= payloadBands[0]!
      ? secondaryByPayload.small
      : freePayload <= payloadBands[1]!
        ? secondaryByPayload.medium
        : freePayload <= payloadBands[2]!
          ? secondaryByPayload.large
          : secondaryByPayload.huge;
  return band[tech];
}

/**
 * Сколько ВЫСТРЕЛОВ пачки съедает один залп орудия.
 *
 * Боезапас считается ВЫСТРЕЛАМИ, а не снарядами, и это две разные величины,
 * которые до 2026-09-16 молча путались между собой:
 *
 * - `weapon.shots` — сколько снарядов летит за один выстрел. У ракетной связки
 *   это ракеты в залпе (РДД-20 — двадцать), у пушки — один снаряд;
 * - `equipment.shots` (и `weapon.ammo`) — сколько ВЫСТРЕЛОВ в тонне. Числа
 *   каноничные: тонна РДД-20 это шесть залпов, тонна РБД-6 — пятнадцать.
 *
 * Бой вычитал из пула `weapon.shots`, то есть тратил на один залп столько
 * выстрелов, сколько в связке ракет. РДД-20 съедала всю тонну за один залп и
 * дальше молчала весь бой, РДД-15 хватало на два, РБД-6 — на три. Генератор при
 * этом считал БК правильно (`ammoVolleys` залпов) и был уверен, что снарядил
 * машину на весь бой. Замер до правки: у 68 % процедурных сборок самый голодный
 * ствол сох за три залпа.
 *
 * Кластерное оружие тратит один выстрел: связка ракет уходит целиком. Сдвоенный
 * огонь Ultra AC — не кластер, и два снаряда за залп он ест по канону, поэтому
 * правило смотрит на `cluster`, а не на число снарядов.
 */
export function ammoPerVolley(w: Pick<WeaponDef, 'shots' | 'cluster'>): number {
  return w.cluster ? 1 : Math.max(1, w.shots);
}

export const AMMO_FOR_WEAPON: Record<string, string> = {
  is_mg: 'ammo_mg',
  cl_mg: 'ammo_mg',
  is_ac2: 'ammo_ac2',
  is_ac5: 'ammo_ac5',
  cl_uac5: 'ammo_ac5',
  is_ac10: 'ammo_ac10',
  cl_uac10: 'ammo_ac10',
  is_ac20: 'ammo_ac20',
  cl_uac20: 'ammo_ac20',
  is_gauss: 'ammo_gauss',
  cl_gauss: 'ammo_gauss',
  is_srm2: 'ammo_srm2',
  is_srm4: 'ammo_srm4',
  cl_srm4: 'ammo_srm4',
  is_srm6: 'ammo_srm6',
  cl_srm6: 'ammo_srm6',
  is_lrm5: 'ammo_lrm5',
  is_lrm10: 'ammo_lrm10',
  cl_lrm10: 'ammo_lrm10',
  is_lrm15: 'ammo_lrm15',
  cl_lrm15: 'ammo_lrm15',
  is_lrm20: 'ammo_lrm20',
  cl_lrm20: 'ammo_lrm20',
};

/**
 * Процедурный генератор сборки робота под заданную тактическую роль.
 */
export function generateAssembly(opts: GenerateAssemblyOptions, rng: Rng): MechAssembly {
  let chassis: ChassisCatalogEntry;

  if (opts.chassisCode) {
    chassis = getChassisCatalogEntry(opts.chassisCode);
  } else {
    const tech = opts.techBase ?? rng.pick(['is', 'clan'] as const);
    const tonnage = opts.tonnage ?? 55;
    const candidates = Array.from(CHASSIS_CATALOG.values()).filter(
      (c) => c.techBase === tech && c.tonnage === tonnage,
    );
    if (candidates.length === 0) {
      throw new RangeError(`В каталоге нет шасси: техбаза ${tech}, тоннаж ${tonnage} т`);
    }
    chassis = rng.pick(candidates);
  }

  // Роль не задана — тянется жребием, ВЗВЕШЕННЫМ по весовому классу
  // (`construction.json → roles`, шаг 47).
  //
  // История этой строки — две крайности. Сперва вес класса решал роль жёстко
  // (лёгкий и средний — всегда brawler, тяжёлый — всегда juggernaut), и
  // прыжковые двигатели, которые ставятся только skirmisher и scout, в
  // процедурной генерации не появлялись никогда: ни одна случайная машина не
  // прыгала (шаг 6, часть C). Лекарством стал равномерный жребий из шести
  // ролей — и оно оказалось шире болезни: стотонник выходил разведчиком, а у
  // роли scout главный калибр малый лазер.
  //
  // Середина: вес не РЕШАЕТ роль, а ВЗВЕШИВАЕТ её. Нулей в таблице нет, поэтому
  // ни одно сочетание не запрещено — странная машина остаётся редкостью.
  const role: AssemblyRole = opts.role ?? pickWeightedRole(chassis.tonnage, rng);
  const tech = chassis.techBase;
  // Пулы этой сборки: семейства (шаг 71b), если задано, иначе роли и навески.
  const family = opts.family === undefined ? undefined : weaponFamily(opts.family);
  const myPrimaryTiers = family === undefined ? primaryTiers(role, tech) : tiersOf(family.primary[tech]);
  const myPrimaryPool = myPrimaryTiers.flat();

  const platform = makePlatform(
    chassis.techBase,
    chassis.tonnage,
    chassis.reactorTier,
    chassis.frameTier,
    opts.quality ?? STANDARD_QUALITY,
    chassis.locomotion,
  );

  const items: MountedItem[] = [];
  let remainingPayload = platform.payloadMass;

  const slotsRemaining: Record<ZoneId, number> = { ...platform.freeSlots };

  const tryMount = (itemId: string, preferredZones: readonly ZoneId[]): boolean => {
    const w = WEAPONS.get(itemId);
    const eq = EQUIPMENT.get(itemId);
    const mass = w?.mass ?? eq?.mass ?? 0;
    const slots = w?.slots ?? eq?.slots ?? 0;

    if (mass > remainingPayload) return false;

    for (const zone of preferredZones) {
      // Генератор подчиняется тому же правилу зон, что и валидатор (шаг 31):
      // иначе он породил бы машины, которые сам же валидатор отвергает, и
      // каталог перестал бы быть годным.
      if (!canMount(itemId, zone)) continue;
      if (slotsRemaining[zone] >= slots) {
        slotsRemaining[zone] -= slots;
        remainingPayload -= mass;
        const kind = w
          ? 'weapon'
          : eq?.category === 'heatsink'
            ? 'heatsink'
            : eq?.category === 'jump_jet'
              ? 'jump_jet'
              : eq?.category === 'ammo'
                ? 'ammo'
                : 'equipment';

        items.push({ id: itemId, kind, zone, ammo: w?.ammo ?? null });
        return true;
      }
    }
    return false;
  };

  /** Влезет ли деталь хоть в одну из зон по ячейкам и правилам. Ничего не меняет. */
  const fitsSomewhere = (
    itemId: string,
    zones: readonly ZoneId[],
    slots: Readonly<Record<ZoneId, number>>,
  ): boolean => {
    const need = EQUIPMENT.get(itemId)?.slots ?? WEAPONS.get(itemId)?.slots ?? 0;
    return zones.some((z) => canMount(itemId, z) && slots[z] >= need);
  };

  /** Снять последнюю установку, вернув её массу и слоты. */
  const unmountLast = (): void => {
    const it = items.pop();
    if (it === undefined) return;
    const d = WEAPONS.get(it.id) ?? EQUIPMENT.get(it.id);
    if (d === undefined) return;
    slotsRemaining[it.zone] += d.slots;
    remainingPayload += d.mass;
  };

  /**
   * Куда идёт боезапас: НОГИ ПЕРВЫМИ, торс и руки последними.
   *
   * Порядок был обратным, и это стоило машине половины вооружения. Оружие
   * ставится только в торс, руки и голову (`mountRules`), а пачки и охладители
   * лезут куда угодно — и занимали они ровно те ячейки, которые единственные и
   * годились под ствол. У стотонника торс и обе руки выходили забиты под ноль
   * при четырёх пустых ячейках в ногах и шестнадцати неистраченных тоннах: на
   * пушку не осталось места, хотя вес на неё был. Ноги под боезапас и
   * охладители и отведены — так их прячут и в каноне.
   */
  const AMMO_ZONES: readonly ZoneId[] = ['leftLeg', 'rightLeg', 'torso', 'leftArm', 'rightArm'];

  /**
   * Сколько пачек боезапаса нужно орудию на норму залпов (`ammoVolleys`).
   *
   * Энергетическому — ноль: ему боезапас не нужен вовсе.
   *
   * Расход залпа берётся у `ammoPerVolley`, а не считается равным единице:
   * сдвоенный огонь Ultra AC съедает два выстрела за раз, и на норму ему нужно
   * вдвое больше тонн. Без этой поправки КЛ-САП/20 выходила с восемью залпами
   * вместо двенадцати.
   */
  const ammoTonsFor = (weaponId: string): number => {
    const ammoId = AMMO_FOR_WEAPON[weaponId];
    if (ammoId === undefined) return 0;
    const shots = EQUIPMENT.get(ammoId)?.shots ?? 0;
    if (shots <= 0) return 1;
    const w = WEAPONS.get(weaponId);
    const perVolley = w === undefined ? 1 : ammoPerVolley(w);
    return Math.max(1, Math.ceil((CONSTRUCTION.weapons.ammoVolleys * perVolley) / shots));
  };

  /**
   * Поставить оружие вместе с боекомплектом — или не ставить вовсе.
   *
   * Орудие без пачки бракуется валидатором и просто съедает тонны: генератор
   * обязан либо уместить пару целиком, либо отступить. Раньше это проходило
   * незамеченным, потому что проверка БК считала пачкой само орудие.
   */
  const tryMountFed = (weaponId: string, zones: readonly ZoneId[]): boolean => {
    if (!tryMount(weaponId, zones)) return false;

    const ammoId = AMMO_FOR_WEAPON[weaponId];
    if (ammoId === undefined) return true;

    if (!tryMount(ammoId, AMMO_ZONES)) {
      unmountLast();
      return false;
    }

    // Сколько ПАЧЕК нужно на норму залпов — по ёмкости самой пачки, а не по
    // прежнему правилу «крупной баллистике плюс одна». Правило было грубым:
    // АП/20 получала десять залпов, а РДД-20 — шесть, и сохла к шестому ходу.
    for (let i = 1; i < ammoTonsFor(weaponId); i++) tryMount(ammoId, AMMO_ZONES);
    return true;
  };

  // 1. Установка главного калибра.
  //
  // Орудие ставится ПОВТОРНО, пока платформа его держит (шаг 47). До этого шага
  // цикл обрывался на первом удачном стволе, и два ППК, две АП/5 или две РДД-20
  // на тяжёлой машине были невозможны в принципе — канон и здравый смысл против
  // одной строки `break`. Остаток тоннажа после единственного орудия уходил в
  // мелочь, и именно так стотонник выходил с малыми лазерами.
  //
  // Порог `mass > remainingPayload * 0.7` остаётся только для ПЕРВОГО ствола:
  // он защищает от машины, у которой одно орудие съело всю навеску. Для второго
  // он бессмыслен — там уже решают резервы брони и охлаждения.
  /**
   * ПОРОГ ДАЛЬНОСТИ по весовому классу (шаг 54, 2026-09-16).
   *
   * У генератора была только плотность — тонн на ячейку, — и она отсеивает
   * лёгкое, но не отсеивает КОРОТКОЕ. Малый лазер бьёт на пять гексов при
   * средней дистанции боя 5.6: на средней и тяжёлой машине он занимает тонну с
   * ячейкой и молчит весь бой. В пулах он стоит только в лёгкой полосе, а на
   * крупные машины попадал через ЗАПАСНОЙ набор — тот берётся лёгким пулом без
   * оглядки на дальность, когда из своего пула не лезет уже ничего.
   *
   * Порог держит и главный калибр, и вспомогательный, и запасной набор. К
   * последнему рубежу (п. 4b) он НЕ применяется: машине без единого ствола
   * любой ствол лучше никакого. Лёгким порог нулевой — для двадцатитонника
   * малый лазер нормальное оружие.
   */
  const minLong = CONSTRUCTION.weapons.minLongByClass[platform.weightClass] ?? 0;
  const reaches = (id: string): boolean => (WEAPONS.get(id)?.long ?? 0) >= minLong;

  // Главный калибр — из ПЕРВОЙ СТУПЕНИ пула, где что-то помещается: порядок
  // ступеней в `construction.json → primaryByRole` и есть приоритет роли
  // (ракетному — РДД-20 первой, юггернауту — АП/20). Внутри ступени — равный
  // жребий (шаг 71): до него пул был плоским списком, и гаусс, стоявший у
  // снайпера и юггернаута вторым после ствола легче себя, почти не встречался.
  //
  // Ступень из одного ствола жребия не бросает, и пул из одиночных ступеней
  // даёт ровно прежнее «первый подходящий» — откат делается данными.
  //
  // Жребий по массе (шаг 66a) пробовали и откатили 2026-09-23: он ломал роли,
  // где порядок задуман (ракетный с 3×РДД-5, застрельщик с уроном 52 вместо 82).
  const maxPrimary = CONSTRUCTION.weapons.maxPrimary;
  let primaryId: string | undefined;
  for (const tier of myPrimaryTiers) {
    const candidates = tier.filter((id) => {
      const w = WEAPONS.get(id);
      return w !== undefined && reaches(id) && w.mass <= remainingPayload * 0.7;
    });
    while (candidates.length > 0 && primaryId === undefined) {
      const pick = candidates.length === 1 ? 0 : rng.int(0, candidates.length - 1);
      const pId = candidates.splice(pick, 1)[0]!;
      if (tryMountFed(pId, ['rightArm', 'torso', 'leftArm'])) primaryId = pId;
    }
    if (primaryId !== undefined) break;
  }

  // 2. Установка прыжковых двигателей для мобильных ролей
  if (role === 'skirmisher' || role === 'scout') {
    // Типоразмер двигателя — по весовому классу, а не по числам в коде (шаг 49):
    // штурмовой берёт тяжёлый, отдельного штурмового двигателя в данных нет.
    const jjId = ({ light: 'jj_light', medium: 'jj_med', heavy: 'jj_hvy', assault: 'jj_hvy' } as const)[
      weightClassOf(chassis.tonnage)
    ];
    const desiredJJ = Math.min(platform.walkMP, 3);
    for (let i = 0; i < desiredJJ; i++) {
      tryMount(jjId, ['leftLeg', 'rightLeg', 'torso']);
    }
  }

  // 3. Электроника по роли.
  //
  // Ставится ДО вспомогательного вооружения: иначе свободные тонны уходят в
  // очередной лазер, и приборы не появляются никогда. Ровно эта ошибка в
  // шаге 6 оставила каталог без прыжковых двигателей — правило было верным, а
  // жребий до него не доходил.
  //
  // Роль решает, что именно: разведчик несёт пробник, потому что искать — его
  // работа; застрельщик и разведчик — ЭПП, потому что уходить от опознания им
  // нужнее всех. Снайперу доставался прицельный компьютер — прибор снят
  // (см. decisions.md, 2026-08-26).
  const ELECTRONICS_BY_ROLE: Partial<Record<AssemblyRole, readonly string[]>> = {
    scout: tech === 'clan' ? ['cl_bap', 'cl_ecm'] : ['is_bap', 'is_ecm'],
    skirmisher: tech === 'clan' ? ['cl_ecm'] : ['is_ecm'],
  };
  for (const eqId of ELECTRONICS_BY_ROLE[role] ?? []) {
    tryMount(eqId, ['torso', 'head', 'leftArm', 'rightArm']);
  }

  // 3b. Повторные стволы главного калибра.
  //
  // Ставятся после прыжковых двигателей и приборов и до вспомогательного
  // оружия: приборы роли обязаны получить свои тонны раньше, чем их съест
  // очередная пушка (ровно эта ошибка в шаге 6 оставила каталог без прыжковых
  // двигателей), а вспомогательное — это добор остатка, и ему очередь последняя.
  //
  // Резервы те же, что у вспомогательного набора: броня до потолка корпуса и
  // охладители под уже набранный залп, в тоннах и в ячейках сразу.
  if (primaryId !== undefined && maxPrimary > 1) {
    const pw = WEAPONS.get(primaryId)!;
    const pAmmo = AMMO_FOR_WEAPON[primaryId];
    const pAmmoDef = pAmmo === undefined ? undefined : EQUIPMENT.get(pAmmo);
    // Пачек может быть несколько (`ammoVolleys`) — резерв обязан считать все,
    // иначе он обманывает сам себя ровно на боекомплект.
    const pAmmoTons = ammoTonsFor(primaryId);
    const pMass = pw.mass + (pAmmoDef?.mass ?? 0) * pAmmoTons;
    const pSlots = pw.slots + (pAmmoDef?.slots ?? 0) * pAmmoTons;

    const ptsPerTonPre = armorPointsPerTon(tech);
    const maxArmorPre = Math.floor((platform.maxArmorPts / ptsPerTonPre) * 4) / 4;
    const armorReservePre = Math.max(0, maxArmorPre - platform.defArmorMass);
    const sinkZonesPre: readonly ZoneId[] = [
      'leftLeg',
      'rightLeg',
      'head',
      'torso',
      'leftArm',
      'rightArm',
    ];
    const sinkPre = generatorSinkId(tech);
    const sinkPtsPre = EQUIPMENT.get(sinkPre)?.heatDissipation ?? 1;
    const sinkSlotsPre = EQUIPMENT.get(sinkPre)?.slots ?? 1;
    const alphaTargetPre = CONSTRUCTION.reactors.alphaHeatTarget;
    const reservePre = hullReserveOf(platform.weightClass);

    for (let n = 1; n < maxPrimary; n++) {
      let heat = pw.heat;
      for (const it of items) heat += WEAPONS.get(it.id)?.heat ?? 0;
      const needSinks = Math.max(
        0,
        Math.ceil(((heat - reservePre) / alphaTargetPre - platform.baseHeatDiss) / sinkPtsPre),
      );
      const freeSinkPre = sinkZonesPre.reduce((sum, z) => sum + slotsRemaining[z], 0);
      if (pMass > remainingPayload - armorReservePre - needSinks) break;
      if (pSlots > freeSinkPre - needSinks * sinkSlotsPre) break;

      if (!tryMountFed(primaryId, ['leftArm', 'torso', 'rightArm'])) break;
    }
  }

  // 4. Установка вспомогательного вооружения.
  //
  // Раньше здесь стоял счётчик из шести ПОПЫТОК (шаг 3, первая версия
  // конструктора), и он же был единственным ограничителем. Считались именно
  // попытки, а не поставленные стволы: жребий, вытянувший слишком тяжёлое
  // орудие или не нашедший ячеек, тратил попытку впустую. Тяжёлые машины
  // упирались в этот счётчик раньше, чем в тоннаж или объём, и выходили с поля
  // недогруженными: у кланового стотонника оставалось 34 тонны и 15 ячеек из
  // 35 — половина машины впустую (замер шага 46c).
  //
  // Стало: ставим, пока есть во что и куда, — но не съедая ни брони, ни
  // охлаждения. Резерв держится по двум статьям:
  //   - `armorReserve` — тонны, которых броне не хватает до потолка корпуса.
  //     Без него оружие сожрало бы защиту, и вместо недогруженной машины
  //     получилась бы бумажная;
  //   - охладители под уже набранный залп по норме `alphaHeatTarget`: орудие,
  //     которое нечем остудить, стрелять всё равно не будет.
  // Всё сверх этих двух статей — законная добыча вооружения.
  const genPtsPerTon = armorPointsPerTon(tech);
  const genMaxArmorTons = Math.floor((platform.maxArmorPts / genPtsPerTon) * 4) / 4;
  const armorReserve = Math.max(0, genMaxArmorTons - platform.defArmorMass);

  // Пул выбирается по тому, сколько машина вообще может поднять оружия: вся
  // навеска минус полная броня. Величина платформы, а не текущего состояния, —
  // иначе пул мельчал бы по ходу набора и стотонник снова добирал бы мелочью.
  const freePayload = platform.payloadMass + platform.defArmorMass - genMaxArmorTons;
  const secondaries = (family === undefined ? secondaryPool(freePayload, tech) : family.secondary[tech]).filter(reaches);
  const fallbackSecondaries = secondaryPool(0, tech).filter(reaches);

  // Тот же порядок и по той же причине, что у боезапаса: ноги первыми.
  // ГОЛОВА в списке есть, и она идёт сразу за ногами (решение пользователя
  // 2026-09-10). Правила зон охладитель туда пускали всегда — не пускал
  // генератор, и три ячейки кокпита простаивали на каждой машине. Оружия крупнее
  // одной ячейки голова не берёт, а до одноячеечного очередь там доходит редко:
  // в порядке установки оружия голова стоит последней.
  const sinkZonesGen: readonly ZoneId[] = [
    'leftLeg',
    'rightLeg',
    'head',
    'torso',
    'leftArm',
    'rightArm',
  ];
  const sinkIdGen = generatorSinkId(tech);
  const sinkPointsGen = EQUIPMENT.get(sinkIdGen)?.heatDissipation ?? 1;
  const alphaTargetGen = CONSTRUCTION.reactors.alphaHeatTarget;
  // Запас корпуса по классу (`combat.json → heat.hullReserve`) идёт сверх нормы:
  // залп стоковой машины упирается в предел, а не в отвод (2026-09-15).
  const reserveGen = hullReserveOf(platform.weightClass);

  const sinkSlotsGen = EQUIPMENT.get(sinkIdGen)?.slots ?? 1;

  /**
   * Сколько охладителей потребует залп с добавленным орудием — в штуках.
   *
   * Резерв считается и в тоннах, и в ЯЧЕЙКАХ. Тонн мало: у кланового
   * стотонника оружие занимало объём, охладители потом не помещались, тонны
   * под них так и оставались неистраченными, а машина выходила с залпом в
   * шесть норм отвода. Место под охлаждение надо держать вместе с весом.
   */
  const sinksNeededWith = (extraHeat: number): number => {
    let heat = extraHeat;
    for (const it of items) heat += WEAPONS.get(it.id)?.heat ?? 0;
    const need = (heat - reserveGen) / alphaTargetGen - platform.baseHeatDiss;
    return need <= 0 ? 0 : Math.ceil(need / sinkPointsGen);
  };

  /** Свободные ячейки в зонах, куда вообще идут охладители. */
  const freeSinkSlots = (): number =>
    sinkZonesGen.reduce((sum, z) => sum + slotsRemaining[z], 0);

  // Сколько неудачных жребиев подряд считать концом набора. Жребий тянет из
  // списка вспомогательных орудий роли, и отказ значит «вот это не влезло», а
  // не «место кончилось»: одного отказа мало, чтобы остановиться.
  /**
   * Требуемая плотность навески — тонн на ячейку.
   *
   * Величина, об которую машина упирается на самом деле: **тоннаж кончается
   * позже объёма**. Малый лазер стоит 0.5 т за ячейку, большой импульсный —
   * 3.5; стволу с боезапасом ячейка пачки считается вместе с ним. Штурмовику
   * надо потратить около 1.3 т на каждую ячейку, лёгкому — 0.3, а до шага 47
   * генератор ставил ровно 1.0 при любом весе — отсюда и семнадцать
   * неистраченных тонн у стотонника при забитом торсе (замер `loadoutstat`).
   *
   * Считается заново на каждом жребии: чем плотнее уже поставленное, тем ниже
   * планка для следующего ствола, и набор сходится сам.
   */
  const neededDensity = (): number => {
    const tons = remainingPayload - armorReserve;
    const slots = freeSinkSlots();
    return slots <= 0 || tons <= 0 ? 0 : tons / slots;
  };
  const densityFactor = CONSTRUCTION.weapons.densityFactor;

  /**
   * Помещается ли орудие вместе со своим боезапасом и охлаждением под него.
   *
   * Резерв держится в ДВУХ валютах сразу. Тонн мало: у кланового стотонника
   * оружие занимало объём, охладители потом не помещались, тонны под них так и
   * оставались неистраченными, а машина выходила с залпом в шесть норм отвода.
   */
  const secondaryFits = (id: string, checkDensity: boolean): boolean => {
    const w = WEAPONS.get(id);
    if (w === undefined) return false;

    const ammoId = AMMO_FOR_WEAPON[id];
    const ammoDef = ammoId === undefined ? undefined : EQUIPMENT.get(ammoId);
    const ammoTons = ammoTonsFor(id);
    const wMass = w.mass + (ammoDef?.mass ?? 0) * ammoTons;
    const wSlots = w.slots + (ammoDef?.slots ?? 0) * ammoTons;

    if (checkDensity && wMass / wSlots < neededDensity() * densityFactor) return false;

    const sinks = sinksNeededWith(w.heat);
    if (wMass > remainingPayload - armorReserve - sinks) return false;
    if (wSlots > freeSinkSlots() - sinks * sinkSlotsGen) return false;
    return fitsSomewhere(id, ['leftArm', 'torso', 'rightArm', 'head'], slotsRemaining);
  };

  // Набор идёт ВЫБОРОМ ИЗ ГОДНОГО, а не жребием вслепую с отбраковкой.
  //
  // Раньше здесь стоял счётчик неудачных попыток: жребий тянул орудие из
  // плоского списка, и попытка, вытянувшая слишком тяжёлое или слишком горячее,
  // тратилась впустую. Пока список состоял из четырёх самых лёгких стволов, это
  // почти не мешало — там всё влезало. С пулами по классу мешает сразу: у
  // стотонника половина пула горячая, двенадцать попыток уходят на отказы, и
  // машина останавливается, не истратив ни тонн, ни ячеек. Теперь на каждом
  // шаге собирается список того, что действительно помещается, и жребий тянет
  // из него — случайность остаётся, впустую не тратится ничего.
  //
  // Пул класса — ПРИОРИТЕТ, а не запрет: когда из своего пула не лезет уже
  // ничего, машина добирает остаток лёгким пулом и без оглядки на плотность.
  // Без этого отката вернулся бы недогруз, от которого ушёл шаг 46c.
  for (;;) {
    let pool = secondaries.filter((id) => secondaryFits(id, true));
    if (pool.length === 0) pool = fallbackSecondaries.filter((id) => secondaryFits(id, false));
    if (pool.length === 0) break;
    if (!tryMountFed(rng.pick(pool), ['leftArm', 'torso', 'rightArm', 'head'])) break;
  }

  // 4b. Машина без единого орудия — последний рубеж (2026-09-16).
  //
  // У самой лёгкой платформы на старшем реакторе навеска почти нулевая
  // (IS-H20-R5F1 — 0.6 т), и её целиком съедает резерв под полную броню. Оба
  // набора отказывали по-своему: главный калибр — по порогу «орудие не больше
  // 70 % навески», вспомогательный — по резерву брони. Машина выходила без
  // единого ствола, а `assemblyToChassisDef` подставлял ей средний лазер ДАРОМ:
  // недогруз превращался в бесплатное оружие тяжелее всего, что платформа
  // вообще может поднять, и в бою такой «разведчик» стрелял, ничем за это не
  // заплатив.
  //
  // Здесь резерв брони не действует и плотность не спрашивается: ствол важнее
  // четверти тонны брони. Берётся самый лёгкий, какой платформа поднимает.
  if (!items.some((it) => WEAPONS.has(it.id))) {
    // Порог дальности здесь НЕ действует — см. `reaches`: машине без единого
    // ствола любой ствол лучше никакого.
    const lightestFirst = [
      ...new Set([...myPrimaryPool, ...secondaryPool(0, tech)]),
    ]
      .map((id) => WEAPONS.get(id))
      .filter((w): w is WeaponDef => w !== undefined)
      .sort((a, b) => a.mass - b.mass);
    const mountLightest = (): boolean =>
      lightestFirst.some((w) => tryMountFed(w.id, ['rightArm', 'torso', 'leftArm', 'head']));
    // Приборы и прыжковые двигатели уступают место стволу. На такой платформе
    // они и съели всю навеску: ЭПП с пробником ставятся до вооружения (п. 3),
    // и это верно ровно до тех пор, пока машине есть чем стрелять. Разведчик
    // без единого орудия не разведчик, а мишень с антенной.
    while (!mountLightest() && items.length > 0) unmountLast();
  }

  // 5. Охладители под тепловой баланс машины (переписано шагом 32).
  //
  // Прежний блок не ставил их почти никогда, и по трём причинам сразу:
  //   1. порог `alphaHeat > baseHeatDiss + 4` требовал залпа жарче 14 единиц,
  //      а у большинства средних и тяжёлых машин альфа-нагрев 6-12 — генератор
  //      считал их «абсолютно холодными» и пропускал весь блок;
  //   2. он пробовал ставить ТОЛЬКО трёхслотовые двойные охладители, игнорируя
  //      однослотовые одинарные, и срывался, когда трёх ячеек подряд не
  //      находилось;
  //   3. он не смотрел в ноги вовсе — а в каноне охладители прячут именно туда.
  //
  // Итог был виден в бою: перегрев участвовал в 58 % ВСЕХ выстрелов противника
  // (замер шага 30), а снять охладитель с поверженной машины было нельзя,
  // потому что их там не было. questions.md пп. 5, 14*.
  //
  // Стало: цель — свести рассеивание с альфа-нагревом, ставим пока не сойдётся
  // и пока есть во что. Двойной охладитель предпочтительнее (2 очка на тонну),
  // но если три ячейки подряд не находятся — идёт одинарный.
  let alphaHeat = 0;
  for (const it of items) {
    const w = WEAPONS.get(it.id);
    if (w) alphaHeat += w.heat;
  }

  const sinkZones: readonly ZoneId[] = [
    'leftLeg',
    'rightLeg',
    'head',
    'torso',
    'leftArm',
    'rightArm',
  ];
  // Тип охладителя выбирается ОДИН раз на машину: смешивать одинарные с двойными
  // валидатор не даёт (канон Total Warfare). Чем именно — решает
  // `generatorSinkId`, и решает по ячейкам, а не по весу.
  const sinkId = generatorSinkId(tech);
  const sink = EQUIPMENT.get(sinkId);
  //
  // Цель — не полный ноль по теплу, а `alphaHeatTarget` норм отвода на залп
  // (`construction.json` → reactors). Единица означала бы сборку, которая жмёт
  // полный залп каждый ход даром, и тепло перестало бы быть выбором. Двойка —
  // то, с чем баланс мерился с шага 5; до перевода шкалы в единое измерение
  // (шаг 46) она была не записана нигде и держалась на том, что бой делил
  // отвод пополам, а конструктор — нет.
  let dissipation = platform.baseHeatDiss;
  const alphaTarget = CONSTRUCTION.reactors.alphaHeatTarget;
  // Шаги 5 и 5b — функцией: добор (5c) снимает охладители и расставляет их
  // заново под изменившийся залп тем же кодом.
  const fitSinks = (): void => {
    while (alphaHeat > dissipation * alphaTarget + reserveGen && remainingPayload >= 1.0) {
      if (!tryMount(sinkId, sinkZones)) break;
      dissipation += sink?.heatDissipation ?? 1;
    }

    // 5b. Остаток, который девать больше некуда, уходит в ОХЛАЖДЕНИЕ (шаг 54).
    //
    // Порог дальности (`reaches`) отсёк оружие, которое не достаёт до боевой
    // дистанции, и у средних и тяжёлых машин освободилось около половины тонны.
    // Купить на неё нечего: самый лёгкий «дострельный» ствол весит тонну, а броня
    // уже стоит у потолка корпуса. Замер это и показал — «набор сорвался» вырос с
    // нуля до 7 % сборок, то есть бесполезный ствол сменился бесполезными тоннами.
    //
    // Охладитель сверх нормы бесполезным не бывает: он не растит ЗАЛП, но растит
    // УСТОЙЧИВЫЙ залп — то, что машина выдаёт каждый ход, не упираясь в предел.
    // Потолок здесь — полный залп без нагрева вовсе: дальше охлаждать нечего.
    while (
      alphaHeat > dissipation &&
      remainingPayload - armorReserve >= 1.0 &&
      freeSinkSlots() >= sinkSlotsGen
    ) {
      if (!tryMount(sinkId, sinkZones)) break;
      dissipation += sink?.heatDissipation ?? 1;
    }
  };
  fitSinks();

  // 5c. ДОБОР НЕИСТРАЧЕННЫХ ТОНН — замена ствола вместе с охлаждением (шаг 71,
  // ступень Б).
  //
  // Замер перед ступенью: у машин, где после набора остаётся тонна и больше,
  // ячеек нет вовсе (0–1 на торс и руки, ноги пусты), броня у потолка корпуса в
  // 100 % случаев, залп горячее отвода в 97 %. ДОБАВИТЬ нечего — ни пачку, ни
  // охладитель, ни броню. Это цена тесного каркаса (F3 отдаёт до 14 ячеек за
  // тонны, `classification.md`), и у кланового штурмовика она доходила до 11 т
  // у каждой второй машины.
  //
  // Ячейки держит не столько ствол, сколько его ОХЛАЖДЕНИЕ: у горячего ствола
  // охладители занимают больше места, чем он сам. Поэтому замена одна на одну
  // почти ничего не даёт (пробовали: 11.4 → 9.9 т), а работает замена «ствол
  // вместе с охладителями»: снять ствол с его пачками, снять ВСЕ охладители,
  // поставить ствол тяжелее и расставить охладители заново шагами 5 и 5b.
  // Замена принимается, если сразу:
  //   - истрачено больше тонн, а броня осталась у потолка;
  //   - залп по урону не слабее;
  //   - перегрев сверх нормы (`alphaHeatTarget` плюс запас корпуса) не вырос;
  //   - новый ствол из пулов этой машины, достаёт до боя (`reaches`), и
  //     повторов главного калибра не больше `maxPrimary`.
  // Из годных берётся истратившая больше тонн, при равенстве — прибавившая
  // урона. Жребия нет: добор не сдвигает поток ГПСЧ.
  //
  // Ручка отката — `construction.json → weapons.fillUnusedPayload`: выключена —
  // сборки байт в байт как до ступени (`test/assemblyRollback.test.ts`).
  if (CONSTRUCTION.weapons.fillUnusedPayload) {
    const primarySet = new Set(myPrimaryPool);
    const upgradePool = [...new Set([...myPrimaryPool, ...secondaries])].filter(reaches);
    const countOf = (id: string): number => items.filter((it) => it.id === id).length;
    const volley = (w: WeaponDef): number => w.damage * w.shots;
    const alphaDamage = (): number =>
      items.reduce((sum, it) => {
        const w = WEAPONS.get(it.id);
        return w === undefined ? sum : sum + volley(w);
      }, 0);
    const overheat = (): number => Math.max(0, alphaHeat - (dissipation * alphaTarget + reserveGen));
    /** Норма пачек у всех стволов этого типа боезапаса полная — `tryMountFed` добирает пачки молча. */
    const fedInFull = (id: string): boolean => {
      const ammoId = AMMO_FOR_WEAPON[id];
      if (ammoId === undefined) return true;
      const users = items.filter((x) => AMMO_FOR_WEAPON[x.id] === ammoId).length;
      return countOf(ammoId) >= ammoTonsFor(id) * users;
    };
    const dropAt = (i: number): void => {
      const [gone] = items.splice(i, 1);
      const d = WEAPONS.get(gone!.id) ?? EQUIPMENT.get(gone!.id);
      slotsRemaining[gone!.zone] += d?.slots ?? 0;
      remainingPayload += d?.mass ?? 0;
    };
    /**
     * Заменить ствол `index` на `to` вместе с охлаждением. Ложь — замена не
     * состоялась; состояние тогда недоопределено, и вызывающий его откатывает.
     */
    const swap = (index: number, to: string): boolean => {
      const from = items[index]!.id;
      const ammoId = AMMO_FOR_WEAPON[from];
      if (ammoId !== undefined) {
        // Пачки общие у стволов одного типа: снимаются, только если у каждого
        // из них норма полная, — иначе снятие обделило бы соседа.
        const users = items.filter((x) => AMMO_FOR_WEAPON[x.id] === ammoId).length;
        if (countOf(ammoId) < ammoTonsFor(from) * users) return false;
      }
      alphaHeat -= WEAPONS.get(from)!.heat;
      dropAt(index);
      if (ammoId !== undefined) {
        for (let n = 0; n < ammoTonsFor(from); n++) dropAt(items.map((x) => x.id).lastIndexOf(ammoId));
      }
      for (let i = items.length - 1; i >= 0; i--) if (items[i]!.id === sinkId) dropAt(i);
      dissipation = platform.baseHeatDiss;
      if (!tryMountFed(to, ['leftArm', 'torso', 'rightArm', 'head']) || !fedInFull(to)) return false;
      alphaHeat += WEAPONS.get(to)!.heat;
      fitSinks();
      return true;
    };

    for (;;) {
      if (remainingPayload - armorReserve < 1) break;
      const before = {
        items: items.slice(),
        slots: { ...slotsRemaining },
        payload: remainingPayload,
        heat: alphaHeat,
        diss: dissipation,
      };
      const restore = (): void => {
        items.splice(0, items.length, ...before.items);
        Object.assign(slotsRemaining, before.slots);
        remainingPayload = before.payload;
        alphaHeat = before.heat;
        dissipation = before.diss;
      };
      const damage0 = alphaDamage();
      const overheat0 = overheat();

      let best: { readonly index: number; readonly to: string; readonly used: number; readonly damage: number } | null =
        null;
      for (let index = 0; index < before.items.length; index++) {
        const from = WEAPONS.get(before.items[index]!.id);
        if (from === undefined) continue;
        for (const to of upgradePool) {
          if (to === from.id) continue;
          if (primarySet.has(to) && countOf(to) >= maxPrimary) continue;
          const ok = swap(index, to);
          const used = before.payload - remainingPayload;
          const damage = alphaDamage();
          const accepted =
            ok &&
            used > 0 &&
            remainingPayload >= armorReserve &&
            damage >= damage0 &&
            overheat() <= overheat0 &&
            (best === null || used > best.used || (used === best.used && damage > best.damage));
          restore();
          if (accepted) best = { index, to, used, damage };
        }
      }
      if (best === null) break;
      swap(best.index, best.to);
    }
  }

  // 6. Оставшийся свободный вес уходит в броню (но не более предела Armor Cap)
  const ptsPerTon = armorPointsPerTon(tech);
  const maxArmorTons = Math.floor((platform.maxArmorPts / ptsPerTon) * 4) / 4;
  const availArmorTons = platform.defArmorMass + Math.max(0, remainingPayload);
  const candidateArmorTons = Math.floor(availArmorTons * 4) / 4;
  const armorTons = Math.min(maxArmorTons, candidateArmorTons);

  const assembly: MechAssembly = {
    chassisCode: chassis.code,
    name: opts.name ?? (chassis.canonName || `${chassis.code}-${role.toUpperCase()}`),
    role,
    techBase: tech,
    tonnage: chassis.tonnage,
    armorTons,
    items,
    ...(opts.quality !== undefined ? { quality: opts.quality } : {}),
  };

  return assembly;
}

/**
 * Конвертация сборки в полноценную игровую спецификацию ChassisDef.
 */
export function assemblyToChassisDef(assembly: MechAssembly): ChassisDef {
  const chassis = getChassisCatalogEntry(assembly.chassisCode);
  const quality = assembly.quality ?? STANDARD_QUALITY;
  const platform = makePlatform(
    chassis.techBase,
    chassis.tonnage,
    chassis.reactorTier,
    chassis.frameTier,
    quality,
    chassis.locomotion,
  );

  const totalArmor = Math.min(
    platform.maxArmorPts,
    Math.round(assembly.armorTons * armorPointsPerTon(chassis.techBase)),
  );

  // Структура и броня делятся ОДНОЙ таблицей долей. Иначе раскладка рискует
  // сделать голову тоньше рук: раньше (до правила общей таблицы) голова получала
  // 8 % брони и три очка структуры и отказывала первой — ровно наоборот замыслу
  // (голова гуще рук всегда, см. `data/construction.json` → `zoneShares`).
  const structure = allocateByZone(platform.totalStructure);
  const armor = allocateByZone(totalArmor);

  // Боезапас орудия — СУММА всех установленных пачек его типа, а не ёмкость
  // одного магазина (шаг 32).
  //
  // До этого шага `mount.ammo` брался как `w.ammo` — паспортная ёмкость одного
  // бункера. Вторая и третья пачка на борту исправно съедали тонны, проходили
  // валидатор и не давали НИ ОДНОГО лишнего выстрела: две пачки к АП/20 давали
  // те же пять выстрелов, что и одна. Расширенный боекомплект — фундамент
  // конструктора BattleTech (вес и риск детонации против длительности боя), и в
  // игре он был отрезан молча.
  //
  // Пачки делятся между орудиями ОДНОГО типа поровну: две пушки АП/20 и три
  // пачки на борту — это полтора магазина каждой, а не три у первой и ноль у
  // второй. Иначе порядок перечисления в сборке решал бы, какое орудие
  // стреляет, а какое возит балласт.
  const ammoBoxesById = new Map<string, number>();
  for (const it of assembly.items) {
    if (EQUIPMENT.get(it.id)?.category !== 'ammo') continue;
    ammoBoxesById.set(it.id, (ammoBoxesById.get(it.id) ?? 0) + 1);
  }
  const weaponsById = new Map<string, number>();
  for (const it of assembly.items) {
    if (!WEAPONS.has(it.id)) continue;
    weaponsById.set(it.id, (weaponsById.get(it.id) ?? 0) + 1);
  }

  const mounts = assembly.items
    .filter((it) => WEAPONS.has(it.id))
    .map((it) => {
      const w = WEAPONS.get(it.id)!;
      if (w.ammo === null) return { weapon: w.id, zone: it.zone, ammo: it.ammo ?? null };

      const ammoId = AMMO_FOR_WEAPON[w.id];
      // Ноль пачек означает негодную сборку — её отвергнет валидатор, и
      // подменять здесь исход нечем. Единица снизу оставлена, чтобы такая
      // сборка вела себя как до шага 32, а не превращалась молча в машину с
      // пустыми стволами.
      const boxes = Math.max(1, ammoId === undefined ? 1 : (ammoBoxesById.get(ammoId) ?? 0));
      const sameWeapons = Math.max(1, weaponsById.get(w.id) ?? 1);
      // `it.ammo` намеренно НЕ читается: генератор кладёт туда паспортную
      // ёмкость одного магазина, и `?? ` подхватывал бы её, отменяя весь счёт
      // по пачкам. Ёмкость установки — производная от того, что стоит на
      // борту, а не отдельно хранимое число.
      return { weapon: w.id, zone: it.zone, ammo: Math.floor((w.ammo * boxes) / sameWeapons) };
    });

  // ОЧКИ ОТВОДА, А НЕ ЧИСЛО ЖЕЛЕЗОК (шаг 46, часть 2).
  //
  // Здесь был единственный источник расхождения между цехом и боем: в графу
  // `heatSinks` складывались очки реактора (10 у сферы, 20 у клана) и ШТУКИ
  // навешенных охладителей, а бой читал сумму как число радиаторов. Двойной
  // охладитель отдавал в бою ровно столько же, сколько одинарный, хотя стоил
  // втрое больше ячеек, — за 220 из 300 сгенерированных сборок платили тоннами
  // и объёмом впустую.
  let extraHeatSinks = 0;
  for (const it of assembly.items) {
    const eq = EQUIPMENT.get(it.id);
    if (eq?.category === 'heatsink') extraHeatSinks += eq.heatDissipation ?? 1;
  }

  const zone = (z: ZoneId): { armor: number; structure: number } => ({
    armor: armor[z],
    structure: structure[z],
  });

  const equipment = assembly.items
    .filter((it) => EQUIPMENT.has(it.id))
    .map((it) => ({ id: it.id, zone: it.zone }));

  // Множители класса применяются РОВНО ОДИН РАЗ — здесь, через платформу.
  // Ни одно число ниже не умножается на них повторно: `platform` уже посчитан
  // с классом, а `armorTons` — вход сборки, а не производная величина.
  const id = `${assembly.chassisCode}${qualitySuffix(quality)}`;

  return {
    id,
    key: `chassis.${assembly.chassisCode.toLowerCase().replace(/-/g, '_')}`,
    weightClass: platform.weightClass,
    techBase: chassis.techBase,
    tons: platform.tonnage,
    heatSinks: platform.baseHeatDiss + extraHeatSinks,
    // Встроенная часть — ровно то, что даёт сам реактор, вместе с поправкой
    // класса. Всё сверх неё навешено по корпусу и потому уязвимо.
    integralHeatSinks: platform.baseHeatDiss,
    reactorTier: platform.reactorTier,
    frameTier: platform.frameTier,
    armorTons: assembly.armorTons,
    zones: {
      head: zone('head'),
      torso: zone('torso'),
      leftArm: zone('leftArm'),
      rightArm: zone('rightArm'),
      leftLeg: zone('leftLeg'),
      rightLeg: zone('rightLeg'),
    },
    mounts: mounts.length > 0 ? mounts : [{ weapon: 'is_ml', zone: 'torso', ammo: null }],
    ...(equipment.length > 0 ? { equipment } : {}),
    // Тепло за крит реактора — свойство машины, а не общая константа: у
    // восстановленного реактора крит греет сильнее, у мастерского слабее.
    // Поле необязательное, и его отсутствие означает значение из combat.json —
    // так все 850 шасси каталога остаются нетронутыми.
    ...(platform.reactorCritHeat !== COMBAT.critical.reactor.heatPerHit
      ? { reactorHeatPerHit: platform.reactorCritHeat }
      : {}),
    // Класс исполнения — для показа в бою (карточка цели): правил он не меняет,
    // всё, что класс даёт, уже посчитано выше. Серийный не пишется — тем же
    // приёмом, что тепло крита: шасси каталога остаются нетронутыми.
    ...(quality.reactor !== 'standard' || quality.frame !== 'standard'
      ? { quality: { reactor: quality.reactor, frame: quality.frame } }
      : {}),
  };
}
