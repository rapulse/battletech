import { ECONOMY, REPAIR } from '../../data/index.js';
import { ZONE_COUNT, zoneFromId, type ZoneId } from '../../model/HitZone.js';
import { shiftQuality } from '../../model/QualityClass.js';
import type { Rng } from '../../rng/index.js';
import {
  maxZones,
  recordChassisDef,
  recordMaxZones,
  recordQuality,
  withQuality,
  type MechRecord,
} from '../mech/MechRecord.js';
import { repairPlan, type RepairJob } from '../mech/repair.js';

/**
 * Работы стапеля (шаг 13): счёт и применение для команд `RepairZone` и
 * `ReplacePart`. `UpgradeClass`/`RestoreWorn` считаются напрямую через
 * `replaceJob`/`restoreJob` из `mech/repair.ts` (шаг 11) — здесь только то,
 * чего в шаге 11 не было: ремонт зоны целиком и полевая замена узла из
 * разрушенной зоны.
 */

export interface ZoneJobPlan {
  readonly cost: number;
  readonly days: number;
  /** Сколько отдельных работ (броня/структура/ячейки) объединяет ремонт зоны. */
  readonly jobCount: number;
  readonly jobs: readonly RepairJob[];
}

/** Ремонт зоны целиком: броня, структура, выбитые ячейки и боекомплект одной работой одного дня. */
export function zoneRepairPlan(record: MechRecord, zone: ZoneId): ZoneJobPlan {
  const jobs = repairPlan(record).jobs.filter((j) => j.zone === zone && j.possible);
  return {
    cost: jobs.reduce((n, j) => n + j.cost, 0),
    days: Math.round(jobs.reduce((n, j) => n + j.days, 0) * 2) / 2,
    jobCount: jobs.length,
    jobs,
  };
}

/**
 * Довести зону до паспорта: применяется, когда работа `zoneRepairPlan` подошла по сроку.
 *
 * Вместе с бронёй, структурой и выбитыми ячейками восстанавливаются установки
 * этой зоны: снятая с юнита `destroyed`-метка и полный бункер. Иначе выходило
 * так, что за работу `slot` («замена оборудования») деньги брались, а орудие
 * оставалось выбитым навсегда, а расстрелянный боезапас не пополнялся ничем
 * вообще — машина после первого боя ехала на все следующие контракты с пустой
 * автопушкой (найдено при приёмке шага 13).
 */
export function applyZoneRepair(record: MechRecord, zone: ZoneId): MechRecord {
  const def = recordChassisDef(record);
  const idx = zoneFromId(zone);
  const lim = maxZones(def)[idx];
  if (lim === undefined) return record;
  const inZone = (m: number): boolean => def.mounts[m]?.zone === zone;
  return {
    ...record,
    condition: {
      ...record.condition,
      zones: record.condition.zones.map((z, i) => (i === idx ? { ...lim } : z)),
      destroyedSlots: record.condition.destroyedSlots.map((s, i) => (i === idx ? [] : s)),
      ammo: record.condition.ammo.map((a, m) => (inZone(m) ? (def.mounts[m]?.ammo ?? a) : a)),
      destroyedMounts: record.condition.destroyedMounts.map((d, m) => (inZone(m) ? false : d)),
    },
  };
}

/**
 * Полевая замена узла из разрушенной зоны (ловушка 1 брифинга шага 13).
 *
 * Стоит от тоннажа зоны плюс фиксированная надбавка полевой сборки — дороже
 * планового ремонта, потому что это не завод. Торс и голова сюда не попадают:
 * это проверяет вызывающая команда (`isVital`), не эта функция.
 */
export function replacePartPlan(record: MechRecord, zone: ZoneId): ZoneJobPlan {
  const idx = zoneFromId(zone);
  const lim = maxZones(recordChassisDef(record))[idx];
  const structure = lim?.structure ?? 0;

  // Надбавка за полевые работы масштабируется тоннажем платформы (шаг 33).
  // Плоские 40 000 составляли от 80 до 94 % всей суммы, из-за чего замена ноги
  // разведчика и штурмовика отличались меньше чем на пятую часть: переменная
  // часть от очков структуры одна этой разницы не делала.
  const tonnage = record.assembly.tonnage;
  const s = ECONOMY.replacePart.surcharge;
  const cost = round(s.base + tonnage * s.perTon + structure * REPAIR.cost.structurePoint);
  const days = Math.max(REPAIR.days.minimum, REPAIR.days.partSwap + structure / REPAIR.days.structurePointsPerDay);
  return { cost, days: Math.round(days * 2) / 2, jobCount: 1, jobs: [] };
}

function round(n: number): number {
  return Math.round(n);
}

export interface ReplacePartResult {
  readonly record: MechRecord;
  readonly success: boolean;
}

/**
 * Исход полевой замены — бросок решает, встал ли узел на место. Деньги и время
 * списываются при постановке работы независимо от исхода (см. `execute.ts`);
 * здесь только то, что происходит с записью, когда работа подошла по сроку.
 *
 * **Наказание пересмотрено шагом 33** (questions.md п. 19). Раньше одна
 * оторванная нога роняла класс каркаса ВСЕЙ машины сразу на дно шкалы —
 * мастерский каркас становился восстановленным за одну работу, хотя торс,
 * кокпит, реактор и гироскоп в бою не пострадали. За три контракта весь парк
 * оказывался восстановленным, и покупать заводские узлы за 180-580 тысяч
 * становилось бессмысленно: следующий же бой отменял покупку. Вертикальная
 * лестница качества выключалась как элемент игры.
 *
 * Стало:
 *   - **класс каркаса падает максимум на ОДНУ ступень** (`master → military →
 *     standard → recovered`), а не сбрасывается на дно;
 *   - **сама заменённая зона получает кустарную латку** — локальный штраф
 *     структуры (`repair.json` → patch), снимаемый только заводской переборкой
 *     каркаса;
 *   - **реактор не трогается вовсе**: оторванная нога к нему отношения не имеет.
 *
 * **Запас прочности добавлен шагом 66** (notes.md §10w): и одна полевая замена
 * всё ещё роняла класс, только не на дно, а на ступень — с тем же итогом за три
 * контракта. Теперь класс падает не с первой замены, а с
 * `REPAIR.frameLoss.perStep`-й подряд: счётчик `condition.frameLossCount`
 * копит удачные замены и падает до нуля, когда ступень наконец снята (или уже
 * упёрлась в дно). Заводская переборка каркаса (`UpgradeClass`/`InstallPart` с
 * узлом `frame`, `execute.ts`) обнуляет счётчик досрочно — обслуживание на
 * стапеле (ремонт зоны, восстановление износа) его не трогает. Латка ставится
 * КАЖДОЙ удачной заменой, а не только той, что уронила ступень.
 */
export function attemptReplacePart(record: MechRecord, zone: ZoneId, rng: Rng): ReplacePartResult {
  if (rng.next() >= ECONOMY.replacePart.successChance) return { record, success: false };

  const lossCount = (record.condition.frameLossCount ?? 0) + 1;
  const atStep = lossCount >= REPAIR.frameLoss.perStep;

  let next = record;
  if (atStep) {
    const currentFrame = recordQuality(record).frame;
    const dropped = shiftQuality(currentFrame, -1);
    next = dropped === currentFrame ? record : withQuality(record, 'frame', dropped);
    next = { ...next, condition: { ...next.condition, frameLossCount: 0 } };
  } else {
    next = { ...next, condition: { ...next.condition, frameLossCount: lossCount } };
  }

  const def = recordChassisDef(next);
  const idx = zoneFromId(zone);
  const inZone = (m: number): boolean => def.mounts[m]?.zone === zone;

  // Латка ставится ДО расчёта потолка: восстановленная зона встаёт сразу с
  // ослабленной структурой, а не с паспортной, которую потом молча срежут.
  const patched = markPatched(next.condition.patchedZones, idx);
  next = { ...next, condition: { ...next.condition, patchedZones: patched } };

  const lim = recordMaxZones(next)[idx];
  if (lim !== undefined) {
    next = {
      ...next,
      condition: {
        ...next.condition,
        zones: next.condition.zones.map((z, i) => (i === idx ? { armor: 0, structure: lim.structure, destroyed: false } : z)),
        destroyedSlots: next.condition.destroyedSlots.map((s, i) => (i === idx ? [] : s)),
        destroyedMounts: next.condition.destroyedMounts.map((d, m) => (inZone(m) ? false : d)),
      },
    };
  }
  return { record: next, success: true };
}

/** Отметить зону как латаную, заведя массив, если его ещё не было. */
function markPatched(current: readonly boolean[] | undefined, idx: number): boolean[] {
  const out = current === undefined ? new Array<boolean>(ZONE_COUNT).fill(false) : [...current];
  out[idx] = true;
  return out;
}
