import { HitZone, isArm, isLeg, isVital } from '../model/HitZone.js';
import { zoneState, type MechUnit, type MountState, type ZoneState, type MechSlot } from '../model/MechUnit.js';

/**
 * Применение урона к зоне (wiki/design/combat/rules.md).
 *
 * Модель простая по замыслу: броня снаружи, структура под ней, зона разрушается,
 * когда структура исчерпана. При пробитии брони урон идёт в структуру.
 *
 * Сквозной урон: попадание в уже разрушенную зону переходит в торс. При
 * разрушении зоны избыточный урон (оверкилл) также переходит в торс, если
 * передача не заблокирована системой CASE (preventTransfer).
 */

export interface DamageOutcome {
  readonly unit: MechUnit;
  /** Зона, в которую урон пришёл фактически (может отличаться от заявленной). */
  readonly zone: HitZone;
  /** Заявленная зона: она была разрушена, урон ушёл сквозным. */
  readonly transferredFrom: HitZone | null;
  readonly amount: number;
  readonly armorBefore: number;
  readonly armorAfter: number;
  readonly structureBefore: number;
  readonly structureAfter: number;
  /** Броня выдержала: до структуры урон не дошёл. */
  readonly armorHeld: boolean;
  readonly zoneDestroyed: boolean;
  readonly mechDestroyed: boolean;
  /** Робот повалился: разрушена нога. */
  readonly fell: boolean;
  /** Оружие, потерянное вместе с зоной. */
  readonly weaponsLost: readonly string[];
}

export interface ApplyDamageOptions {
  /** Защита CASE: не передавать избыточный урон и урон разрушенной зоны в торс. */
  readonly preventTransfer?: boolean;
}

const TRANSFER_TO: HitZone = HitZone.Torso;

export function applyDamage(
  unit: MechUnit,
  requested: HitZone,
  amount: number,
  opts?: ApplyDamageOptions,
): DamageOutcome {
  if (amount <= 0) {
    const z = zoneState(unit, requested);
    return {
      unit,
      zone: requested,
      transferredFrom: null,
      amount: 0,
      armorBefore: z.armor,
      armorAfter: z.armor,
      structureBefore: z.structure,
      structureAfter: z.structure,
      armorHeld: true,
      zoneDestroyed: false,
      mechDestroyed: unit.destroyed,
      fell: false,
      weaponsLost: [],
    };
  }

  let zone = requested;
  let transferredFrom: HitZone | null = null;
  if (zoneState(unit, zone).destroyed && zone !== TRANSFER_TO) {
    if (opts?.preventTransfer) {
      const z = zoneState(unit, zone);
      return {
        unit,
        zone,
        transferredFrom: null,
        amount,
        armorBefore: z.armor,
        armorAfter: z.armor,
        structureBefore: z.structure,
        structureAfter: z.structure,
        armorHeld: true,
        zoneDestroyed: false,
        mechDestroyed: unit.destroyed,
        fell: false,
        weaponsLost: [],
      };
    }
    transferredFrom = zone;
    zone = TRANSFER_TO;
  }

  const before = zoneState(unit, zone);
  const absorbed = Math.min(before.armor, amount);
  const armorAfter = before.armor - absorbed;
  const throughArmor = amount - absorbed;
  const structureDamage = Math.min(before.structure, throughArmor);
  const structureAfter = Math.max(0, before.structure - structureDamage);
  const excess = throughArmor - structureDamage;

  const zoneDestroyed = !before.destroyed && structureAfter === 0;
  const armorHeld = throughArmor === 0;

  const zones: ZoneState[] = unit.zones.slice();
  zones[zone] = {
    ...before,
    armor: armorAfter,
    structure: structureAfter,
    destroyed: before.destroyed || zoneDestroyed,
  };

  // Разрушенная рука снимает установленное в ней вооружение и ячейки
  let mounts: readonly MountState[] = unit.mounts;
  const weaponsLost: string[] = [];
  let slots: readonly (readonly MechSlot[])[] = unit.slots;

  if (zoneDestroyed && isArm(zone)) {
    mounts = unit.mounts.map((m) => {
      if (m.zone !== zone || m.destroyed) return m;
      weaponsLost.push(m.weapon);
      return { ...m, destroyed: true };
    });
    if (slots[zone]) {
      const updatedZoneSlots = slots[zone]!.map((s) => ({ ...s, destroyed: true }));
      const newSlots = slots.slice();
      newSlots[zone] = updatedZoneSlots;
      slots = newSlots;
    }
  }

  if (zoneDestroyed && isLeg(zone) && slots[zone]) {
    const updatedZoneSlots = slots[zone]!.map((s) => ({ ...s, destroyed: true }));
    const newSlots = slots.slice();
    newSlots[zone] = updatedZoneSlots;
    slots = newSlots;
  }

  const fell = zoneDestroyed && isLeg(zone) && !unit.prone;
  // Оторванная нога выводит машину из боя так же безусловно, как разрушенный
  // торс или голова: обездвиженная навсегда машина — не боец (шаг 6, часть A).
  let mechDestroyed = unit.destroyed || (zoneDestroyed && (isVital(zone) || isLeg(zone)));

  const damageAppliedHere = amount - excess;
  let next: MechUnit = {
    ...unit,
    zones,
    mounts,
    slots,
    damageThisTurn: unit.damageThisTurn + damageAppliedHere,
    prone: unit.prone || fell,
    fellThisTurn: unit.fellThisTurn || fell,
    destroyed: mechDestroyed,
  };

  // Сквозной избыточный урон в торс (если зона разрушена и нет CASE)
  if (zoneDestroyed && excess > 0 && zone !== TRANSFER_TO && !opts?.preventTransfer && !mechDestroyed) {
    const excessOutcome = applyDamage(next, TRANSFER_TO, excess, opts);
    next = excessOutcome.unit;
    mechDestroyed = next.destroyed;
  }

  return {
    unit: next,
    zone,
    transferredFrom,
    amount,
    armorBefore: before.armor,
    armorAfter,
    structureBefore: before.structure,
    structureAfter,
    armorHeld,
    zoneDestroyed,
    mechDestroyed,
    fell,
    weaponsLost,
  };
}
