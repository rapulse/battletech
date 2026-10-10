import {
  chassis,
  CONSTRUCTION,
  EQUIPMENT,
  weapon,
} from '../data/tables.js';
import type { ChassisDef } from '../data/schema.js';
import type { Direction, Hex } from '../hex/index.js';
import type { MoveMode } from '../map/movement.js';
import { HitZone, isArm, ZONE_IDS, zoneFromId, ZONE_COUNT, type ZoneId } from './HitZone.js';
import type { Pilot } from './Pilot.js';
import { WeightClass } from './WeightClass.js';
import { AMMO_FOR_WEAPON, ammoPerVolley, makePlatform } from '../rules/construction.js';

export type UnitId = string;

/** Сторона в бою. Пока две; расширяется без правки правил. */
export type Side = 'player' | 'opfor';

/**
 * Очищает id шасси от служебных динамических суффиксов (`~Q...`, `~rec:...`),
 * возвращая чистый индекс модели робота (например, `IS-H35-R3F1` или `WVR-6R`).
 */
export function cleanChassisCode(chassisId: string): string {
  return chassisId.split('~')[0] ?? chassisId;
}

/** Состояние одной зоны: броня снаружи, структура под ней. */
export interface ZoneState {
  readonly armor: number;
  readonly structure: number;
  readonly maxArmor: number;
  readonly maxStructure: number;
  readonly destroyed: boolean;
}

/** Тип содержимого ячейки оборудования. */
export type SlotItemKind =
  | 'cockpit'
  | 'sensor'
  | 'reactor'
  | 'gyro'
  | 'arm_actuator'
  | 'leg_actuator'
  | 'fixed'
  | 'weapon'
  | 'ammo'
  | 'heatsink'
  | 'jump_jet'
  | 'equipment'
  | 'empty';

/** Состояние одной ячейки оборудования в зоне. */
export interface MechSlot {
  readonly kind: SlotItemKind;
  /** ID оружия/снаряжения/пачки, если применимо. */
  readonly id?: string;
  /** Индекс установки в `mounts`, если это оружие или его пачка. */
  readonly mountIndex?: number;
  /** Урон при детонации, если это пачка боезапаса. */
  readonly explosionDamage?: number;
  /** Повреждён/уничтожен ли слот критом. */
  readonly destroyed: boolean;
}

/** Установленное оружие. Разрушение руки снимает то, что в ней стояло. */
export interface MountState {
  readonly weapon: string;
  readonly zone: HitZone;
  /** null — энергетическое, боезапас не расходуется. */
  readonly ammo: number | null;
  readonly destroyed: boolean;
  /** Индексы ячеек в зоне, занятых этой установкой. */
  readonly slotIndices: readonly number[];
  /** Стреляла ли эта установка в текущем ходу. Залп — каждый ствол по разу. */
  readonly firedThisTurn: boolean;
}

/** Робот или огневая точка (шаг 73c). */
export type UnitFrame = 'mech' | 'emplacement';

export interface MechUnit {
  readonly id: UnitId;
  readonly side: Side;
  /** Ключ шасси в таблице данных. */
  readonly chassis: string;
  readonly weightClass: WeightClass;
  /**
   * MP ходьбы платформы: выводится из техбазы/тоннажа/тира реактора через
   * `makePlatform` один раз при создании юнита, не хранится в `chassis.json`
   * (шаг 6, часть B — `mpBudget` считается по машине, а не по весовому классу).
   */
  readonly walkMP: number;
  readonly pilot: Pilot;
  readonly hex: Hex;
  readonly facing: Direction;
  /** Сколько MP осталось в текущем ходу. */
  readonly mpLeft: number;
  /** Режим, в котором юнит двигался в этом ходу; null — ещё не двигался. */
  readonly moveMode: MoveMode | null;
  /** Пройдено гексов за ход: нужно для модификатора попадания по цели. */
  readonly hexesMoved: number;
  /** Глубина погружения: влияет на укрытие и на стрельбу. */
  readonly submerged: 0 | 1 | 2;
  /** Робот упал и тратит ход на подъём. */
  readonly prone: boolean;
  /** Зоны по индексу HitZone. */
  readonly zones: readonly ZoneState[];
  readonly mounts: readonly MountState[];
  /** Раскладка слотов по зонам (индекс HitZone -> массив ячеек). */
  readonly slots: readonly (readonly MechSlot[])[];
  readonly heat: number;
  /** Урон, полученный в этом ходу: входит в проверку исполнения. */
  readonly damageThisTurn: number;
  readonly fellThisTurn: boolean;
  /** Стрелял ли в этой фазе. */
  readonly hasFired: boolean;
  /**
   * Сколько раз машина открывала огонь за бой. Счётчик боя, а не хода: дважды
   * выстреливший опознан навсегда (`combat.json` → detection.identifyAfterShots),
   * потому что вспышку выстрела помехами не заглушить (шаг 7).
   */
  readonly shotsSeen: number;
  /** Робот выведен из строя: разрушен торс, кокпит либо выбыл пилот. */
  readonly destroyed: boolean;
  /**
   * Машина ОТОШЛА с поля своим ходом (шаг 43) — ушла целой, а не выбыла.
   *
   * Отдельный признак, а не `destroyed`: ушедшая машина не трофей и остаётся у
   * своего хозяина, и всё, что считает трофеи (`debrief/index.ts`), выводится
   * из `destroyed`. В строю она при этом не числится — `BattleState.active` и
   * `rules/objective.ts::isActive` её не считают: её на поле больше нет.
   */
  readonly withdrawn: boolean;
  /** Обесточен (аварийное отключение реактора). */
  readonly shutdown: boolean;
  /**
   * Засадная машина или огневая точка, которая ещё не включилась (шаг 73a).
   *
   * Стоит обесточенной — ровно в том же `shutdown`, что и после перегрева: не
   * ходит, не стреляет, по ней легче попасть. Признак держит отключение до
   * включения (`execute.ts`) и прячет её от сенсоров дальше
   * `combat.json → ambush.spotRange` (`detection.ts`). Отдельного «режима
   * засады» в правилах нет.
   */
  readonly dormant: boolean;
  /**
   * Засаду обнаружили ДО включения (решение пользователя 2026-09-24): прошли
   * рядом или разглядели. Обнаруженная видна сенсорам как обычная обесточенная
   * машина, и включившись, первую фазу огня пропускает — перезапуск реактора
   * занимает ход. Необнаруженная открывает огонь сразу.
   */
  readonly spotted: boolean;
  /**
   * Машина нанимателя на стороне роты (шаг 73b): ходит за неё бот, игрок ею не
   * командует, и кампании она не принадлежит — ни в потери, ни в опыт, ни в
   * трофеи роты она не попадает (`fromBattle.ts`, `debrief`).
   */
  readonly ally: boolean;
  /**
   * Что это физически (шаг 73c): боевой робот или неподвижная огневая точка.
   *
   * Огневая точка — участник боя, а не отдельная сущность: выбор цели,
   * видимость, линия огня, навесной огонь, журнал и быстрый расчёт работают с
   * ней как с машиной. Чего у неё нет из правил меха — ходьбы, падений, тепла,
   * критов, пилота, морали и места в задаче боя, — перечислено в одном месте:
   * `rules/emplacement.ts`.
   */
  readonly frame: UnitFrame;
  /**
   * Объект-цель задачи боя (шаг 73d): узел связи, склад. Его разрушают на
   * штурме и удерживают на обороне (`rules/objective.ts`). Только у установок.
   */
  readonly objectiveTarget: boolean;
  /** Был ли обесточен в прошлом ходу (защита от петли отключения). */
  readonly shutdownLastTurn: boolean;
  /** Счётчики критических попаданий по ключевым системам. */
  readonly reactorHits: number;
  readonly gyroHits: number;
  readonly sensorHits: number;
  readonly legActuatorHits: readonly [number, number]; // [leftLeg, rightLeg]
  readonly armActuatorHits: readonly [number, number]; // [leftArm, rightArm]
}

const WEIGHT_BY_ID: Readonly<Record<string, WeightClass>> = {
  light: WeightClass.Light,
  medium: WeightClass.Medium,
  heavy: WeightClass.Heavy,
  assault: WeightClass.Assault,
};

export interface MakeUnitOptions {
  readonly id: UnitId;
  readonly side: Side;
  readonly chassis: string;
  readonly pilot: Pilot;
  readonly hex: Hex;
  readonly facing: Direction;
}

/**
 * Радиаторы, встроенные в сам реактор: ячеек не занимают и критом не выбиваются.
 * Всё, что сверх, висит на корпусе и уязвимо (`wiki/design/combat/critical.md`).
 */
export const INTEGRAL_HEAT_SINKS = 10;

/** Категория из `equipment.json` в вид ячейки. */
function slotKindOf(category: string): SlotItemKind {
  switch (category) {
    case 'heatsink':
      return 'heatsink';
    case 'jump_jet':
      return 'jump_jet';
    case 'ammo':
      return 'ammo';
    default:
      return 'equipment';
  }
}

/**
 * Раскладка слотов по зонам (несъёмное + навеска + пустые слоты).
 */
export function buildUnitSlots(def: ChassisDef): {
  slots: MechSlot[][];
  mountSlotIndices: number[][];
} {
  const baseSlots = CONSTRUCTION.zones.baseSlots;
  const slots: MechSlot[][] = Array.from({ length: ZONE_COUNT }, () => []);
  const mountSlotIndices: number[][] = Array.from({ length: def.mounts.length }, () => []);

  // 1. Несъёмные слоты для каждой зоны
  slots[HitZone.Head]!.push(
    { kind: 'cockpit', destroyed: false },
    { kind: 'sensor', destroyed: false },
    { kind: 'sensor', destroyed: false },
  );

  slots[HitZone.LeftArm]!.push(
    { kind: 'arm_actuator', id: 'shoulder', destroyed: false },
    { kind: 'arm_actuator', id: 'upper_arm', destroyed: false },
  );

  slots[HitZone.RightArm]!.push(
    { kind: 'arm_actuator', id: 'shoulder', destroyed: false },
    { kind: 'arm_actuator', id: 'upper_arm', destroyed: false },
  );

  slots[HitZone.LeftLeg]!.push(
    { kind: 'leg_actuator', id: 'hip', destroyed: false },
    { kind: 'leg_actuator', id: 'upper_leg', destroyed: false },
    { kind: 'leg_actuator', id: 'lower_leg', destroyed: false },
    { kind: 'leg_actuator', id: 'foot', destroyed: false },
  );

  slots[HitZone.RightLeg]!.push(
    { kind: 'leg_actuator', id: 'hip', destroyed: false },
    { kind: 'leg_actuator', id: 'upper_leg', destroyed: false },
    { kind: 'leg_actuator', id: 'lower_leg', destroyed: false },
    { kind: 'leg_actuator', id: 'foot', destroyed: false },
  );

  slots[HitZone.Torso]!.push(
    { kind: 'reactor', destroyed: false },
    { kind: 'reactor', destroyed: false },
    { kind: 'reactor', destroyed: false },
    { kind: 'gyro', destroyed: false },
    { kind: 'gyro', destroyed: false },
    { kind: 'fixed', id: 'life_support', destroyed: false },
  );

  const addSlot = (z: HitZone, slot: MechSlot): { zone: HitZone; index: number } => {
    const zoneName = ZONE_IDS[z];
    const max = baseSlots[zoneName] ?? 12;
    const targetSlots = slots[z]!;
    if (targetSlots.length < max) {
      const idx = targetSlots.length;
      targetSlots.push(slot);
      return { zone: z, index: idx };
    }
    // Переполнение уходит в торс
    const torsoSlots = slots[HitZone.Torso]!;
    if (z !== HitZone.Torso && torsoSlots.length < baseSlots.torso) {
      const idx = torsoSlots.length;
      torsoSlots.push(slot);
      return { zone: HitZone.Torso, index: idx };
    }
    const idx = targetSlots.length;
    targetSlots.push(slot);
    return { zone: z, index: idx };
  };

  // Пачки боезапаса. У собранного генератором шасси они лежат в `equipment` со
  // своей зоной — там и должны остаться: где именно стоит бомба, решает сборка,
  // и весь смысл CASE в том, что это осознанный выбор. Выводить зону из орудия
  // можно только для рукописных шасси, где списка снаряжения нет вовсе.
  const ammoFromEquipment = (def.equipment ?? []).filter(
    (e) => EQUIPMENT.get(e.id)?.category === 'ammo',
  );

  // 2. Установленное вооружение и пачки боезапаса
  for (let mIdx = 0; mIdx < def.mounts.length; mIdx++) {
    const m = def.mounts[mIdx]!;
    const z = zoneFromId(m.zone);
    const w = weapon(m.weapon);
    const wSlots = w.slots;

    for (let s = 0; s < wSlots; s++) {
      const res = addSlot(z, {
        kind: 'weapon',
        id: m.weapon,
        mountIndex: mIdx,
        destroyed: false,
      });
      if (res.zone === z) {
        mountSlotIndices[mIdx]!.push(res.index);
      }
    }

    // Тип боекомплекта берётся из таблицы соответствий; угадывать его нельзя —
    // промах здесь означал бы чужой `explosionDamage`, а разброс там от 0
    // (болванки Гаусса) до 400 (ящик пулемётных патронов).
    const ammoId =
      ammoFromEquipment.length === 0 && m.ammo !== null && m.ammo > 0
        ? AMMO_FOR_WEAPON[m.weapon]
        : undefined;
    if (ammoId !== undefined) {
      addSlot(z, {
        kind: 'ammo',
        id: ammoId,
        mountIndex: mIdx,
        explosionDamage: EQUIPMENT.get(ammoId)?.explosionDamage ?? 0,
        destroyed: false,
      });
    }
  }

  for (const e of ammoFromEquipment) {
    const eq = EQUIPMENT.get(e.id)!;
    for (let s = 0; s < eq.slots; s++) {
      addSlot(zoneFromId(e.zone), {
        kind: 'ammo',
        id: e.id,
        explosionDamage: eq.explosionDamage ?? 0,
        destroyed: false,
      });
    }
  }

  // 3. Дополнительное оборудование. Охладители сюда не попадают: их
  // единственный источник — `def.heatSinks` (шаг 4), иначе они считались бы
  // дважды — и в рассеивании, и в слотах.
  if (def.equipment) {
    for (const eq of def.equipment) {
      const e = EQUIPMENT.get(eq.id);
      if (e === undefined || e.category === 'heatsink' || e.category === 'ammo') continue;
      const z = zoneFromId(eq.zone);
      for (let s = 0; s < e.slots; s++) {
        addSlot(z, { kind: slotKindOf(e.category), id: eq.id, destroyed: false });
      }
    }
  }

  // 4. Навесные охладители. Очки, что дал сам реактор, сидят внутри него: ячеек
  // не занимают, крит их не достаёт. Всё сверх того развешено по корпусу, и вот
  // оно уже уязвимо — перебитая ячейка возвращается теплом.
  //
  // Граница берётся у ШАССИ, а не из общей константы: база реактора у Сферы 10,
  // у Кланов 20, и класс исполнения двигает её ещё на ±2…4. С константой 10 у
  // клановой машины десять очков собственного охлаждения реактора оказывались
  // выбиваемыми ячейками — её отвод сбивали до сферной десятки, хотя разбить
  // реактор радиаторным критом нельзя (`notes.md` §10d). Каталожные шасси
  // `chassis.json` поля не несут: там каноничный счёт радиаторов, встроенных
  // ровно десять.
  const external = Math.max(0, def.heatSinks - (def.integralHeatSinks ?? INTEGRAL_HEAT_SINKS));
  const sinkZones: readonly HitZone[] = [
    HitZone.Torso,
    HitZone.LeftLeg,
    HitZone.Torso,
    HitZone.RightLeg,
    HitZone.Torso,
    HitZone.LeftArm,
    HitZone.Torso,
    HitZone.RightArm,
  ];
  for (let i = 0; i < external; i++) {
    addSlot(sinkZones[i % sinkZones.length]!, { kind: 'heatsink', destroyed: false });
  }

  // 5. Заполнение оставшихся ячеек пустыми слотами до baseSlots
  for (let z = 0; z < ZONE_COUNT; z++) {
    const zoneName = ZONE_IDS[z as HitZone];
    const max = baseSlots[zoneName] ?? 6;
    const zSlots = slots[z]!;
    while (zSlots.length < max) {
      zSlots.push({ kind: 'empty', destroyed: false });
    }
  }

  return { slots, mountSlotIndices };
}

/** Сборка робота из таблицы шасси: броня, структура и вооружение приезжают из данных. */
export function makeUnit(opts: MakeUnitOptions): MechUnit {
  const def = chassis(opts.chassis);
  const wc = WEIGHT_BY_ID[def.weightClass];
  if (wc === undefined) throw new RangeError(`Неизвестный весовой класс: ${def.weightClass}`);

  const zones: ZoneState[] = new Array<ZoneState>(ZONE_COUNT);
  for (const [id, row] of Object.entries(def.zones)) {
    const z = zoneFromId(id as ZoneId);
    zones[z] = {
      armor: row.armor,
      structure: row.structure,
      maxArmor: row.armor,
      maxStructure: row.structure,
      destroyed: false,
    };
  }

  const { slots, mountSlotIndices } = buildUnitSlots(def);

  const mounts: MountState[] = def.mounts.map((m, idx) => ({
    weapon: m.weapon,
    zone: zoneFromId(m.zone),
    ammo: m.ammo,
    destroyed: false,
    slotIndices: mountSlotIndices[idx] ?? [],
    firedThisTurn: false,
  }));

  const walkMP = makePlatform(def.techBase, def.tons, def.reactorTier, def.frameTier).walkMP;

  return {
    id: opts.id,
    side: opts.side,
    chassis: def.id,
    weightClass: wc,
    walkMP,
    pilot: opts.pilot,
    hex: opts.hex,
    facing: opts.facing,
    mpLeft: 0,
    moveMode: null,
    hexesMoved: 0,
    submerged: 0,
    prone: false,
    zones,
    mounts,
    slots,
    heat: 0,
    damageThisTurn: 0,
    fellThisTurn: false,
    hasFired: false,
    shotsSeen: 0,
    destroyed: false,
    withdrawn: false,
    shutdown: false,
    dormant: false,
    spotted: false,
    ally: false,
    frame: 'mech',
    objectiveTarget: false,
    shutdownLastTurn: false,
    reactorHits: 0,
    gyroHits: 0,
    sensorHits: 0,
    legActuatorHits: [0, 0],
    armActuatorHits: [0, 0],
  };
}

export function zoneState(unit: MechUnit, z: HitZone): ZoneState {
  const s = unit.zones[z];
  if (s === undefined) throw new RangeError(`Нет зоны ${z} у ${unit.id}`);
  return s;
}

/** Уровень глаз для линии видимости: стоящий робот на уровень выше клетки. */
export function eyeLevelOffset(unit: MechUnit): number {
  return unit.prone ? 0 : 1;
}

/**
 * Вскрыта ли внутренняя структура хоть где-то. Входит в проверку исполнения:
 * пилот в машине с оголённым каркасом действует хуже.
 */
export function structureBreached(unit: MechUnit): boolean {
  return unit.zones.some((z) => !z.destroyed && z.armor === 0 && z.maxArmor > 0);
}

/**
 * Оружие, из которого можно стрелять прямо сейчас: цело, зона цела, боезапас
 * есть, робот не обесточен и этот ствол ещё не стрелял в этом ходу.
 *
 * Залп собирается из повторных выстрелов, а не из одной команды: игрок бьёт по
 * очереди и после каждого попадания решает, добавить ли ещё. Поэтому запрет
 * живёт на установке, а не на роботе.
 */
export function availableMounts(unit: MechUnit): MountState[] {
  if (unit.shutdown) return [];
  return unit.mounts.filter(
    (m) =>
      !m.destroyed &&
      !m.firedThisTurn &&
      !zoneState(unit, m.zone).destroyed &&
      (m.ammo === null || m.ammo > 0),
  );
}

/** Сброс отметок «стрелял» на всех установках в конце хода. */
export function rearmMounts(unit: MechUnit): MechUnit {
  if (!unit.mounts.some((m) => m.firedThisTurn)) return unit;
  return { ...unit, mounts: unit.mounts.map((m) => ({ ...m, firedThisTurn: false })) };
}

/** Может ли робот вообще действовать. Пилот без сознания или мех обесточен — робот стоит. */
export function isOperational(unit: MechUnit): boolean {
  return !unit.destroyed && !unit.withdrawn && !unit.shutdown && unit.pilot.status === 'active';
}

/** Разрушение руки снимает установленное в ней вооружение. */
export function mountsInZone(unit: MechUnit, z: HitZone): MountState[] {
  return unit.mounts.filter((m) => m.zone === z);
}

export function armMounts(unit: MechUnit): MountState[] {
  return unit.mounts.filter((m) => isArm(m.zone));
}

/** Сумма оставшейся брони и структуры — грубая оценка «сколько ещё держится». */
export function integrity(unit: MechUnit): number {
  return unit.zones.reduce((acc, z) => acc + z.armor + z.structure, 0);
}

export function maxIntegrity(unit: MechUnit): number {
  return unit.zones.reduce((acc, z) => acc + z.maxArmor + z.maxStructure, 0);
}

/**
 * Расход боезапаса конкретной установки.
 *
 * Пул установки считается ВЫСТРЕЛАМИ, а не снарядами: сколько их съедает залп,
 * решает `ammoPerVolley`. Прямое вычитание `w.shots` тратило на один залп
 * столько выстрелов, сколько в связке ракет, и осушало РДД-20 с первого же
 * нажатия (см. докстринг `ammoPerVolley`).
 */
export function spendAmmo(unit: MechUnit, mountIndex: number): MechUnit {
  const m = unit.mounts[mountIndex];
  if (m === undefined || m.ammo === null) return unit;
  const w = weapon(m.weapon);
  const left = Math.max(0, m.ammo - ammoPerVolley(w));
  const mounts = unit.mounts.slice();
  mounts[mountIndex] = { ...m, ammo: left };
  return { ...unit, mounts };
}

/**
 * Есть ли в зоне рабочий CASE.
 *
 * У кланской техники он встроен и бесплатен по массе и слотам — асимметрия
 * намеренная, см. `wiki/design/mechs/equipment.md`. Поэтому проверка идёт по
 * техбазе шасси из данных, а не по виду ячейки: кланской ячейки CASE не бывает.
 */
export function hasCase(unit: MechUnit, z: HitZone): boolean {
  if (chassis(unit.chassis).techBase === 'clan') return true;
  const zSlots = unit.slots[z];
  if (!zSlots) return false;
  return zSlots.some((s) => s.id === 'is_case' && !s.destroyed);
}

/** Проверка наличия рабочей системы защиты CASE II в зоне. */
export function hasCase2(unit: MechUnit, z: HitZone): boolean {
  const zSlots = unit.slots[z];
  if (!zSlots) return false;
  return zSlots.some((s) => s.id === 'case2' && !s.destroyed);
}

/**
 * Рассеивание тепла машиной за ход — в очках отвода, тех же самых, что считает
 * цех (`construction.ts::validateAssembly`).
 *
 * Одна шкала на конструктор и на бой (шаг 46). До неё графа `heatSinks` читалась
 * здесь как число радиаторов и делилась пополам, а складывались в него очки, —
 * ангар обещал отвод 16, машина отводила 6-8, двойной охладитель работал как
 * одинарный, а восстановленный реактор ничем не отличался от серийного, потому
 * что разницу съедал нижний порог.
 *
 * Крит вычитает ровно то очко, что этот радиатор давал: ячейки охладителей
 * раскладываются по одной на очко сверх встроенных в реактор
 * (`INTEGRAL_HEAT_SINKS`), поэтому перебитая ячейка — это минус единица отвода,
 * без пересчётов и округлений.
 */
export function unitDissipation(unit: MechUnit): number {
  const designed = chassis(unit.chassis).heatSinks;
  let lost = 0;
  for (let z = 0; z < ZONE_COUNT; z++) {
    for (const s of unit.slots[z] ?? []) {
      if (s.kind === 'heatsink' && s.destroyed) lost += 1;
    }
  }
  return Math.max(1, designed - lost);
}
