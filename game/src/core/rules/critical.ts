import { COMBAT, weapon } from '../data/tables.js';
import { HitZone, ZONE_COUNT } from '../model/HitZone.js';
import {
  hasCase,
  hasCase2,
  type MechSlot,
  type MechUnit,
  type SlotItemKind,
} from '../model/MechUnit.js';
import type { Rng } from '../rng/index.js';
import { applyDamage, type DamageOutcome } from './damage.js';
import { rollEjection, type EjectionResult } from './ejection.js';
import { rollInjury, type InjuryResult } from './injury.js';

/**
 * Критические попадания (wiki/design/combat/rules.md, шаг 4).
 *
 * Бросок на крит делается ТОЛЬКО при пробитии брони зоны (урон дошёл до структуры).
 * Два типа урона:
 *   - механическое (ballistic, missile) — 30 %
 *   - лучевое (energy) — 15 %
 *
 * Последствия:
 *   - Оружие: установка уничтожается (стрелять нельзя, зона цела)
 *   - Боезапас: детонация по обычным правилам урона (урон explosionDamage в зону)
 *   - Охладитель: падает рассеивание тепла
 *   - Реактор: 1-й/2-й крит +2 тепла/ход; 3-й крит — мех уничтожен через rollEjection('torso')
 *   - Гироскоп: 1-й крит +1 к Пилотированию; 2-й крит — мех падает навсегда
 *   - Кокпит: катапультирование по поводу 'head'
 *   - Привод: штраф к точности руки или подвижности ноги
 *   - Пустой слот / уже разрушенный: пробитие навылет без последствий
 */

export type CriticalEffect =
  | 'weaponDestroyed'
  | 'ammoExplosion'
  | 'heatsinkDamaged'
  | 'reactorHit'
  | 'reactorDestroyed'
  | 'gyroHit'
  | 'gyroDestroyed'
  | 'cockpitDestroyed'
  | 'sensorHit'
  | 'actuatorHit'
  | 'jumpJetDamaged'
  | 'equipmentDamaged'
  | 'empty';

export interface CriticalResult {
  readonly unit: MechUnit;
  readonly zone: HitZone;
  readonly slotIndex: number;
  readonly slotKind: SlotItemKind;
  readonly itemId?: string | undefined;
  readonly effect: CriticalEffect;
  readonly weaponLost?: string | undefined;
  readonly damageDealt?: number | undefined;
  /** Взрыв погашен внутри зоны системой CASE II. */
  readonly contained?: boolean | undefined;
  readonly explosionOutcome?: DamageOutcome | undefined;
  readonly injury?: InjuryResult | undefined;
  readonly ejection?: EjectionResult | undefined;
}

export interface CriticalCheck {
  readonly rolled: boolean;
  readonly success: boolean;
  readonly roll: number;
  readonly chance: number;
  readonly result: CriticalResult | null;
}

/** Шанс крита по категории оружия из боевых констант. */
export function criticalChanceFor(category: string): number {
  const cat = category as 'ballistic' | 'missile' | 'energy';
  return COMBAT.critical.chanceByCategory[cat] ?? 0.15;
}

/**
 * Проверка и бросок на критическое попадание при пробитии брони.
 */
export function rollCriticalHit(
  rng: Rng,
  skillRng: Rng,
  unit: MechUnit,
  zone: HitZone,
  weaponId: string,
  armorHeld: boolean,
): CriticalCheck {
  // Крит не бросается, если броня выдержала или юнит уже уничтожен
  if (armorHeld || unit.destroyed) {
    return { rolled: false, success: false, roll: 0, chance: 0, result: null };
  }

  const w = weapon(weaponId);
  const chance = criticalChanceFor(w.category);
  const roll = rng.next();
  const success = roll < chance;

  if (!success) {
    return { rolled: true, success: false, roll, chance, result: null };
  }

  const result = resolveCriticalSlot(rng, skillRng, unit, zone);
  return { rolled: true, success: true, roll, chance, result };
}

/**
 * Разрешение детонации конкретной пачки боезапаса в зоне.
 * Используется как при крите ячейки боезапаса, так и при тепловой детонации.
 */
export function triggerAmmoExplosion(
  skillRng: Rng,
  unit: MechUnit,
  zone: HitZone,
  slotIndex: number,
  slot: MechSlot,
): CriticalResult {
  // Пачка без заявленного урона детонации не детонирует. Подставлять сюда
  // «типичное» число нельзя: разброс в данных от 0 (болванки Гаусса) до 400
  // (ящик пулемётных патронов), и любая догадка здесь решает судьбу машины.
  const damage = slot.explosionDamage ?? 0;
  const newSlots = unit.slots.map((arr) => arr.slice());
  if (newSlots[zone] && newSlots[zone]![slotIndex]) {
    newSlots[zone]![slotIndex] = { ...slot, destroyed: true };
  }

  // Снаряды Гаусса (0 урона) не взрываются — это болванки
  if (damage <= 0) {
    return {
      unit: { ...unit, slots: newSlots },
      zone,
      slotIndex,
      slotKind: 'ammo',
      itemId: slot.id,
      effect: 'ammoExplosion',
      damageDealt: 0,
      contained: false,
    };
  }

  const case2 = hasCase2(unit, zone);
  const case1 = hasCase(unit, zone);

  // CASE II гасит взрыв внутри зоны (наносит 1 урон и останавливает передачу)
  // Обычный CASE останавливает передачу избытка в соседнюю зону
  const explosionDamage = case2 ? 1 : damage;
  const preventTransfer = case1 || case2;

  const outcome = applyDamage(
    { ...unit, slots: newSlots },
    zone,
    explosionDamage,
    { preventTransfer },
  );

  let expUnit = outcome.unit;
  let ejection: EjectionResult | undefined;
  let injury: InjuryResult | undefined;

  // Не наказывать дважды:
  // Если взрыв уничтожил робота — катапультирование через rollEjection('torso') (ранение при приземлении 45 %)
  // Если робот уцелел — бросок ранения по причине ammoExplosion (40 %)
  if (expUnit.destroyed) {
    ejection = rollEjection(skillRng, expUnit, 'torso');
    expUnit = ejection.unit;
  } else if (expUnit.pilot.status === 'active') {
    injury = rollInjury(skillRng, expUnit.pilot, 'ammoExplosion');
    expUnit = { ...expUnit, pilot: injury.pilot };
    if (expUnit.pilot.status !== 'active') {
      expUnit = { ...expUnit, destroyed: true };
    }
  }

  return {
    unit: expUnit,
    zone,
    slotIndex,
    slotKind: 'ammo',
    itemId: slot.id,
    effect: 'ammoExplosion',
    damageDealt: explosionDamage,
    contained: case2,
    explosionOutcome: outcome,
    injury,
    ejection,
  };
}

/**
 * Выбор случайной ячейки в зоне и применение последствий крита.
 */
export function resolveCriticalSlot(
  rng: Rng,
  skillRng: Rng,
  unit: MechUnit,
  zone: HitZone,
): CriticalResult {
  const zoneSlots = unit.slots[zone] ?? [];
  if (zoneSlots.length === 0) {
    return {
      unit,
      zone,
      slotIndex: 0,
      slotKind: 'empty',
      effect: 'empty',
    };
  }

  const slotIndex = Math.floor(rng.next() * zoneSlots.length);
  const slot = zoneSlots[slotIndex]!;

  // Если ячейка уже разрушена — прошло навылет
  if (slot.destroyed) {
    return {
      unit,
      zone,
      slotIndex,
      slotKind: slot.kind,
      itemId: slot.id,
      effect: 'empty',
    };
  }

  // В пустой и служебной ячейке ломаться нечему: крит проходит насквозь и
  // ничего не помечает. Раньше метка «выбито» ставилась до разбора, что стоит
  // в ячейке, и уезжала в запись машины: ремонт брал деньги за пустоту, а
  // мехлаб считал зону повреждённой и запрещал снимать из неё целое железо
  // (плейтест 2026-09-15). Бросок ячейки остаётся прежним — ГПСЧ тянется так же.
  if (slot.kind === 'empty' || slot.kind === 'fixed') {
    return { unit, zone, slotIndex, slotKind: slot.kind, effect: 'empty' };
  }

  // Клонируем раскладку слотов
  const newSlots = unit.slots.map((arr) => arr.slice());
  newSlots[zone]![slotIndex] = { ...slot, destroyed: true };

  switch (slot.kind) {
    case 'weapon': {
      const mountIndex = slot.mountIndex;
      let mounts = unit.mounts;
      let weaponNameStr: string | undefined;

      if (mountIndex !== undefined && mounts[mountIndex]) {
        const m = mounts[mountIndex]!;
        weaponNameStr = m.weapon;
        mounts = unit.mounts.map((it, idx) => (idx === mountIndex ? { ...it, destroyed: true } : it));

        // Помечаем все ячейки этого орудия как разрушенные
        for (let z = 0; z < ZONE_COUNT; z++) {
          if (newSlots[z]) {
            newSlots[z] = newSlots[z]!.map((s) =>
              s.kind === 'weapon' && s.mountIndex === mountIndex ? { ...s, destroyed: true } : s,
            );
          }
        }
      }

      return {
        unit: { ...unit, slots: newSlots, mounts },
        zone,
        slotIndex,
        slotKind: 'weapon',
        itemId: slot.id,
        weaponLost: weaponNameStr,
        effect: 'weaponDestroyed',
      };
    }

    case 'ammo':
      return triggerAmmoExplosion(skillRng, unit, zone, slotIndex, slot);

    case 'heatsink':
      return {
        unit: { ...unit, slots: newSlots },
        zone,
        slotIndex,
        slotKind: 'heatsink',
        itemId: slot.id,
        effect: 'heatsinkDamaged',
      };

    case 'reactor': {
      const reactorHits = unit.reactorHits + 1;
      if (reactorHits >= COMBAT.critical.reactor.maxHits) {
        const destroyedUnit: MechUnit = {
          ...unit,
          slots: newSlots,
          reactorHits,
          destroyed: true,
        };
        const ejection = rollEjection(skillRng, destroyedUnit, 'torso');
        return {
          unit: ejection.unit,
          zone,
          slotIndex,
          slotKind: 'reactor',
          effect: 'reactorDestroyed',
          ejection,
        };
      }
      return {
        unit: { ...unit, slots: newSlots, reactorHits },
        zone,
        slotIndex,
        slotKind: 'reactor',
        effect: 'reactorHit',
      };
    }

    case 'gyro': {
      const gyroHits = unit.gyroHits + 1;
      if (gyroHits >= COMBAT.critical.gyro.maxHits) {
        // Второй крит гироскопа выводит машину из боя так же, как оторванная
        // нога (шаг 6, часть E): начинка торса повреждена насмерть, драться
        // больше нечем. `destroyed` здесь запускает тот же rollEjection('torso')
        // в attack.ts, что и любая другая гибель — отдельной ветки нет.
        return {
          unit: {
            ...unit,
            slots: newSlots,
            gyroHits,
            prone: true,
            fellThisTurn: true,
            destroyed: true,
          },
          zone,
          slotIndex,
          slotKind: 'gyro',
          effect: 'gyroDestroyed',
        };
      }
      return {
        unit: { ...unit, slots: newSlots, gyroHits },
        zone,
        slotIndex,
        slotKind: 'gyro',
        effect: 'gyroHit',
      };
    }

    case 'cockpit': {
      const ejection = rollEjection(skillRng, { ...unit, slots: newSlots }, 'head');
      return {
        unit: ejection.unit,
        zone,
        slotIndex,
        slotKind: 'cockpit',
        effect: 'cockpitDestroyed',
        ejection,
      };
    }

    case 'sensor': {
      const sensorHits = unit.sensorHits + 1;
      return {
        unit: { ...unit, slots: newSlots, sensorHits },
        zone,
        slotIndex,
        slotKind: 'sensor',
        effect: 'sensorHit',
      };
    }

    case 'arm_actuator': {
      const armIdx = zone === HitZone.LeftArm ? 0 : 1;
      const armActuatorHits: [number, number] = [
        unit.armActuatorHits[0] + (armIdx === 0 ? 1 : 0),
        unit.armActuatorHits[1] + (armIdx === 1 ? 1 : 0),
      ];
      return {
        unit: { ...unit, slots: newSlots, armActuatorHits },
        zone,
        slotIndex,
        slotKind: 'arm_actuator',
        itemId: slot.id,
        effect: 'actuatorHit',
      };
    }

    case 'leg_actuator': {
      const legIdx = zone === HitZone.LeftLeg ? 0 : 1;
      const legActuatorHits: [number, number] = [
        unit.legActuatorHits[0] + (legIdx === 0 ? 1 : 0),
        unit.legActuatorHits[1] + (legIdx === 1 ? 1 : 0),
      ];
      return {
        unit: { ...unit, slots: newSlots, legActuatorHits },
        zone,
        slotIndex,
        slotKind: 'leg_actuator',
        itemId: slot.id,
        effect: 'actuatorHit',
      };
    }

    case 'jump_jet':
      return {
        unit: { ...unit, slots: newSlots },
        zone,
        slotIndex,
        slotKind: 'jump_jet',
        itemId: slot.id,
        effect: 'jumpJetDamaged',
      };

    case 'equipment':
      return {
        unit: { ...unit, slots: newSlots },
        zone,
        slotIndex,
        slotKind: 'equipment',
        itemId: slot.id,
        effect: 'equipmentDamaged',
      };

    default:
      return {
        unit: { ...unit, slots: newSlots },
        zone,
        slotIndex,
        slotKind: slot.kind,
        effect: 'empty',
      };
  }
}
