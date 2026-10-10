import { CHASSIS_CATALOG, REPAIR, type ChassisDef } from '../../data/index.js';
import { isVital as isVitalZone, type HitZone as ZoneIndex } from '../../model/HitZone.js';
import { ZONE_COUNT, ZONE_IDS, zoneFromId, type ZoneId } from '../../model/HitZone.js';
import { STANDARD_QUALITY, type MechQuality, type QualityClass } from '../../model/QualityClass.js';
import { assemblyToChassisDef, type MechAssembly } from '../../rules/construction.js';
import { buildUnitSlots } from '../../model/MechUnit.js';

/**
 * Машина отряда вне боя (шаг 11).
 *
 * `MechUnit` живёт ровно один бой и знает про клетки, фасинг и тепло.
 * `MechRecord` живёт между боями и знает про класс исполнения, износ и то, что
 * осталось от брони. Боевой юнит ВЫВОДИТСЯ из записи на входе в бой и
 * складывается обратно на выходе — мостом шага 12, не здесь.
 *
 * Считать заново почти нечего: зоны, ячейки и боезапас уже лежат в `MechUnit` в
 * нужном виде. Новых сущностей ровно две — класс исполнения и износ.
 */

/**
 * Узлы, у которых есть класс исполнения и собственный износ.
 *
 * Только реактор и каркас — ровно те, для которых
 * `wiki/design/mechs/classification.md` §5 задаёт множители. Класс отдельных
 * орудий не заводится намеренно: множителей для него в вики нет, а выдумать их
 * значило бы выдумать баланс. Открытый вопрос шагов 13/15.
 */
export const WEAR_NODES = ['reactor', 'frame'] as const;
export type WearNode = (typeof WEAR_NODES)[number];

export interface ZoneCondition {
  readonly armor: number;
  readonly structure: number;
  readonly destroyed: boolean;
}

/** Что осталось от машины. Индексация зон — по `HitZone`, как в бою. */
export interface MechCondition {
  readonly zones: readonly ZoneCondition[];
  /** Индексы выбитых ячеек по зоне. */
  readonly destroyedSlots: readonly (readonly number[])[];
  /** Остаток боезапаса по установке; `null` — энергетическое орудие. */
  readonly ammo: readonly (number | null)[];
  readonly destroyedMounts: readonly boolean[];
  /**
   * Кустарная латка по зонам (шаг 33): конечность, восстановленная полевой
   * заменой, а не заводским стапелем.
   *
   * Заменена причина наказания. До этого шага одна оторванная нога роняла класс
   * каркаса ВСЕЙ машины сразу на дно шкалы, хотя торс, кокпит, реактор и
   * гироскоп в бою не пострадали. Теперь общий каркас падает максимум на
   * ступень, а расплата за полевую работу локальна: латаная зона держит меньше
   * структуры, пока её не перебрали в заводском цеху.
   *
   * Индекс — `HitZone`. Поле необязательное: старые сохранения его не имеют и
   * читаются как машина без латок.
   */
  readonly patchedZones?: readonly boolean[];
  /**
   * Запас прочности каркаса (шаг 66): сколько успешных полевых замен подряд
   * уже накоплено с последней заводской переборки. На `REPAIR.frameLoss.perStep`
   * такой замене каркас теряет ступень класса, а счётчик падает до нуля —
   * ровно как латки. Заводская переборка (`UpgradeClass`/`InstallPart` с узлом
   * `frame`) обнуляет его тоже, а обслуживание на стапеле (ремонт зоны,
   * восстановление износа) — нет.
   *
   * Поле необязательное: старые сохранения его не имеют и читаются как машина
   * без накопленного запаса.
   */
  readonly frameLossCount?: number;
}

export interface MechRecord {
  readonly id: string;
  /** Собственное имя машины. Описание, механики не касается. */
  readonly name: string;
  readonly assembly: MechAssembly;
  readonly condition: MechCondition;
  /** Износ узла, 0..threshold. На пороге узел теряет ступень класса. */
  readonly wear: Readonly<Record<WearNode, number>>;
  readonly pilotId: string | null;
  readonly battles: number;
  /**
   * Фракция, от которой машина пришла (шаг 50): владелец системы для купленной,
   * противник для трофея. Нет поля — машина своей роты (стартовая тройка,
   * сохранения до шага 50).
   *
   * Игровой факт, а не показ: ядро не знает, что по нему выбирается раскраска.
   * В хэш кампании не входит — как и имя, на правила не влияет.
   */
  readonly originFaction?: string;
  /** Раскраска после перекраски на стапеле — id из `data/paints.json`. Нет — по происхождению. */
  readonly paint?: string;
}

export function recordQuality(record: MechRecord): MechQuality {
  return record.assembly.quality ?? STANDARD_QUALITY;
}

/** Боевая спецификация записи: класс уже учтён уравнением массы. */
export function recordChassisDef(record: MechRecord): ChassisDef {
  return assemblyToChassisDef(record.assembly);
}

/** Полные значения зон по спецификации — потолок, до которого чинят. */
export function maxZones(def: ChassisDef): ZoneCondition[] {
  const out: ZoneCondition[] = [];
  for (let z = 0; z < ZONE_COUNT; z++) {
    const id = ZONE_IDS[z] as ZoneId;
    const zone = def.zones[id];
    out.push({ armor: zone.armor, structure: zone.structure, destroyed: false });
  }
  return out;
}

/**
 * Потолки зон КОНКРЕТНОЙ машины: паспорт с поправкой на кустарные латки
 * (шаг 33).
 *
 * `maxZones` отвечает на вопрос «сколько держит эта модель», а эта функция — на
 * вопрос «сколько держит эта машина». Разница ровно в латках: конечность,
 * приваренную в поле, не довести до паспорта ремонтом — её надо перебрать на
 * заводском стапеле, и до тех пор она слабее штатной.
 *
 * Ремонт доводит зону до ЭТОГО потолка, а не до заводского: иначе латка
 * снималась бы обычной доливкой брони и не значила бы ничего.
 */
export function recordMaxZones(record: MechRecord): ZoneCondition[] {
  const limits = maxZones(recordChassisDef(record));
  const patched = record.condition.patchedZones;
  if (patched === undefined) return limits;

  const keep = 1 - REPAIR.patch.structurePenalty;
  return limits.map((lim, z) =>
    patched[z] === true
      ? { ...lim, structure: Math.max(1, Math.round(lim.structure * keep)) }
      : lim,
  );
}

/** Есть ли на машине хоть одна кустарная латка. */
export function hasPatches(record: MechRecord): boolean {
  return record.condition.patchedZones?.some((p) => p) === true;
}

export interface MakeRecordOptions {
  readonly id: string;
  readonly name?: string | undefined;
  readonly assembly: MechAssembly;
  readonly pilotId?: string | null | undefined;
  readonly originFaction?: string | undefined;
}

/** Новая машина в полном порядке: броня и структура по спецификации, износа нет. */
export function makeRecord(opts: MakeRecordOptions): MechRecord {
  const def = assemblyToChassisDef(opts.assembly);
  // Имя ищется мягко: сборка с шифром вне каталога (самодельная, из старого
  // сохранения) получает свой id, а не RangeError из `getChassisCatalogEntry`.
  const name =
    opts.name ??
    (opts.assembly.name || CHASSIS_CATALOG.get(opts.assembly.chassisCode)?.canonName || opts.id);
  return {
    id: opts.id,
    name,
    assembly: opts.assembly,
    condition: {
      zones: maxZones(def),
      destroyedSlots: Array.from({ length: ZONE_COUNT }, () => []),
      ammo: def.mounts.map((m) => m.ammo),
      destroyedMounts: def.mounts.map(() => false),
    },
    wear: { reactor: 0, frame: 0 },
    pilotId: opts.pilotId ?? null,
    battles: 0,
    ...(opts.originFaction !== undefined ? { originFaction: opts.originFaction } : {}),
  };
}

/**
 * Сменить класс узла.
 *
 * Обязательно вместе с подрезкой состояния: класс каркаса меняет структуру, а
 * потолок брони считается как удвоенная структура. Понизили класс — и
 * сохранённая броня оказалась бы выше нового потолка, то есть ремонт вниз давал
 * бы машину крепче паспорта.
 */
export function withQuality(
  record: MechRecord,
  node: WearNode,
  cls: QualityClass,
): MechRecord {
  const quality: MechQuality = { ...recordQuality(record), [node]: cls };
  const next: MechRecord = { ...record, assembly: { ...record.assembly, quality } };
  return clampCondition(next);
}

/** Подрезать состояние под текущую спецификацию. Разрушенные зоны остаются разрушенными. */
export function clampCondition(record: MechRecord): MechRecord {
  const limits = recordMaxZones(record);
  const zones = record.condition.zones.map((z, i) => {
    const lim = limits[i] ?? z;
    return {
      armor: Math.min(z.armor, lim.armor),
      structure: Math.min(z.structure, lim.structure),
      destroyed: z.destroyed,
    };
  });
  return { ...record, condition: { ...record.condition, zones } };
}

/** Зона по имени — для планов ремонта и показа. */
export function zoneCondition(record: MechRecord, zone: ZoneId): ZoneCondition {
  const z = record.condition.zones[zoneFromId(zone)];
  if (z === undefined) throw new RangeError(`Нет зоны ${zone} в записи ${record.id}`);
  return z;
}

/**
 * Лом: разрушен торс или голова.
 *
 * Такие зоны полевой заменой не восстанавливаются (`isVital`), поэтому машина
 * не вернётся в паспорт никаким ремонтом — годится только на разбор. Один
 * признак на всех: соперники по нему не выводят машину в бой, мехлаб по нему
 * не советует игроку ремонт, который невозможен.
 */
export function isWreck(record: MechRecord): boolean {
  return record.condition.zones.some((z, i) => z.destroyed && isVitalZone(i as ZoneIndex));
}

/**
 * Выбитые ячейки зоны, в которых БЫЛО что ломать.
 *
 * С плейтеста 2026-09-15 крит в пустую и служебную ячейку ничего не помечает
 * (`rules/critical.ts`). Но сохранения до этой правки уже несут такие метки, и
 * читать `destroyedSlots` напрямую значило бы брать за них деньги ремонта и
 * запрещать из-за них демонтаж. Поэтому все, кто спрашивает «что в зоне
 * сломано», спрашивают здесь: номер ячейки сверяется с раскладкой машины.
 */
export function brokenSlots(record: MechRecord, zone: number): readonly number[] {
  const marked = record.condition.destroyedSlots[zone] ?? [];
  if (marked.length === 0) return marked;
  const layout = buildUnitSlots(recordChassisDef(record)).slots[zone] ?? [];
  return marked.filter((i) => {
    const kind = layout[i]?.kind;
    return kind !== undefined && kind !== 'empty' && kind !== 'fixed';
  });
}

/** Машина цела: ни одна зона не разрушена и всё починено до паспорта. */
export function isPristine(record: MechRecord): boolean {
  // Латаная машина в паспортном состоянии БЫВАЕТ: паспорт у неё свой, с
  // поправкой на латку (шаг 33). Иначе одна полевая замена навсегда закрывала
  // бы мехлаб — ровно то, на что жалуется questions.md п. 15.
  const limits = recordMaxZones(record);
  return record.condition.zones.every((z, i) => {
    const lim = limits[i];
    return (
      lim !== undefined && !z.destroyed && z.armor >= lim.armor && z.structure >= lim.structure
    );
  });
}

/**
 * Имеет ли машина все конечности и восстановленную внутреннюю структуру.
 *
 * Броня может быть повреждена или отсутствовать (она расходник и почти не
 * влияет на стоимость машины), но все 6 зон обязаны быть не разрушены
 * и иметь полностью восстановленную внутреннюю структуру.
 */
export function hasIntactStructure(record: MechRecord): boolean {
  const limits = recordMaxZones(record);
  return record.condition.zones.every((z, i) => {
    const lim = limits[i];
    return lim !== undefined && !z.destroyed && z.structure >= lim.structure;
  });
}

