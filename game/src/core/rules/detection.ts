import { COMBAT, EQUIPMENT } from '../data/tables.js';
import { distance, type Hex } from '../hex/index.js';
import { los, type HexMap } from '../map/index.js';
import { ContactLevel } from '../model/Contact.js';
import { eyeLevelOffset } from '../model/MechUnit.js';
import type { MechUnit, Side, UnitId } from '../model/MechUnit.js';

/**
 * Обнаружение: три уровня контакта (wiki/design/combat/terrain.md).
 *
 * Замысел одной строкой: **круг вокруг машины сообщает, что кто-то есть, и
 * ничего больше. Всё содержательное знание добывается через рельеф.**
 *
 * Отсюда деление уровней. `Blip` — работа сенсоров, ей холм не мешает, и она
 * честно не говорит ни класса, ни вооружения. `Silhouette` требует линии
 * видимости, то есть уже зависит от высот, леса, зданий и стен целиком.
 * `Identified` требует ещё и дистанции, которую лес и дым укорачивают. Значит
 * прятаться на карте можно, а прятаться от факта своего существования — нет.
 *
 * Контакт — свойство СТОРОНЫ, а не отдельной машины: приказы отдаёт сторона, и
 * если бы каждый робот знал своё, копьё из четырёх машин видело бы четыре
 * разные карты. Берётся максимум по всем живым машинам стороны — то же
 * решение, что «отметка стрелял живёт на установке, а не на роботе»: свойство
 * кладётся туда, где им пользуются.
 */

/** Суммарный радиус пробника носителя: 0 — пробника нет или он разбит. */
export function probeRange(unit: MechUnit): number {
  let best = 0;
  for (const zoneSlots of unit.slots) {
    for (const slot of zoneSlots) {
      if (slot.kind !== 'equipment' || slot.destroyed || slot.id === undefined) continue;
      const r = EQUIPMENT.get(slot.id)?.probeRange ?? 0;
      if (r > best) best = r;
    }
  }
  return best;
}

/** Радиус прикрытия ЭПП носителя: 0 — прибора нет или он разбит. */
export function ecmRange(unit: MechUnit): number {
  let best = 0;
  for (const zoneSlots of unit.slots) {
    for (const slot of zoneSlots) {
      if (slot.kind !== 'equipment' || slot.destroyed || slot.id === undefined) continue;
      const r = EQUIPMENT.get(slot.id)?.ecmRange ?? 0;
      if (r > best) best = r;
    }
  }
  return best;
}

/** Прикрыта ли клетка чужим ЭПП: работает по площади, а не по носителю. */
function underEcm(hex: Hex, carriers: readonly MechUnit[]): boolean {
  for (const c of carriers) {
    if (distance(c.hex, hex) <= ecmRange(c)) return true;
  }
  return false;
}

export interface DetectionInputs {
  readonly map: HexMap;
  /** Машины, которые смотрят: живые машины одной стороны. */
  readonly viewers: readonly MechUnit[];
  /** Машины противника, которых ищут. */
  readonly targets: readonly MechUnit[];
  /** Машины стороны цели, несущие ЭПП: прикрывают своих по площади. */
  readonly screens: readonly MechUnit[];
}

/**
 * Уровень контакта одной стороны по одной цели.
 *
 * Порядок внутри важен и читается сверху вниз как правило, а не как код:
 * сначала берётся лучшее, что даёт геометрия, потом это лучшее правят приборы,
 * и только «выдал себя стрельбой» не правится ничем — снявшись с места, от
 * собственных вспышек уже не спрячешься.
 */
export function contactLevel(inputs: DetectionInputs, target: MechUnit): ContactLevel {
  const { map, viewers, screens } = inputs;
  const det = COMBAT.detection;
  const screened = underEcm(target.hex, screens);

  // 0. Необнаруженная засада (шаг 73a) обесточена и сенсорам не видна дальше
  //    `ambush.spotRange`. Найти её можно, только пройдя рядом (проверка идёт и
  //    по траектории хода — `execute.ts::spotAlongPath`); обнаруженная дальше
  //    видна как обычная обесточенная машина. Отсюда и смысл разведчика впереди.
  if (
    target.dormant &&
    !target.spotted &&
    !viewers.some((v) => distance(v.hex, target.hex) <= COMBAT.ambush.spotRange)
  ) {
    return ContactLevel.None;
  }

  let best = ContactLevel.None;
  // Лучшее, что добыл ПРОБНИК внутри своего радиуса — этому ЭПП не помеха
  // (пара «один прячет, другой ищет» иначе работает в одну сторону, см. ниже).
  let probeBypass = ContactLevel.None;

  for (const viewer of viewers) {
    const probe = probeRange(viewer);
    const range = distance(viewer.hex, target.hex);

    // 1. Сенсоры задают ВНЕШНЮЮ границу знания, а не только нижний уровень:
    //    дальше неё машины нет вовсе, сколько бы чистой ни была линия. Иначе
    //    силуэт был бы виден через всю карту, и дальность сенсоров работала бы
    //    только там, где линия перекрыта, — то есть почти нигде.
    if (range > det.sensorRange + probe) continue;

    // Рельеф сенсорам не мешает — в этом и смысл нижнего уровня.
    let level: ContactLevel = ContactLevel.Blip;

    // 2. Прямая видимость даёт силуэт. Здесь в дело идёт вся карта разом:
    //    высоты, лес, здания, стены, дым — всё, что умеет `los`.
    const sight = los(map, viewer.hex, target.hex, {
      fromEye: eyeLevelOffset(viewer),
      toEye: eyeLevelOffset(target),
    });
    if (!sight.blocked) {
      if (level < ContactLevel.Silhouette) level = ContactLevel.Silhouette;

      // 3. Опознание: дистанция, укороченная укрытием по пути и укрытием самой
      //    цели. Лес не прячет от радара, но мешает разглядеть, кто там.
      const cover = sight.coverMod + sight.targetCover;
      const reach = Math.max(1, det.identifyRange - cover * det.identifyPenaltyPerCover);
      if (range <= reach) level = ContactLevel.Identified;
    }

    // 4. Пробник поднимает контакт на ступень в своём радиусе: он для того и
    //    ставится — разглядеть то, что сенсоры только нащупали.
    const probedHere = probe > 0 && range <= probe;
    if (probedHere && level < ContactLevel.Identified) {
      level = (level + 1) as ContactLevel;
    }

    if (level > best) best = level;
    // Контакт, добытый пробником В ЕГО радиусе, не подлежит срезу помехами
    // ниже (пункт 5): без этого ЭПП всегда сильнее пробника, а пара «один
    // прячет, другой ищет» — рабочая только для того, кто прячет (A1, шаг 8).
    if (probedHere && level > probeBypass) probeBypass = level;
  }

  // 5. ЭПП мешает ОПОЗНАНИЮ и только ему: под помехами машину видно, но не
  //    разобрать, чем она вооружена и насколько побита. Уровень срезается до
  //    силуэта и ниже не опускается никогда.
  //
  //    Первая версия роняла контакт на ступень с любого уровня, и силуэт
  //    превращался в засветку. Это дёргало тот же рычаг, что и вся разведка:
  //    штраф за стрельбу вслепую (+4) делал выстрел невыгодным, бот переставал
  //    стрелять, бой не доводился до конца. Замер на каталоге: 18.3 хода и
  //    14 % ничьих, которых не было ни на одном прошлом шаге.
  //
  //    Прикрывает площадь, а не носителя: иначе прибор защищал бы только того,
  //    кто его несёт, и переставал быть решением отряда.
  if (screened && best > ContactLevel.Silhouette) best = ContactLevel.Silhouette;
  // Пробник пробивает срез: то, что добыто ИМ в его радиусе, восстанавливается
  // поверх среза ЭПП, а не теряется вместе с ним (A1, шаг 8).
  if (probeBypass > best) best = probeBypass;

  // 6. Дважды открывший огонь опознан навсегда, и никакой прибор этого не
  //    отменяет: вспышка выстрела — не то, что прячут помехами.
  if (target.shotsSeen >= det.identifyAfterShots) return ContactLevel.Identified;

  return best;
}

/** Таблица контактов одной стороны по всем чужим машинам. */
export function computeContacts(
  map: HexMap,
  units: readonly MechUnit[],
  side: Side,
): Map<UnitId, ContactLevel> {
  // Ушедшая с поля машина (шаг 43) не видит и не видна: её на карте нет. Без
  // этой оговорки отход оставлял бы за собой призрачный контакт на краю карты,
  // к которому бот потом ходил бы всем звеном.
  const viewers = units.filter(
    (u) => u.side === side && !u.destroyed && !u.withdrawn && u.pilot.status === 'active',
  );
  const targets = units.filter((u) => u.side !== side && !u.destroyed && !u.withdrawn);
  const screens = units.filter(
    (u) => u.side !== side && !u.destroyed && !u.withdrawn && ecmRange(u) > 0,
  );

  const out = new Map<UnitId, ContactLevel>();
  for (const t of targets) {
    out.set(t.id, contactLevel({ map, viewers, targets, screens }, t));
  }
  return out;
}
