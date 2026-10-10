import { QUALITY, REPAIR, tierPriceFactor, type ChassisDef } from '../../data/index.js';
import { ZONE_IDS, type ZoneId } from '../../model/HitZone.js';
import { DEFAULT_QUALITY_CLASS, type QualityClass } from '../../model/QualityClass.js';
import { getChassisCatalogEntry } from '../../rules/construction.js';
import {
  brokenSlots,
  recordMaxZones,
  recordChassisDef,
  recordQuality,
  type MechRecord,
  type WearNode,
} from './MechRecord.js';

/**
 * План ремонта: сколько это стоит и сколько занимает (шаг 11).
 *
 * Здесь только счёт. Списывать деньги, занимать стапель и двигать календарь
 * будет шаг 13 — ремонт становится задачей в очереди суток (`core/campaign/clock.ts`),
 * а не мгновенным пересчётом полей.
 *
 * Все числа — из `data/repair.json` и `data/quality.json`. Ни одной зашитой
 * константы: цены выверяются замером кампании на шагах 13 и 16, и подгонять их
 * придётся в данных, а не в коде.
 */

export type RepairJobKind = 'armor' | 'structure' | 'slot' | 'ammo' | 'reactor' | 'frame';

export interface RepairJob {
  readonly kind: RepairJobKind;
  readonly zone?: ZoneId;
  readonly cost: number;
  readonly days: number;
  /** Количество единиц (очков брони, структуры, слотов или % боекомплекта). */
  readonly amount?: number;
  /**
   * Выполнима ли работа вообще.
   *
   * Разрушенную вдребезги зону чинить нечем — это правило, а не недоработка
   * (`wiki/design/campaign/global-layer.md`). Такая работа попадает в план
   * невыполнимой, чтобы игрок видел, ЧТО именно нельзя починить, а не пустой
   * список.
   */
  readonly possible: boolean;
  /**
   * Почему работа невыполнима — видом, а не фразой (шаг 52): `sameClass` — узел
   * уже этого класса, `notWorn` — узел не изношен, `zoneDestroyed` — зона
   * разрушена, и восстанавливается она только заменой узла целиком (шаг 13).
   * До шага 52 у работы была ещё подпись `label` по-русски; её не показывал ни
   * один экран — ангар называет работу по `kind`, зоне и `amount`.
   */
  readonly note?: RepairNote;
}

export type RepairNote = 'sameClass' | 'notWorn' | 'zoneDestroyed';

export interface RepairPlan {
  readonly jobs: readonly RepairJob[];
  /** Стоимость выполнимых работ. */
  readonly cost: number;
  /** Дни выполнимых работ. Параллельность цеха — шаг 13, здесь честная сумма. */
  readonly days: number;
  readonly blocked: number;
}

function round(n: number): number {
  return Math.round(n);
}

function days(n: number): number {
  return Math.max(REPAIR.days.minimum, Math.round(n * 2) / 2);
}

/**
 * Паспорт узла: всё, от чего зависит его цена, и ничего сверх того.
 *
 * Заведён шагом 15: рынок торгует узлами, которых ещё нет ни на одной машине
 * отряда, и складская запись живёт отдельно от записи машины. Цену такого узла
 * надо уметь считать без `MechRecord` — а тоннаж и тир как раз и есть всё, что
 * для этого нужно.
 */
export interface NodeSpec {
  readonly node: WearNode;
  readonly tonnage: number;
  readonly tier: number;
}

/**
 * Цена узла: тоннаж × класс × тир.
 *
 * Тир входит в цену отдельным множителем, потому что быстрый реактор дороже
 * медленного и в деньгах, а не только в тоннах
 * (`wiki/design/mechs/classification.md` §5, «Цена самого тира»). Множитель
 * класса — отношение звёзд к звёздам серийного, то есть таблица вики читается
 * буквально, а не пересказывается числами в коде.
 */
export function nodeCost(spec: NodeSpec, cls: QualityClass): number {
  const perTon = spec.node === 'reactor' ? REPAIR.cost.reactorPerTon : REPAIR.cost.framePerTon;
  const starFactor = QUALITY[cls].stars / QUALITY[DEFAULT_QUALITY_CLASS].stars;
  return round(perTon * spec.tonnage * starFactor * tierPriceFactor(spec.tier));
}

/** Паспорт узла конкретной машины: тоннаж и тир берутся из каталога шасси. */
export function recordNodeSpec(record: MechRecord, node: WearNode): NodeSpec {
  const entry = getChassisCatalogEntry(record.assembly.chassisCode);
  return {
    node,
    tonnage: entry.tonnage,
    tier: node === 'reactor' ? entry.reactorTier : entry.frameTier,
  };
}

/** Цена узла машины отряда. Тот же счёт, что `nodeCost`, только паспорт берётся из записи. */
export function partCost(record: MechRecord, node: WearNode, cls: QualityClass): number {
  return nodeCost(recordNodeSpec(record, node), cls);
}

/** Замена узла на другой класс. Повышение — покупка, а не ремонт, и стоит соответственно. */
export function replaceJob(record: MechRecord, node: WearNode, target: QualityClass): RepairJob {
  const current = recordQuality(record)[node];
  return {
    kind: node,
    cost: partCost(record, node, target),
    days: days(REPAIR.days.partSwap),
    possible: current !== target,
    ...(current === target ? { note: 'sameClass' as const } : {}),
  };
}

/**
 * Восстановление изношенного узла без смены класса.
 *
 * Дешевле замены (`restoreShare`), и это вторая половина петли, которую просил
 * пользователь: бои изнашивают → изношенное восстанавливают → совсем убитое
 * меняют. Сбрасывает счётчик износа, но не поднимает класс.
 */
export function restoreJob(record: MechRecord, node: WearNode): RepairJob {
  const current = recordQuality(record)[node];
  const full = partCost(record, node, current);
  const worn = record.wear[node] / REPAIR.wear.threshold;
  return {
    kind: node,
    cost: round(full * REPAIR.cost.restoreShare * worn),
    days: days(REPAIR.days.partSwap * worn),
    possible: record.wear[node] > 0,
    ...(record.wear[node] > 0 ? {} : { note: 'notWorn' as const }),
  };
}

/**
 * Сколько бункеров боекомплекта не хватает зоне до паспорта, долями.
 *
 * Расстрелянный боезапас — такая же недостача до паспорта, как выбитая броня, и
 * без этой работы машина после первого же боя уезжает на следующий контракт с
 * пустым автопушечным бункером навсегда: перезаряжать её было бы нечем
 * (найдено при приёмке шага 13 — `wiki/decisions.md`, 2026-09-01).
 */
function missingAmmoBins(record: MechRecord, def: ChassisDef, zone: ZoneId): number {
  let bins = 0;
  def.mounts.forEach((mount, m) => {
    if (mount.zone !== zone || mount.ammo === null || mount.ammo <= 0) return;
    const left = record.condition.ammo[m] ?? mount.ammo;
    bins += Math.max(0, mount.ammo - left) / mount.ammo;
  });
  return bins;
}

/**
 * Что нужно, чтобы вернуть машину в паспортное состояние.
 *
 * Класс не трогается: повышение — отдельная покупка (`replaceJob`), а не часть
 * ремонта. Иначе лестница «подобрал → починил → накопил → поставил армейский»
 * схлопнулась бы в одну кнопку.
 */
export function repairPlan(record: MechRecord): RepairPlan {
  const def = recordChassisDef(record);
  // Потолки берутся с поправкой на кустарные латки (шаг 33): ремонт доводит
  // латаную конечность до ЕЁ потолка, а не до заводского. Иначе латка снималась
  // бы обычной доливкой брони и не значила бы ничего.
  const limits = recordMaxZones(record);
  const jobs: RepairJob[] = [];

  record.condition.zones.forEach((zone, i) => {
    const id = ZONE_IDS[i] as ZoneId;
    const lim = limits[i];
    if (lim === undefined) return;

    if (zone.destroyed) {
      jobs.push({
        kind: 'structure',
        zone: id,
        cost: 0,
        days: 0,
        possible: false,
        note: 'zoneDestroyed',
      });
      return;
    }

    const structureGap = lim.structure - zone.structure;
    if (structureGap > 0) {
      jobs.push({
        kind: 'structure',
        zone: id,
        cost: round(structureGap * REPAIR.cost.structurePoint),
        days: days(structureGap / REPAIR.days.structurePointsPerDay),
        amount: structureGap,
        possible: true,
      });
    }

    const armorGap = lim.armor - zone.armor;
    if (armorGap > 0) {
      jobs.push({
        kind: 'armor',
        zone: id,
        cost: round(armorGap * REPAIR.cost.armorPoint),
        days: days(armorGap / REPAIR.days.armorPointsPerDay),
        amount: armorGap,
        possible: true,
      });
    }

    // Только ячейки, где было что ломать: пустые метки старых сохранений не в счёт.
    const slots = brokenSlots(record, i).length;
    if (slots > 0) {
      jobs.push({
        kind: 'slot',
        zone: id,
        cost: round(slots * REPAIR.cost.slot),
        days: days(slots * REPAIR.days.perSlot),
        amount: slots,
        possible: true,
      });
    }

    const bins = missingAmmoBins(record, def, id);
    if (bins > 0) {
      jobs.push({
        kind: 'ammo',
        zone: id,
        cost: round(bins * REPAIR.cost.ammoBin),
        days: days(bins * REPAIR.days.perAmmoBin),
        amount: Math.round(bins * 100),
        possible: true,
      });
    }
  });

  const doable = jobs.filter((j) => j.possible);
  return {
    jobs,
    cost: doable.reduce((n, j) => n + j.cost, 0),
    days: Math.round(doable.reduce((n, j) => n + j.days, 0) * 2) / 2,
    blocked: jobs.length - doable.length,
  };
}
