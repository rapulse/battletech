import achievementsJson from '../../../data/achievements.json';
import biomesJson from '../../../data/biomes.json';
import chassisCatalogJson from '../../../data/chassis_catalog.json';
import chassisJson from '../../../data/chassis.json';
import combatJson from '../../../data/combat.json';
import constructionJson from '../../../data/construction.json';
import economyJson from '../../../data/economy.json';
import emplacementsJson from '../../../data/emplacements.json';
import milestonesJson from '../../../data/milestones.json';
import namesJson from '../../../data/names.json';
import equipmentJson from '../../../data/equipment.json';
import paintsJson from '../../../data/paints.json';
import pilotsJson from '../../../data/pilots.json';
import qualityJson from '../../../data/quality.json';
import repairJson from '../../../data/repair.json';
import terrainJson from '../../../data/terrain.json';
import weaponsJson from '../../../data/weapons.json';

import { TERRAIN_IDS, TerrainType, type TerrainInfo } from '../map/TerrainType.js';
import { zoneFromId, type HitZone } from '../model/HitZone.js';
import { QUALITY_CLASS_IDS, type QualityClass } from '../model/QualityClass.js';
import {
  achievementsFileSchema,
  biomesFileSchema,
  chassisCatalogFileSchema,
  chassisFileSchema,
  combatFileSchema,
  emplacementsFileSchema,
  type EmplacementKind,
  type StructureKind,
  constructionFileSchema,
  economyFileSchema,
  equipmentFileSchema,
  milestonesFileSchema,
  namesFileSchema,
  paintsFileSchema,
  pilotsFileSchema,
  qualityFileSchema,
  repairFileSchema,
  terrainFileSchema,
  weaponsFileSchema,
  type AchievementsFile,
  type BiomeDef,
  type ChassisCatalogEntry,
  type ChassisDef,
  type ConstructionFile,
  type EconomyFile,
  type EquipmentDef,
  type MilestonesFile,
  type PaintsFile,
  type QualityClassDef,
  type RepairFile,
  type WeaponDef,
} from './schema.js';

/**
 * Загрузка и проверка игровых таблиц (game_core.md §8, §12 шаг 2).
 *
 * Разбор идёт один раз при загрузке модуля, а не при каждом обращении: батч-прогон
 * на 10 000 боёв не должен платить за валидацию 10 000 раз.
 *
 * Проверяется не только форма записи, но и **ссылки между таблицами**: шасси не может
 * ссылаться на несуществующее оружие, а таблица опыта — на несуществующий навык. Это
 * и есть та ошибка, которая иначе всплывает через месяц кривым балансом.
 */

function fail(what: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(`Ошибка в игровых данных (${what}):\n${detail}`);
}

function parse<T>(what: string, schema: { parse: (v: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    return fail(what, err);
  }
}

// --- рельеф ------------------------------------------------------------------

const terrainFile = parse('data/terrain.json', terrainFileSchema, terrainJson);

if (terrainFile.terrain.length !== TERRAIN_IDS.length) {
  fail(
    'data/terrain.json',
    new Error(`записей ${terrainFile.terrain.length}, а типов рельефа ${TERRAIN_IDS.length}`),
  );
}

export const TERRAIN: readonly TerrainInfo[] = terrainFile.terrain.map((row, i) => {
  const expected = TERRAIN_IDS[i];
  if (row.id !== expected) {
    fail(
      'data/terrain.json',
      new Error(`позиция ${i}: ожидался «${expected}», в файле «${row.id}». Порядок обязан совпадать с enum TerrainType`),
    );
  }
  return {
    id: i as TerrainType,
    key: `terrain.${row.id}`,
    enterCost: row.enterCost,
    objHeight: row.objHeight,
    toHitMod: row.toHitMod,
    heatPerTurn: row.heatPerTurn,
    pilotingOnRun: row.pilotingOnRun,
    hardCover: row.hardCover,
    walkable: row.walkable,
    partialCover: row.partialCover,
  };
});

export function terrainInfo(t: TerrainType): TerrainInfo {
  const info = TERRAIN[t];
  if (info === undefined) throw new RangeError(`Неизвестный рельеф: ${t}`);
  return info;
}

/**
 * Динамический слой (дым, пожар, лёд) и высота стены.
 *
 * Оверлеи названы ключом, а не порядком массива: их хранит битовая маска
 * (`HexMap.overlay`), и порядок бит поменять нельзя, а порядок записей в файле —
 * можно. Для рельефа связь обратная — там enum, и порядок проверяется выше.
 */
export const OVERLAYS = terrainFile.overlays;
export const EDGE_RULES = terrainFile.edges;

// --- биомы -------------------------------------------------------------------

const biomesFile = parse('data/biomes.json', biomesFileSchema, biomesJson);

export const BIOME_LIST: readonly BiomeDef[] = biomesFile.biomes;

export const BIOMES: ReadonlyMap<string, BiomeDef> = new Map(BIOME_LIST.map((b) => [b.id, b]));

if (BIOMES.size !== BIOME_LIST.length) {
  fail('data/biomes.json', new Error('повторяющиеся id биомов'));
}

/** Биом по имени. Опечатка в сценарии или в адресной строке обязана быть слышной. */
export function biome(id: string): BiomeDef {
  const b = BIOMES.get(id);
  if (b === undefined) {
    throw new RangeError(`Неизвестный биом: ${id}. Известны: ${[...BIOMES.keys()].join(', ')}`);
  }
  return b;
}

/** Умеренный — эталон, по которому меряется баланс карт (шаг 9a, часть E). */
export const DEFAULT_BIOME = 'temperate';

// --- оружие ------------------------------------------------------------------

const weaponsFile = parse('data/weapons.json', weaponsFileSchema, weaponsJson);

export const WEAPON_LIST: readonly WeaponDef[] = weaponsFile.weapons;

export const WEAPONS: ReadonlyMap<string, WeaponDef> = new Map(
  WEAPON_LIST.map((w) => [w.id, w]),
);

if (WEAPONS.size !== WEAPON_LIST.length) {
  fail('data/weapons.json', new Error('повторяющиеся id оружия'));
}

export function weapon(id: string): WeaponDef {
  const w = WEAPONS.get(id);
  if (w === undefined) throw new RangeError(`Неизвестное оружие: ${id}`);
  return w;
}

// --- шасси -------------------------------------------------------------------

const chassisFile = parse('data/chassis.json', chassisFileSchema, chassisJson);

export const CHASSIS_LIST: readonly ChassisDef[] = chassisFile.chassis;

export const CHASSIS: ReadonlyMap<string, ChassisDef> = new Map(
  CHASSIS_LIST.map((c) => [c.id, c]),
);

if (CHASSIS.size !== CHASSIS_LIST.length) {
  fail('data/chassis.json', new Error('повторяющиеся id шасси'));
}

for (const c of CHASSIS_LIST) {
  for (const m of c.mounts) {
    if (!WEAPONS.has(m.weapon)) {
      fail('data/chassis.json', new Error(`шасси ${c.id}: неизвестное оружие «${m.weapon}»`));
    }
    const w = weapon(m.weapon);
    if ((w.ammo === null) !== (m.ammo === null)) {
      fail(
        'data/chassis.json',
        new Error(
          `шасси ${c.id}, оружие ${m.weapon}: боезапас в шасси и в оружии обязаны быть согласованы (энергетическое — null, баллистическое — число)`,
        ),
      );
    }
  }
}

const DYNAMIC_CHASSIS = new Map<string, ChassisDef>();

export function registerDynamicChassis(def: ChassisDef): void {
  DYNAMIC_CHASSIS.set(def.id, def);
}

export function chassis(id: string): ChassisDef {
  const c = DYNAMIC_CHASSIS.get(id) ?? CHASSIS.get(id);
  if (c === undefined) throw new RangeError(`Неизвестное шасси: ${id}`);
  return c;
}

// --- конструирование ---------------------------------------------------------

export const CONSTRUCTION: ConstructionFile = parse(
  'data/construction.json',
  constructionFileSchema,
  constructionJson,
);

/**
 * Пулы оружия ссылаются на каталог, а схема этого проверить не может: файл
 * конструирования разбирается сам по себе. Опечатка в идентификаторе иначе
 * всплыла бы пустым пулом посреди генерации — и молча, потому что генератор
 * просто не нашёл бы оружия и списал жребий в неудачу.
 */
{
  const w = CONSTRUCTION.weapons;
  // Пул главного калибра состоит из ступеней (шаг 71): проверяется каждый ствол
  // каждой ступени, иначе опечатка внутри ступени прошла бы мимо.
  const flat = (tiers: readonly (string | readonly string[])[]): readonly string[] => tiers.flat();
  const pools: Record<string, { readonly is: readonly string[]; readonly clan: readonly string[] }> = {
    ...Object.fromEntries(
      Object.entries(w.primaryByRole).map(([k, v]) => [
        `primaryByRole.${k}`,
        { is: flat(v.is), clan: flat(v.clan) },
      ]),
    ),
    'secondaryByPayload.small': w.secondaryByPayload.small,
    'secondaryByPayload.medium': w.secondaryByPayload.medium,
    'secondaryByPayload.large': w.secondaryByPayload.large,
    'secondaryByPayload.huge': w.secondaryByPayload.huge,
    ...Object.fromEntries(
      Object.entries(w.families).flatMap(([k, f]) => [
        [`families.${k}.primary`, { is: flat(f.primary.is), clan: flat(f.primary.clan) }],
        [`families.${k}.secondary`, f.secondary],
      ]),
    ),
  };
  for (const [where, pool] of Object.entries(pools)) {
    for (const tech of ['is', 'clan'] as const) {
      for (const id of pool[tech]) {
        const def = WEAPONS.get(id);
        if (def === undefined) {
          fail('data/construction.json', new Error(`weapons.${where}.${tech}: неизвестное оружие «${id}»`));
        } else if (def.techBase !== tech) {
          fail(
            'data/construction.json',
            new Error(`weapons.${where}.${tech}: оружие «${id}» принадлежит техбазе ${def.techBase}`),
          );
        }
      }
    }
  }
}

/**
 * Группы биомов и таблицы семейств (шаги 71, 71b) ссылаются на другие файлы:
 * биомы — на `biomes.json`, семейства — на `weapons.families`. Биом без группы
 * молча остался бы без своих весов, опечатка в семействе — без эффекта.
 */
{
  const r = CONSTRUCTION.roles;
  const seen = new Map<string, string>();
  for (const [group, list] of Object.entries(r.biomeGroups)) {
    for (const id of list) {
      if (!BIOMES.has(id)) fail('data/construction.json', new Error(`roles.biomeGroups.${group}: неизвестный биом «${id}»`));
      const other = seen.get(id);
      if (other !== undefined) {
        fail('data/construction.json', new Error(`roles.biomeGroups: биом «${id}» стоит и в «${other}», и в «${group}»`));
      }
      seen.set(id, group);
    }
  }
  for (const b of BIOME_LIST) {
    if (!seen.has(b.id)) fail('data/construction.json', new Error(`roles.biomeGroups: биом «${b.id}» не входит ни в одну группу`));
  }
  const fams = new Set(Object.keys(CONSTRUCTION.weapons.families));
  for (const [group, byKey] of Object.entries(r.familyByBiome)) {
    if (r.biomeGroups[group] === undefined) fail('data/construction.json', new Error(`roles.familyByBiome: неизвестная группа «${group}»`));
    for (const [key, weights] of Object.entries(byKey)) {
      for (const f of Object.keys(weights)) {
        if (!fams.has(f)) fail('data/construction.json', new Error(`roles.familyByBiome.${group}.${key}: неизвестное семейство «${f}»`));
      }
    }
  }
  for (const f of Object.keys(r.familyMaxShare)) {
    if (!fams.has(f)) fail('data/construction.json', new Error(`roles.familyMaxShare: неизвестное семейство «${f}»`));
  }
  for (const [group, spec] of Object.entries(r.familySpecialists)) {
    if (r.biomeGroups[group] === undefined) fail('data/construction.json', new Error(`roles.familySpecialists: неизвестная группа «${group}»`));
    for (const f of Object.keys(spec)) {
      if (!fams.has(f)) fail('data/construction.json', new Error(`roles.familySpecialists.${group}: неизвестное семейство «${f}»`));
    }
  }
}

/**
 * Сколько тиров существует на самом деле — по длине таблиц, а не по числу в
 * схеме. Шаг 7 сократил каркас с пяти ступеней до трёх, и всё, что знало «5»
 * наизусть, пришлось бы искать вручную.
 */
export const REACTOR_TIERS_AVAILABLE = CONSTRUCTION.reactors.massPercent.is.length;
export const FRAME_TIERS_AVAILABLE = CONSTRUCTION.frames.massPercent.length;

// Ссылка шасси на несуществующий тир обязана падать при загрузке, а не
// индексировать мимо массива. Схема этого не проверяет намеренно: число тиров —
// свойство данных, а не формы записи.
for (const c of CHASSIS_LIST) {
  if (c.reactorTier > REACTOR_TIERS_AVAILABLE || c.frameTier > FRAME_TIERS_AVAILABLE) {
    fail(
      'data/chassis.json',
      new Error(
        `шасси ${c.id}: тир вне таблиц (реактор R1..R${REACTOR_TIERS_AVAILABLE}, каркас F1..F${FRAME_TIERS_AVAILABLE})`,
      ),
    );
  }
}

const equipmentFile = parse('data/equipment.json', equipmentFileSchema, equipmentJson);

export const EQUIPMENT_LIST: readonly EquipmentDef[] = equipmentFile.equipment;

export const EQUIPMENT: ReadonlyMap<string, EquipmentDef> = new Map(
  EQUIPMENT_LIST.map((e) => [e.id, e]),
);

if (EQUIPMENT.size !== EQUIPMENT_LIST.length) {
  fail('data/equipment.json', new Error('повторяющиеся id оборудования'));
}

export function equipment(id: string): EquipmentDef {
  const e = EQUIPMENT.get(id);
  if (e === undefined) throw new RangeError(`Неизвестное оборудование: ${id}`);
  return e;
}

const chassisCatalogFile = parse(
  'data/chassis_catalog.json',
  chassisCatalogFileSchema,
  chassisCatalogJson,
);

export const CHASSIS_CATALOG_LIST: readonly ChassisCatalogEntry[] = chassisCatalogFile.chassis;

export const CHASSIS_CATALOG: ReadonlyMap<string, ChassisCatalogEntry> = new Map(
  CHASSIS_CATALOG_LIST.map((c) => [c.code, c]),
);

export function chassisCatalog(code: string): ChassisCatalogEntry {
  const c = CHASSIS_CATALOG.get(code);
  if (c === undefined) throw new RangeError(`Неизвестное шасси каталога: ${code}`);
  return c;
}

// --- боевые константы --------------------------------------------------------

export const COMBAT = parse('data/combat.json', combatFileSchema, combatJson);

// --- огневые точки (шаг 73c) --------------------------------------------------

export const EMPLACEMENTS = parse('data/emplacements.json', emplacementsFileSchema, emplacementsJson);

const EMPLACEMENT_KINDS: ReadonlyMap<string, EmplacementKind> = new Map(
  EMPLACEMENTS.kinds.map((k) => [k.id, k]),
);
for (const k of EMPLACEMENTS.kinds) {
  if (!WEAPONS.has(k.weapon)) {
    throw new Error(`Ошибка в игровых данных (data/emplacements.json): у «${k.id}» неизвестное оружие ${k.weapon}`);
  }
}

export function emplacementKind(id: string): EmplacementKind {
  const k = EMPLACEMENT_KINDS.get(id);
  if (k === undefined) throw new RangeError(`Неизвестная огневая точка: ${id}`);
  return k;
}

const STRUCTURE_KINDS: ReadonlyMap<string, StructureKind> = new Map(
  EMPLACEMENTS.structures.map((k) => [k.id, k]),
);

/** Конструкция укрепления (шаг 73d): бункер, узел связи, склад. */
export function structureKind(id: string): StructureKind {
  const k = STRUCTURE_KINDS.get(id);
  if (k === undefined) throw new RangeError(`Неизвестная конструкция укрепления: ${id}`);
  return k;
}

/** Таблицы зон, разложенные по HitZone: индекс 0..5 соответствует броску d6 1..6. */
export interface ZoneTables {
  readonly above: readonly HitZone[];
  readonly level: readonly HitZone[];
  readonly below: readonly HitZone[];
}

export const ZONE_TABLES: ZoneTables = {
  above: COMBAT.hitLocation.tables.above.map(zoneFromId),
  below: COMBAT.hitLocation.tables.below.map(zoneFromId),
  level: COMBAT.hitLocation.tables.level.map(zoneFromId),
};

export const HEAD_GLANCE_ZONE: HitZone = zoneFromId(COMBAT.hitLocation.headConfirm.glanceZone);

// --- пилоты ------------------------------------------------------------------

export const PILOTS = parse('data/pilots.json', pilotsFileSchema, pilotsJson);
export const NAMES = parse('data/names.json', namesFileSchema, namesJson);

export const SKILL_IDS: readonly string[] = PILOTS.skills.map((s) => s.id);

{
  const known = new Set(SKILL_IDS);
  if (known.size !== SKILL_IDS.length) {
    fail('data/pilots.json', new Error('повторяющиеся id навыков'));
  }
  for (const [event, row] of Object.entries(PILOTS.progression.xp)) {
    for (const skill of row.skills) {
      if (!known.has(skill)) {
        fail('data/pilots.json', new Error(`опыт за «${event}» ссылается на неизвестный навык «${skill}»`));
      }
    }
  }
  for (const o of PILOTS.origins) {
    for (const s of [...o.strong, ...o.weak]) {
      if (!known.has(s)) {
        fail('data/pilots.json', new Error(`происхождение ${o.id} ссылается на неизвестный навык «${s}»`));
      }
    }
  }
  // Навыки, на которые опираются правила боя. Переименовать в JSON, не тронув код,
  // тихо сломало бы стрельбу — поэтому проверяем явно.
  for (const required of ['gunnery', 'piloting', 'tactics', 'composure', 'endurance']) {
    if (!known.has(required)) {
      fail('data/pilots.json', new Error(`правила боя опираются на навык «${required}», его нет в списке`));
    }
  }
}

// --- класс исполнения и ремонт (шаг 11) --------------------------------------

const qualityFile = parse('data/quality.json', qualityFileSchema, qualityJson);

/**
 * Классы исполнения по имени.
 *
 * Порядок записей в файле обязан совпадать с `QUALITY_CLASS_IDS` — на этот
 * порядок опирается шкала «хуже → лучше», по которой ходят повышение класса
 * ремонтом и понижение износом. Сверка та же, что у рельефа: молча
 * переставленный порядок иначе превратил бы улучшение в ухудшение.
 */
qualityFile.classes.forEach((row, i) => {
  const expected = QUALITY_CLASS_IDS[i];
  if (row.id !== expected) {
    fail(
      'data/quality.json',
      new Error(
        `позиция ${i}: ожидался «${expected}», в файле «${row.id}». ` +
          'Порядок обязан совпадать с QUALITY_CLASS_IDS (шкала «хуже → лучше»)',
      ),
    );
  }
});

export const QUALITY: Readonly<Record<QualityClass, QualityClassDef>> = Object.fromEntries(
  qualityFile.classes.map((row) => [row.id, row]),
) as Record<QualityClass, QualityClassDef>;

/** Множитель цены узла по тиру: быстрый реактор дороже медленного и в деньгах. */
export function tierPriceFactor(tier: number): number {
  for (const group of qualityFile.tierPrice.groups) {
    if (tier <= group.maxTier) return group.factor;
  }
  const last = qualityFile.tierPrice.groups[qualityFile.tierPrice.groups.length - 1];
  return last?.factor ?? 1;
}

export const REPAIR: RepairFile = parse('data/repair.json', repairFileSchema, repairJson);

// --- раскраски мехов (шаг 50) -------------------------------------------------

export const PAINTS: PaintsFile = parse('data/paints.json', paintsFileSchema, paintsJson);

/** Раскраска, в которую откатывается всё, чего нет. Единственный id, известный коду. */
export const DEFAULT_PAINT = 'default';

{
  const ids = new Set(Object.keys(PAINTS.paints));
  if (!ids.has(DEFAULT_PAINT)) fail('data/paints.json', new Error(`нет раскраски «${DEFAULT_PAINT}»`));
  const letters = new Map<string, string>();
  for (const [id, p] of Object.entries(PAINTS.paints)) {
    const other = letters.get(p.letter);
    if (other !== undefined) {
      fail('data/paints.json', new Error(`буква «${p.letter}» у «${other}» и «${id}»`));
    }
    letters.set(p.letter, id);
  }
  const targets = [
    ...Object.entries(PAINTS.byFaction).map(([k, v]) => [`byFaction.${k}`, v] as const),
    ...Object.entries(PAINTS.byKind).map(([k, v]) => [`byKind.${k}`, v] as const),
    ['player', PAINTS.player] as const,
  ];
  for (const [where, id] of targets) {
    if (!ids.has(id)) fail('data/paints.json', new Error(`${where}: нет раскраски «${id}»`));
  }
}

// --- достижения (шаг 69) ------------------------------------------------------

export const ACHIEVEMENTS: AchievementsFile = parse('data/achievements.json', achievementsFileSchema, achievementsJson);

/**
 * Ячеек в атласе значков: сетка 5×5 (`tools/pack_ui_atlases.py`). Номер за
 * пределами сетки `AtlasImage` молча завернул бы на чужой значок, поэтому он
 * ловится здесь, при загрузке.
 */
export const ACHIEVEMENT_ICONS = 25;

{
  const ids = new Set<string>();
  const icons = new Map<number, string>();
  for (const a of ACHIEVEMENTS.achievements) {
    if (ids.has(a.id)) fail('data/achievements.json', new Error(`id «${a.id}» повторяется`));
    ids.add(a.id);
    if (a.icon >= ACHIEVEMENT_ICONS) {
      fail('data/achievements.json', new Error(`«${a.id}»: ячейки ${a.icon} нет в атласе из ${ACHIEVEMENT_ICONS}`));
    }
    const other = icons.get(a.icon);
    if (other !== undefined) fail('data/achievements.json', new Error(`ячейка ${a.icon} у «${other}» и «${a.id}»`));
    icons.set(a.icon, a.id);
  }
}

// --- главы кампании (шаг 70) --------------------------------------------------

export const MILESTONES: MilestonesFile = parse('data/milestones.json', milestonesFileSchema, milestonesJson);

{
  // id глав и вех — ключи словаря (`progress.chapter.<id>`, `progress.milestone.<id>`):
  // повтор молча отдал бы двум вехам одну подпись.
  const chapters = new Set<string>();
  const milestones = new Set<string>();
  for (const c of MILESTONES.campaigns.merc.chapters) {
    if (chapters.has(c.id)) fail('data/milestones.json', new Error(`глава «${c.id}» повторяется`));
    chapters.add(c.id);
    for (const m of c.milestones) {
      if (milestones.has(m.id)) fail('data/milestones.json', new Error(`веха «${m.id}» повторяется`));
      milestones.add(m.id);
    }
  }
}

// --- экономика роты (шаг 13) --------------------------------------------------

export const ECONOMY: EconomyFile = parse('data/economy.json', economyFileSchema, economyJson);

/**
 * Лестница цеха обязана вести ВВЕРХ и начинаться выше стартового числа стапелей
 * (шаг 19a). Ступень «улучшить с четырёх до четырёх» проходит схему и
 * обнаруживается только тем, что игрок заплатил ни за что, — а такие вещи
 * останавливают загрузку здесь, а не всплывают через месяц.
 */
{
  let previous = ECONOMY.company.bays;
  for (const step of ECONOMY.bays.steps) {
    if (step.to <= previous) {
      fail(
        'data/economy.json',
        new Error(
          `bays.steps: ступень до ${step.to} не выше предыдущего числа стапелей (${previous}). ` +
            'Лестница цеха обязана строго расти',
        ),
      );
    }
    previous = step.to;
  }
}

/**
 * Ангар корабля (шаг 75) открывается той же лестницей, что и цех: ячейка с
 * номером N стоит как стапель с номером N. Значит, у каждой ячейки от открытых
 * сразу (`minMechs`) до потолка корабля (`mechCapacity`) обязана быть своя
 * ступень — иначе ангар перескочил бы номер или упёрся бы ниже потолка.
 */
for (const ship of Object.values(ECONOMY.dropships)) {
  if (ship.minMechs > ship.mechCapacity) {
    fail(
      'data/economy.json',
      new Error(`dropships.${ship.id}: открыто сразу ${ship.minMechs} ячеек при потолке ${ship.mechCapacity}`),
    );
  }
  for (let to = ship.minMechs + 1; to <= ship.mechCapacity; to++) {
    if (!ECONOMY.bays.steps.some((step) => step.to === to)) {
      fail(
        'data/economy.json',
        new Error(`bays.steps: нет ступени до ${to} — ангар корабля ${ship.id} открывается по ней`),
      );
    }
  }
}
